//! Tauri command layer for PassForge.
//!
//! The `#[tauri::command]` functions in this module are thin wrappers over the
//! already-tested `VaultDb`, `SessionState`, and `lesspass_core` functions. The
//! non-trivial logic (fingerprint synthesis and password derivation) lives in
//! pure helper functions so it can be unit-tested without spinning up a Tauri
//! runtime.

use crate::db::VaultDb;
use crate::error::{PassForgeError, Result};
use crate::models::{
    EntryInput, EntrySummary, PasskeyRecord, Folder, FolderInput, GenerationMode, ImportReport, Settings,
    VaultEntry, VaultExport,
};
use crate::keychain::SecretStore;
use crate::remote;
use crate::session::SessionState;
use passforge_protocol::{DeriveResponse, blind, finish_password};
use zeroize::{Zeroize, Zeroizing};
use lesspass_core::{
    build_fingerprint_hash, calc_entropy, create_fingerprint, render_password, CryptoConfig,
    Fingerprint, PasswordProfile,
};
use std::sync::{Arc, Mutex};
use tauri::State;

/// Process-wide application state managed by Tauri.
///
/// The database is the SQLCipher vault file (see `vault.rs`). The settings
/// mutex guards the global default crypto config and idle/clipboard timing.
pub struct AppState {
    pub db: std::sync::Arc<Mutex<VaultDb>>,
}

/// Every vault command requires an unlocked session; using the app counts
/// as activity for the idle timer.
pub fn require_unlocked(session: &SessionState) -> Result<()> {
    if session.is_locked() {
        return Err(PassForgeError::Locked);
    }
    session.touch();
    Ok(())
}

pub fn load_settings(db: &VaultDb) -> Settings {
    db.get_kv("settings")
        .ok()
        .flatten()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-testable without a Tauri runtime)
// ---------------------------------------------------------------------------

/// Attach a stable per-entry fingerprint to each search result.
///
/// The fingerprint is derived from the entry's login (not the generated
/// password) so the vault list view can render icons without requiring an
/// unlocked session. This is an intentional v1 simplification: rotation
/// detection is deferred until `generate_password` is the sole producer.
pub fn synthesize_fingerprints(entries: &mut [EntrySummary]) -> Result<()> {
    for entry in entries.iter_mut() {
        let hash = build_fingerprint_hash(&entry.login);
        entry.fingerprint = Some(
            create_fingerprint(&hash).map_err(|err| PassForgeError::InvalidRequest(err.to_string()))?,
        );
    }
    Ok(())
}

/// Derive a deterministic password for a vault entry.
///
/// Uses the entry's per-profile crypto override when present, otherwise falls
/// back to the global default from settings. The caller is responsible for
/// obtaining the master password from the unlocked session and for marking the
/// entry as used after a successful render.
pub fn derive_password(
    entry: &VaultEntry,
    master_password: &str,
    settings: &Settings,
) -> Result<String> {
    derive_password_with(entry, master_password, settings, remote::derive)
}

pub fn derive_password_with<F>(
    entry: &VaultEntry,
    master_password: &str,
    settings: &Settings,
    remote: F,
) -> Result<String>
where
    F: FnOnce(&str, Option<&str>, &str) -> Result<DeriveResponse>,
{
    derive_profile_password_with(&entry.profile, master_password, settings, remote)
}

/// Derive a password for an ad-hoc profile (one that need not exist in the
/// vault), honoring the configured generation mode. This is what the local
/// API's `/api/generate` uses so external frontends follow the same
/// serverless / algorithm-server setting as the desktop UI.
pub fn derive_profile_password(
    profile: &PasswordProfile,
    master_password: &str,
    settings: &Settings,
) -> Result<String> {
    derive_profile_password_with(profile, master_password, settings, remote::derive)
}

pub fn derive_profile_password_with<F>(
    profile: &PasswordProfile,
    master_password: &str,
    settings: &Settings,
    remote: F,
) -> Result<String>
where
    F: FnOnce(&str, Option<&str>, &str) -> Result<DeriveResponse>,
{
    profile.options.validate()?;
    match &settings.generation {
        GenerationMode::Serverless => {
            let crypto: CryptoConfig = profile
                .crypto
                .clone()
                .unwrap_or_else(|| settings.default_crypto.clone());
            crypto.validate()?;
            let entropy = calc_entropy(profile, master_password, &crypto);
            render_password(&entropy, &profile.options)
                .map_err(|err| PassForgeError::InvalidRequest(err.to_string()))
        }
        GenerationMode::Server { url, algorithm } => {
            let url = remote::normalize_server_url(url)?;
            let blinded = blind(profile, master_password, &settings.default_crypto);
            let response = remote(&url, algorithm.as_deref(), &blinded.input_hex())?;
            let output = hex::decode(&response.output)
                .map_err(|_| PassForgeError::Remote("server returned invalid output hex".into()))?;
            finish_password(&blinded, &output, &profile.options)
                .map_err(|err| PassForgeError::Remote(format!("invalid server output: {err}")))
        }
    }
}

// ---------------------------------------------------------------------------
// Session commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn is_locked(session: State<SessionState>) -> bool {
    session.is_locked()
}

#[tauri::command]
pub fn unlock_with_master_password(
    master_password: String,
    session: State<SessionState>,
) -> Result<()> {
    session.unlock(master_password.into_bytes())
}

#[tauri::command]
pub fn record_activity(session: State<SessionState>) {
    session.touch();
}

/// Whether this device supports biometric unlock (Touch ID hardware +
/// enrolled fingerprint). macOS only; false elsewhere.
#[tauri::command]
pub fn biometric_supported() -> bool {
    crate::biometric::available()
}

/// Whether a master password is stored in the platform secret store, so
/// Touch ID unlock can actually be offered.
#[tauri::command]
pub fn master_password_stored() -> bool {
    crate::vault::resolved_secret_store()
        .and_then(|store| store.load_master_password())
        .map(|pw| pw.is_some())
        .unwrap_or(false)
}

/// Touch ID → reads the Keychain-stored master password → unlocks.
/// Convenience only: opt-in storage happens via `remember_master_password`.
#[tauri::command]
pub fn biometric_unlock(session: State<SessionState>) -> Result<()> {
    crate::biometric::authenticate("unlock PassForge")?;
    let master = crate::vault::resolved_secret_store()?
        .load_master_password()?
        .ok_or_else(|| {
            PassForgeError::InvalidRequest(
                "no master password stored in the keychain".into(),
            )
        })?;
    session.unlock(master)
}

/// Stores the current session's master password in the platform secret
/// store so Touch ID can unlock next time. Explicit opt-in.
#[tauri::command]
pub fn remember_master_password(session: State<SessionState>) -> Result<()> {
    require_unlocked(&session)?;
    let bytes = session.master_password_bytes()?;
    crate::vault::resolved_secret_store()?.save_master_password(&bytes)
}

/// Removes the Keychain-stored master password (disables Touch ID unlock).
#[tauri::command]
pub fn forget_master_password() -> Result<()> {
    crate::vault::resolved_secret_store()?.delete_master_password()
}

#[tauri::command]
pub fn lock(session: State<SessionState>) -> Result<()> {
    session.lock()
}

/// Preview the master-password fingerprint shown on the lock screen while
/// typing. Derived from the master password alone via the same LessPass
/// fingerprint pipeline used elsewhere.
pub fn master_fingerprint(master_password: &str) -> Result<Fingerprint> {
    create_fingerprint(&build_fingerprint_hash(master_password))
        .map_err(|err| PassForgeError::InvalidRequest(err.to_string()))
}

// ---------------------------------------------------------------------------
// Vault commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn create_folder(input: FolderInput, state: State<AppState>, session: State<SessionState>) -> Result<Folder> {
    require_unlocked(&session)?;
    state.db.lock().expect("db mutex poisoned").create_folder(input)
}

#[tauri::command]
pub fn create_entry(input: crate::models::EntryInput, state: State<AppState>, session: State<SessionState>) -> Result<VaultEntry> {
    require_unlocked(&session)?;
    state.db.lock().expect("db mutex poisoned").create_entry(input)
}

#[tauri::command]
pub fn list_folders(state: State<AppState>, session: State<SessionState>) -> Result<Vec<Folder>> {
    require_unlocked(&session)?;
    state.db.lock().expect("db mutex poisoned").list_folders()
}

#[tauri::command]
pub fn get_entry(entry_id: String, state: State<AppState>, session: State<SessionState>) -> Result<VaultEntry> {
    require_unlocked(&session)?;
    state
        .db
        .lock()
        .expect("db mutex poisoned")
        .get_entry(&entry_id)?
        .ok_or(PassForgeError::EntryNotFound(entry_id))
}

#[tauri::command]
pub fn update_entry(
    entry_id: String,
    input: EntryInput,
    state: State<AppState>,
    session: State<SessionState>,
) -> Result<VaultEntry> {
    require_unlocked(&session)?;
    state
        .db
        .lock()
        .expect("db mutex poisoned")
        .update_entry(&entry_id, input)
}

#[tauri::command]
pub fn delete_entry(entry_id: String, state: State<AppState>, session: State<SessionState>) -> Result<()> {
    require_unlocked(&session)?;
    state
        .db
        .lock()
        .expect("db mutex poisoned")
        .delete_entry(&entry_id)
}

#[tauri::command]
pub fn preview_fingerprint(master_password: String) -> Result<Fingerprint> {
    master_fingerprint(&master_password)
}

#[tauri::command]
pub fn search_entries(query: String, state: State<AppState>, session: State<SessionState>) -> Result<Vec<EntrySummary>> {
    require_unlocked(&session)?;
    let mut entries = state.db.lock().expect("db mutex poisoned").search_entries(&query)?;
    synthesize_fingerprints(&mut entries)?;
    Ok(entries)
}

/// Generate the password for a vault entry using the unlocked session's
/// master password, then mark the entry used. Shared by the IPC command and
/// the local API (`POST /api/entries/{id}/generate`). Derivation runs off
/// the async executor because server mode blocks on HTTP.
pub async fn generate_entry_password(
    db: &Arc<Mutex<VaultDb>>,
    session: &SessionState,
    entry_id: &str,
) -> Result<String> {
    require_unlocked(session)?;
    {
        let db = db.lock().expect("db mutex poisoned");
        if let Some(sealed) = db.get_sealed(entry_id)? {
            let root = session.root_key("passforge-seal-root-v1")?;
            let password = crate::seal::unseal(&root, entry_id, &sealed)?;
            db.mark_used(entry_id)?;
            return Ok((*password).clone());
        }
    }
    let (entry, settings, master_bytes) = {
        let db = db.lock().expect("db mutex poisoned");
        let entry = db
            .get_entry(entry_id)?
            .ok_or_else(|| PassForgeError::EntryNotFound(entry_id.to_string()))?;
        let settings = load_settings(&db);
        let master_bytes = session.master_password_bytes()?;
        (entry, settings, master_bytes)
    };
    let master_bytes = Zeroizing::new(master_bytes);
    let password = tokio::task::spawn_blocking(move || {
        let mut master_bytes = master_bytes;
        let master_password = match String::from_utf8(std::mem::take(&mut *master_bytes)) {
            Ok(password) => Zeroizing::new(password),
            Err(error) => {
                let mut bytes = error.into_bytes();
                bytes.zeroize();
                return Err(PassForgeError::InvalidRequest(
                    "master password is not valid UTF-8".into(),
                ));
            }
        };
        derive_password(&entry, &master_password, &settings)
    })
    .await
    .map_err(|_| PassForgeError::InvalidRequest("password generation task failed".into()))??;
    db.lock().expect("db mutex poisoned").mark_used(entry_id)?;
    Ok(password)
}

#[tauri::command]
pub async fn generate_password(
    entry_id: String,
    state: State<'_, AppState>,
    session: State<'_, SessionState>,
) -> Result<String> {
    generate_entry_password(&state.db, &session, &entry_id).await
}

/// Port + bearer token of the embedded local API, so the desktop UI can be
/// a client of the same backend the extension uses. Same process, same
/// trust domain — the token never leaves the app.
#[tauri::command]
pub fn backend_info() -> Result<serde_json::Value> {
    let db_path = crate::vault::resolved_db_path()?;
    let dir = db_path
        .parent()
        .ok_or_else(|| PassForgeError::InvalidRequest("bad vault path".into()))?;
    let port = crate::api::read_port(dir)
        .ok_or_else(|| PassForgeError::InvalidRequest("local API is not running".into()))?;
    let token = crate::api::read_token(dir)
        .ok_or_else(|| PassForgeError::InvalidRequest("api token is missing".into()))?;
    Ok(serde_json::json!({ "port": port, "token": token }))
}

#[tauri::command]
pub async fn server_info(
    url: String,
    session: State<'_, SessionState>,
) -> Result<passforge_protocol::InfoResponse> {
    require_unlocked(&session)?;
    let url = remote::normalize_server_url(&url)?;
    tauri::async_runtime::spawn_blocking(move || remote::fetch_info(&url))
        .await
        .map_err(|_| PassForgeError::Remote("server info task failed".into()))?
}

// ---------------------------------------------------------------------------
// Settings commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_settings(state: State<AppState>, session: State<SessionState>) -> Result<Settings> {
    require_unlocked(&session)?;
    let db = state.db.lock().expect("db mutex poisoned");
    Ok(load_settings(&db))
}

/// Validate, normalize and persist settings (shared by IPC and the API).
pub fn persist_settings(
    db: &VaultDb,
    session: &SessionState,
    mut settings: Settings,
) -> Result<Settings> {
    require_unlocked(session)?;
    settings.default_crypto.validate()?;
    if let GenerationMode::Server { url, .. } = &mut settings.generation {
        *url = remote::normalize_server_url(url)?;
    }
    let mut known = Vec::new();
    for url in &settings.known_servers {
        let url = remote::normalize_server_url(url)?;
        if !known.contains(&url) {
            known.push(url);
        }
    }
    settings.known_servers = known;
    session.set_idle_timeout(settings.idle_lock_seconds);
    db.set_kv("settings", &serde_json::to_string(&settings)?)?;
    Ok(settings)
}

#[tauri::command]
pub fn save_settings(
    settings: Settings,
    state: State<AppState>,
    session: State<SessionState>,
) -> Result<Settings> {
    let db = state.db.lock().expect("db mutex poisoned");
    persist_settings(&db, &session, settings)
}

// ---------------------------------------------------------------------------
// Backup commands
// ---------------------------------------------------------------------------

/// Preview a sealed entry's migration: current = unsealed legacy password,
/// next = a fresh derive of the entry's profile ignoring the seal.
pub async fn migration_preview_inner(
    db: &Arc<Mutex<VaultDb>>,
    session: &SessionState,
    entry_id: &str,
) -> Result<serde_json::Value> {
    require_unlocked(session)?;
    let (entry, sealed, settings, master_bytes) = {
        let db = db.lock().expect("db mutex poisoned");
        let entry = db
            .get_entry(entry_id)?
            .ok_or_else(|| PassForgeError::EntryNotFound(entry_id.to_string()))?;
        let sealed = db
            .get_sealed(entry_id)?
            .ok_or_else(|| PassForgeError::InvalidRequest("entry is not sealed".into()))?;
        (entry, sealed, load_settings(&db), session.master_password_bytes()?)
    };
    let root = session.root_key("passforge-seal-root-v1")?;
    let current = crate::seal::unseal(&root, entry_id, &sealed)?;
    let master_bytes = Zeroizing::new(master_bytes);
    let next = tokio::task::spawn_blocking(move || {
        let mut b = master_bytes;
        let master = String::from_utf8(std::mem::take(&mut *b))
            .map_err(|e| { let mut x = e.into_bytes(); x.zeroize(); PassForgeError::InvalidRequest("master password is not valid UTF-8".into()) })?;
        derive_password(&entry, &master, &settings)
    })
    .await
    .map_err(|_| PassForgeError::InvalidRequest("derive task failed".into()))??;
    Ok(serde_json::json!({ "current": *current, "next": next }))
}

/// Finish a migration: clear the seal, keep the entry as generated, bump
/// the migrated counter used by the sidebar progress.
pub async fn complete_migration_inner(
    db: &Arc<Mutex<VaultDb>>,
    session: &SessionState,
    entry_id: &str,
) -> Result<VaultEntry> {
    require_unlocked(session)?;
    let db = db.lock().expect("db mutex poisoned");
    if db.get_sealed(entry_id)?.is_none() {
        return Err(PassForgeError::InvalidRequest("entry is not sealed".into()));
    }
    db.set_sealed(entry_id, None)?;
    let stats = db.get_kv("migration_stats")?.unwrap_or_default();
    let n: i64 = serde_json::from_str::<serde_json::Value>(&stats)
        .ok()
        .and_then(|v| v["migrated"].as_i64())
        .unwrap_or(0);
    db.set_kv("migration_stats", &serde_json::json!({"migrated": n + 1}).to_string())?;
    db.get_entry(entry_id)?.ok_or(PassForgeError::EntryNotFound(entry_id.to_string()))
}

#[tauri::command]
pub async fn migration_preview(entry_id: String, state: State<'_, AppState>, session: State<'_, SessionState>) -> Result<serde_json::Value> {
    migration_preview_inner(&state.db, &session, &entry_id).await
}

#[tauri::command]
pub async fn complete_migration(entry_id: String, state: State<'_, AppState>, session: State<'_, SessionState>) -> Result<VaultEntry> {
    complete_migration_inner(&state.db, &session, &entry_id).await
}

#[tauri::command]
pub fn list_sealed(state: State<AppState>, session: State<SessionState>) -> Result<serde_json::Value> {
    require_unlocked(&session)?;
    let db = state.db.lock().expect("db mutex poisoned");
    let mut entries = db.search_entries("")?;
    entries.retain(|e| e.kind == crate::models::EntryKind::Sealed);
    synthesize_fingerprints(&mut entries)?;
    let stats = db.get_kv("migration_stats")?.unwrap_or_default();
    let migrated = serde_json::from_str::<serde_json::Value>(&stats)
        .ok()
        .and_then(|v| v["migrated"].as_u64())
        .unwrap_or(0);
    Ok(serde_json::json!({ "entries": entries, "migrated": migrated }))
}

/// Import passwords from a CSV/JSON file — IPC only, so the plaintext file
/// never crosses the loopback API.
#[tauri::command]
pub fn list_passkeys(state: State<AppState>, session: State<SessionState>) -> Result<Vec<PasskeyRecord>> {
    require_unlocked(&session)?;
    let db = state.db.lock().expect("db mutex poisoned");
    db.list_passkeys(None)
}

#[tauri::command]
pub fn delete_passkey(id: String, state: State<AppState>, session: State<SessionState>) -> Result<bool> {
    require_unlocked(&session)?;
    let db = state.db.lock().expect("db mutex poisoned");
    db.delete_passkey(&id)
}

#[tauri::command]
pub async fn import_passwords(path: String, state: State<'_, AppState>, session: State<'_, SessionState>) -> Result<serde_json::Value> {
    require_unlocked(&session)?;
    let content = std::fs::read_to_string(&path)
        .map_err(|e| PassForgeError::InvalidRequest(format!("cannot read {path}: {e}")))?;
    let parsed = crate::import::parse(&content)?;
    let settings = {
        let db = state.db.lock().expect("db mutex poisoned");
        load_settings(&db)
    };
    let db = state.db.clone();
    let session = session.inner().clone();
    let report = tokio::task::spawn_blocking(move || {
        crate::import::import_credentials(&db, &session, &settings, parsed)
    })
    .await
    .map_err(|_| PassForgeError::InvalidRequest("import task failed".into()))??;
    serde_json::to_value(report).map_err(Into::into)
}

/// Write every folder and entry profile to `path` as JSON. The export holds
/// no generated passwords (PassForge never stores them) but is still
/// sensitive metadata.
#[tauri::command]
pub fn export_vault(path: String, state: State<AppState>, session: State<SessionState>) -> Result<()> {
    require_unlocked(&session)?;
    let db = state.db.lock().expect("db mutex poisoned");
    let export = VaultExport {
        version: 2,
        exported_at: chrono::Utc::now().to_rfc3339(),
        folders: db.list_folders()?,
        entries: db
            .list_all_entries()?
            .into_iter()
            .map(|entry| crate::models::ExportedEntry {
                sealed: db.get_sealed(&entry.id).ok().flatten(),
                entry,
            })
            .collect(),
        passkeys: db.list_passkeys(None)?,
    };
    std::fs::write(&path, serde_json::to_string_pretty(&export)?)?;
    Ok(())
}

/// Merge an export file into the vault. Entries/folders are matched by id and
/// existing rows are skipped, so re-importing the same file is a no-op.
#[tauri::command]
pub fn import_vault(
    path: String,
    state: State<AppState>,
    session: State<SessionState>,
) -> Result<ImportReport> {
    require_unlocked(&session)?;
    let json = std::fs::read_to_string(&path)?;
    let export: VaultExport = serde_json::from_str(&json).map_err(|e| {
        PassForgeError::InvalidRequest(format!("not a PassForge export file: {e}"))
    })?;
    if export.version != 1 {
        return Err(PassForgeError::InvalidRequest(format!(
            "unsupported export version {}",
            export.version
        )));
    }
    state.db.lock().expect("db mutex poisoned").import_export(&export)
}

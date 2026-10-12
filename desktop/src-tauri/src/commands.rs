//! Tauri command layer for PassForge.
//!
//! The `#[tauri::command]` functions in this module are thin wrappers over the
//! already-tested `VaultDb`, `SessionState`, and `lesspass_core` functions. The
//! non-trivial logic (fingerprint synthesis and password derivation) lives in
//! pure helper functions so it can be unit-tested without spinning up a Tauri
//! runtime.

use crate::db::VaultDb;
use crate::error::{PassForgeError, Result};
use crate::models::{EntryInput, EntrySummary, Folder, FolderInput, Settings, VaultEntry};
use crate::keychain::SecretStore;
use crate::session::SessionState;
use zeroize::Zeroize;
use lesspass_core::{
    build_fingerprint_hash, calc_entropy, create_fingerprint, render_password, CryptoConfig,
    Fingerprint,
};
use std::sync::Mutex;
use tauri::State;

/// Process-wide application state managed by Tauri.
///
/// The database is in-memory for v1 (persistence deferred to a later task). The
/// settings mutex guards the global default crypto config and idle/clipboard
/// timing.
pub struct AppState {
    pub db: Mutex<VaultDb>,
}

/// Every vault command requires an unlocked session; using the app counts
/// as activity for the idle timer.
fn require_unlocked(session: &SessionState) -> Result<()> {
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
    let crypto: CryptoConfig = entry
        .profile
        .crypto
        .clone()
        .unwrap_or_else(|| settings.default_crypto.clone());
    let entropy = calc_entropy(&entry.profile, master_password, &crypto);
    render_password(&entropy, &entry.profile.options)
        .map_err(|err| PassForgeError::InvalidRequest(err.to_string()))
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

#[tauri::command]
pub fn generate_password(
    entry_id: String,
    state: State<AppState>,
    session: State<SessionState>,
) -> Result<String> {
    let mut master_bytes = session.master_password_bytes()?;
    let mut master_password = String::from_utf8(std::mem::take(&mut master_bytes))
        .map_err(|err| {
            master_bytes.zeroize();
            PassForgeError::InvalidRequest(format!("master password is not valid UTF-8: {err}"))
        })?;
    let db = state.db.lock().expect("db mutex poisoned");
    let settings = load_settings(&db);
    let entry = db
        .get_entry(&entry_id)?
        .ok_or_else(|| PassForgeError::EntryNotFound(entry_id.clone()))?;
    let password = derive_password(&entry, &master_password, &settings);
    master_password.zeroize();
    let password = password?;
    db.mark_used(&entry_id)?;
    Ok(password)
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

#[tauri::command]
pub fn save_settings(
    settings: Settings,
    state: State<AppState>,
    session: State<SessionState>,
) -> Result<Settings> {
    require_unlocked(&session)?;
    session.set_idle_timeout(settings.idle_lock_seconds);
    let db = state.db.lock().expect("db mutex poisoned");
    db.set_kv("settings", &serde_json::to_string(&settings)?)?;
    Ok(settings)
}

//! Tauri command layer for PassForge.
//!
//! The `#[tauri::command]` functions in this module are thin wrappers over the
//! already-tested `VaultDb`, `SessionState`, and `lesspass_core` functions. The
//! non-trivial logic (fingerprint synthesis and password derivation) lives in
//! pure helper functions so it can be unit-tested without spinning up a Tauri
//! runtime.

use crate::db::VaultDb;
use crate::error::{PassForgeError, Result};
use crate::models::{EntrySummary, Folder, FolderInput, Settings, VaultEntry};
use crate::session::SessionState;
use lesspass_core::{
    build_fingerprint_hash, calc_entropy, create_fingerprint, render_password, CryptoConfig,
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
    pub settings: Mutex<Settings>,
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
pub fn lock(session: State<SessionState>) -> Result<()> {
    session.lock()
}

// ---------------------------------------------------------------------------
// Vault commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn create_folder(input: FolderInput, state: State<AppState>) -> Result<Folder> {
    state.db.lock().expect("db mutex poisoned").create_folder(input)
}

#[tauri::command]
pub fn create_entry(input: crate::models::EntryInput, state: State<AppState>) -> Result<VaultEntry> {
    state.db.lock().expect("db mutex poisoned").create_entry(input)
}

#[tauri::command]
pub fn search_entries(query: String, state: State<AppState>) -> Result<Vec<EntrySummary>> {
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
    let master_password =
        String::from_utf8(session.master_password_bytes()?)
            .map_err(|_| PassForgeError::InvalidRequest("master password is not valid UTF-8".into()))?;
    let settings = state
        .settings
        .lock()
        .expect("settings mutex poisoned")
        .clone();
    let db = state.db.lock().expect("db mutex poisoned");
    let entry = db
        .get_entry(&entry_id)?
        .ok_or_else(|| PassForgeError::EntryNotFound(entry_id.clone()))?;
    let password = derive_password(&entry, &master_password, &settings)?;
    db.mark_used(&entry_id)?;
    Ok(password)
}

// ---------------------------------------------------------------------------
// Settings commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> Settings {
    state
        .settings
        .lock()
        .expect("settings mutex poisoned")
        .clone()
}

#[tauri::command]
pub fn save_settings(
    settings: Settings,
    state: State<AppState>,
    session: State<SessionState>,
) -> Result<Settings> {
    session.set_idle_timeout(settings.idle_lock_seconds);
    *state.settings.lock().expect("settings mutex poisoned") = settings.clone();
    Ok(settings)
}

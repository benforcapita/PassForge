mod commands;
mod db;
mod error;
mod keychain;
mod models;
mod session;

use commands::AppState;
use models::Settings;
use std::sync::Mutex;

fn main() {
    let db = db::VaultDb::memory().expect("database opens");
    db.migrate().expect("database migrates");

    let builder = tauri::Builder::default()
        .manage(session::SessionState::default())
        .manage(AppState {
            db: Mutex::new(db),
            settings: Mutex::new(Settings::default()),
        })
        .invoke_handler(tauri::generate_handler![
            commands::is_locked,
            commands::unlock_with_master_password,
            commands::lock,
            commands::create_folder,
            commands::create_entry,
            commands::search_entries,
            commands::generate_password,
            commands::get_settings,
            commands::save_settings,
        ]);

    #[cfg(mobile)]
    let builder = builder.plugin(tauri_plugin_biometric::init());

    builder
        .run(tauri::generate_context!())
        .expect("failed to run PassForge");
}

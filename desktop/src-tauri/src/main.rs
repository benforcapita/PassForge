mod biometric;
mod commands;
mod db;
mod error;
mod keychain;
mod models;
mod session;
mod vault;

use commands::AppState;
use std::sync::Mutex;

fn main() {
    let db = vault::open().expect("vault opens");

    let builder = tauri::Builder::default()
        .manage(session::SessionState::default())
        .manage(AppState {
            db: Mutex::new(db),
        })
        .invoke_handler(tauri::generate_handler![
            commands::is_locked,
            commands::record_activity,
            commands::unlock_with_master_password,
            commands::lock,
            commands::create_folder,
            commands::list_folders,
            commands::create_entry,
            commands::get_entry,
            commands::update_entry,
            commands::delete_entry,
            commands::preview_fingerprint,
            commands::search_entries,
            commands::generate_password,
            commands::get_settings,
            commands::save_settings,
            commands::biometric_supported,
            commands::master_password_stored,
            commands::biometric_unlock,
            commands::remember_master_password,
            commands::forget_master_password,
        ]);

    let builder = builder
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            use tauri::{Emitter, Manager};
            let session = app.state::<session::SessionState>().inner().clone();
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                    if let Ok(true) = session.lock_if_idle() {
                        let _ = app_handle.emit("passforge://vault-locked", ());
                    }
                }
            });
            Ok(())
        });
    #[cfg(mobile)]
    let builder = builder.plugin(tauri_plugin_biometric::init());

    builder
        .run(tauri::generate_context!())
        .expect("failed to run PassForge");
}

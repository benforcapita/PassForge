use passforge_desktop::commands::{self, AppState};
use passforge_desktop::{api, session, vault};
use std::sync::{Arc, Mutex};

/// `--register-hosts [--user <name>]`: write the native-messaging manifests
/// and exit — used by the pkg postinstall and the Homebrew postflight, which
/// run as root, so manifests must land in the console user's home and be
/// chowned back to them.
fn register_hosts() -> i32 {
    let mut user: Option<String> = None;
    let mut args = std::env::args().skip_while(|a| a != "--register-hosts").skip(1);
    while let Some(arg) = args.next() {
        if arg == "--user" {
            user = args.next();
        }
    }

    let home = match &user {
        Some(name) => user_home(name),
        None => match dirs::home_dir() {
            Some(h) => h,
            None => {
                eprintln!("passforge: --register-hosts: cannot resolve home directory");
                return 1;
            }
        },
    };

    let Ok(exe) = std::env::current_exe() else {
        eprintln!("passforge: --register-hosts: cannot resolve current exe");
        return 1;
    };
    let host = exe.with_file_name("passforge-host");
    if !host.is_file() {
        eprintln!(
            "passforge: --register-hosts: passforge-host not found next to {}",
            exe.display()
        );
        return 1;
    }

    let written = passforge_desktop::browser_hosts::register_full(&home, &host);
    if written.is_empty() {
        println!("passforge: no browser manifests needed writing in {}", home.display());
    }
    for (browser, file) in &written {
        println!("passforge: wrote {} ({})", file.display(), browser);
        if let Some(name) = &user {
            // Running as root from a postinstall: hand the file to the user.
            let status = std::process::Command::new("chown")
                .arg(name)
                .arg(file)
                .status();
            match status {
                Ok(s) if s.success() => {}
                _ => eprintln!("passforge: could not chown {} to {name}", file.display()),
            }
        }
    }
    0
}

/// Home directory of a named macOS user (pkg postinstall runs as root, so
/// $HOME is wrong). Falls back to /Users/<name>.
fn user_home(name: &str) -> std::path::PathBuf {
    let dscl = std::process::Command::new("dscl")
        .args([".", "-read"])
        .arg(format!("/Users/{name}"))
        .arg("NFSHomeDirectory")
        .output();
    if let Ok(out) = dscl {
        let text = String::from_utf8_lossy(&out.stdout);
        if let Some(path) = text.strip_prefix("NFSHomeDirectory:").map(str::trim) {
            if path.starts_with('/') {
                return std::path::PathBuf::from(path);
            }
        }
    }
    std::path::PathBuf::from(format!("/Users/{name}"))
}

fn main() {
    if std::env::args().any(|a| a == "--register-hosts") {
        std::process::exit(register_hosts());
    }
    let registered = passforge_desktop::browser_hosts::register_bundled_host();
    if !registered.is_empty() {
        eprintln!("passforge: registered native host for {}", registered.join(", "));
    }
    let db = vault::open().expect("vault opens");
    let session = session::SessionState::default();
    session.set_idle_timeout(commands::load_settings(&db).idle_lock_seconds);
    let db = Arc::new(Mutex::new(db));

    let builder = tauri::Builder::default()
        .manage(session.clone())
        .manage(AppState { db: db.clone() })
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
            commands::backend_info,
            commands::server_info,
            commands::get_settings,
            commands::save_settings,
            commands::biometric_supported,
            commands::master_password_stored,
            commands::biometric_unlock,
            commands::remember_master_password,
            commands::forget_master_password,
            commands::export_vault,
            commands::import_vault,
            commands::import_passwords,
            commands::migration_preview,
            commands::complete_migration,
            commands::list_sealed,
            commands::list_passkeys,
            commands::delete_passkey,
        ]);

    let builder = builder
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            use tauri::{Emitter, Manager};
            let session = app.state::<session::SessionState>().inner().clone();
            let app_handle = app.handle().clone();

            // The local API server — the one backend every frontend calls
            // for generation and vault data. Failure degrades to IPC-only.
            let api_session = app.state::<session::SessionState>().inner().clone();
            let api_db = app.state::<AppState>().db.clone();
            tauri::async_runtime::spawn(async move {
                match vault::resolved_db_path().and_then(|p| {
                    let dir = p.parent().map(|d| d.to_path_buf()).ok_or_else(|| {
                        passforge_desktop::error::PassForgeError::InvalidRequest(
                            "bad vault path".into(),
                        )
                    })?;
                    let token = api::load_or_create_token(&dir)?;
                    Ok((dir, token))
                }) {
                    Ok((dir, token)) => {
                        let state = api::ApiState {
                            db: api_db,
                            session: api_session,
                            token,
                        };
                        if let Err(err) = api::serve(state, dir).await {
                            eprintln!("passforge api: {err}");
                        }
                    }
                    Err(err) => eprintln!("passforge api setup: {err}"),
                }
            });
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

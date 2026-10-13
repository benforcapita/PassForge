use std::thread;

use lesspass_core::PasswordOptions;
use passforge_desktop::{
    commands::derive_password,
    db::VaultDb,
    models::{EntryInput, FolderInput, GenerationMode, Settings},
    remote,
};
use passforge_server::{app, ServerConfig};
use tokio::net::TcpListener;
use zeroize::Zeroizing;

fn start_server() -> (
    String,
    tokio::sync::oneshot::Sender<()>,
    thread::JoinHandle<()>,
) {
    let (address_tx, address_rx) = std::sync::mpsc::channel();
    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel();
    let server_thread = thread::spawn(move || {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async move {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            address_tx.send(listener.local_addr().unwrap()).unwrap();
            let config = ServerConfig {
                name: "desktop test server".into(),
                pepper: None::<Zeroizing<Vec<u8>>>,
                max_concurrent: 4,
            };
            axum::serve(listener, app(config))
                .with_graceful_shutdown(async {
                    let _ = shutdown_rx.await;
                })
                .await
                .unwrap();
        });
    });
    let address = address_rx.recv().unwrap();
    (format!("http://{address}"), shutdown_tx, server_thread)
}

#[test]
fn real_http_server_supports_info_and_server_mode_derivation() {
    let (url, shutdown, server_thread) = start_server();
    let info = remote::fetch_info(&url).unwrap();
    assert!(info
        .algorithms
        .iter()
        .any(|algorithm| algorithm.id == "argon2id-v1"));

    let db = VaultDb::memory().unwrap();
    db.migrate().unwrap();
    let folder = db
        .create_folder(FolderInput {
            parent_id: None,
            name: "Personal".into(),
        })
        .unwrap();
    let entry = db
        .create_entry(EntryInput {
            site: "example.org".into(),
            login: "alice".into(),
            counter: 1,
            options: PasswordOptions {
                length: 16,
                ..PasswordOptions::default()
            },
            salt_fields: vec![],
            crypto: None,
            folder_id: folder.id,
            group_ids: vec![],
            tags: vec![],
        })
        .unwrap();
    let make_settings = |algorithm: Option<&str>| Settings {
        generation: GenerationMode::Server {
            url: url.clone(),
            algorithm: algorithm.map(str::to_owned),
        },
        ..Settings::default()
    };
    let password_default =
        derive_password(&entry, "real-http-test-master", &make_settings(None)).unwrap();
    let password_argon = derive_password(
        &entry,
        "real-http-test-master",
        &make_settings(Some("argon2id-v1")),
    )
    .unwrap();
    let password_pbkdf2 = derive_password(
        &entry,
        "real-http-test-master",
        &make_settings(Some("pbkdf2-sha512-v1")),
    )
    .unwrap();

    assert_eq!(password_default.len(), 16);
    assert_eq!(password_default, password_argon);
    assert_ne!(password_default, password_pbkdf2);

    shutdown.send(()).unwrap();
    server_thread.join().unwrap();
}

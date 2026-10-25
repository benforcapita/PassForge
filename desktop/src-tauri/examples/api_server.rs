//! Test API server for the extension e2e: an in-memory vault seeded with a
//! folder + two entries, unlocked with master "test-master", serving the
//! real `api::router` on a fixed port.
//!
//!   PASSFORGE_VAULT_DIR=$(mktemp -d) cargo run --example api_server -- 8901
//!
//! Writes `api-info.json` + `api-token` into PASSFORGE_VAULT_DIR (or a temp
//! dir) — the same files the real app writes — and prints them on stdout.
use lesspass_core::PasswordOptions;
use passforge_desktop::api::{self, ApiState};
use passforge_desktop::db::VaultDb;
use passforge_desktop::models::{EntryInput, FolderInput};
use passforge_desktop::session::SessionState;
use std::sync::{Arc, Mutex};

#[tokio::main]
async fn main() {
    let port: u16 = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "8901".into())
        .parse()
        .expect("port");
    let dir = std::env::var_os("PASSFORGE_VAULT_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::env::temp_dir().join("passforge-e2e"));
    std::fs::create_dir_all(&dir).unwrap();

    let db = VaultDb::memory().expect("memory db");
    db.migrate().expect("migrate");
    let folder = db
        .create_folder(FolderInput { parent_id: None, name: "Demo".into() })
        .unwrap();
    for (site, login) in [("localhost", "alice@example.com"), ("github.com", "dev@passforge.io")] {
        db.create_entry(EntryInput {
            site: site.into(),
            login: login.into(),
            counter: 1,
            options: PasswordOptions::default(),
            salt_fields: vec![],
            crypto: None,
            folder_id: folder.id.clone(),
            group_ids: vec![],
            tags: vec![],
        })
        .unwrap();
    }

    let session = SessionState::default();
    if std::env::args().nth(2).as_deref() != Some("--locked") {
        session.unlock(b"test-master".to_vec()).unwrap();
    } else {
        println!("session left LOCKED (--locked)");
    }
    let token = api::load_or_create_token(&dir).unwrap();
    let state = ApiState {
        db: Arc::new(Mutex::new(db)),
        session,
        token: token.clone(),
    };

    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await.unwrap();
    std::fs::write(
        dir.join("api-info.json"),
        serde_json::json!({"port": port, "pid": std::process::id()}).to_string(),
    )
    .unwrap();
    println!("listening on http://127.0.0.1:{port} dir={} token={token}", dir.display());
    axum::serve(listener, api::router(state)).await.unwrap();
}

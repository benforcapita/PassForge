//! The local API is the only place frontends can reach the algorithm, so
//! these tests prove: token enforcement, the locked-session gate on vault
//! routes, and that `/api/generate` + `/api/fingerprint` return byte-identical
//! results to calling `lesspass_core` directly.

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use lesspass_core::{PasswordOptions, PasswordProfile};
use passforge_desktop::api::{self, ApiState};
use passforge_desktop::commands::{derive_profile_password, generate_entry_password};
use passforge_desktop::db::VaultDb;
use passforge_desktop::models::{EntryInput, FolderInput, GenerationMode, Settings};
use passforge_desktop::session::SessionState;
use std::sync::{Arc, Mutex};
use tower::ServiceExt;

const TOKEN: &str = "test-token";

fn state() -> ApiState {
    let db = VaultDb::memory().expect("memory db");
    db.migrate().expect("migrate");
    ApiState {
        db: Arc::new(Mutex::new(db)),
        session: SessionState::default(),
        token: TOKEN.to_string(),
    }
}

fn req(method: &str, path: &str, body: Option<serde_json::Value>) -> Request<Body> {
    let builder = Request::builder()
        .method(method)
        .uri(path)
        .header("authorization", format!("Bearer {TOKEN}"));
    match body {
        Some(json) => builder
            .header("content-type", "application/json")
            .body(Body::from(json.to_string()))
            .unwrap(),
        None => builder.body(Body::empty()).unwrap(),
    }
}

async fn json(resp: axum::response::Response) -> serde_json::Value {
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&bytes).unwrap()
}

/// PasswordProfile's wire shape: options are flattened into the profile.
fn profile() -> serde_json::Value {
    serde_json::json!({
        "site": "github.com",
        "login": "dev@passforge.io",
        "counter": 2,
        "lowercase": true,
        "uppercase": true,
        "digits": true,
        "symbols": true,
        "length": 20,
        "salt_fields": [],
    })
}

#[tokio::test]
async fn generate_matches_direct_core_derivation() {
    let app = api::router(state());
    let resp = app
        .oneshot(req(
            "POST",
            "/api/generate",
            Some(serde_json::json!({
                "masterPassword": "correct horse",
                "profile": profile(),
            })),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = json(resp).await;
    let got = body["password"].as_str().unwrap();

    let profile: PasswordProfile = serde_json::from_value(profile()).unwrap();
    let want = lesspass_core::render_password(
        &lesspass_core::calc_entropy(&profile, "correct horse", &Default::default()),
        &profile.options,
    )
    .unwrap();
    assert_eq!(got, want);
}

/// The API must follow the app's generation mode: with an algorithm server
/// saved in settings, `/api/generate` derives through that server exactly like
/// the desktop UI and native host do — never the serverless path.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn generate_honors_server_generation_mode() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();
    let server = tokio::spawn(async move {
        let config = passforge_server::ServerConfig {
            name: "api test server".into(),
            pepper: None::<zeroize::Zeroizing<Vec<u8>>>,
            max_concurrent: 4,
        };
        axum::serve(listener, passforge_server::app(config))
            .with_graceful_shutdown(async {
                let _ = shutdown_rx.await;
            })
            .await
            .unwrap();
    });

    let st = state();
    let settings = Settings {
        generation: GenerationMode::Server {
            url: url.clone(),
            algorithm: Some("pbkdf2-sha512-v1".into()),
        },
        ..Settings::default()
    };
    st.db
        .lock()
        .unwrap()
        .set_kv("settings", &serde_json::to_string(&settings).unwrap())
        .unwrap();

    let resp = api::router(st)
        .oneshot(req(
            "POST",
            "/api/generate",
            Some(serde_json::json!({
                "masterPassword": "correct horse",
                "profile": profile(),
            })),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let got = json(resp).await["password"].as_str().unwrap().to_string();

    let profile: PasswordProfile = serde_json::from_value(profile()).unwrap();
    let want = tokio::task::spawn_blocking(move || {
        derive_profile_password(&profile, "correct horse", &settings).unwrap()
    })
    .await
    .unwrap();
    assert_eq!(got, want);

    let profile: PasswordProfile = serde_json::from_value(self::profile()).unwrap();
    let serverless = lesspass_core::render_password(
        &lesspass_core::calc_entropy(&profile, "correct horse", &Default::default()),
        &profile.options,
    )
    .unwrap();
    assert_ne!(got, serverless, "server mode must not fall back to serverless");

    shutdown_tx.send(()).unwrap();
    server.await.unwrap();
}

#[tokio::test]
async fn fingerprint_matches_direct_core_call() {
    let app = api::router(state());
    let resp = app
        .oneshot(req(
            "POST",
            "/api/fingerprint",
            Some(serde_json::json!({ "masterPassword": "master" })),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = json(resp).await;
    let want = lesspass_core::create_fingerprint(&lesspass_core::build_fingerprint_hash("master"))
        .unwrap();
    assert_eq!(body, serde_json::to_value(&want).unwrap());
}

#[tokio::test]
async fn every_route_rejects_missing_or_bad_token() {
    let app = api::router(state());
    for (method, path, body) in [
        ("GET", "/api/health", None),
        ("GET", "/api/entries", None),
        ("GET", "/api/entries/abc", None),
        ("GET", "/api/settings", None),
        (
            "POST",
            "/api/generate",
            Some(serde_json::json!({"masterPassword":"x","profile":profile()})),
        ),
        (
            "POST",
            "/api/fingerprint",
            Some(serde_json::json!({"masterPassword":"x"})),
        ),
    ] {
        let no_auth = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(path)
                    .body(Body::from(body.as_ref().map_or(String::new(), |b: &serde_json::Value| b.to_string())))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(no_auth.status(), StatusCode::UNAUTHORIZED, "{path} without token");

        let bad = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(path)
                    .header("authorization", "Bearer wrong")
                    .body(Body::from(body.map_or(String::new(), |b| b.to_string())))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(bad.status(), StatusCode::UNAUTHORIZED, "{path} with bad token");
    }
}

#[tokio::test]
async fn vault_routes_require_unlocked_session() {
    let st = state();
    {
        let db = st.db.lock().unwrap();
        let folder = db
            .create_folder(FolderInput {
                parent_id: None,
                name: "work".into(),
            })
            .unwrap();
        db.create_entry(EntryInput {
            site: "github.com".into(),
            login: "dev@passforge.io".into(),
            counter: 1,
            options: PasswordOptions::default(),
            salt_fields: vec![],
            crypto: None,
            folder_id: folder.id,
            group_ids: vec![],
            tags: vec![],
        })
        .unwrap();
    }
    let app = api::router(st.clone());

    // Locked session: vault routes forbidden, generate still works (one-shot).
    for path in ["/api/entries", "/api/settings"] {
        let resp = app.clone().oneshot(req("GET", path, None)).await.unwrap();
        assert_eq!(resp.status(), StatusCode::FORBIDDEN, "{path} while locked");
    }

    st.session.unlock(b"master".to_vec()).unwrap();
    let resp = app.clone().oneshot(req("GET", "/api/entries", None)).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let rows = json(resp).await;
    assert_eq!(rows.as_array().unwrap().len(), 1);
    assert_eq!(rows[0]["site"], "github.com");

    // Health exposes the lock state for frontends.
    let resp = app.oneshot(req("GET", "/api/health", None)).await.unwrap();
    assert_eq!(json(resp).await["locked"], false);
}

/// The desktop UI generates through this route, so it must (a) be gated on
/// the unlocked session and (b) produce exactly what the IPC path produces.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn entry_generate_requires_unlock_and_matches_ipc_derivation() {
    let st = state();
    let entry_id = {
        let db = st.db.lock().unwrap();
        let folder = db
            .create_folder(FolderInput { parent_id: None, name: "work".into() })
            .unwrap();
        db.create_entry(EntryInput {
            site: "github.com".into(),
            login: "dev@passforge.io".into(),
            counter: 3,
            options: PasswordOptions::default(),
            salt_fields: vec![],
            crypto: None,
            folder_id: folder.id,
            group_ids: vec![],
            tags: vec![],
        })
        .unwrap()
        .id
    };
    let app = api::router(st.clone());
    let path = format!("/api/entries/{entry_id}/generate");

    let resp = app.clone().oneshot(req("POST", &path, None)).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN, "locked app must not generate");

    st.session.unlock(b"correct horse".to_vec()).unwrap();
    let resp = app.clone().oneshot(req("POST", &path, None)).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let got = json(resp).await["password"].as_str().unwrap().to_string();

    let want = generate_entry_password(&st.db, &st.session, &entry_id).await.unwrap();
    assert_eq!(got, want);

    let resp = app.oneshot(req("POST", "/api/entries/nope/generate", None)).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn put_settings_normalizes_known_servers_and_requires_unlock() {
    let st = state();
    let app = api::router(st.clone());
    let body = serde_json::json!({
        "defaultCrypto": {"iterations": 100000, "keylen": 32, "digest": "sha256"},
        "idleLockSeconds": 60,
        "clipboardClearSeconds": 30,
        "generation": {"mode": "server", "url": "http://127.0.0.1:8790/", "algorithm": null},
        "knownServers": ["http://127.0.0.1:8790/", "http://127.0.0.1:8790", "https://algo.example/"],
    });

    let resp = app.clone().oneshot(req("PUT", "/api/settings", Some(body.clone()))).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);

    st.session.unlock(b"master".to_vec()).unwrap();
    let resp = app.clone().oneshot(req("PUT", "/api/settings", Some(body))).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let saved = json(resp).await;
    assert_eq!(saved["generation"]["url"], "http://127.0.0.1:8790");
    assert_eq!(
        saved["knownServers"],
        serde_json::json!(["http://127.0.0.1:8790", "https://algo.example"])
    );

    let resp = app.oneshot(req("GET", "/api/settings", None)).await.unwrap();
    assert_eq!(json(resp).await["knownServers"].as_array().unwrap().len(), 2);
}

#[test]
fn origin_policy_admits_extensions_and_the_desktop_webview_only() {
    for ok in [
        "chrome-extension://abcdefghijklmnop",
        "moz-extension://1234",
        "safari-web-extension://x",
        "tauri://localhost",
        "http://tauri.localhost",
    ] {
        assert!(api::origin_allowed(ok), "{ok}");
    }
    for bad in ["https://evil.example", "http://127.0.0.1:5000", "null", ""] {
        assert!(!api::origin_allowed(bad), "{bad}");
    }
}

#[test]
fn token_file_is_created_once_with_0600() {
    let dir = tempfile::tempdir().unwrap();
    let first = api::load_or_create_token(dir.path()).unwrap();
    let second = api::load_or_create_token(dir.path()).unwrap();
    assert_eq!(first, second);
    assert_eq!(first.len(), 64);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(dir.path().join("api-token"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
    }
    assert_eq!(api::read_token(dir.path()).as_deref(), Some(first.as_str()));
}

#[tokio::test]
async fn generate_rejects_invalid_profile_parameters() {
    for patch in [
        serde_json::json!({ "crypto": { "iterations": 100000, "keylen": 0, "digest": "sha256" } }),
        serde_json::json!({ "length": 1000000 }),
        serde_json::json!({ "lowercase": false, "uppercase": false, "digits": false, "symbols": false }),
    ] {
        let mut p = profile();
        for (k, v) in patch.as_object().unwrap() {
            p[k] = v.clone();
        }
        let resp = api::router(state())
            .oneshot(req(
                "POST",
                "/api/generate",
                Some(serde_json::json!({ "masterPassword": "correct horse", "profile": p })),
            ))
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST, "{patch}");
    }
}

#[tokio::test]
async fn put_settings_rejects_invalid_default_crypto() {
    let st = state();
    st.session.unlock(b"master".to_vec()).unwrap();
    let mut settings = serde_json::to_value(Settings::default()).unwrap();
    settings["defaultCrypto"]["keylen"] = serde_json::json!(0);
    let resp = api::router(st.clone())
        .oneshot(req("PUT", "/api/settings", Some(settings)))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let db = st.db.lock().unwrap();
    assert_eq!(
        passforge_desktop::commands::load_settings(&db).default_crypto.keylen,
        32
    );
}

/// `/api/autofill` filters entries by the page URL — the page and its
/// content script never learn which entries exist, only the SW does.
#[tokio::test]
async fn autofill_matches_only_the_page_site() {
    let st = state();
    {
        let db = st.db.lock().unwrap();
        let folder = db
            .create_folder(FolderInput { parent_id: None, name: "work".into() })
            .unwrap();
        for (site, login) in [
            ("localhost", "alice@example.com"),
            ("github.com", "dev@passforge.io"),
            ("app.github.com", "ci@passforge.io"),
        ] {
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
    }
    let app = api::router(st.clone());

    // Locked: forbidden.
    let resp = app
        .clone()
        .oneshot(req("GET", "/api/autofill?url=https://github.com/", None))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);

    st.session.unlock(b"master".to_vec()).unwrap();

    // github.com page: both github.com and the subdomain-scoped entry match
    // (a github.com page is NOT offered a login.github.com entry).
    let resp = app
        .clone()
        .oneshot(req("GET", "/api/autofill?url=https://github.com/login", None))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let rows = json(resp).await;
    let sites: Vec<_> = rows
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["site"].as_str().unwrap())
        .collect();
    assert_eq!(sites, ["github.com"]);
    // Fingerprints are synthesized like search results.
    assert!(rows[0]["fingerprint"].is_object() || rows[0]["fingerprint"].is_array());

    // Subdomain page sees the parent-domain entry, not sibling subdomains.
    let resp = app
        .clone()
        .oneshot(req("GET", "/api/autofill?url=https://login.github.com/", None))
        .await
        .unwrap();
    let rows = json(resp).await;
    assert_eq!(rows.as_array().unwrap().len(), 1);
    assert_eq!(rows.as_array().unwrap()[0]["site"], "github.com");

    // The app.github.com entry page matches its own entry plus the parent.
    let resp = app
        .clone()
        .oneshot(req("GET", "/api/autofill?url=https://app.github.com/", None))
        .await
        .unwrap();
    let rows = json(resp).await;
    assert_eq!(rows.as_array().unwrap().len(), 2);

    // A lookalike host gets nothing; non-loopback http gets nothing.
    for url in [
        "https://github.com.evil.io/",
        "http://github.com/",
        "ftp://github.com/",
    ] {
        let resp = app
            .clone()
            .oneshot(req("GET", &format!("/api/autofill?url={url}"), None))
            .await
            .unwrap();
        assert_eq!(json(resp).await.as_array().unwrap().len(), 0, "{url}");
    }

    // Loopback http matches the localhost entry.
    let resp = app
        .oneshot(req("GET", "/api/autofill?url=http://localhost:3000/login", None))
        .await
        .unwrap();
    let rows = json(resp).await;
    assert_eq!(rows.as_array().unwrap()[0]["site"], "localhost");
}

/// `POST /api/entries` creates an entry usable by generate — the extension's
/// signup flow end to end.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn create_entry_then_generate_round_trip() {
    let st = state();
    let app = api::router(st.clone());
    let input = serde_json::json!({
        "site": "newapp.io",
        "login": "me@newapp.io",
        "counter": 1,
        "options": {"lowercase": true, "uppercase": true, "digits": true, "symbols": true, "length": 16},
        "saltFields": [],
        "crypto": null,
        "folderId": "",
        "groupIds": [],
        "tags": []
    });

    // Locked: forbidden.
    let resp = app
        .clone()
        .oneshot(req("POST", "/api/entries", Some(input.clone())))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);

    st.session.unlock(b"correct horse".to_vec()).unwrap();
    let resp = app
        .clone()
        .oneshot(req("POST", "/api/entries", Some(input)))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let entry = json(resp).await;
    let id = entry["id"].as_str().unwrap().to_string();
    assert_eq!(entry["profile"]["site"], "newapp.io");
    // Empty folderId landed in the auto-created folder.
    assert!(!entry["folderId"].as_str().unwrap().is_empty());

    // Generate through the session, exactly like a fill.
    let resp = app
        .oneshot(req("POST", &format!("/api/entries/{id}/generate"), None))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let password = json(resp).await["password"].as_str().unwrap().to_string();
    assert!(!password.is_empty());
}

#[tokio::test]
async fn autofill_and_create_entry_reject_missing_token() {
    let app = api::router(state());
    for (method, path) in [
        ("GET", "/api/autofill?url=https://github.com/"),
        ("POST", "/api/entries"),
    ] {
        let resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(path)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED, "{path} without token");
    }
}

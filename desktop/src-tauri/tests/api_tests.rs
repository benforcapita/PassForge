//! The local API is the only place frontends can reach the algorithm, so
//! these tests prove: token enforcement, the locked-session gate on vault
//! routes, and that `/api/generate` + `/api/fingerprint` return byte-identical
//! results to calling `lesspass_core` directly.

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use lesspass_core::{PasswordOptions, PasswordProfile};
use passforge_desktop::api::{self, ApiState};
use passforge_desktop::db::VaultDb;
use passforge_desktop::models::{EntryInput, FolderInput};
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

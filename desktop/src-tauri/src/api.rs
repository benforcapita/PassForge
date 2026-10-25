//! Local HTTP API — the single backend every frontend calls.
//!
//! PassForge's architecture rule: frontends are fully severed from the
//! password-generation algorithm. This server, embedded in the desktop app
//! process, is the only place `lesspass-core` runs for external clients —
//! the browser extension calls it over `http://127.0.0.1`, and the desktop
//! UI's own generation goes through `/api/entries/{id}/generate` too, so a
//! frontend that is not connected to the backend cannot produce a password.
//!
//! Security model:
//! - Loopback only (`127.0.0.1`, ephemeral port written to
//!   `<vault dir>/api-info.json`).
//! - Every request needs `Authorization: Bearer <api-token>` where the token
//!   is a random hex secret in `<vault dir>/api-token` (0600). The browser
//!   extension obtains `port` + `token` through the `api_info`
//!   native-messaging op of `passforge-host` — pairing by OS trust, not by
//!   anything typed into the extension.
//! - `/api/generate` is one-shot: the master password arrives in the request
//!   and is zeroized after use — the server never stores it.
//! - Vault endpoints additionally require the app's session to be unlocked,
//!   so a locked app serves nothing.
//! - CORS is restricted to browser-extension schemes.

use crate::commands::{
    complete_migration_inner, derive_profile_password, generate_entry_password, load_settings,
    master_fingerprint, migration_preview_inner, persist_settings, require_unlocked,
    synthesize_fingerprints,
};
use crate::db::VaultDb;
use crate::error::{PassForgeError, Result};
use crate::models::{EntryInput, FolderInput, Settings};
use crate::session::SessionState;
use axum::{
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use lesspass_core::PasswordProfile;
use serde::Deserialize;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use tower_http::cors::CorsLayer;
use zeroize::{Zeroize, Zeroizing};

const TOKEN_FILE: &str = "api-token";
const INFO_FILE: &str = "api-info.json";

#[derive(Clone)]
pub struct ApiState {
    pub db: Arc<Mutex<VaultDb>>,
    pub session: SessionState,
    pub token: String,
}

/// Random 32-byte hex token, load-or-create at `<vault dir>/api-token` (0600).
pub fn load_or_create_token(vault_dir: &std::path::Path) -> Result<String> {
    let path = vault_dir.join(TOKEN_FILE);
    if let Ok(raw) = std::fs::read_to_string(&path) {
        let token = raw.trim().to_string();
        if !token.is_empty() {
            return Ok(token);
        }
    }
    let mut bytes = [0u8; 32];
    bytes[..16].copy_from_slice(uuid::Uuid::new_v4().as_bytes());
    bytes[16..].copy_from_slice(uuid::Uuid::new_v4().as_bytes());
    let token = hex::encode(bytes);
    std::fs::write(&path, &token)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
    }
    Ok(token)
}

/// Reads the api token the running server expects (used by `api_info`).
pub fn read_token(vault_dir: &std::path::Path) -> Option<String> {
    std::fs::read_to_string(vault_dir.join(TOKEN_FILE))
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Reads the port of the currently-registered server (used by `api_info`).
pub fn read_port(vault_dir: &std::path::Path) -> Option<u16> {
    let raw = std::fs::read_to_string(vault_dir.join(INFO_FILE)).ok()?;
    serde_json::from_str::<serde_json::Value>(&raw).ok()?["port"]
        .as_u64()
        .map(|p| p as u16)
}

/// Origins allowed to call the API from a browser context: browser
/// extensions, and the desktop app's own webview (which is a client of this
/// backend like any other frontend). The Vite dev server origin is only
/// accepted in debug builds.
pub fn origin_allowed(origin: &str) -> bool {
    let scheme = origin.split("://").next().unwrap_or("");
    if matches!(scheme, "chrome-extension" | "moz-extension" | "safari-web-extension") {
        return true;
    }
    if matches!(origin, "tauri://localhost" | "http://tauri.localhost" | "https://tauri.localhost")
    {
        return true;
    }
    cfg!(debug_assertions) && origin == "http://localhost:1420"
}

pub fn router(state: ApiState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(tower_http::cors::AllowOrigin::predicate(|origin, _| {
            origin.to_str().map(origin_allowed).unwrap_or(false)
        }))
        .allow_methods([
            axum::http::Method::GET,
            axum::http::Method::POST,
            axum::http::Method::PUT,
        ])
        .allow_headers([
            axum::http::header::AUTHORIZATION,
            axum::http::header::CONTENT_TYPE,
        ]);

    Router::new()
        .route("/api/health", get(health))
        .route("/api/generate", post(generate))
        .route("/api/fingerprint", post(fingerprint))
        .route("/api/entries", get(search_entries).post(create_entry))
        .route("/api/autofill", get(autofill_entries))
        .route("/api/entries/{id}", get(get_entry))
        .route("/api/entries/{id}/generate", post(generate_entry))
        .route("/api/settings", get(get_settings).put(put_settings))
        .route("/api/migration", get(list_migration))
        .route("/api/entries/{id}/migration-preview", post(migration_preview))
        .route("/api/entries/{id}/migrate", post(migrate_entry))
        .route("/api/server-info", post(server_info))
        .route_layer(middleware::from_fn_with_state(state.clone(), require_token))
        .layer(cors)
        .with_state(state)
}

/// Binds 127.0.0.1 on an ephemeral port, records it in `<vault
/// dir>/api-info.json`, and serves until the process exits. Spawn with
/// `tauri::async_runtime::spawn(api::serve(...))`.
pub async fn serve(state: ApiState, vault_dir: std::path::PathBuf) -> Result<SocketAddr> {
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await?;
    let addr = listener.local_addr()?;
    std::fs::write(
        vault_dir.join(INFO_FILE),
        serde_json::to_string(&serde_json::json!({
            "port": addr.port(),
            "pid": std::process::id(),
        }))?,
    )?;
    axum::serve(listener, router(state))
        .await
        .map_err(|e| PassForgeError::Io(e))?;
    Ok(addr)
}

async fn require_token(
    State(state): State<ApiState>,
    headers: HeaderMap,
    request: axum::extract::Request,
    next: Next,
) -> Response {
    let ok = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .map(|v| v.strip_prefix("Bearer ") == Some(state.token.as_str()))
        .unwrap_or(false);
    if !ok {
        return api_error(
            StatusCode::UNAUTHORIZED,
            &PassForgeError::InvalidRequest("missing or invalid api token".into()),
        );
    }
    next.run(request).await
}

fn api_error(status: StatusCode, err: &PassForgeError) -> Response {
    (status, Json(serde_json::json!({ "error": err.to_string() }))).into_response()
}

fn map_err(err: PassForgeError) -> Response {
    let status = match err {
        PassForgeError::Locked => StatusCode::FORBIDDEN,
        PassForgeError::SealMismatch => StatusCode::CONFLICT,
        PassForgeError::EntryNotFound(_) => StatusCode::NOT_FOUND,
        PassForgeError::InvalidRequest(_) => StatusCode::BAD_REQUEST,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    };
    api_error(status, &err)
}

async fn health(State(state): State<ApiState>) -> impl IntoResponse {
    Json(serde_json::json!({
        "version": env!("CARGO_PKG_VERSION"),
        "locked": state.session.is_locked(),
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GenerateRequest {
    master_password: String,
    profile: PasswordProfile,
}

/// Honors the app's configured generation mode (serverless or algorithm
/// server), exactly like the desktop UI and the native host do. Derivation
/// may block on a remote server, so it runs off the async executor.
async fn generate(
    State(state): State<ApiState>,
    Json(body): Json<GenerateRequest>,
) -> Response {
    state.session.touch();
    let settings = {
        let db = state.db.lock().expect("db mutex poisoned");
        load_settings(&db)
    };
    let GenerateRequest { master_password, profile } = body;
    let master_password = Zeroizing::new(master_password);
    let result = tokio::task::spawn_blocking(move || {
        derive_profile_password(&profile, &master_password, &settings)
    })
    .await
    .map_err(|_| PassForgeError::InvalidRequest("password generation task failed".into()))
    .and_then(|r| r);
    match result {
        Ok(password) => Json(serde_json::json!({ "password": password })).into_response(),
        Err(err) => map_err(err),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FingerprintRequest {
    master_password: String,
}

async fn fingerprint(
    State(state): State<ApiState>,
    Json(mut body): Json<FingerprintRequest>,
) -> Response {
    state.session.touch();
    let result = master_fingerprint(&body.master_password);
    body.master_password.zeroize();
    match result {
        Ok(fp) => Json(fp).into_response(),
        Err(err) => map_err(err),
    }
}

#[derive(Deserialize)]
struct EntriesQuery {
    q: Option<String>,
}

async fn search_entries(
    State(state): State<ApiState>,
    Query(query): Query<EntriesQuery>,
) -> Response {
    let result = (|| -> Result<serde_json::Value> {
        require_unlocked(&state.session)?;
        let db = state.db.lock().expect("db mutex poisoned");
        let mut rows = db.search_entries(&query.q.unwrap_or_default())?;
        drop(db);
        synthesize_fingerprints(&mut rows)?;
        serde_json::to_value(rows).map_err(Into::into)
    })();
    match result {
        Ok(rows) => Json(rows).into_response(),
        Err(err) => map_err(err),
    }
}

#[derive(Deserialize)]
struct AutofillQuery {
    url: String,
}

/// Entry candidates for the extension's autofill dropdown. Matching happens
/// here — the page and the content script never see vault data.
async fn autofill_entries(
    State(state): State<ApiState>,
    Query(query): Query<AutofillQuery>,
) -> Response {
    let result = (|| -> Result<serde_json::Value> {
        require_unlocked(&state.session)?;
        let db = state.db.lock().expect("db mutex poisoned");
        let mut rows = db.search_entries("")?;
        rows.retain(|row| crate::autofill::site_matches(&row.site, &query.url));
        drop(db);
        synthesize_fingerprints(&mut rows)?;
        serde_json::to_value(rows).map_err(Into::into)
    })();
    match result {
        Ok(rows) => Json(rows).into_response(),
        Err(err) => map_err(err),
    }
}

/// Creates a vault entry (extension "generate for this signup" flow). An
/// empty `folderId` lands in the first folder — or a fresh "Personal" folder
/// when the vault has none, like the desktop UI's default selection.
async fn create_entry(
    State(state): State<ApiState>,
    Json(mut input): Json<EntryInput>,
) -> Response {
    let result = (|| -> Result<serde_json::Value> {
        require_unlocked(&state.session)?;
        let db = state.db.lock().expect("db mutex poisoned");
        if input.folder_id.is_empty() {
            input.folder_id = match db.list_folders()?.into_iter().next() {
                Some(folder) => folder.id,
                None => db
                    .create_folder(FolderInput {
                        parent_id: None,
                        name: "Personal".into(),
                    })?
                    .id,
            };
        }
        let entry = db.create_entry(input)?;
        serde_json::to_value(entry).map_err(Into::into)
    })();
    match result {
        Ok(entry) => Json(entry).into_response(),
        Err(err) => map_err(err),
    }
}

async fn get_entry(
    State(state): State<ApiState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Response {
    let result = (|| -> Result<serde_json::Value> {
        require_unlocked(&state.session)?;
        let db = state.db.lock().expect("db mutex poisoned");
        let entry = db
            .get_entry(&id)?
            .ok_or_else(|| PassForgeError::EntryNotFound(id.clone()))?;
        serde_json::to_value(entry).map_err(Into::into)
    })();
    match result {
        Ok(entry) => Json(entry).into_response(),
        Err(err) => map_err(err),
    }
}

async fn migration_preview(
    State(state): State<ApiState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Response {
    state.session.touch();
    match migration_preview_inner(&state.db, &state.session, &id).await {
        Ok(v) => Json(v).into_response(),
        Err(err) => map_err(err),
    }
}

async fn migrate_entry(
    State(state): State<ApiState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Response {
    state.session.touch();
    match complete_migration_inner(&state.db, &state.session, &id).await {
        Ok(entry) => Json(serde_json::to_value(entry).unwrap_or_default()).into_response(),
        Err(err) => map_err(err),
    }
}

async fn list_migration(State(state): State<ApiState>) -> Response {
    let result = (|| -> Result<serde_json::Value> {
        require_unlocked(&state.session)?;
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
    })();
    match result {
        Ok(v) => Json(v).into_response(),
        Err(err) => map_err(err),
    }
}

async fn get_settings(State(state): State<ApiState>) -> Response {
    let result = (|| -> Result<serde_json::Value> {
        require_unlocked(&state.session)?;
        let db = state.db.lock().expect("db mutex poisoned");
        serde_json::to_value(load_settings(&db)).map_err(Into::into)
    })();
    match result {
        Ok(settings) => Json(settings).into_response(),
        Err(err) => map_err(err),
    }
}

/// Generate for a vault entry with the unlocked session's master password —
/// the route the desktop UI uses, so it has no generation path of its own.
async fn generate_entry(
    State(state): State<ApiState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Response {
    state.session.touch();
    let kind = {
        let db = state.db.lock().expect("db mutex poisoned");
        if db.get_sealed(&id).ok().flatten().is_some() {
            "sealed"
        } else {
            "generated"
        }
    };
    match generate_entry_password(&state.db, &state.session, &id).await {
        Ok(password) => Json(serde_json::json!({ "password": password, "kind": kind })).into_response(),
        Err(err) => map_err(err),
    }
}

async fn put_settings(State(state): State<ApiState>, Json(settings): Json<Settings>) -> Response {
    let result = (|| -> Result<serde_json::Value> {
        let db = state.db.lock().expect("db mutex poisoned");
        serde_json::to_value(persist_settings(&db, &state.session, settings)?).map_err(Into::into)
    })();
    match result {
        Ok(settings) => Json(settings).into_response(),
        Err(err) => map_err(err),
    }
}

#[derive(Deserialize)]
struct ServerInfoRequest {
    url: String,
}

/// Probe an algorithm server on behalf of a frontend (extensions can't
/// reach arbitrary hosts; the backend is the only thing that talks to
/// algorithm servers anyway).
async fn server_info(
    State(state): State<ApiState>,
    Json(body): Json<ServerInfoRequest>,
) -> Response {
    let result = async {
        require_unlocked(&state.session)?;
        let url = crate::remote::normalize_server_url(&body.url)?;
        tokio::task::spawn_blocking(move || crate::remote::fetch_info(&url))
            .await
            .map_err(|_| PassForgeError::Remote("server info task failed".into()))?
    }
    .await;
    match result {
        Ok(info) => Json(info).into_response(),
        Err(err) => map_err(err),
    }
}

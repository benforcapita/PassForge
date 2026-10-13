//! Chrome native-messaging framing and request dispatch for the
//! `passforge-host` binary. The host is read-only: it serves vault
//! profiles and, on request, generates a password from a master password
//! supplied over the (same-user) stdio channel. Passwords are never
//! stored, matching the app's stateless model.

use crate::commands::{derive_password, load_settings};
use crate::db::VaultDb;
use crate::error::{PassForgeError, Result};
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};

const MAX_FRAME: u32 = 1024 * 1024;

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Request {
    Ping,
    Search { query: Option<String> },
    GetEntry { entry_id: String },
    Generate { entry_id: String, master_password: String },
    ApiInfo,
    Lock,
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum Response {
    Ok { result: serde_json::Value },
    Err { error: String },
}

impl Response {
    fn ok(result: serde_json::Value) -> Self {
        Self::Ok { result }
    }
    fn err(err: impl std::fmt::Display) -> Self {
        Self::Err { error: err.to_string() }
    }
}

/// Reads one 4-byte little-endian length-prefixed JSON frame.
/// Returns Ok(None) on a clean EOF before any bytes.
pub fn read_frame(r: &mut impl Read) -> Result<Option<String>> {
    let mut len_buf = [0u8; 4];
    match r.read_exact(&mut len_buf) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e.into()),
    }
    let len = u32::from_le_bytes(len_buf);
    if len == 0 || len > MAX_FRAME {
        return Err(PassForgeError::InvalidRequest("invalid frame length".into()));
    }
    let mut buf = vec![0u8; len as usize];
    r.read_exact(&mut buf)?;
    Ok(Some(String::from_utf8_lossy(&buf).into_owned()))
}

pub fn write_frame(w: &mut impl Write, payload: &str) -> Result<()> {
    let bytes = payload.as_bytes();
    w.write_all(&(bytes.len() as u32).to_le_bytes())?;
    w.write_all(bytes)?;
    w.flush()?;
    Ok(())
}

pub fn dispatch(db: Option<&VaultDb>, payload: &str) -> Response {
    let request: Request = match serde_json::from_str(payload) {
        Ok(r) => r,
        Err(e) => return Response::err(format!("bad request: {e}")),
    };
    fn respond(result: Result<serde_json::Value>) -> Response {
        match result {
            Ok(v) => Response::ok(v),
            Err(e) => Response::err(e),
        }
    }
    match request {
        Request::Ping => Response::ok(serde_json::json!({ "version": env!("CARGO_PKG_VERSION") })),
        Request::Search { query } => match db {
            Some(db) => respond(db
                .search_entries(&query.unwrap_or_default())
                .and_then(|rows| serde_json::to_value(rows).map_err(Into::into))),
            None => Response::err("vault unavailable"),
        },
        Request::GetEntry { entry_id } => match db {
            Some(db) => respond(match db.get_entry(&entry_id) {
                Ok(Some(entry)) => serde_json::to_value(entry).map_err(Into::into),
                Ok(None) => Err(PassForgeError::EntryNotFound(entry_id)),
                Err(e) => Err(e),
            }),
            None => Response::err("vault unavailable"),
        },
        Request::Generate { entry_id, master_password } => match db {
            Some(db) => respond((|| {
                let settings = load_settings(db);
                let entry = db
                    .get_entry(&entry_id)?
                    .ok_or_else(|| PassForgeError::EntryNotFound(entry_id.clone()))?;
                let password = derive_password(&entry, &master_password, &settings)?;
                db.mark_used(&entry_id)?;
                Ok(serde_json::json!({ "password": password }))
            })()),
            None => Response::err("vault unavailable"),
        },
        // Pairing: hands the extension the local API's port + bearer token.
        // Both live in the vault dir (api-info.json is written by the running
        // app; api-token is 0600) so this op needs OS file access, not a
        // running daemon — when the app is closed the extension can at least
        // fail with "app not running" instead of hanging.
        Request::ApiInfo => (|| {
            let db_path = crate::vault::resolved_db_path()?;
            let dir = db_path
                .parent()
                .ok_or_else(|| PassForgeError::InvalidRequest("bad vault path".into()))?;
            let port = crate::api::read_port(dir).ok_or_else(|| {
                PassForgeError::InvalidRequest("app is not running".into())
            })?;
            let token = crate::api::read_token(dir).ok_or_else(|| {
                PassForgeError::InvalidRequest("api token is missing".into())
            })?;
            Ok::<serde_json::Value, PassForgeError>(serde_json::json!({
                "port": port,
                "token": token,
            }))
        })()
        .map_or_else(Response::err, Response::ok),
        Request::Lock => Response::ok(serde_json::Value::Null),
    }
}

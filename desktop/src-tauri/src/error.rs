use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum PassForgeError {
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("entry not found: {0}")]
    EntryNotFound(String),
    #[error("vault is locked")]
    Locked,
    #[error("this password was imported under a different master password")]
    SealMismatch,
    #[error("keychain error: {0}")]
    Keychain(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("invalid request: {0}")]
    InvalidRequest(String),
    #[allow(dead_code)]
    #[error("algorithm server error: {0}")]
    Remote(String),
}

impl From<lesspass_core::CoreError> for PassForgeError {
    fn from(err: lesspass_core::CoreError) -> Self {
        PassForgeError::InvalidRequest(err.to_string())
    }
}

pub type Result<T> = std::result::Result<T, PassForgeError>;

#[derive(Debug, Serialize)]
pub struct CommandError {
    pub message: String,
}

impl serde::Serialize for PassForgeError {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        CommandError {
            message: self.to_string(),
        }
        .serialize(serializer)
    }
}

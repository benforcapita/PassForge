use crate::error::{PassForgeError, Result};
#[cfg(target_os = "macos")]
use security_framework::passwords::{
    delete_generic_password, get_generic_password, set_generic_password,
};

#[cfg(target_os = "macos")]
const SERVICE: &str = "com.passforge.desktop";
#[cfg(target_os = "macos")]
const MASTER_ACCOUNT: &str = "master-password";
#[cfg(target_os = "macos")]
const DB_KEY_ACCOUNT: &str = "database-key";

pub trait SecretStore: Send + Sync {
    fn save_master_password(&self, value: &[u8]) -> Result<()>;
    fn load_master_password(&self) -> Result<Option<Vec<u8>>>;
    fn delete_master_password(&self) -> Result<()>;
    fn save_database_key(&self, value: &[u8]) -> Result<()>;
    fn load_database_key(&self) -> Result<Option<Vec<u8>>>;
}

#[cfg(target_os = "macos")]
#[derive(Debug, Default)]
pub struct MacKeychain;

/// `errSecItemNotFound`: the only Keychain failure that means "no such
/// secret". Everything else (access denied, user cancelled the prompt,
/// interaction not allowed, ...) must surface as an error — treating it as
/// "missing" would let `load_or_create_key` overwrite the real vault key.
#[cfg(target_os = "macos")]
const ERR_SEC_ITEM_NOT_FOUND: i32 = -25300;

#[cfg(target_os = "macos")]
fn load_optional(account: &str) -> Result<Option<Vec<u8>>> {
    match get_generic_password(SERVICE, account) {
        Ok(value) => Ok(Some(value)),
        Err(err) if err.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(None),
        Err(err) => Err(PassForgeError::Keychain(err.to_string())),
    }
}

#[cfg(target_os = "macos")]
impl SecretStore for MacKeychain {
    fn save_master_password(&self, value: &[u8]) -> Result<()> {
        set_generic_password(SERVICE, MASTER_ACCOUNT, value)
            .map_err(|err| PassForgeError::Keychain(err.to_string()))
    }

    fn load_master_password(&self) -> Result<Option<Vec<u8>>> {
        load_optional(MASTER_ACCOUNT)
    }

    fn delete_master_password(&self) -> Result<()> {
        match delete_generic_password(SERVICE, MASTER_ACCOUNT) {
            Ok(()) => Ok(()),
            Err(err) => Err(PassForgeError::Keychain(err.to_string())),
        }
    }

    fn save_database_key(&self, value: &[u8]) -> Result<()> {
        set_generic_password(SERVICE, DB_KEY_ACCOUNT, value)
            .map_err(|err| PassForgeError::Keychain(err.to_string()))
    }

    fn load_database_key(&self) -> Result<Option<Vec<u8>>> {
        load_optional(DB_KEY_ACCOUNT)
    }
}

/// Stores the vault encryption key as a 0600-permission file next to the
/// database. Used on platforms without an OS secret store wired up yet; the
/// vault holds only profile parameters (never passwords), so this keeps the
/// file out of casual reach rather than pretending to be the Keychain.
pub struct FileSecretStore {
    path: std::path::PathBuf,
}

impl FileSecretStore {
    pub fn new(path: std::path::PathBuf) -> Self {
        Self { path }
    }
}

impl SecretStore for FileSecretStore {
    fn save_master_password(&self, _value: &[u8]) -> Result<()> {
        Err(PassForgeError::Keychain(
            "master password storage is unsupported on this platform".into(),
        ))
    }

    fn load_master_password(&self) -> Result<Option<Vec<u8>>> {
        Ok(None)
    }

    fn delete_master_password(&self) -> Result<()> {
        Ok(())
    }

    fn save_database_key(&self, value: &[u8]) -> Result<()> {
        std::fs::write(&self.path, hex::encode(value))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&self.path, std::fs::Permissions::from_mode(0o600))?;
        }
        Ok(())
    }

    fn load_database_key(&self) -> Result<Option<Vec<u8>>> {
        match std::fs::read_to_string(&self.path) {
            Ok(contents) => hex::decode(contents.trim())
                .map(Some)
                .map_err(|err| PassForgeError::Keychain(err.to_string())),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(err) => Err(err.into()),
        }
    }
}

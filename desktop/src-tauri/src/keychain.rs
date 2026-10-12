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

#[cfg(target_os = "macos")]
impl SecretStore for MacKeychain {
    fn save_master_password(&self, value: &[u8]) -> Result<()> {
        set_generic_password(SERVICE, MASTER_ACCOUNT, value)
            .map_err(|err| PassForgeError::Keychain(err.to_string()))
    }

    fn load_master_password(&self) -> Result<Option<Vec<u8>>> {
        match get_generic_password(SERVICE, MASTER_ACCOUNT) {
            Ok(value) => Ok(Some(value)),
            Err(_) => Ok(None),
        }
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
        match get_generic_password(SERVICE, DB_KEY_ACCOUNT) {
            Ok(value) => Ok(Some(value)),
            Err(_) => Ok(None),
        }
    }
}

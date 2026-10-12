use crate::db::VaultDb;
use crate::error::{PassForgeError, Result};
use crate::keychain::SecretStore;

#[cfg(target_os = "macos")]
use crate::keychain::MacKeychain as PlatformSecretStore;
#[cfg(not(target_os = "macos"))]
use crate::keychain::FileSecretStore as PlatformSecretStore;

/// Default vault location: `<platform data dir>/PassForge/passforge.db`.
/// Override with PASSFORGE_DB_PATH (dev/tests) or pass a path to `open_at`.
pub fn default_db_path() -> Result<std::path::PathBuf> {
    let dir = dirs::data_dir()
        .ok_or_else(|| PassForgeError::InvalidRequest("no platform data dir".into()))?
        .join("PassForge");
    Ok(dir.join("passforge.db"))
}

fn new_db_key() -> Vec<u8> {
    let mut key = Vec::with_capacity(32);
    key.extend_from_slice(uuid::Uuid::new_v4().as_bytes());
    key.extend_from_slice(uuid::Uuid::new_v4().as_bytes());
    key
}

fn platform_secret_store(dir: &std::path::Path) -> PlatformSecretStore {
    #[cfg(target_os = "macos")]
    {
        let _ = dir;
        PlatformSecretStore
    }
    #[cfg(not(target_os = "macos"))]
    {
        PlatformSecretStore::new(dir.join("passforge.key"))
    }
}

/// Opens (or creates) the SQLCipher vault at `db_path`, using a random key
/// held in the platform secret store — never derived from the master
/// password, so the master password stays a pure generation input.
pub fn open_at(db_path: &std::path::Path) -> Result<VaultDb> {
    let dir = db_path
        .parent()
        .ok_or_else(|| PassForgeError::InvalidRequest("invalid vault path".into()))?;
    std::fs::create_dir_all(dir)?;
    let store = platform_secret_store(dir);
    let key = match store.load_database_key()? {
        Some(key) => key,
        None => {
            let key = new_db_key();
            store.save_database_key(&key)?;
            key
        }
    };
    let db = VaultDb::open_encrypted(db_path, &key)?;
    db.migrate()?;
    Ok(db)
}

pub fn open() -> Result<VaultDb> {
    let path = match std::env::var_os("PASSFORGE_DB_PATH") {
        Some(p) => std::path::PathBuf::from(p),
        None => default_db_path()?,
    };
    open_at(&path)
}

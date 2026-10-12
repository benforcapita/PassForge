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

/// The platform secret store for the vault directory (Keychain on macOS,
/// 0600 key file elsewhere). `pub(crate)` so commands can reach the same
/// store for the optional saved-master-password feature.
pub(crate) fn platform_secret_store(dir: &std::path::Path) -> PlatformSecretStore {
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

fn load_or_create_key(dir: &std::path::Path) -> Result<Vec<u8>> {
    let store = platform_secret_store(dir);
    match store.load_database_key()? {
        Some(key) => Ok(key),
        None => {
            let key = new_db_key();
            store.save_database_key(&key)?;
            Ok(key)
        }
    }
}

fn load_key(dir: &std::path::Path) -> Result<Vec<u8>> {
    platform_secret_store(dir).load_database_key()?.ok_or_else(|| {
        PassForgeError::InvalidRequest("vault is not initialized".into())
    })
}

/// Opens the vault only if it already exists — never creates the file or
/// key. Used by the native-messaging host, which must not create state.
pub fn open_existing_at(db_path: &std::path::Path) -> Result<VaultDb> {
    let dir = db_path
        .parent()
        .ok_or_else(|| PassForgeError::InvalidRequest("invalid vault path".into()))?;
    let key = load_key(dir)?;
    VaultDb::open_encrypted(db_path, &key)
}

/// Opens (or creates) the SQLCipher vault at `db_path`, using a random key
/// held in the platform secret store — never derived from the master
/// password, so the master password stays a pure generation input.
pub fn open_at(db_path: &std::path::Path) -> Result<VaultDb> {
    let dir = db_path
        .parent()
        .ok_or_else(|| PassForgeError::InvalidRequest("invalid vault path".into()))?;
    std::fs::create_dir_all(dir)?;
    let key = load_or_create_key(dir)?;
    let db = VaultDb::open_encrypted(db_path, &key)?;
    db.migrate()?;
    Ok(db)
}

/// The path `open()` resolves to (PASSFORGE_DB_PATH or the default).
pub fn resolved_db_path() -> Result<std::path::PathBuf> {
    match std::env::var_os("PASSFORGE_DB_PATH") {
        Some(p) => Ok(std::path::PathBuf::from(p)),
        None => default_db_path(),
    }
}

/// The secret store co-located with the vault `open()` uses.
pub fn resolved_secret_store() -> Result<PlatformSecretStore> {
    let path = resolved_db_path()?;
    let dir = path
        .parent()
        .ok_or_else(|| PassForgeError::InvalidRequest("invalid vault path".into()))?;
    Ok(platform_secret_store(dir))
}

pub fn open() -> Result<VaultDb> {
    open_at(&resolved_db_path()?)
}

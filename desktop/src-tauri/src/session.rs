use crate::error::{PassForgeError, Result};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use zeroize::{Zeroize, Zeroizing};

#[derive(Clone, Default)]
pub struct SessionState {
    inner: std::sync::Arc<Mutex<SessionInner>>,
}

#[derive(Default)]
struct SessionInner {
    master_password: Vec<u8>,
    unlocked_at: Option<Instant>,
    idle_timeout: Duration,
    /// Cached master-derived root keys, per label. Cleared on lock/unlock.
    root_keys: std::collections::HashMap<&'static str, Zeroizing<[u8; 32]>>,
}

impl SessionState {
    pub fn unlock(&self, master_password: Vec<u8>) -> Result<()> {
        let mut inner = self.inner.lock().expect("session mutex poisoned");
        inner.master_password.zeroize();
        inner.root_keys.clear();
        inner.master_password = master_password;
        inner.unlocked_at = Some(Instant::now());
        if inner.idle_timeout.is_zero() {
            inner.idle_timeout = Duration::from_secs(60);
        }
        Ok(())
    }

    pub fn lock(&self) -> Result<()> {
        let mut inner = self.inner.lock().expect("session mutex poisoned");
        inner.master_password.zeroize();
        inner.master_password.clear();
        inner.unlocked_at = None;
        inner.root_keys.clear();
        Ok(())
    }

    /// Root key derived from the session master password for a fixed domain
    /// `label` (PBKDF2-HMAC-SHA256, 100k iterations — a constant, NOT from
    /// settings, so changing default crypto never breaks sealed secrets).
    /// Used for sealed legacy passwords ("passforge-seal-root-v1") and the
    /// passkey root ("passforge-passkey-root-v1"). Cached per label.
    pub fn root_key(&self, label: &'static str) -> Result<Zeroizing<[u8; 32]>> {
        let mut inner = self.inner.lock().expect("session mutex poisoned");
        if inner.master_password.is_empty() || inner.unlocked_at.is_none() {
            return Err(PassForgeError::Locked);
        }
        if let Some(key) = inner.root_keys.get(label) {
            return Ok(Zeroizing::new(**key));
        }
        let mut key = [0u8; 32];
        pbkdf2::pbkdf2_hmac::<sha2::Sha256>(
            &inner.master_password,
            label.as_bytes(),
            100_000,
            &mut key,
        );
        inner.root_keys.insert(label, Zeroizing::new(key));
        Ok(Zeroizing::new(key))
    }

    pub fn is_locked(&self) -> bool {
        let inner = self.inner.lock().expect("session mutex poisoned");
        inner.master_password.is_empty() || inner.unlocked_at.is_none()
    }

    pub fn master_password_bytes(&self) -> Result<Vec<u8>> {
        let inner = self.inner.lock().expect("session mutex poisoned");
        if inner.master_password.is_empty() {
            return Err(PassForgeError::Locked);
        }
        Ok(inner.master_password.clone())
    }

    /// Refreshes the last-activity timestamp. No-op while locked.
    pub fn touch(&self) {
        let mut inner = self.inner.lock().expect("session mutex poisoned");
        if inner.unlocked_at.is_some() {
            inner.unlocked_at = Some(Instant::now());
        }
    }

    pub fn set_idle_timeout(&self, seconds: u64) {
        let mut inner = self.inner.lock().expect("session mutex poisoned");
        inner.idle_timeout = Duration::from_secs(seconds);
    }

    pub fn lock_if_idle(&self) -> Result<bool> {
        let should_lock = {
            let inner = self.inner.lock().expect("session mutex poisoned");
            inner
                .unlocked_at
                .map(|at| at.elapsed() >= inner.idle_timeout)
                .unwrap_or(false)
        };
        if should_lock {
            self.lock()?;
        }
        Ok(should_lock)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn root_key_caches_clears_and_depends_on_master() {
        let s = SessionState::default();
        assert!(s.root_key("a").is_err());
        s.unlock(b"master".to_vec()).unwrap();
        let k1 = s.root_key("a").unwrap();
        let k2 = s.root_key("a").unwrap();
        assert_eq!(&*k1, &*k2);
        let other = s.root_key("b").unwrap();
        assert_ne!(&*k1, &*other);
        s.lock().unwrap();
        assert!(s.root_key("a").is_err());
        s.unlock(b"other".to_vec()).unwrap();
        let k3 = s.root_key("a").unwrap();
        assert_ne!(&*k1, &*k3);
    }
}

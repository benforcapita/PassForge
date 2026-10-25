//! Sealed legacy passwords. A "sealed" entry stores an imported password
//! encrypted under a key derived from the session master password; the vault
//! holds ciphertext only. Ciphertext length is bucketed so stored rows don't
//! leak password length.
//!
//! Wire: `SealedSecret` (camelCase) is safe to persist/export; it never
//! appears on `VaultEntry`/`EntrySummary`, so it can't reach frontends.

use crate::error::{PassForgeError, Result};
use chacha20poly1305::aead::{Aead, AeadCore, KeyInit, OsRng, Payload};
use chacha20poly1305::{Key, XChaCha20Poly1305, XNonce};
use hkdf::Hkdf;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use zeroize::{Zeroize, Zeroizing};

const BUCKETS: [usize; 4] = [64, 128, 256, 512];
const INFO: &[u8] = b"passforge-seal-v1";
const AAD_PREFIX: &[u8] = b"passforge-seal-v1";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SealedSecret {
    pub v: u8,
    pub salt: String,
    pub nonce: String,
    pub ct: String,
}

fn key_for(root: &[u8; 32], salt: &[u8]) -> [u8; 32] {
    let hk = Hkdf::<Sha256>::new(Some(salt), root);
    let mut key = [0u8; 32];
    hk.expand(INFO, &mut key).expect("hkdf expand 32B");
    key
}

fn bucket_of(len: usize) -> Result<usize> {
    BUCKETS
        .iter()
        .copied()
        .find(|b| len <= *b - 2)
        .ok_or_else(|| PassForgeError::InvalidRequest("password exceeds 510 bytes".into()))
}

/// Encrypt `password` for `entry_id` under `root` (session seal root).
pub fn seal(root: &[u8; 32], entry_id: &str, password: &str) -> Result<SealedSecret> {
    let salt: [u8; 16] = rand::random();
    let nonce_bytes = XChaCha20Poly1305::generate_nonce(&mut OsRng);
    let key = Zeroizing::new(key_for(root, &salt));

    let pw = password.as_bytes();
    let bucket = bucket_of(pw.len())?;
    let mut pt = Zeroizing::new(vec![0u8; bucket]);
    pt[..2].copy_from_slice(&(pw.len() as u16).to_be_bytes());
    pt[2..2 + pw.len()].copy_from_slice(pw);

    let aad = [AAD_PREFIX, entry_id.as_bytes()].concat();
    let ct = XChaCha20Poly1305::new(Key::from_slice(&key[..]))
        .encrypt(&nonce_bytes, Payload { msg: &pt, aad: &aad })
        .map_err(|_| PassForgeError::InvalidRequest("seal failed".into()))?;

    Ok(SealedSecret {
        v: 1,
        salt: hex::encode(salt),
        nonce: hex::encode(nonce_bytes),
        ct: hex::encode(ct),
    })
}

/// Decrypt a `SealedSecret`. AEAD failure maps to `SealMismatch` (the sealed
/// password was imported under a different master password).
pub fn unseal(
    root: &[u8; 32],
    entry_id: &str,
    sealed: &SealedSecret,
) -> Result<Zeroizing<String>> {
    if sealed.v != 1 {
        return Err(PassForgeError::SealMismatch);
    }
    let mismatch = || PassForgeError::SealMismatch;
    let salt = hex::decode(&sealed.salt).map_err(|_| mismatch())?;
    let nonce = hex::decode(&sealed.nonce).map_err(|_| mismatch())?;
    let ct = hex::decode(&sealed.ct).map_err(|_| mismatch())?;
    if nonce.len() != 24 {
        return Err(mismatch());
    }
    let key = Zeroizing::new(key_for(root, &salt));
    let aad = [AAD_PREFIX, entry_id.as_bytes()].concat();
    let mut pt = Zeroizing::new(
        XChaCha20Poly1305::new(Key::from_slice(&key[..]))
            .decrypt(XNonce::from_slice(&nonce), Payload { msg: &ct, aad: &aad })
            .map_err(|_| mismatch())?,
    );
    let len = u16::from_be_bytes([pt[0], pt[1]]) as usize;
    if len + 2 > pt.len() {
        return Err(mismatch());
    }
    let s = String::from_utf8(pt[2..2 + len].to_vec()).map_err(|_| mismatch())?;
    pt.zeroize();
    Ok(Zeroizing::new(s))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root() -> [u8; 32] {
        [7u8; 32]
    }

    #[test]
    fn round_trip() {
        let s = seal(&root(), "e1", "hunter2").unwrap();
        assert_eq!(&*unseal(&root(), "e1", &s).unwrap(), "hunter2");
    }

    #[test]
    fn wrong_root_tampers_and_ids_mismatch() {
        let s = seal(&root(), "e1", "hunter2").unwrap();
        assert!(matches!(unseal(&[8u8; 32], "e1", &s), Err(PassForgeError::SealMismatch)));
        let mut tampered = s.clone();
        let mut c = hex::decode(&tampered.ct).unwrap();
        c[3] ^= 1;
        tampered.ct = hex::encode(c);
        assert!(matches!(unseal(&root(), "e1", &tampered), Err(PassForgeError::SealMismatch)));
        assert!(matches!(unseal(&root(), "e2", &s), Err(PassForgeError::SealMismatch)));
    }

    #[test]
    fn ciphertext_buckets_hide_length() {
        let short = seal(&root(), "e1", "a").unwrap();
        let longer = seal(&root(), "e1", "x".repeat(40).as_str()).unwrap();
        assert_eq!(
            hex::decode(&short.ct).unwrap().len(),
            hex::decode(&longer.ct).unwrap().len()
        );
    }

    #[test]
    fn overlong_rejected() {
        assert!(seal(&root(), "e1", &"x".repeat(511)).is_err());
    }
}

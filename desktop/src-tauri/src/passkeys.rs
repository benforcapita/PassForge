//! Stateless passkey provider. The signing key for a credential is derived
//! from the session's passkey root (session.root_key("passforge-passkey-root-v1")),
//! the rpId and a random 16-byte nonce — the vault only stores site/user
//! metadata plus that nonce. A credential works on any device with the same
//! master password; nothing key-shaped is at rest.
//!
//! Hand-rolled CBOR (we only need maps/ints/bstr/text) — no external encoder.

use crate::error::{PassForgeError, Result};
use hmac::{Hmac, Mac};
use hkdf::Hkdf;
use p256::ecdsa::{signature::Signer, Signature, SigningKey, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use zeroize::Zeroizing;

type HmacSha256 = Hmac<Sha256>;

/// Fixed AAGUID for PassForge authenticators (random v4 UUID generated for
/// this implementation; stable so sites can recognise us).
pub const AAGUID: [u8; 16] = [
    0x5a, 0x39, 0xbd, 0x2e, 0x8e, 0x4a, 0x4f, 0x61, 0x9c, 0x7b, 0x0c, 0x3d, 0x7a, 0xe2, 0x11, 0x55,
];

const FLAG_UP: u8 = 0x01;
const FLAG_UV: u8 = 0x04;
const FLAG_BE: u8 = 0x08;
const FLAG_BS: u8 = 0x10;
const FLAG_AT: u8 = 0x40;

// ---------------------------------------------------------------------------
// Tiny CBOR encoder
// ---------------------------------------------------------------------------

fn cbor_head(out: &mut Vec<u8>, major: u8, value: u64) {
    let base = major << 5;
    if value < 24 {
        out.push(base | value as u8);
    } else if value <= 0xFF {
        out.push(base | 24);
        out.push(value as u8);
    } else if value <= 0xFFFF {
        out.push(base | 25);
        out.extend_from_slice(&(value as u16).to_be_bytes());
    } else {
        out.push(base | 26);
        out.extend_from_slice(&(value as u32).to_be_bytes());
    }
}

fn cbor_uint(out: &mut Vec<u8>, value: u64) {
    cbor_head(out, 0, value);
}

fn cbor_nint(out: &mut Vec<u8>, value: i64) {
    debug_assert!(value < 0);
    cbor_head(out, 1, (-1 - value) as u64);
}

fn cbor_bstr(out: &mut Vec<u8>, value: &[u8]) {
    cbor_head(out, 2, value.len() as u64);
    out.extend_from_slice(value);
}

fn cbor_text(out: &mut Vec<u8>, value: &str) {
    cbor_head(out, 3, value.len() as u64);
    out.extend_from_slice(value.as_bytes());
}

fn cbor_int(out: &mut Vec<u8>, value: i64) {
    if value >= 0 {
        cbor_uint(out, value as u64);
    } else {
        cbor_nint(out, value);
    }
}

// ---------------------------------------------------------------------------
// Credential IDs: 0x01 ‖ nonce(16) ‖ HMAC tag(16)
// ---------------------------------------------------------------------------

fn id_tag(root: &[u8; 32], rp_id: &str, nonce: &[u8; 16]) -> [u8; 16] {
    let mut mac = <HmacSha256 as Mac>::new_from_slice(root).expect("hmac key");
    mac.update(b"passforge-passkey-id-v1");
    mac.update(&(rp_id.len() as u32).to_be_bytes());
    mac.update(rp_id.as_bytes());
    mac.update(nonce);
    let tag = mac.finalize().into_bytes();
    tag[..16].try_into().expect("16 bytes")
}

/// Mint a credential id for (root, rpId, nonce).
pub fn credential_id(root: &[u8; 32], rp_id: &str, nonce: &[u8; 16]) -> Vec<u8> {
    let mut id = Vec::with_capacity(33);
    id.push(0x01);
    id.extend_from_slice(nonce);
    id.extend_from_slice(&id_tag(root, rp_id, nonce));
    id
}

/// Recover the nonce from a credential id — only if it's ours AND minted for
/// this rpId. Constant-time tag comparison.
pub fn parse_credential_id(root: &[u8; 32], rp_id: &str, id: &[u8]) -> Option<[u8; 16]> {
    if id.len() != 33 || id[0] != 0x01 {
        return None;
    }
    let nonce: [u8; 16] = id[1..17].try_into().ok()?;
    let expected = id_tag(root, rp_id, &nonce);
    if expected.ct_eq(&id[17..33]).into() {
        Some(nonce)
    } else {
        None
    }
}

// ---------------------------------------------------------------------------
// Key derivation: HKDF(root, salt=nonce, info="passforge-passkey-v1"‖rpId)
// ---------------------------------------------------------------------------

fn derive_key(root: &[u8; 32], rp_id: &str, nonce: &[u8; 16]) -> Result<SigningKey> {
    for i in 0..64u8 {
        let mut info = b"passforge-passkey-v1".to_vec();
        info.extend_from_slice(rp_id.as_bytes());
        if i > 0 {
            info.push(i);
        }
        let hk = Hkdf::<Sha256>::new(Some(nonce), root);
        let mut key = Zeroizing::new([0u8; 32]);
        hk.expand(&info, &mut key[..])
            .map_err(|_| PassForgeError::InvalidRequest("hkdf expand failed".into()))?;
        if let Ok(sk) = SigningKey::from_slice(&key[..]) {
            return Ok(sk);
        }
    }
    Err(PassForgeError::InvalidRequest(
        "could not derive a valid P-256 key".into(),
    ))
}

// ---------------------------------------------------------------------------
// COSE + authenticator data
// ---------------------------------------------------------------------------

fn cose_key(vk: &VerifyingKey) -> Vec<u8> {
    let point = vk.to_encoded_point(false);
    let x = point.x().expect("uncompressed point");
    let y = point.y().expect("uncompressed point");
    // {1:2, 3:-7, -1:1, -2:x, -3:y} — canonical key order 1,3,-1,-2,-3
    let mut out = Vec::new();
    cbor_head(&mut out, 5, 5);
    cbor_uint(&mut out, 1);
    cbor_uint(&mut out, 2);
    cbor_uint(&mut out, 3);
    cbor_nint(&mut out, -7);
    cbor_nint(&mut out, -1);
    cbor_uint(&mut out, 1);
    cbor_nint(&mut out, -2);
    cbor_bstr(&mut out, x);
    cbor_nint(&mut out, -3);
    cbor_bstr(&mut out, y);
    out
}

fn rp_hash(rp_id: &str) -> [u8; 32] {
    Sha256::digest(rp_id.as_bytes()).into()
}

fn authenticator_data(rp_id: &str, attested: Option<(&[u8], &[u8])>) -> Vec<u8> {
    let mut out = rp_hash(rp_id).to_vec();
    let flags = FLAG_UP | FLAG_UV | FLAG_BE | FLAG_BS | if attested.is_some() { FLAG_AT } else { 0 };
    out.push(flags);
    out.extend_from_slice(&0u32.to_be_bytes()); // signCount: always 0
    if let Some((cred_id, cose)) = attested {
        out.extend_from_slice(&AAGUID);
        out.extend_from_slice(&(cred_id.len() as u16).to_be_bytes());
        out.extend_from_slice(cred_id);
        out.extend_from_slice(cose);
    }
    out
}

fn attestation_object(auth_data: &[u8]) -> Vec<u8> {
    // {"fmt":"none","attStmt":{},"authData":bstr} — canonical order:
    // fmt(3) < attStmt(7) < authData(8)
    let mut out = Vec::new();
    cbor_head(&mut out, 5, 3);
    cbor_text(&mut out, "fmt");
    cbor_text(&mut out, "none");
    cbor_text(&mut out, "attStmt");
    cbor_head(&mut out, 5, 0);
    cbor_text(&mut out, "authData");
    cbor_bstr(&mut out, auth_data);
    out
}

/// clientDataJSON built by the backend — fixed key order.
fn client_data_json(kind: &str, challenge_b64url: &str, origin: &str) -> Vec<u8> {
    format!(
        "{{\"type\":\"{kind}\",\"challenge\":\"{challenge_b64url}\",\"origin\":\"{origin}\",\"crossOrigin\":false}}"
    )
    .into_bytes()
}

fn sign(key: &SigningKey, auth_data: &[u8], client_data_json: &[u8]) -> Vec<u8> {
    let mut message = auth_data.to_vec();
    message.extend_from_slice(&Sha256::digest(client_data_json));
    let sig: Signature = key.sign(&message);
    sig.to_der().as_bytes().to_vec()
}

fn spki_der(key: &SigningKey) -> Vec<u8> {
    // SubjectPublicKeyInfo for EC P-256: fixed prefix + 65-byte point.
    const PREFIX: [u8; 26] = [
        0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08,
        0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00,
    ];
    let point = key.verifying_key().to_encoded_point(false);
    let mut out = PREFIX.to_vec();
    out.extend_from_slice(point.as_bytes());
    out
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedPasskey {
    pub credential_id: Vec<u8>,
    pub client_data_json: Vec<u8>,
    pub attestation_object: Vec<u8>,
    pub authenticator_data: Vec<u8>,
    pub public_key: Vec<u8>,
    pub public_key_algorithm: i64,
    pub transports: Vec<String>,
    /// The raw nonce — stored in the vault so the key can be re-derived.
    #[serde(skip)]
    pub nonce: [u8; 16],
}

#[derive(Debug, Clone)]
pub struct AssertionResult {
    pub client_data_json: Vec<u8>,
    pub authenticator_data: Vec<u8>,
    pub signature: Vec<u8>,
}

/// Create a credential. `nonce` is None → random (production); Some(n) for
/// fixtures/tests.
#[doc(hidden)]
pub fn create_with_nonce(
    root: &[u8; 32],
    rp_id: &str,
    origin: &str,
    challenge_b64url: &str,
    nonce: Option<[u8; 16]>,
) -> Result<CreatedPasskey> {
    let nonce = nonce.unwrap_or_else(|| {
rand::random()
    });
    let cred_id = credential_id(root, rp_id, &nonce);
    let key = derive_key(root, rp_id, &nonce)?;
    let cose = cose_key(key.verifying_key());
    let auth_data = authenticator_data(rp_id, Some((&cred_id, &cose)));
    let att_obj = attestation_object(&auth_data);
    let cdj = client_data_json("webauthn.create", challenge_b64url, origin);
    Ok(CreatedPasskey {
        credential_id: cred_id,
        client_data_json: cdj,
        attestation_object: att_obj,
        authenticator_data: auth_data,
        public_key: spki_der(&key),
        public_key_algorithm: -7,
        transports: vec!["internal".into(), "hybrid".into()],
        nonce,
    })
}

/// Sign an assertion for a credential id we minted (verifies the tag).
pub fn assert_with(
    root: &[u8; 32],
    rp_id: &str,
    origin: &str,
    challenge_b64url: &str,
    cred_id: &[u8],
) -> Result<Option<(AssertionResult, [u8; 16])>> {
    let Some(nonce) = parse_credential_id(root, rp_id, cred_id) else {
        return Ok(None);
    };
    let key = derive_key(root, rp_id, &nonce)?;
    let auth_data = authenticator_data(rp_id, None);
    let cdj = client_data_json("webauthn.get", challenge_b64url, origin);
    let signature = sign(&key, &auth_data, &cdj);
    Ok(Some((
        AssertionResult {
            client_data_json: cdj,
            authenticator_data: auth_data,
            signature,
        },
        nonce,
    )))
}

// ---------------------------------------------------------------------------
// Origin / rpId policy
// ---------------------------------------------------------------------------

/// Whether `rp_id` is a valid relying-party id for a request coming from
/// `origin`: https only (except http on localhost/127.0.0.1), the origin
/// host must equal rp_id or be a strict subdomain, rp_id must contain a dot
/// unless it is "localhost", and IP rp_ids other than 127.0.0.1 are refused.
pub fn rp_id_allowed(origin: &str, rp_id: &str) -> bool {
    if rp_id.is_empty() || rp_id.ends_with('.') {
        return false;
    }
    let url = match url::Url::parse(origin) {
        Ok(u) => u,
        Err(_) => return false,
    };
    let host = match url.host_str() {
        Some(h) => h.trim_end_matches('.').to_lowercase(),
        None => return false,
    };
    let rp = rp_id.trim_end_matches('.').to_lowercase();
    let loopback_http = host == "localhost" || host == "127.0.0.1";
    match url.scheme() {
        "https" => {}
        "http" if loopback_http => {}
        _ => return false,
    }
    // Host must equal the rpId or be a strict subdomain of it.
    if host != rp && !host.ends_with(&format!(".{rp}")) {
        return false;
    }
    // rpId must contain a dot unless it is "localhost" or the loopback IP
    // over http; all other IP rpIds are refused.
    if rp != "localhost" {
        if !rp.contains('.') {
            return false;
        }
        let loopback_ip = rp == "127.0.0.1" && url.scheme() == "http" && host == "127.0.0.1";
        if !loopback_ip && rp.parse::<std::net::IpAddr>().is_ok() {
            return false;
        }
    }
    true
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn root() -> [u8; 32] {
        [7u8; 32]
    }

    #[test]
    fn deterministic_key_per_rp_and_nonce() {
        let n = [9u8; 16];
        let a = derive_key(&root(), "example.com", &n).unwrap();
        let b = derive_key(&root(), "example.com", &n).unwrap();
        assert_eq!(a.to_bytes(), b.to_bytes());
        let c = derive_key(&root(), "other.com", &n).unwrap();
        assert_ne!(a.to_bytes(), c.to_bytes());
    }

    #[test]
    fn credential_id_round_trip_and_rejections() {
        let n = [1u8; 16];
        let id = credential_id(&root(), "example.com", &n);
        assert_eq!(id.len(), 33);
        assert_eq!(parse_credential_id(&root(), "example.com", &id), Some(n));
        assert_eq!(parse_credential_id(&root(), "other.com", &id), None);
        let mut bad = id.clone();
        bad[20] ^= 1;
        assert_eq!(parse_credential_id(&root(), "example.com", &bad), None);
        assert_eq!(parse_credential_id(&root(), "example.com", &id[..20]), None);
        assert_eq!(parse_credential_id(&[8u8; 32], "example.com", &id), None);
    }

    #[test]
    fn signature_verifies_with_derived_pubkey() {
        let n = [2u8; 16];
        let key = derive_key(&root(), "example.com", &n).unwrap();
        let auth = authenticator_data("example.com", None);
        let cdj = client_data_json("webauthn.get", "Y2hhbGxlbmdl", "https://example.com");
        let sig = sign(&key, &auth, &cdj);
        let vk = key.verifying_key();
        let mut msg = auth.clone();
        msg.extend_from_slice(&Sha256::digest(&cdj));
        let signature = Signature::from_der(&sig).unwrap();
        use p256::ecdsa::signature::Verifier;
        assert!(vk.verify(&msg, &signature).is_ok());
    }

    #[test]
    fn cose_key_bytes_match_handcomputed() {
        let n = [3u8; 16];
        let key = derive_key(&root(), "example.com", &n).unwrap();
        let cose = cose_key(key.verifying_key());
        // a5 01 02 03 26 20 01 21 5820 <x> 22 5820 <y>
        let point = key.verifying_key().to_encoded_point(false);
        let mut expected = vec![0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20];
        expected.extend_from_slice(point.x().unwrap());
        expected.extend_from_slice(&[0x22, 0x58, 0x20]);
        expected.extend_from_slice(point.y().unwrap());
        assert_eq!(cose, expected);
    }

    #[test]
    fn authdata_flags_and_lengths() {
        let n = [4u8; 16];
        let id = credential_id(&root(), "example.com", &n);
        let key = derive_key(&root(), "example.com", &n).unwrap();
        let cose = cose_key(key.verifying_key());
        let create = authenticator_data("example.com", Some((&id, &cose)));
        assert_eq!(create[32], FLAG_UP | FLAG_UV | FLAG_BE | FLAG_BS | FLAG_AT);
        assert_eq!(&create[33..37], &[0, 0, 0, 0]);
        assert_eq!(&create[37..53], &AAGUID);
        assert_eq!(u16::from_be_bytes([create[53], create[54]]), 33);
        assert_eq!(create.len(), 55 + 33 + cose.len());
        let get = authenticator_data("example.com", None);
        assert_eq!(get.len(), 37);
        assert_eq!(get[32], FLAG_UP | FLAG_UV | FLAG_BE | FLAG_BS);
    }

    #[test]
    fn rp_id_policy() {
        // happy paths
        assert!(rp_id_allowed("https://example.com", "example.com"));
        assert!(rp_id_allowed("https://app.example.com", "example.com"));
        assert!(rp_id_allowed("https://example.com:8443", "example.com"));
        assert!(rp_id_allowed("http://localhost:8181", "localhost"));
        assert!(rp_id_allowed("http://127.0.0.1:9000", "127.0.0.1"));
        // rejections
        for (o, r) in [
            ("https://example.com.evil.io", "example.com"),
            ("https://notexample.com", "example.com"),
            ("http://example.com", "example.com"),
            ("https://example.com", "com"),
            ("https://example.com", "localhost"),
            ("https://10.0.0.1", "10.0.0.1"),
            ("http://10.0.0.1", "10.0.0.1"),
            ("http://127.0.0.1:9000", "localhost"),
            ("not a url", "example.com"),
            ("https://example.com", ""),
            ("https://example.com", "example.com."),
            ("ftp://example.com", "example.com"),
        ] {
            assert!(!rp_id_allowed(o, r), "{o} {r}");
        }
    }

    #[test]
    fn create_attestation_and_get_sign() {
        let created =
            create_with_nonce(&root(), "localhost", "http://localhost:8181", "Y2hhbA", Some([5u8; 16]))
                .unwrap();
        assert!(created.attestation_object.starts_with(&[0xa3]));
        let res = assert_with(
            &root(),
            "localhost",
            "http://localhost:8181",
            "Y2hhbA",
            &created.credential_id,
        )
        .unwrap();
        assert!(res.is_some());
        // foreign rp id → None
        let res2 = assert_with(&root(), "evil.io", "https://evil.io", "Y2hhbA", &created.credential_id)
            .unwrap();
        assert!(res2.is_none());
    }
}

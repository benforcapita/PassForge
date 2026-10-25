//! Deterministic passkey vectors: fixed root + nonce + inputs → fixed
//! attestation/assertion bytes (ECDSA is RFC-6979 deterministic). If the
//! crypto drifts, this fails. Regenerate with `UPDATE_FIXTURES=1`.
use passforge_desktop::passkeys::{assert_with, create_with_nonce};
use serde::Deserialize;

const ROOT: [u8; 32] = [
    0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef, 0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef,
    0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef, 0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef,
];
const NONCE: [u8; 16] = [
    0xaa, 0xbb, 0xcc, 0xdd, 0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xee, 0xff,
];
const RP_ID: &str = "localhost";
const ORIGIN: &str = "http://localhost:8181";
const CREATE_CHALLENGE: &str = "Y3JlYXRlLWNoYWxsZW5nZQ";
const GET_CHALLENGE: &str = "Z2V0LWNoYWxsZW5nZQ";

fn b64(bytes: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn produce() -> serde_json::Value {
    let created = create_with_nonce(&ROOT, RP_ID, ORIGIN, CREATE_CHALLENGE, Some(NONCE)).unwrap();
    let (assertion, _) = assert_with(
        &ROOT, RP_ID, ORIGIN, GET_CHALLENGE, &created.credential_id,
    )
    .unwrap()
    .unwrap();
    serde_json::json!({
        "rpId": RP_ID,
        "origin": ORIGIN,
        "registration": {
            "challenge": CREATE_CHALLENGE,
            "credentialId": b64(&created.credential_id),
            "clientDataJSON": b64(&created.client_data_json),
            "attestationObject": b64(&created.attestation_object),
            "authenticatorData": b64(&created.authenticator_data),
            "publicKey": b64(&created.public_key),
            "publicKeyAlgorithm": created.public_key_algorithm,
        },
        "assertion": {
            "challenge": GET_CHALLENGE,
            "clientDataJSON": b64(&assertion.client_data_json),
            "authenticatorData": b64(&assertion.authenticator_data),
            "signature": b64(&assertion.signature),
        },
    })
}

#[test]
fn vectors_match_fixture() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/passkey_vectors.json");
    let expected = produce();
    if std::env::var("UPDATE_FIXTURES").is_ok() {
        std::fs::write(path, serde_json::to_string_pretty(&expected).unwrap()).unwrap();
        return;
    }
    let stored: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(path).expect("missing fixture; run UPDATE_FIXTURES=1")).unwrap();
    assert_eq!(expected, stored);
}

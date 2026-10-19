use passforge_desktop::browser_hosts::{self, EXTENSION_ID, HOST_NAME};
use sha2::{Digest, Sha256};
use std::path::Path;

/// Chrome derives an extension's ID from the SHA-256 of its public key
/// (first 16 bytes, hex digits mapped 0-f -> a-p). The constant the app
/// registers must match the key shipped in the extension manifest.
#[test]
fn extension_id_matches_manifest_key() {
    let manifest: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../packages/passforge-extension/public/manifest.json"),
        )
        .unwrap(),
    )
    .unwrap();
    let der = base64_decode(manifest["key"].as_str().expect("manifest has a key"));
    let id: String = hex::encode(&Sha256::digest(&der)[..16])
        .chars()
        .map(|c| (b'a' + c.to_digit(16).unwrap() as u8) as char)
        .collect();
    assert_eq!(id, EXTENSION_ID);
}

#[test]
fn registers_only_installed_browsers_and_is_idempotent() {
    let home = tempfile::tempdir().unwrap();
    let chrome_root = browser_hosts::browser_dirs(home.path())
        .into_iter()
        .find(|(name, ..)| *name == "chrome")
        .unwrap();
    std::fs::create_dir_all(&chrome_root.1).unwrap();
    let host = Path::new("/Applications/PassForge.app/Contents/MacOS/passforge-host");

    assert_eq!(browser_hosts::register(home.path(), host), vec!["chrome"]);
    let written: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(chrome_root.2.join(format!("{HOST_NAME}.json"))).unwrap(),
    )
    .unwrap();
    assert_eq!(written["name"], HOST_NAME);
    assert_eq!(written["path"], host.to_str().unwrap());
    assert_eq!(
        written["allowed_origins"],
        serde_json::json!([format!("chrome-extension://{EXTENSION_ID}/")])
    );
    // Unchanged → nothing rewritten; moved app → rewritten.
    assert!(browser_hosts::register(home.path(), host).is_empty());
    assert_eq!(
        browser_hosts::register(home.path(), Path::new("/tmp/PassForge.app/Contents/MacOS/passforge-host")),
        vec!["chrome"]
    );
    // Browsers that aren't installed never get a directory created.
    let brave = browser_hosts::browser_dirs(home.path())
        .into_iter()
        .find(|(name, ..)| *name == "brave")
        .unwrap();
    assert!(!brave.1.exists());
}

fn base64_decode(s: &str) -> Vec<u8> {
    const T: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = Vec::new();
    let (mut buf, mut bits) = (0u32, 0);
    for c in s.bytes().filter(|&c| c != b'=') {
        buf = (buf << 6) | T.iter().position(|&t| t == c).unwrap() as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
        }
    }
    out
}

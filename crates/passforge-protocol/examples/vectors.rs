//! Golden vectors for `packages/passforge-protocol-js`:
//! `cargo run -q -p passforge-protocol --example vectors > packages/passforge-protocol-js/test/vectors.json`

use lesspass_core::{
    build_fingerprint_hash, create_fingerprint, render_password,
    types::{CryptoConfig, PasswordOptions, PasswordProfile, SaltField},
};
use passforge_protocol::{blind, finish_entropy, finish_password, settings_digest};
use serde_json::{json, Value};

fn options(lowercase: bool, uppercase: bool, digits: bool, symbols: bool, length: usize) -> PasswordOptions {
    PasswordOptions { lowercase, uppercase, digits, symbols, length }
}

fn output(len: usize, seed: u8) -> Vec<u8> {
    (0..len).map(|i| (i as u8).wrapping_mul(31).wrapping_add(seed)).collect()
}

fn options_json(o: &PasswordOptions) -> Value {
    json!({
        "lowercase": o.lowercase, "uppercase": o.uppercase,
        "digits": o.digits, "symbols": o.symbols, "length": o.length,
    })
}

fn main() {
    let field = |k: &str, v: &str| SaltField { key: k.into(), value: v.into() };
    let cases: Vec<(&str, &str, &str, u32, PasswordOptions, Vec<SaltField>, &str, u32, usize)> = vec![
        ("example.org", "alice@example.org", "correct horse", 1, options(true, true, true, true, 16), vec![], "sha256", 1000, 32),
        ("lesspass.com", "♥", "tHis is a g00d! password", 2, options(true, true, true, true, 35), vec![], "sha256", 1000, 32),
        ("github.com", "", "master", 1, options(true, false, false, false, 4), vec![], "sha256", 1000, 32),
        ("bank.example", "carol", "master", 255, options(false, true, false, false, 12), vec![], "sha512", 1000, 32),
        ("bank.example", "carol", "master", 3, options(false, false, true, false, 6), vec![], "sha1", 1000, 32),
        ("symbols.test", "dave", "pässwörd", 1, options(false, false, false, true, 20), vec![], "sha-256", 1000, 32),
        ("salted.test", "erin", "master", 1, options(true, true, true, true, 16), vec![field("b", "2"), field("a", "1"), field("a", "0")], "sha256", 1000, 32),
        ("long.test", "frank", "master", 7, options(true, true, true, true, 128), vec![], "SHA-512", 1000, 32),
        ("mixed.test", "grace", "master", 1, options(true, false, true, false, 10), vec![field("env", "prod")], "sha256", 1000, 64),
        ("mixed.test", "heidi", "master", 2, options(false, true, true, true, 24), vec![], "sha1", 1000, 32),
        ("unknown-digest.test", "ivan", "master", 1, options(true, true, false, false, 8), vec![], "md5", 1000, 32),
        ("example.org", "alice@example.org", "correct horse", 1, options(true, true, true, true, 16), vec![], "sha256", 100_000, 32),
    ];

    let protocol: Vec<Value> = cases
        .into_iter()
        .enumerate()
        .map(|(i, (site, login, master, counter, opts, salt_fields, digest, iterations, out_len))| {
            let profile = PasswordProfile {
                site: site.into(),
                login: login.into(),
                counter,
                options: opts.clone(),
                salt_fields: salt_fields.clone(),
                crypto: None,
            };
            let crypto = CryptoConfig { iterations, keylen: 32, digest: digest.into() };
            let blinded = blind(&profile, master, &crypto);
            let server_output = output(out_len, i as u8);
            json!({
                "profile": {
                    "site": site, "login": login, "counter": counter,
                    "lowercase": opts.lowercase, "uppercase": opts.uppercase,
                    "digits": opts.digits, "symbols": opts.symbols, "length": opts.length,
                    "saltFields": salt_fields.iter().map(|f| json!({"key": f.key, "value": f.value})).collect::<Vec<_>>(),
                },
                "masterPassword": master,
                "crypto": { "iterations": iterations, "digest": digest },
                "settingsDigest": hex::encode(settings_digest(&profile)),
                "inputHex": blinded.input_hex(),
                "serverOutput": hex::encode(&server_output),
                "entropy": finish_entropy(&blinded, &server_output).unwrap(),
                "password": finish_password(&blinded, &server_output, &opts).unwrap(),
            })
        })
        .collect();

    let entropies = [
        "e99e20abab609cc4564ef137acb540de20d9b92dcc5cda58f78ba431444ef2da",
        "0000000000000000000000000000000000000000000000000000000000000000",
        "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    ];
    let render_opts = [
        options(true, true, true, true, 16),
        options(true, false, false, false, 4),
        options(false, true, true, false, 33),
        options(false, false, false, true, 64),
    ];
    let render: Vec<Value> = entropies
        .iter()
        .zip(render_opts.iter().cycle())
        .chain(entropies.iter().zip(render_opts.iter().rev()))
        .map(|(entropy, opts)| {
            json!({
                "entropy": entropy,
                "options": options_json(opts),
                "password": render_password(entropy, opts).unwrap(),
            })
        })
        .collect();

    let fingerprint: Vec<Value> = ["master", "tHis is a g00d! password", "♥", ""]
        .iter()
        .map(|master| {
            json!({
                "masterPassword": master,
                "fingerprint": create_fingerprint(&build_fingerprint_hash(master)).unwrap(),
            })
        })
        .collect();

    println!(
        "{}",
        serde_json::to_string_pretty(&json!({
            "protocol": protocol,
            "render": render,
            "fingerprint": fingerprint,
        }))
        .unwrap()
    );
}

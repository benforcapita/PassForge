use lesspass_core::{CryptoConfig, PasswordOptions, calc_entropy, render_password};
use passforge_desktop::commands::{
    derive_password, derive_password_with, synthesize_fingerprints,
};
use passforge_desktop::db::VaultDb;
use passforge_desktop::error::PassForgeError;
use passforge_desktop::models::{EntryInput, FolderInput, GenerationMode, Settings};
use passforge_desktop::session::SessionState;
use passforge_protocol::{DeriveResponse, blind, finish_password};

fn sample_entry(folder_id: String) -> EntryInput {
    EntryInput {
        site: "example.com".into(),
        login: "me@example.com".into(),
        counter: 1,
        options: PasswordOptions::default(),
        salt_fields: vec![],
        crypto: None,
        folder_id,
        group_ids: vec![],
        tags: vec![],
    }
}

#[test]
fn search_synthesizes_login_based_fingerprints() {
    let db = VaultDb::memory().unwrap();
    db.migrate().unwrap();
    let folder = db
        .create_folder(FolderInput { parent_id: None, name: "Personal".into() })
        .unwrap();
    let mut a = sample_entry(folder.id.clone());
    db.create_entry(a.clone()).unwrap();
    a.login = "other@example.com".into();
    a.site = "other.example".into();
    db.create_entry(a).unwrap();

    let mut entries = db.search_entries("").unwrap();
    assert_eq!(entries.len(), 2);
    assert!(entries.iter().all(|e| e.fingerprint.is_none()));

    synthesize_fingerprints(&mut entries).unwrap();

    assert_eq!(entries.len(), 2);
    for entry in &entries {
        let fp = entry.fingerprint.as_ref().expect("fingerprint set");
        assert_eq!(fp.len(), 3, "fingerprint has three fingers");
    }
    // Fingerprints derive from the login, so distinct logins should differ.
    let icons_a: Vec<_> = entries[0].fingerprint.as_ref().unwrap().iter().collect();
    let icons_b: Vec<_> = entries[1].fingerprint.as_ref().unwrap().iter().collect();
    assert_ne!(format!("{icons_a:?}"), format!("{icons_b:?}"));
}

#[test]
fn derive_password_uses_entry_crypto_when_present() {
    let db = VaultDb::memory().unwrap();
    db.migrate().unwrap();
    let folder = db
        .create_folder(FolderInput { parent_id: None, name: "Personal".into() })
        .unwrap();

    let mut entry_input = sample_entry(folder.id.clone());
    entry_input.crypto = Some(CryptoConfig { iterations: 10_000, keylen: 32, digest: "sha256".into() });
    let entry = db.create_entry(entry_input).unwrap();

    let settings = Settings::default();
    let pw = derive_password(&entry, "master-secret", &settings).unwrap();
    assert!(!pw.is_empty());

    // Same inputs => same password (deterministic).
    let pw_again = derive_password(&entry, "master-secret", &settings).unwrap();
    assert_eq!(pw, pw_again);

    // Different master password => different output.
    let pw_other = derive_password(&entry, "different-master", &settings).unwrap();
    assert_ne!(pw, pw_other);
}

#[test]
fn derive_password_falls_back_to_settings_default_crypto() {
    let db = VaultDb::memory().unwrap();
    db.migrate().unwrap();
    let folder = db
        .create_folder(FolderInput { parent_id: None, name: "Personal".into() })
        .unwrap();
    let entry = db.create_entry(sample_entry(folder.id)).unwrap();

    let settings = Settings::default();
    let pw = derive_password(&entry, "master-secret", &settings).unwrap();
    assert!(!pw.is_empty());
}

#[test]
fn unlock_then_derive_password_is_consistent() {
    let session = SessionState::default();
    session.unlock(b"master-secret".to_vec()).unwrap();

    let bytes = session.master_password_bytes().unwrap();
    let master = String::from_utf8(bytes).unwrap();
    assert_eq!(master, "master-secret");

    let db = VaultDb::memory().unwrap();
    db.migrate().unwrap();
    let folder = db
        .create_folder(FolderInput { parent_id: None, name: "Personal".into() })
        .unwrap();
    let entry = db.create_entry(sample_entry(folder.id)).unwrap();

    let settings = Settings::default();
    let pw_a = derive_password(&entry, &master, &settings).unwrap();
    let pw_b = derive_password(&entry, &master, &settings).unwrap();
    assert_eq!(pw_a, pw_b);
}

#[test]
fn master_fingerprint_is_deterministic_and_varies() {
    use passforge_desktop::commands::master_fingerprint;

    let a1 = master_fingerprint("correct horse").unwrap();
    let a2 = master_fingerprint("correct horse").unwrap();
    let b = master_fingerprint("battery staple").unwrap();

    assert_eq!(a1, a2);
    assert_eq!(a1.len(), 3);
    assert_ne!(format!("{a1:?}"), format!("{b:?}"));
}

#[test]
fn serverless_generation_matches_lesspass_core() {
    let db = VaultDb::memory().unwrap();
    db.migrate().unwrap();
    let folder = db
        .create_folder(FolderInput {
            parent_id: None,
            name: "Personal".into(),
        })
        .unwrap();
    let entry = db.create_entry(sample_entry(folder.id)).unwrap();
    let settings = Settings::default();
    let master = "fixed-master-password";
    let crypto = entry
        .profile
        .crypto
        .as_ref()
        .unwrap_or(&settings.default_crypto);
    let expected_entropy = calc_entropy(&entry.profile, master, crypto);
    let expected = render_password(&expected_entropy, &entry.profile.options).unwrap();

    assert_eq!(
        derive_password(&entry, master, &settings).unwrap(),
        expected
    );
}

#[test]
fn server_generation_sends_blinded_input_and_finishes_locally() {
    let db = VaultDb::memory().unwrap();
    db.migrate().unwrap();
    let folder = db
        .create_folder(FolderInput {
            parent_id: None,
            name: "Personal".into(),
        })
        .unwrap();
    let entry = db.create_entry(sample_entry(folder.id)).unwrap();
    let master = "fixed-master-password";
    let settings = Settings {
        generation: GenerationMode::Server {
            url: "  https://algorithm.example/// ".into(),
            algorithm: Some("pbkdf2-sha512-v1".into()),
        },
        ..Settings::default()
    };
    let expected_blind = blind(&entry.profile, master, &settings.default_crypto).input_hex();
    let server_output = [0x42; 32];

    let actual = derive_password_with(&entry, master, &settings, |url, algorithm, input| {
        assert_eq!(url, "https://algorithm.example");
        assert_eq!(algorithm, Some("pbkdf2-sha512-v1"));
        assert_eq!(input, expected_blind);
        Ok(DeriveResponse {
            algorithm: "pbkdf2-sha512-v1".into(),
            output: hex::encode(server_output),
        })
    })
    .unwrap();
    let expected = finish_password(
        &blind(&entry.profile, master, &settings.default_crypto),
        &server_output,
        &entry.profile.options,
    )
    .unwrap();

    assert_eq!(actual, expected);
}

#[test]
fn server_generation_propagates_transport_and_invalid_hex_errors() {
    let db = VaultDb::memory().unwrap();
    db.migrate().unwrap();
    let folder = db
        .create_folder(FolderInput {
            parent_id: None,
            name: "Personal".into(),
        })
        .unwrap();
    let entry = db.create_entry(sample_entry(folder.id)).unwrap();
    let settings = Settings {
        generation: GenerationMode::Server {
            url: "https://algorithm.example".into(),
            algorithm: None,
        },
        ..Settings::default()
    };

    let transport_error = derive_password_with(&entry, "master", &settings, |_, _, _| {
        Err(PassForgeError::Remote("offline".into()))
    })
    .unwrap_err();
    assert!(matches!(transport_error, PassForgeError::Remote(message) if message == "offline"));

    let invalid_hex = derive_password_with(&entry, "master", &settings, |_, _, _| {
        Ok(DeriveResponse {
            algorithm: "argon2id-v1".into(),
            output: "not-hex".into(),
        })
    })
    .unwrap_err();
    assert!(matches!(invalid_hex, PassForgeError::Remote(_)));
}

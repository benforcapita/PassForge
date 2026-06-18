use lesspass_core::{PasswordOptions, CryptoConfig};
use passforge_desktop::commands::{derive_password, synthesize_fingerprints};
use passforge_desktop::db::VaultDb;
use passforge_desktop::models::{EntryInput, FolderInput, Settings};
use passforge_desktop::session::SessionState;

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

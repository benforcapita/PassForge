use lesspass_core::PasswordOptions;
use passforge_desktop::db::VaultDb;
use passforge_desktop::models::{EntryInput, FolderInput};

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
        tags: vec!["finance".into(), "primary".into()],
    }
}

#[test]
fn creates_folder_and_entry_without_storing_password() {
    let db = VaultDb::memory().unwrap();
    db.migrate().unwrap();

    let folder = db
        .create_folder(FolderInput {
            parent_id: None,
            name: "Personal".into(),
        })
        .unwrap();
    let entry = db.create_entry(sample_entry(folder.id.clone())).unwrap();
    let loaded = db.get_entry(&entry.id).unwrap().unwrap();

    assert_eq!(loaded.profile.site, "example.com");
    assert_eq!(loaded.profile.login, "me@example.com");
    assert_eq!(loaded.folder_id, folder.id);
    assert_eq!(loaded.tags, vec!["finance", "primary"]);
    assert_eq!(
        db.debug_column_names("entries")
            .unwrap()
            .contains(&"password".to_string()),
        false
    );
}

#[test]
fn opens_encrypted_database_with_key() {
    let temp_dir = tempfile::tempdir().unwrap();
    let db_path = temp_dir.path().join("vault.sqlite");

    let db = VaultDb::open_encrypted(&db_path, b"0123456789abcdef0123456789abcdef").unwrap();
    db.migrate().unwrap();
    drop(db);

    let reopened = VaultDb::open_encrypted(&db_path, b"0123456789abcdef0123456789abcdef").unwrap();
    reopened.migrate().unwrap();
}

#[test]
fn searches_entries_by_domain_and_login() {
    let db = VaultDb::memory().unwrap();
    db.migrate().unwrap();
    let folder = db
        .create_folder(FolderInput {
            parent_id: None,
            name: "Root".into(),
        })
        .unwrap();
    db.create_entry(sample_entry(folder.id)).unwrap();

    let matches = db.search_entries("example").unwrap();

    assert_eq!(matches.len(), 1);
    assert_eq!(matches[0].site, "example.com");
    assert_eq!(matches[0].login, "me@example.com");
}

#[test]
fn rejects_unsafe_debug_table_names() {
    let db = VaultDb::memory().unwrap();
    db.migrate().unwrap();

    let error = db.debug_column_names("entries); DROP TABLE entries; --");

    assert_eq!(
        error.unwrap_err().to_string(),
        "invalid request: table name must be a simple identifier"
    );
}

#[test]
fn list_folders_returns_alphabetical_order() {
    let db = VaultDb::memory().unwrap();
    db.migrate().unwrap();
    for name in ["Zeta", "Alpha", "Mango"] {
        db.create_folder(FolderInput {
            parent_id: None,
            name: name.into(),
        })
        .unwrap();
    }

    let folders = db.list_folders().unwrap();
    let names: Vec<_> = folders.iter().map(|f| f.name.as_str()).collect();
    assert_eq!(names, vec!["Alpha", "Mango", "Zeta"]);
}

#[test]
fn update_entry_changes_fields_and_replaces_tags() {
    let db = VaultDb::memory().unwrap();
    db.migrate().unwrap();
    let folder = db
        .create_folder(FolderInput {
            parent_id: None,
            name: "Root".into(),
        })
        .unwrap();
    let entry = db.create_entry(sample_entry(folder.id.clone())).unwrap();
    let created_at = entry.updated_at.clone();

    let mut input = sample_entry(folder.id);
    input.site = "new.example.com".into();
    input.login = "other@example.com".into();
    input.counter = 7;
    input.tags = vec!["rotated".into()];

    let updated = db.update_entry(&entry.id, input).unwrap();
    assert_eq!(updated.profile.site, "new.example.com");
    assert_eq!(updated.profile.login, "other@example.com");
    assert_eq!(updated.profile.counter, 7);
    assert_eq!(updated.tags, vec!["rotated"]);
    assert!(updated.updated_at >= created_at);
}

#[test]
fn update_and_delete_missing_entry_return_not_found() {
    use passforge_desktop::error::PassForgeError;

    let db = VaultDb::memory().unwrap();
    db.migrate().unwrap();
    let folder = db
        .create_folder(FolderInput {
            parent_id: None,
            name: "Root".into(),
        })
        .unwrap();

    let update_err = db
        .update_entry("missing-id", sample_entry(folder.id))
        .unwrap_err();
    assert!(matches!(update_err, PassForgeError::EntryNotFound(_)));

    let delete_err = db.delete_entry("missing-id").unwrap_err();
    assert!(matches!(delete_err, PassForgeError::EntryNotFound(_)));
}

#[test]
fn delete_entry_removes_it() {
    let db = VaultDb::memory().unwrap();
    db.migrate().unwrap();
    let folder = db
        .create_folder(FolderInput {
            parent_id: None,
            name: "Root".into(),
        })
        .unwrap();
    let entry = db.create_entry(sample_entry(folder.id)).unwrap();

    db.delete_entry(&entry.id).unwrap();
    assert!(db.get_entry(&entry.id).unwrap().is_none());
}

#[test]
fn entry_summary_includes_counter_and_folder_id() {
    let db = VaultDb::memory().unwrap();
    db.migrate().unwrap();
    let folder = db
        .create_folder(FolderInput {
            parent_id: None,
            name: "Root".into(),
        })
        .unwrap();
    let mut input = sample_entry(folder.id.clone());
    input.counter = 3;
    db.create_entry(input).unwrap();

    let matches = db.search_entries("example").unwrap();
    assert_eq!(matches.len(), 1);
    assert_eq!(matches[0].counter, 3);
    assert_eq!(matches[0].folder_id, folder.id);
}

#[test]
fn encrypted_vault_persists_entries_and_settings_across_reopen() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("passforge.db");
    let key = [7u8; 32];

    {
        let db = VaultDb::open_encrypted(&db_path, &key).unwrap();
        db.migrate().unwrap();
        let folder = db
            .create_folder(FolderInput { parent_id: None, name: "Work".into() })
            .unwrap();
        db.create_entry(sample_entry(folder.id.clone())).unwrap();
        db.set_kv("settings", "{\"idle_lock_seconds\":42}").unwrap();
    }

    {
        let db = VaultDb::open_encrypted(&db_path, &key).unwrap();
        db.migrate().unwrap();
        let entries = db.search_entries("").unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].site, "example.com");
        assert_eq!(
            db.get_kv("settings").unwrap().as_deref(),
            Some("{\"idle_lock_seconds\":42}")
        );
    }
}

#[test]
fn encrypted_vault_rejects_wrong_key() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("passforge.db");
    {
        let db = VaultDb::open_encrypted(&db_path, &[7u8; 32]).unwrap();
        db.migrate().unwrap();
    }
    let bad = VaultDb::open_encrypted(&db_path, &[9u8; 32]).and_then(|db| db.migrate());
    assert!(bad.is_err());
}

#[test]
fn vault_open_creates_db_and_key_file_then_reopens() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("nested").join("passforge.db");

    {
        let db = passforge_desktop::vault::open_at(&db_path).unwrap();
        let folder = db
            .create_folder(FolderInput { parent_id: None, name: "Work".into() })
            .unwrap();
        db.create_entry(sample_entry(folder.id)).unwrap();
    }

    // key file was created beside the db
    assert!(dir.path().join("nested").join("passforge.key").exists());

    let db = passforge_desktop::vault::open_at(&db_path).unwrap();
    assert_eq!(db.search_entries("").unwrap().len(), 1);
}

#[test]
fn native_messaging_frame_roundtrip_and_dispatch() {
    use passforge_desktop::native_messaging::{dispatch, read_frame, write_frame};

    let mut buf = Vec::new();
    write_frame(&mut buf, r#"{"op":"ping"}"#).unwrap();
    let mut cur = std::io::Cursor::new(buf);
    assert_eq!(read_frame(&mut cur).unwrap().as_deref(), Some(r#"{"op":"ping"}"#));
    assert_eq!(read_frame(&mut cur).unwrap(), None); // clean EOF

    // dispatch on a real vault
    let db = VaultDb::memory().unwrap();
    db.migrate().unwrap();
    let folder = db
        .create_folder(FolderInput { parent_id: None, name: "Work".into() })
        .unwrap();
    db.create_entry(sample_entry(folder.id)).unwrap();

    let resp = dispatch(Some(&db), r#"{"op":"search","query":"example"}"#);
    let json = serde_json::to_value(&resp).unwrap();
    assert_eq!(json["status"], "ok");
    assert_eq!(json["result"].as_array().unwrap().len(), 1);

    let id = json["result"][0]["id"].as_str().unwrap();
    let resp = dispatch(
        Some(&db),
        &format!(
            r#"{{"op":"generate","entry_id":"{id}","master_password":"hunter2"}}"#
        ),
    );
    let json = serde_json::to_value(&resp).unwrap();
    assert_eq!(json["status"], "ok");
    assert!(json["result"]["password"].as_str().unwrap().len() > 0);

    // locked host (no vault) degrades, doesn't die
    let resp = dispatch(None, r#"{"op":"search"}"#);
    assert_eq!(serde_json::to_value(&resp).unwrap()["status"], "err");
}

// Dev utility: seeds a demo vault at $PASSFORGE_DB_PATH (or the default
// location) with a folder and two entries for manual/e2e testing.
use passforge_desktop::db::VaultDb;
use passforge_desktop::models::{EntryInput, FolderInput};
use passforge_desktop::vault;
use lesspass_core::PasswordOptions;

fn main() {
    let path = match std::env::var_os("PASSFORGE_DB_PATH") {
        Some(p) => std::path::PathBuf::from(p),
        None => vault::default_db_path().expect("data dir"),
    };
    let db: VaultDb = vault::open_at(&path).expect("vault opens");
    let folder = db
        .create_folder(FolderInput { parent_id: None, name: "Demo".into() })
        .unwrap();
    for (site, login) in [("github.com", "dev@passforge.io"), ("example.com", "me@example.com")] {
        db.create_entry(EntryInput {
            site: site.into(),
            login: login.into(),
            counter: 1,
            options: PasswordOptions::default(),
            salt_fields: vec![],
            crypto: None,
            folder_id: folder.id.clone(),
            group_ids: vec![],
            tags: vec![],
        })
        .unwrap();
    }
    println!("seeded {}", path.display());
}

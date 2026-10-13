use crate::error::{PassForgeError, Result};
use crate::models::{
    EntryInput, EntrySummary, Folder, FolderInput, ImportReport, VaultEntry, VaultExport,
};
use chrono::Utc;
use lesspass_core::PasswordProfile;
use rusqlite::{Connection, params};
use uuid::Uuid;

pub struct VaultDb {
    conn: Connection,
}

impl VaultDb {
    pub fn memory() -> Result<Self> {
        Ok(Self {
            conn: Connection::open_in_memory()?,
        })
    }

    pub fn open(path: &std::path::Path) -> Result<Self> {
        Ok(Self {
            conn: Connection::open(path)?,
        })
    }

    pub fn open_encrypted(path: &std::path::Path, key: &[u8]) -> Result<Self> {
        let conn = Connection::open(path)?;
        let key_hex = hex::encode(key);
        conn.pragma_update(None, "key", format!("x'{key_hex}'"))?;
        conn.pragma_update(None, "cipher_page_size", 4096)?;
        conn.pragma_update(None, "kdf_iter", 256000)?;
        conn.execute_batch("SELECT count(*) FROM sqlite_master;")?;
        Ok(Self { conn })
    }

    pub fn migrate(&self) -> Result<()> {
        self.conn.execute_batch(
            r#"
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS folders (
              id TEXT PRIMARY KEY,
              parent_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
              name TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS entries (
              id TEXT PRIMARY KEY,
              site TEXT NOT NULL,
              login TEXT NOT NULL,
              counter INTEGER NOT NULL,
              options_json TEXT NOT NULL,
              salt_fields_json TEXT NOT NULL,
              crypto_json TEXT,
              folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE RESTRICT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              last_used_at TEXT
            );

            CREATE TABLE IF NOT EXISTS groups (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL UNIQUE
            );

            CREATE TABLE IF NOT EXISTS entry_groups (
              entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
              group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
              PRIMARY KEY (entry_id, group_id)
            );

            CREATE TABLE IF NOT EXISTS kv (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS tags (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL UNIQUE
            );

            CREATE TABLE IF NOT EXISTS entry_tags (
              entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
              tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
              PRIMARY KEY (entry_id, tag_id)
            );
            "#,
        )?;
        Ok(())
    }

    pub fn create_folder(&self, input: FolderInput) -> Result<Folder> {
        let folder = Folder {
            id: Uuid::new_v4().to_string(),
            parent_id: input.parent_id,
            name: input.name,
        };
        self.conn.execute(
            "INSERT INTO folders (id, parent_id, name) VALUES (?1, ?2, ?3)",
            params![&folder.id, &folder.parent_id, &folder.name],
        )?;
        Ok(folder)
    }

    pub fn create_entry(&self, input: EntryInput) -> Result<VaultEntry> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        let profile = PasswordProfile {
            site: input.site,
            login: input.login,
            counter: input.counter,
            options: input.options,
            salt_fields: input.salt_fields,
            crypto: input.crypto,
        };

        self.conn.execute(
            "INSERT INTO entries
             (id, site, login, counter, options_json, salt_fields_json, crypto_json, folder_id, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                &id,
                &profile.site,
                &profile.login,
                profile.counter,
                serde_json::to_string(&profile.options)?,
                serde_json::to_string(&profile.salt_fields)?,
                serde_json::to_string(&profile.crypto)?,
                &input.folder_id,
                &now,
                &now
            ],
        )?;

        for tag in &input.tags {
            self.attach_tag(&id, tag)?;
        }

        Ok(self
            .get_entry(&id)?
            .expect("inserted entry should be readable immediately"))
    }

    pub fn get_entry(&self, id: &str) -> Result<Option<VaultEntry>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, site, login, counter, options_json, salt_fields_json, crypto_json, folder_id, created_at, updated_at, last_used_at
             FROM entries WHERE id = ?1",
        )?;
        let mut rows = stmt.query(params![id])?;
        let Some(row) = rows.next()? else {
            return Ok(None);
        };

        Ok(Some(self.entry_from_row(row)?))
    }

    pub fn list_all_entries(&self) -> Result<Vec<VaultEntry>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, site, login, counter, options_json, salt_fields_json, crypto_json, folder_id, created_at, updated_at, last_used_at
             FROM entries ORDER BY site ASC, login ASC",
        )?;
        let mut rows = stmt.query([])?;
        let mut entries = Vec::new();
        while let Some(row) = rows.next()? {
            entries.push(self.entry_from_row(row)?);
        }
        Ok(entries)
    }

    fn entry_from_row(&self, row: &rusqlite::Row<'_>) -> Result<VaultEntry> {
        let options_json: String = row.get(4)?;
        let salt_fields_json: String = row.get(5)?;
        let crypto_json: String = row.get(6)?;
        let profile = PasswordProfile {
            site: row.get(1)?,
            login: row.get(2)?,
            counter: row.get::<_, i64>(3)? as u32,
            options: serde_json::from_str(&options_json)?,
            salt_fields: serde_json::from_str(&salt_fields_json)?,
            crypto: serde_json::from_str(&crypto_json)?,
        };
        let entry_id: String = row.get(0)?;

        Ok(VaultEntry {
            id: entry_id.clone(),
            profile,
            folder_id: row.get(7)?,
            group_ids: self.group_ids_for_entry(&entry_id)?,
            tags: self.tags_for_entry(&entry_id)?,
            created_at: row.get(8)?,
            updated_at: row.get(9)?,
            last_used_at: row.get(10)?,
        })
    }

    pub fn list_folders(&self) -> Result<Vec<Folder>> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, parent_id, name FROM folders ORDER BY name ASC")?;
        let rows = stmt.query_map([], |row| {
            Ok(Folder {
                id: row.get(0)?,
                parent_id: row.get(1)?,
                name: row.get(2)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn update_entry(&self, id: &str, input: EntryInput) -> Result<VaultEntry> {
        let now = Utc::now().to_rfc3339();
        let affected = self.conn.execute(
            "UPDATE entries SET site = ?1, login = ?2, counter = ?3, options_json = ?4,
             salt_fields_json = ?5, crypto_json = ?6, folder_id = ?7, updated_at = ?8
             WHERE id = ?9",
            params![
                &input.site,
                &input.login,
                input.counter,
                serde_json::to_string(&input.options)?,
                serde_json::to_string(&input.salt_fields)?,
                serde_json::to_string(&input.crypto)?,
                &input.folder_id,
                &now,
                id
            ],
        )?;
        if affected == 0 {
            return Err(PassForgeError::EntryNotFound(id.to_string()));
        }

        self.conn.execute(
            "DELETE FROM entry_tags WHERE entry_id = ?1",
            params![id],
        )?;
        for tag in &input.tags {
            self.attach_tag(id, tag)?;
        }

        Ok(self
            .get_entry(id)?
            .expect("updated entry should be readable immediately"))
    }

    pub fn delete_entry(&self, id: &str) -> Result<()> {
        let affected = self
            .conn
            .execute("DELETE FROM entries WHERE id = ?1", params![id])?;
        if affected == 0 {
            return Err(PassForgeError::EntryNotFound(id.to_string()));
        }
        Ok(())
    }

    pub fn search_entries(&self, query: &str) -> Result<Vec<EntrySummary>> {
        let like = format!("%{}%", query);
        let mut stmt = self.conn.prepare(
            "SELECT id, site, login, counter, folder_id, last_used_at FROM entries
             WHERE site LIKE ?1 OR login LIKE ?1
             ORDER BY last_used_at DESC, site ASC, login ASC",
        )?;
        let rows = stmt.query_map(params![like], |row| {
            Ok(EntrySummary {
                id: row.get(0)?,
                site: row.get(1)?,
                login: row.get(2)?,
                counter: row.get::<_, i64>(3)? as u32,
                folder_id: row.get(4)?,
                fingerprint: None,
                last_used_at: row.get(5)?,
            })
        })?;

        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    /// Merge an export document into the vault inside one transaction.
    /// Folders and entries are matched by id and skipped when they already
    /// exist, so re-importing the same file is a no-op.
    pub fn import_export(&self, export: &VaultExport) -> Result<ImportReport> {
        let tx = self.conn.unchecked_transaction()?;
        let mut report = ImportReport {
            folders_created: 0,
            folders_skipped: 0,
            entries_created: 0,
            entries_skipped: 0,
        };
        for folder in &export.folders {
            let affected = tx.execute(
                "INSERT OR IGNORE INTO folders (id, parent_id, name) VALUES (?1, ?2, ?3)",
                params![&folder.id, &folder.parent_id, &folder.name],
            )?;
            if affected == 0 {
                report.folders_skipped += 1;
            } else {
                report.folders_created += 1;
            }
        }
        for entry in &export.entries {
            let affected = tx.execute(
                "INSERT OR IGNORE INTO entries
                 (id, site, login, counter, options_json, salt_fields_json, crypto_json, folder_id, created_at, updated_at, last_used_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                params![
                    &entry.id,
                    &entry.profile.site,
                    &entry.profile.login,
                    entry.profile.counter,
                    serde_json::to_string(&entry.profile.options)?,
                    serde_json::to_string(&entry.profile.salt_fields)?,
                    serde_json::to_string(&entry.profile.crypto)?,
                    &entry.folder_id,
                    &entry.created_at,
                    &entry.updated_at,
                    &entry.last_used_at,
                ],
            )?;
            if affected == 0 {
                report.entries_skipped += 1;
                continue;
            }
            report.entries_created += 1;
            for tag in &entry.tags {
                let tag_id = Uuid::new_v4().to_string();
                tx.execute(
                    "INSERT OR IGNORE INTO tags (id, name) VALUES (?1, ?2)",
                    params![&tag_id, tag],
                )?;
                let existing_id: String = tx.query_row(
                    "SELECT id FROM tags WHERE name = ?1",
                    params![tag],
                    |row| row.get(0),
                )?;
                tx.execute(
                    "INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?1, ?2)",
                    params![&entry.id, &existing_id],
                )?;
            }
            for group_id in &entry.group_ids {
                tx.execute(
                    "INSERT OR IGNORE INTO groups (id, name) VALUES (?1, ?2)",
                    params![group_id, group_id],
                )?;
                tx.execute(
                    "INSERT OR IGNORE INTO entry_groups (entry_id, group_id) VALUES (?1, ?2)",
                    params![&entry.id, group_id],
                )?;
            }
        }
        tx.commit()?;
        Ok(report)
    }

    pub fn mark_used(&self, id: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE entries SET last_used_at = ?1 WHERE id = ?2",
            params![Utc::now().to_rfc3339(), id],
        )?;
        Ok(())
    }

    pub fn debug_column_names(&self, table: &str) -> Result<Vec<String>> {
        if !is_simple_identifier(table) {
            return Err(PassForgeError::InvalidRequest(
                "table name must be a simple identifier".into(),
            ));
        }
        let mut stmt = self.conn.prepare(&format!("PRAGMA table_info({table})"))?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    fn attach_tag(&self, entry_id: &str, name: &str) -> Result<()> {
        let tag_id = Uuid::new_v4().to_string();
        self.conn.execute(
            "INSERT OR IGNORE INTO tags (id, name) VALUES (?1, ?2)",
            params![tag_id, name],
        )?;
        let existing_id: String = self.conn.query_row(
            "SELECT id FROM tags WHERE name = ?1",
            params![name],
            |row| row.get(0),
        )?;
        self.conn.execute(
            "INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?1, ?2)",
            params![entry_id, existing_id],
        )?;
        Ok(())
    }

    fn tags_for_entry(&self, entry_id: &str) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT tags.name FROM tags
             INNER JOIN entry_tags ON entry_tags.tag_id = tags.id
             WHERE entry_tags.entry_id = ?1
             ORDER BY tags.name ASC",
        )?;
        let rows = stmt.query_map(params![entry_id], |row| row.get::<_, String>(0))?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    fn group_ids_for_entry(&self, entry_id: &str) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT group_id FROM entry_groups WHERE entry_id = ?1 ORDER BY group_id ASC",
        )?;
        let rows = stmt.query_map(params![entry_id], |row| row.get::<_, String>(0))?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }
}

fn is_simple_identifier(value: &str) -> bool {
    let mut chars = value.chars();
    let Some(first) = chars.next() else {
        return false;
    };

    (first == '_' || first.is_ascii_alphabetic())
        && chars.all(|ch| ch == '_' || ch.is_ascii_alphanumeric())
}

impl VaultDb {
    pub fn get_kv(&self, key: &str) -> Result<Option<String>> {
        let mut stmt = self
            .conn
            .prepare("SELECT value FROM kv WHERE key = ?1")?;
        let mut rows = stmt.query(params![key])?;
        match rows.next()? {
            Some(row) => Ok(Some(row.get(0)?)),
            None => Ok(None),
        }
    }

    pub fn set_kv(&self, key: &str, value: &str) -> Result<()> {
        self.conn.execute(
            "INSERT INTO kv (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }
}

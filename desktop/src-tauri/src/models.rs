use lesspass_core::{CryptoConfig, Fingerprint, PasswordOptions, PasswordProfile, SaltField};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub id: String,
    pub parent_id: Option<String>,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FolderInput {
    pub parent_id: Option<String>,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EntryInput {
    pub site: String,
    pub login: String,
    pub counter: u32,
    pub options: PasswordOptions,
    pub salt_fields: Vec<SaltField>,
    pub crypto: Option<CryptoConfig>,
    pub folder_id: String,
    pub group_ids: Vec<String>,
    pub tags: Vec<String>,
}

impl EntryInput {
    pub fn validate(&self) -> Result<(), lesspass_core::CoreError> {
        self.options.validate()?;
        if let Some(crypto) = &self.crypto {
            crypto.validate()?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub enum EntryKind {
    #[default]
    Generated,
    Sealed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VaultEntry {
    pub id: String,
    #[serde(default)]
    pub kind: EntryKind,
    pub profile: PasswordProfile,
    pub folder_id: String,
    pub group_ids: Vec<String>,
    pub tags: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
    pub last_used_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EntrySummary {
    pub id: String,
    #[serde(default)]
    pub kind: EntryKind,
    pub site: String,
    pub login: String,
    pub counter: u32,
    pub folder_id: String,
    pub fingerprint: Option<Fingerprint>,
    pub last_used_at: Option<String>,
}

/// JSON document produced by `export_vault`. Contains folders and entry
/// profiles only — PassForge never stores generated passwords, so there is
/// nothing secret to encrypt; the file is still sensitive metadata and users
/// should treat it as such.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VaultExport {
    pub version: u32,
    pub exported_at: String,
    pub folders: Vec<Folder>,
    pub entries: Vec<ExportedEntry>,
}

/// VaultEntry + its optional sealed blob. The blob is serialized only in
/// exports — never on VaultEntry/EntrySummary, so it can't reach frontends.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExportedEntry {
    #[serde(flatten)]
    pub entry: VaultEntry,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sealed: Option<crate::seal::SealedSecret>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub folders_created: usize,
    pub folders_skipped: usize,
    pub entries_created: usize,
    pub entries_skipped: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub default_crypto: CryptoConfig,
    pub idle_lock_seconds: u64,
    pub clipboard_clear_seconds: u64,
    #[serde(default)]
    pub generation: GenerationMode,
    /// Algorithm servers the user has added (normalized URLs). The active
    /// one, if any, is `generation`; this list is what the Servers panel
    /// offers to switch between.
    #[serde(default)]
    pub known_servers: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(tag = "mode", rename_all = "camelCase")]
pub enum GenerationMode {
    #[default]
    Serverless,
    Server {
        url: String,
        #[serde(default)]
        algorithm: Option<String>,
    },
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            default_crypto: CryptoConfig::default(),
            idle_lock_seconds: 60,
            clipboard_clear_seconds: 30,
            generation: GenerationMode::Serverless,
            known_servers: Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_without_generation_default_to_serverless() {
        let settings: Settings = serde_json::from_str(
            r#"{"defaultCrypto":{"iterations":100000,"keylen":32,"digest":"sha256"},"idleLockSeconds":60,"clipboardClearSeconds":30}"#,
        )
        .unwrap();
        assert_eq!(settings.generation, GenerationMode::Serverless);
    }

    #[test]
    fn server_generation_settings_round_trip() {
        let settings = Settings {
            generation: GenerationMode::Server {
                url: "https://algorithm.example".into(),
                algorithm: Some("pbkdf2-sha512-v1".into()),
            },
            ..Settings::default()
        };
        let encoded = serde_json::to_string(&settings).unwrap();
        let decoded: Settings = serde_json::from_str(&encoded).unwrap();
        assert_eq!(decoded, settings);
        assert!(encoded.contains(r#""generation":{"mode":"server","url":"https://algorithm.example","algorithm":"pbkdf2-sha512-v1"}"#));

        let server_default = Settings {
            generation: GenerationMode::Server {
                url: "https://algorithm.example".into(),
                algorithm: None,
            },
            ..Settings::default()
        };
        let encoded = serde_json::to_string(&server_default).unwrap();
        assert!(encoded
            .contains(r#""mode":"server","url":"https://algorithm.example","algorithm":null"#));
        assert_eq!(
            serde_json::from_str::<Settings>(&encoded).unwrap(),
            server_default
        );
    }
}

use serde::{Deserialize, Serialize};

/// Configuration for the password generation algorithm.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CryptoConfig {
    /// Number of PBKDF2 iterations (default: 100_000)
    #[serde(default = "default_iterations")]
    pub iterations: u32,
    /// Key length in bytes (default: 32)
    #[serde(default = "default_keylen")]
    pub keylen: usize,
    /// Hash digest algorithm: "sha256", "sha512", "sha1"
    #[serde(default = "default_digest")]
    pub digest: String,
}

fn default_iterations() -> u32 {
    100_000
}
fn default_keylen() -> usize {
    32
}
fn default_digest() -> String {
    "sha256".into()
}

/// Accepted PBKDF2 iteration counts.
pub const ITERATIONS_RANGE: std::ops::RangeInclusive<u32> = 1_000..=10_000_000;
/// Accepted derived-key lengths in bytes.
pub const KEYLEN_RANGE: std::ops::RangeInclusive<usize> = 16..=64;
/// Accepted rendered password lengths.
pub const PASSWORD_LENGTH_RANGE: std::ops::RangeInclusive<usize> = 4..=128;
/// Accepted digest names (compared case-insensitively).
pub const DIGESTS: [&str; 6] = ["sha1", "sha-1", "sha256", "sha-256", "sha512", "sha-512"];

impl CryptoConfig {
    /// Reject parameters that would weaken or break derivation (e.g. a zero
    /// key length makes the output independent of the master password).
    pub fn validate(&self) -> Result<(), CoreError> {
        if !ITERATIONS_RANGE.contains(&self.iterations) {
            return Err(CoreError::InvalidCryptoConfig(format!(
                "iterations must be between {} and {}, got {}",
                ITERATIONS_RANGE.start(),
                ITERATIONS_RANGE.end(),
                self.iterations
            )));
        }
        if !KEYLEN_RANGE.contains(&self.keylen) {
            return Err(CoreError::InvalidCryptoConfig(format!(
                "keylen must be between {} and {}, got {}",
                KEYLEN_RANGE.start(),
                KEYLEN_RANGE.end(),
                self.keylen
            )));
        }
        if !DIGESTS.contains(&self.digest.to_ascii_lowercase().as_str()) {
            return Err(CoreError::InvalidCryptoConfig(format!(
                "unsupported digest {:?}",
                self.digest
            )));
        }
        Ok(())
    }
}

impl Default for CryptoConfig {
    fn default() -> Self {
        Self {
            iterations: default_iterations(),
            keylen: default_keylen(),
            digest: default_digest(),
        }
    }
}

/// Character set options for the rendered password.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PasswordOptions {
    pub lowercase: bool,
    pub uppercase: bool,
    pub digits: bool,
    pub symbols: bool,
    pub length: usize,
}

impl PasswordOptions {
    fn rule_count(&self) -> usize {
        [self.lowercase, self.uppercase, self.digits, self.symbols]
            .iter()
            .filter(|enabled| **enabled)
            .count()
    }

    /// Reject option sets that cannot be rendered safely.
    pub fn validate(&self) -> Result<(), CoreError> {
        let rules = self.rule_count();
        if rules == 0 {
            return Err(CoreError::InvalidPasswordOptions(
                "at least one character set must be enabled".into(),
            ));
        }
        if !PASSWORD_LENGTH_RANGE.contains(&self.length) {
            return Err(CoreError::InvalidPasswordOptions(format!(
                "length must be between {} and {}, got {}",
                PASSWORD_LENGTH_RANGE.start(),
                PASSWORD_LENGTH_RANGE.end(),
                self.length
            )));
        }
        if self.length < rules {
            return Err(CoreError::InvalidPasswordLength {
                length: self.length,
                required_rules: rules,
            });
        }
        Ok(())
    }
}

impl Default for PasswordOptions {
    fn default() -> Self {
        Self {
            lowercase: true,
            uppercase: true,
            digits: true,
            symbols: true,
            length: 16,
        }
    }
}

/// A saved password profile (the "entry") — no password is stored,
/// only the parameters needed to regenerate it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PasswordProfile {
    /// Website or service identifier
    pub site: String,
    /// Login / username
    pub login: String,
    /// Counter for password rotation
    #[serde(default = "default_counter")]
    pub counter: u32,
    /// Character set options
    #[serde(flatten)]
    pub options: PasswordOptions,
    /// Per-entry custom salt fields; key-value pairs mixed into the salt
    #[serde(default)]
    pub salt_fields: Vec<SaltField>,
    /// Per-entry algorithm overrides (falls back to global settings)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub crypto: Option<CryptoConfig>,
}

fn default_counter() -> u32 {
    1
}

/// A user-defined salt field for extra entropy per entry.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SaltField {
    pub key: String,
    pub value: String,
}

impl PasswordProfile {
    /// Validate the character options and any per-entry crypto override.
    pub fn validate(&self) -> Result<(), CoreError> {
        self.options.validate()?;
        if let Some(crypto) = &self.crypto {
            crypto.validate()?;
        }
        Ok(())
    }

    /// Build the salt string: site + login + counter(hex) + sorted salt fields.
    pub fn build_salt(&self) -> String {
        let base = format!("{}{}{:x}", self.site, self.login, self.counter);
        if self.salt_fields.is_empty() {
            return base;
        }
        // Sort by key for deterministic output
        let mut fields = self.salt_fields.clone();
        fields.sort_by(|a, b| a.key.cmp(&b.key).then_with(|| a.value.cmp(&b.value)));
        let extra: String = fields
            .iter()
            .map(|f| format!("{}:{}", f.key, f.value))
            .collect::<Vec<_>>()
            .join("|");
        format!("{}{}", base, extra)
    }
}

/// Full configuration for generating a password.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerateRequest {
    pub profile: PasswordProfile,
    pub master_password: String,
    /// Global crypto settings (can be overridden per-profile)
    #[serde(default)]
    pub crypto: CryptoConfig,
}

use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CoreError {
    InvalidPasswordLength {
        length: usize,
        required_rules: usize,
    },
    InvalidFingerprintHash {
        actual_len: usize,
    },
    InvalidCryptoConfig(String),
    InvalidPasswordOptions(String),
}

impl fmt::Display for CoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CoreError::InvalidPasswordLength {
                length,
                required_rules,
            } => {
                write!(
                    f,
                    "password length {length} cannot fit {required_rules} required character rules"
                )
            }
            CoreError::InvalidFingerprintHash { actual_len } => {
                write!(
                    f,
                    "fingerprint hash must contain at least 18 hex characters, got {actual_len}"
                )
            }
            CoreError::InvalidCryptoConfig(reason) => write!(f, "invalid crypto config: {reason}"),
            CoreError::InvalidPasswordOptions(reason) => {
                write!(f, "invalid password options: {reason}")
            }
        }
    }
}

impl std::error::Error for CoreError {}

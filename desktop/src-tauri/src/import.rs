//! Import legacy passwords (CSV exports from Chrome/Firefox/Safari/Bitwarden/
//! 1Password/LastPass, or LessPass JSON profile exports) and reverse-match
//! them: a password that turns out to BE a PassForge/LessPass derivation
//! becomes a normal generated entry — nothing secret is stored. Everything
//! else is sealed (crate::seal) until the user migrates the account.
//!
//! Plaintext passwords only live in memory here — deliberately no HTTP
//! route, so a CSV never crosses the loopback API.

use crate::autofill::host_of;
use crate::commands::derive_profile_password_with;
use crate::db::VaultDb;
use crate::error::{PassForgeError, Result};
use crate::models::{EntryInput, FolderInput, Settings};
use crate::remote;
use crate::session::SessionState;
use lesspass_core::{PasswordOptions, PasswordProfile};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use subtle::ConstantTimeEq;
use zeroize::{Zeroize, Zeroizing};

pub struct ImportedCredential {
    pub site: String,
    pub login: String,
    pub password: Zeroizing<String>,
    pub folder: Option<String>,
}

/// A LessPass-style generated profile carried by a JSON export (no password).
pub struct ImportedProfile {
    pub site: String,
    pub login: String,
    pub counter: u32,
    pub options: PasswordOptions,
    pub folder: Option<String>,
}

pub struct ParsedImport {
    pub credentials: Vec<ImportedCredential>,
    pub profiles: Vec<ImportedProfile>,
    pub skipped: Vec<String>,
}

fn pick<'a>(row: &'a csv::StringRecord, headers: &csv::StringRecord, names: &[&str]) -> Option<&'a str> {
    headers
        .iter()
        .position(|h| names.iter().any(|n| n.eq_ignore_ascii_case(h)))
        .and_then(|i| row.get(i))
        .map(str::trim)
        .filter(|v| !v.is_empty())
}

fn site_host(raw: &str, fallback: Option<&str>) -> String {
    let raw = raw.trim();
    if raw.is_empty() {
        return fallback.unwrap_or("").trim().to_string();
    }
    if let Some(h) = host_of(raw) {
        return h.strip_prefix("www.").map(str::to_string).unwrap_or(h);
    }
    // no scheme: treat the string itself as host (minus www./trailing dot)
    let h = raw
        .split('/')
        .next()
        .unwrap_or(raw)
        .split(':')
        .next()
        .unwrap_or(raw)
        .trim_end_matches('.')
        .to_lowercase();
    h.strip_prefix("www.").map(str::to_string).unwrap_or(h)
}

/// Parse CSV or LessPass JSON export content.
pub fn parse(content: &str) -> Result<ParsedImport> {
    let trimmed = content.trim_start();
    if trimmed.starts_with(['[', '{']) {
        return parse_lesspass(content);
    }
    parse_csv(content)
}

fn parse_csv(content: &str) -> Result<ParsedImport> {
    let mut rdr = csv::ReaderBuilder::new()
        .flexible(true)
        .from_reader(content.as_bytes());
    let headers = rdr.headers().map_err(|e| {
        PassForgeError::InvalidRequest(format!("invalid CSV header: {e}"))
    })?.clone();
    let mut out = ParsedImport { credentials: vec![], profiles: vec![], skipped: vec![] };
    for (n, row) in rdr.records().enumerate() {
        let row = row.map_err(|e| PassForgeError::InvalidRequest(format!("CSV row {n}: {e}")))?;
        // Bitwarden exports carry non-login rows; LastPass secure notes use
        // the http://sn marker.
        if let Some(ty) = pick(&row, &headers, &["type"]) {
            if !ty.eq_ignore_ascii_case("login") {
                continue;
            }
        }
        let url = pick(&row, &headers, &["url", "login_uri", "website"]).unwrap_or("");
        if url.eq_ignore_ascii_case("http://sn") {
            continue;
        }
        let name = pick(&row, &headers, &["name", "title"]);
        let site = site_host(url, name);
        let login = pick(&row, &headers, &["username", "login_username", "login", "email"])
            .unwrap_or("")
            .to_string();
        let password = pick(&row, &headers, &["password", "login_password"]);
        let folder = pick(&row, &headers, &["folder", "grouping"]).map(str::to_string);
        match password {
            Some(pw) if !site.is_empty() && !login.is_empty() => out.credentials.push(
                ImportedCredential {
                    site,
                    login,
                    password: Zeroizing::new(pw.to_string()),
                    folder,
                },
            ),
            _ => {
                let label = if name.is_some() || !site.is_empty() {
                    format!("{site} ({})", if login.is_empty() { "no login" } else { &login })
                } else {
                    format!("row {}", n + 2)
                };
                out.skipped.push(match password {
                    None => format!("{label}: no password"),
                    _ => format!("{label}: missing site or login"),
                });
            }
        }
    }
    Ok(out)
}

#[derive(Deserialize)]
struct LessPassProfile {
    site: String,
    login: String,
    #[serde(default)]
    lowercase: bool,
    #[serde(default)]
    uppercase: bool,
    #[serde(default, alias = "digits")]
    numbers: bool,
    #[serde(default)]
    symbols: bool,
    length: usize,
    #[serde(default = "one")]
    counter: u32,
    #[serde(default)]
    folder: Option<String>,
}
fn one() -> u32 {
    1
}

fn parse_lesspass(content: &str) -> Result<ParsedImport> {
    #[derive(Deserialize)]
    struct Wrapper {
        #[serde(default, alias = "passwordProfiles")]
        profiles: Vec<LessPassProfile>,
    }
    let profiles: Vec<LessPassProfile> = if content.trim_start().starts_with('[') {
        serde_json::from_str(content)?
    } else {
        serde_json::from_str::<Wrapper>(content)?.profiles
    };
    let mut out = ParsedImport { credentials: vec![], profiles: vec![], skipped: vec![] };
    for p in profiles {
        if p.site.is_empty() || p.login.is_empty() || !(4..=64).contains(&p.length) {
            out.skipped.push(format!("{}: invalid LessPass profile", p.site));
            continue;
        }
        out.profiles.push(ImportedProfile {
            site: site_host(&p.site, Some(&p.site)),
            login: p.login,
            counter: p.counter.max(1),
            options: PasswordOptions {
                lowercase: p.lowercase,
                uppercase: p.uppercase,
                digits: p.numbers,
                symbols: p.symbols,
                length: p.length,
            },
            folder: p.folder,
        });
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// Reverse match: prove an imported password IS a derivation of (site, login)
// under the session master password. The options are forced by LessPass's
// guarantee of one char per enabled set: the enabled classes equal exactly
// the classes present in the password.
// ---------------------------------------------------------------------------

const LOWER: &str = "abcdefghijklmnopqrstuvwxyz";
const UPPER: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGIT: &str = "0123456789";
const SYMB: &str = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";

fn options_for(password: &str) -> Option<PasswordOptions> {
    let (mut lo, mut up, mut di, mut sy) = (false, false, false, false);
    for c in password.chars() {
        if LOWER.contains(c) {
            lo = true;
        } else if UPPER.contains(c) {
            up = true;
        } else if DIGIT.contains(c) {
            di = true;
        } else if SYMB.contains(c) {
            sy = true;
        } else {
            return None; // outside the LessPass alphabet — can't be generated
        }
    }
    let length = password.chars().count();
    if !(4..=128).contains(&length) {
        return None;
    }
    Some(PasswordOptions { lowercase: lo, uppercase: up, digits: di, symbols: sy, length })
}

/// Some(counter, options) when `password` reproduces exactly for (site,
/// login) under `master`, honouring the configured generation mode.
pub fn reverse_match(
    site: &str,
    login: &str,
    password: &str,
    master: &str,
    settings: &Settings,
) -> Option<(u32, PasswordOptions)> {
    let options = options_for(password)?;
    for counter in 1..=10u32 {
        let profile = PasswordProfile {
            site: site.to_string(),
            login: login.to_string(),
            counter,
            options: options.clone(),
            salt_fields: vec![],
            crypto: None,
        };
        let Ok(candidate) = derive_profile_password_with(&profile, master, settings, remote::derive)
        else {
            break; // remote failure: no point trying more counters
        };
        if candidate.as_bytes().ct_eq(password.as_bytes()).into() {
            return Some((counter, options));
        }
    }
    None
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport2 {
    pub total: usize,
    pub reverse_matched: usize,
    pub sealed: usize,
    pub less_pass_profiles: usize,
    pub skipped_duplicate: usize,
    pub skipped_invalid: usize,
    pub skip_reasons: Vec<String>,
}

fn resolve_folder(db: &VaultDb, name: Option<&str>) -> Result<String> {
    let folders = db.list_folders()?;
    if let Some(name) = name {
        if let Some(f) = folders.iter().find(|f| f.name.eq_ignore_ascii_case(name)) {
            return Ok(f.id.clone());
        }
        return Ok(db
            .create_folder(FolderInput { parent_id: None, name: name.to_string() })?
            .id);
    }
    if let Some(f) = folders.first() {
        return Ok(f.id.clone());
    }
    Ok(db
        .create_folder(FolderInput { parent_id: None, name: "Imported".into() })?
        .id)
}

fn entry_exists(db: &VaultDb, site: &str, login: &str) -> Result<bool> {
    Ok(db
        .search_entries("")?
        .iter()
        .any(|e| e.site.eq_ignore_ascii_case(site) && e.login.eq_ignore_ascii_case(login)))
}

fn default_input(site: String, login: String, folder: String) -> EntryInput {
    EntryInput {
        site,
        login,
        counter: 1,
        options: PasswordOptions::default(),
        salt_fields: vec![],
        crypto: None,
        folder_id: folder,
        group_ids: vec![],
        tags: vec![],
    }
}

/// Import credentials + LessPass profiles. Per credential: duplicate →
/// skip; reverse match → generated entry; otherwise sealed entry.
/// Blocking (remote derive can block) — call from spawn_blocking.
pub fn import_credentials(
    db: &Arc<Mutex<VaultDb>>,
    session: &SessionState,
    settings: &Settings,
    parsed: ParsedImport,
) -> Result<ImportReport2> {
    let mut report = ImportReport2 {
        total: parsed.credentials.len() + parsed.profiles.len() + parsed.skipped.len(),
        skip_reasons: parsed.skipped.iter().take(20).cloned().collect(),
        skipped_invalid: parsed.skipped.len(),
        ..Default::default()
    };
    let mut master: Option<Zeroizing<String>> = None;

    for profile in parsed.profiles {
        let db = db.lock().expect("db mutex poisoned");
        if entry_exists(&db, &profile.site, &profile.login)? {
            report.skipped_duplicate += 1;
            continue;
        }
        let folder_id = resolve_folder(&db, profile.folder.as_deref())?;
        let mut input = default_input(profile.site, profile.login, folder_id);
        input.counter = profile.counter;
        input.options = profile.options;
        db.create_entry(input)?;
        report.less_pass_profiles += 1;
    }

    for mut cred in parsed.credentials {
        {
            let db = db.lock().expect("db mutex poisoned");
            if entry_exists(&db, &cred.site, &cred.login)? {
                report.skipped_duplicate += 1;
                continue;
            }
        }
        if master.is_none() {
            let bytes = session.master_password_bytes()?;
            master = Some(match String::from_utf8(bytes) {
                Ok(s) => Zeroizing::new(s),
                Err(e) => {
                    let mut b = e.into_bytes();
                    b.zeroize();
                    return Err(PassForgeError::InvalidRequest(
                        "master password is not valid UTF-8".into(),
                    ));
                }
            });
        }
        let matched = reverse_match(&cred.site, &cred.login, &cred.password, &master.clone().unwrap(), settings);
        let db = db.lock().expect("db mutex poisoned");
        let folder_id = resolve_folder(&db, cred.folder.as_deref())?;
        match matched {
            Some((counter, options)) => {
                let mut input = default_input(cred.site, cred.login, folder_id);
                input.counter = counter;
                input.options = options;
                db.create_entry(input)?;
                report.reverse_matched += 1;
            }
            None => {
                let input = default_input(cred.site, cred.login, folder_id);
                let entry = db.create_entry(input)?;
                let root = session.root_key("passforge-seal-root-v1")?;
                let sealed = crate::seal::seal(&root, &entry.id, &cred.password)?;
                db.set_sealed(&entry.id, Some(&sealed))?;
                report.sealed += 1;
            }
        }
        cred.password.zeroize();
    }
    Ok(report)
}

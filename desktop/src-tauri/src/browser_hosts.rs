//! Registers the `passforge-host` native-messaging manifest with every
//! installed Chromium-family browser, so a downloaded PassForge.app pairs
//! with the extension without any manual script. Runs on each launch and
//! only rewrites a manifest when its content changed (e.g. the app moved).

use std::path::{Path, PathBuf};

pub const HOST_NAME: &str = "com.passforge.desktop";

/// Fixed extension ID, pinned by the public `key` in the extension's
/// manifest.json (so an unpacked install gets the same ID on every machine).
pub const EXTENSION_ID: &str = "ihgkdijknaongdcmebhaaiagcafmnaic";

/// (browser, profile root, NativeMessagingHosts dir) for the current OS.
pub fn browser_dirs(home: &Path) -> Vec<(&'static str, PathBuf, PathBuf)> {
    let roots: &[(&str, &str)] = if cfg!(target_os = "macos") {
        &[
            ("chrome", "Library/Application Support/Google/Chrome"),
            ("chrome-beta", "Library/Application Support/Google/Chrome Beta"),
            ("chromium", "Library/Application Support/Chromium"),
            ("brave", "Library/Application Support/BraveSoftware/Brave-Browser"),
            ("edge", "Library/Application Support/Microsoft Edge"),
            ("arc", "Library/Application Support/Arc/User Data"),
        ]
    } else {
        &[
            ("chrome", ".config/google-chrome"),
            ("chromium", ".config/chromium"),
            ("brave", ".config/BraveSoftware/Brave-Browser"),
            ("edge", ".config/microsoft-edge"),
        ]
    };
    roots
        .iter()
        .map(|(name, rel)| {
            let root = home.join(rel);
            let hosts = root.join("NativeMessagingHosts");
            (*name, root, hosts)
        })
        .collect()
}

pub fn manifest_json(host_path: &Path) -> String {
    serde_json::to_string_pretty(&serde_json::json!({
        "name": HOST_NAME,
        "description": "PassForge native messaging host — pairs the browser extension with the PassForge app.",
        "path": host_path,
        "type": "stdio",
        "allowed_origins": [format!("chrome-extension://{EXTENSION_ID}/")],
    }))
    .expect("static manifest serializes")
}

/// Writes the manifest for every browser whose profile root exists under
/// `home`. Returns the (browser, manifest path) pairs that were (re)written.
/// Used by `--register-hosts` so a pkg postinstall running as root can write
/// into — and chown back to — the console user's home directory.
pub fn register_full(home: &Path, host_path: &Path) -> Vec<(&'static str, PathBuf)> {
    let body = manifest_json(host_path);
    let mut written = Vec::new();
    for (name, root, hosts) in browser_dirs(home) {
        if !root.is_dir() {
            continue;
        }
        let file = hosts.join(format!("{HOST_NAME}.json"));
        if std::fs::read_to_string(&file).ok().as_deref() == Some(body.as_str()) {
            continue;
        }
        if std::fs::create_dir_all(&hosts).and_then(|_| std::fs::write(&file, &body)).is_ok() {
            written.push((name, file));
        }
    }
    written
}

/// Writes the manifest for every browser whose profile root exists.
/// Returns the browsers that were (re)written.
pub fn register(home: &Path, host_path: &Path) -> Vec<&'static str> {
    register_full(home, host_path)
        .into_iter()
        .map(|(name, _)| name)
        .collect()
}

/// Registers the host that ships next to the running executable (inside
/// `PassForge.app/Contents/MacOS/`). No-op if it isn't there (e.g. tests).
pub fn register_bundled_host() -> Vec<&'static str> {
    let (Some(home), Ok(exe)) = (dirs::home_dir(), std::env::current_exe()) else {
        return Vec::new();
    };
    let host = exe.with_file_name("passforge-host");
    if !host.is_file() {
        return Vec::new();
    }
    register(&home, &host)
}

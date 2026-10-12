//! `passforge-host` — Chrome native-messaging host. The extension talks to
//! it over length-prefixed JSON on stdin/stdout; it reads the same
//! SQLCipher vault the app uses (read-mostly: `mark_used` is the only
//! write). It never creates the vault or its key.

use passforge_desktop::native_messaging::{dispatch, read_frame, write_frame};
use passforge_desktop::vault;
use serde::Serialize;

fn main() {
    let db_path = match std::env::var_os("PASSFORGE_DB_PATH") {
        Some(p) => std::path::PathBuf::from(p),
        None => match vault::default_db_path() {
            Ok(p) => p,
            Err(e) => return fail(&e.to_string()),
        },
    };
    let db = vault::open_existing_at(&db_path).ok();
    if db.is_none() {
        // Degrade gracefully: ping/search still answer; data ops report
        // "vault unavailable" rather than the host dying on first frame.
        eprintln!("passforge-host: vault unavailable at {}", db_path.display());
    }

    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut input = stdin.lock();
    let mut output = stdout.lock();

    loop {
        match read_frame(&mut input) {
            Ok(Some(payload)) => {
                let response = dispatch(db.as_ref(), &payload);
                let json = serde_json::to_string(&response)
                    .unwrap_or_else(|_| r#"{"status":"err","error":"serialize"}"#.into());
                if write_frame(&mut output, &json).is_err() {
                    return;
                }
            }
            Ok(None) => return, // browser closed the pipe
            Err(e) => return fail(&e.to_string()),
        }
    }
}

fn fail(message: &str) -> ! {
    let stdout = std::io::stdout();
    let _ = write_frame(
        &mut stdout.lock(),
        &serde_json::to_string(&serde_json::json!({"status":"err","error":message}))
            .unwrap(),
    );
    std::process::exit(1);
}

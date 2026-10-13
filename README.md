# PassForge

PassForge is a local-first, stateless password manager built on the LessPass algorithm. Passwords are regenerated deterministically from a site, a login, and your master password — never stored, never synced, no accounts, no server.

### Features

- **macOS desktop app** — Tauri v2 shell, Rust backend, React 19 frontend built on the Obsidian Precision design system (see `docs/design-system/`).
- **Encrypted local metadata** — SQLCipher-backed SQLite stores entries (site, login, counter, password options, salt fields) so you can organize and revisit sites without remembering every parameter.
- **Keychain + Touch ID** — The database encryption key lives in the macOS Keychain; an optional Touch ID convenience gate can feed a remembered master password to `unlock`. The desktop holds the master password only in RAM and zeroizes it on lock, idle timeout, or quit.
- **Entry organization** — Folders (hierarchical) and tags (freeform).
- **One local backend** — the desktop app embeds a loopback HTTP API (`http://127.0.0.1`, bearer token in the vault dir) that owns all generation and vault access. Frontends are severed from the algorithm by design: they call the API and contain no derivation code.
- **Chromium MV3 extension** (`packages/passforge-extension`) — a thin frontend: generation and fingerprints are API calls to the running app, paired via the `passforge-host` native messenger (`api_info` op) which also prefills profile parameters for the current tab.
- **Offline CLI** (`cli/`) — `pip install lesspass`; `lesspass site login masterpassword` prints the generated password.
- **Security-first design** — No cloud sync, no accounts, no network services. Generated passwords are never written to disk or logs. Clipboard auto-clears after a configurable delay.

### What PassForge is NOT

- Not a cloud-sync password manager — no server, no accounts, no network traffic.
- Not a password vault — passwords are never stored, only the parameters to regenerate them.
- Not cross-platform desktop (v1) — macOS only.
- Not a Safari or Firefox extension (v1) — Chromium only.
- Not a mobile app.

### Repository layout

- `desktop/` — Tauri v2 + React desktop app (`passforge-desktop` crate in `desktop/src-tauri/`).
- `crates/lesspass-core/` — Rust implementation of the password-generation algorithm.
- `packages/passforge-extension/` — Chromium MV3 extension (frontend only; calls the local API).
- `cli/` — Python CLI.
- `docs/` — design system, security checklist, macOS verification checklist.

### Verification

```bash
cargo test                            # Rust (lesspass-core, passforge-desktop)
yarn install && yarn build && yarn test   # JS workspaces
cd cli && PYTHONPATH=. python3 -m unittest discover -s tests -t .
```

## License

This project is licensed under the terms of the GNU GPLv3.

## Credit

PassForge is a fork of [LessPass](https://github.com/lesspass/lesspass), itself based on an original idea from the [masterpassword app](https://masterpassword.app/). The deterministic algorithm (site + login + master password → password, every time, with nothing stored) is LessPass's; PassForge keeps that promise and drops the server, accounts, and sync.

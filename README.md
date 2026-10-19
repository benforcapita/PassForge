# PassForge

PassForge is a local-first, stateless password manager built on the LessPass algorithm. Passwords are regenerated deterministically from a site, a login, and your master password — never stored, never synced, no accounts. Optionally, an interchangeable zero-knowledge algorithm server can take part in derivation — it never sees your site, login, master password, settings, or the resulting password (see `docs/remote-protocol.md`).

### Features

- **macOS desktop app** — Tauri v2 shell, Rust backend, React 19 frontend built on the Obsidian Precision design system (see `docs/design-system/`).
- **Encrypted local metadata** — SQLCipher-backed SQLite stores entries (site, login, counter, password options, salt fields) so you can organize and revisit sites without remembering every parameter.
- **Keychain + Touch ID** — The database encryption key lives in the macOS Keychain; an optional Touch ID convenience gate can feed a remembered master password to `unlock`. The desktop holds the master password only in RAM and zeroizes it on lock, idle timeout, or quit.
- **Entry organization** — Folders (hierarchical) and tags (freeform).
- **Chromium MV3 extension** (`packages/passforge-extension`) — stateless generator on its own; when the `passforge-host` native-messaging host is installed it prefills profile parameters for the current tab. It never stores passwords or receives the master password. Supports the same optional algorithm servers.
- **Offline CLI** (`cli/`) — `pip install lesspass`; `lesspass site login masterpassword` prints the generated password. Supports the same optional algorithm servers.
- **Optional algorithm servers** — `crates/passforge-server` reference server (Argon2id, PBKDF2-SHA512, optional server pepper) speaking the stateless `passforge-remote-v1` API; serverless mode keeps the built-in LessPass algorithm.
- **Security-first design** — No cloud sync, no accounts, no network traffic unless you pick an algorithm server. Generated passwords are never written to disk or logs. Clipboard auto-clears after a configurable delay.

### What PassForge is NOT

- Not a cloud-sync password manager — no accounts, no sync; algorithm servers are optional, stateless and zero-knowledge.
- Not a password vault — passwords are never stored, only the parameters to regenerate them.
- Not cross-platform desktop (v1) — macOS only.
- Not a Safari or Firefox extension (v1) — Chromium only.
- Not a mobile app.

### Repository layout

- `desktop/` — Tauri v2 + React desktop app (`passforge-desktop` crate in `desktop/src-tauri/`).
- `crates/lesspass-core/` — Rust implementation of the password-generation algorithm.
- `crates/passforge-protocol/` — Client-side primitives and types for the remote algorithm protocol.
- `crates/passforge-server/` — Reference stateless remote algorithm server.
- `packages/lesspass/` — TypeScript implementation of the same algorithm, used by the extension.
- `packages/passforge-extension/` — Chromium MV3 extension.
- `cli/` — Python CLI.
- `docs/` — design system, security checklist, macOS verification checklist, remote protocol specification.

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

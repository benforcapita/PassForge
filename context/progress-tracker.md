# Progress Tracker

## Current Phase

v1 feature-complete pending real-Mac verification polish. All nine implementation tasks are complete; upstream LessPass legacy (server, mobile, connected CLI, web packages) has been removed.

## Completed

| Task | Description | Evidence |
|------|-------------|----------|
| Design spec | PassForge v1 architecture, storage, security, UI, and extension behavior defined. | `docs/superpowers/specs/2026-06-07-passforge-design.md` |
| Task 1 | lesspass-core stabilized: CoreError, Result returns, serde, compatibility tests. | `crates/lesspass-core/` |
| Task 2 | Tauri desktop scaffold: Vite + React 19 + Tailwind v4 frontend, Rust backend. | `desktop/` |
| Task 3 | SQLCipher-backed storage: folders, entries, tags, encrypted open, search, no password column. | `desktop/src-tauri/src/db.rs` |
| Task 4 | Session + platform secret store: in-memory session lock/unlock with zeroize, macOS Keychain adapter. | `desktop/src-tauri/src/session.rs`, `keychain.rs` |
| Task 5 | Tauri commands + frontend API layer. | `desktop/src-tauri/src/commands.rs`, `desktop/src/api.ts` |
| Task 6 | Desktop UI on the Obsidian Precision design system: lock screen + 3-pane workbench. | `desktop/src/views/`, `desktop/src/styles/tokens.css` |
| Task 7 | Native-messaging backend (`passforge-host` binary + manifest/install script). | `desktop/src-tauri/src/bin/passforge-host.rs`, `desktop/src-tauri/native-messaging/` |
| Task 8 | Chromium MV3 extension (`passforge-extension`): stateless generator + vault profile prefill. | `packages/passforge-extension/` |
| Task 9 | Security checklist + IPC lock enforcement; backend idle lock; conditional clipboard wipe. | `docs/security-checklist.md` |
| Hardening | Touch ID convenience gate on macOS (LAContext), macOS verification pass. | `desktop/src-tauri/src/biometric.rs`, `docs/macos-verification.md` |
| Cleanup | Removed upstream LessPass `backend/`, `lesspass-api`, `lesspass-mobile`, connected CLI, web packages (`lesspass-web-*`, `lesspass-i18n`), upstream assets. | this file |

## Remaining

| Item | Description |
|------|-------------|
| Real-Mac Touch ID spot-check | LAContext prompt needs physical Touch ID hardware. |
| `passforge-host` sidecar packaging | Register as Tauri `externalBin` to ship inside the `.app`. |

## Quick Commands

```bash
# Inspect repo state
git status --short

# Rust verification
cargo test
cargo check -p passforge-desktop

# Desktop frontend verification
yarn workspace passforge-desktop build

# JS workspace verification
yarn test
yarn build

# Extension-specific verification
yarn workspace passforge-extension test
yarn workspace passforge-extension build

# CLI verification
cd cli && PYTHONPATH=. python3 -m unittest discover -s tests -t .
```

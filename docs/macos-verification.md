# macOS verification checklist

Things to verify on a real Mac (cannot be checked on Linux):

## Build
- `cargo build` in `desktop/` (macOS builds take `security-framework` in
  `keychain.rs`; `FileSecretStore` is non-macOS only).
- `yarn tauri build` produces the `.app`/`.dmg`.

## Keychain
- First launch creates `passforge.db` + a 32-byte key stored as a generic
  password in Keychain (`service: com.passforge.desktop`,
  `account: database-key`). Inspect in Keychain Access.app.
- Restart the app: vault reopens without re-prompting; macOS should not
  show a keychain prompt since the app created the item.

## Locking
- Backend idle ticker (`lock_if_idle`, 1s) emits `passforge://vault-locked`
  → UI returns to lock screen. Verify by setting `idle_lock_seconds` low.
- `record_activity` on interaction resets the clock.

## Clipboard
- Copy a generated password → paste works; after the countdown the
  clipboard is cleared **only if** it still holds the password.
- Confirm the wipe works with the timer (Tauri plugin path, not the
  webview `navigator.clipboard` which needs user activation).

## Native messaging
- `./native-messaging/install-host.sh /path/to/passforge-host <EXT_ID>`
  writes `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/
  com.passforge.desktop.json` (also chromium/edge/brave).
- The host binary must be built for macOS (`cargo build --bin
  passforge-host`). To ship inside the `.app`, register it as a Tauri
  `externalBin` sidecar (`binaries/passforge-host-<target-triple>`) — not
  yet configured in `tauri.conf.json`; the dev flow is a standalone binary.

## Touch ID — NOT implemented on desktop
`tauri-plugin-biometric` is compiled for `#[cfg(mobile)]` only; the desktop
app has no biometric unlock today. macOS Touch ID would need LAContext
via `security-framework`/`swift` FFI or a dedicated plugin — open item.
Unlock is currently: type master password → `unlock` IPC.

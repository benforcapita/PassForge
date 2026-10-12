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
- `scripts/build-mac.sh` builds everything and installs the manifest:
  `tauri build` runs `desktop/scripts/build-sidecar.sh` (stages
  `src-tauri/binaries/passforge-host-<triple>`) and bundles the host into
  `PassForge.app/Contents/MacOS/passforge-host` via `externalBin`.
- Or by hand: `./native-messaging/install-host.sh \
  "/Applications/PassForge.app/Contents/MacOS/passforge-host" <EXT_ID>`
  writes `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/
  com.passforge.desktop.json` (also chromium/edge/brave).
- Verify the sidecar is actually inside the bundle
  (`ls PassForge.app/Contents/MacOS/`), that the manifest points at it,
  and that `ping` from the extension answers (first use may show Keychain
  prompts for `database-key`).

## Touch ID
Implemented in `src/biometric.rs` via `LAContext`
(`objc2-local-authentication`), gated `#[cfg(macos)]`; other platforms get
a stub that reports unsupported so the UI hides it. Still a convenience
gate only — there is no authentication by design.

- Lock screen offers "Remember on this Mac (Touch ID)" after a typed
  unlock when `biometric_supported` and nothing is stored →
  `remember_master_password` saves the master password in Keychain.
- Next visit shows "Unlock with Touch ID" → `biometric_unlock` runs
  `evaluatePolicy(DeviceOwnerAuthenticationWithBiometrics)` and feeds the
  stored password into `unlock`.
- `forget_master_password` clears the stored password.
- Verify on a real Mac: the system Touch ID prompt appears, success
  unlocks, cancel/deny stays on the lock screen, and a fresh install
  (no stored password) hides the button.

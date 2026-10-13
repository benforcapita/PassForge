# PassForge security checklist

Status of the threat model as of the vault-hardening + security pass.

## Model
- Stateless: the app only ever *derives* passwords (site + login + counter +
  char sets + master password → deterministic output). Passwords are never
  stored anywhere — not in the vault, not on disk, not in settings.
- No authentication: the master password is a pure generation input. There is
  no "correct" password and no verifier to steal or brute-force against.
- The vault stores only profile *parameters* and settings (SQLCipher DB).

## Session / lock
- [x] Master password lives only in `SessionState` memory, zeroized on lock.
- [x] Backend 1s ticker calls `lock_if_idle`; a hung webview can't keep the
  vault unlocked (idle lock is enforced in Rust, not the renderer).
- [x] All vault IPC commands require an unlocked session (`require_unlocked`)
  and count as activity (`session.touch()`).
- [x] `generate_password` zeroizes its UTF-8 copy of the master password.
- [ ] SessionState holds the master as `Vec<u8>`; derived `String`s returned
  to JS are inherently non-zeroizable (product requirement — passwords must
  reach the user). Documented residual risk.

## Vault at rest
- [x] SQLCipher (bundled) with a random 32-byte key, not derived from the
  master password.
- [x] Key in macOS Keychain via `security-framework`; `FileSecretStore`
  (0600 file) elsewhere — explicitly not a security boundary on non-macOS.
- [x] `mark_used` is the only write the native-messaging host can make.
- [ ] No rekey/rotation path yet (master-password change is meaningless by
  design; DB-key rotation unimplemented).
- [ ] No import/export — acceptable for v1.

## IPC / webview surface
- [x] CSP: `default-src 'self'`; `connect-src` restricted to Tauri IPC.
- [x] Capability file grants only `core:default`, `core:event:default`,
  `clipboard-manager:allow-read-text`, `clipboard-manager:allow-write-text`.
- [~] `clipboard-manager:allow-read-text` lets the renderer read the user's
  clipboard — required for the conditional wipe; a webview compromise could
  abuse it. Residual risk accepted for v1; consider gating reads behind a
  Rust command instead of the JS plugin later.
- [x] Errors serialize to `{ message }` only — no internals leaked.

## Clipboard
- [x] Copy and wipe go through `tauri-plugin-clipboard-manager` inside Tauri
  (no user-gesture requirement for the timed wipe).
- [x] Wipe is conditional: only clears if the clipboard still equals the
  copied password — can't clobber later user copies.

## Local API (backend for frontends)
- [x] Binds `127.0.0.1` only, ephemeral port; other machines can't reach it.
- [x] Every route requires `Authorization: Bearer` with a random 256-bit
  token stored `<vault dir>/api-token` (0600) — other local processes
  without vault-dir read access can't call it.
- [x] `/api/generate` is one-shot: the master password arrives per-request
  and is zeroized after use; the server stores nothing.
- [x] Vault routes additionally require the app's unlocked session —
  a locked app serves no data.
- [x] CORS limited to browser-extension schemes
  (`chrome-extension://`, `moz-extension://`, `safari-web-extension://`).
- [ ] A compromised browser tab can't reach the API: no Origin means CORS
  blocks pages, but any extension with `host_permissions` for 127.0.0.1
  could call it *if it also reads the token* — requires vault-dir access,
  i.e. already user-level code execution.

## Native messaging host
- [x] Chrome `allowed_origins` restricts the manifest to the extension ID.
- [x] `open_existing_at` never creates the vault or key; missing vault
  degrades to `{"status":"err"}` per-op, host stays alive for `ping`.
- [x] 1 MiB frame cap, malformed frames return an error frame, not a crash.
- [x] `generate` takes the master password over same-user stdio — by design
  (no auth); equivalent exposure to typing it into the extension anyway.
- [ ] Host runs unsandboxed as the user — standard for native messaging.

## What this does NOT protect against (in scope to document)
- An attacker with user-level code execution on the machine (can read the
  0600 key file on non-macOS, attach to the app, or replace the host binary).
- Physical access while unlocked.
- Clipboard managers / sync services retaining history (platform behavior).

## Verified by tests
- `lock` zeroizes + `is_locked`; locked session cannot expose master bytes.
- `touch` refreshes idle clock and is a no-op while locked.
- Vault persists + wrong key fails to open; `open_existing_at` no-create.
- Native-messaging frame roundtrip, dispatch, degraded no-vault path.
- UI: lock screen, copy/wipe, don't-clobber wipe, delete-DELETE, lazy gen.

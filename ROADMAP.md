# Roadmap

Open work after **12.1.0** (see [CHANGELOG.md](CHANGELOG.md)). Items are grouped by area and
roughly ordered by priority inside each group. Accepted risks that are not planned to change
are listed in the README "Security model" and [docs/security-checklist.md](docs/security-checklist.md).

## Release and distribution

- [ ] **Sign and notarize macOS builds.** The release workflow already signs and notarizes
  when the `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`,
  `APPLE_ID`, `APPLE_PASSWORD` and `APPLE_TEAM_ID` secrets are set. Until an Apple Developer
  ID is available, builds are ad-hoc signed: users go through "Open Anyway" on first launch
  and re-approve Keychain access after every update. Set `PKG_SIGN_IDENTITY` to sign the
  `.pkg` too.
- [ ] **Publish the Homebrew tap.** Create the `homebrew-passforge` tap repository from
  `packaging/homebrew/` and update the cask/formula checksums per release. The release job
  prints them in its summary; automate the tap update.
- [ ] **Chrome Web Store listing.** The extension ID is pinned by the manifest `key`, but
  the matching private key is kept outside the repository and the extension is still
  sideloaded ("Load unpacked"). A store listing would add auto-updates and remove the
  developer-mode step.
- [ ] **Verify the installers on real systems.** CI installs the server with
  `install-server.sh` on Ubuntu and builds the `.pkg`, but nobody has yet:
  - installed the `.pkg` on a clean Mac (postinstall host registration for the console user);
  - run `install-server.sh` on macOS (launchd path);
  - run `install-server.sh` on an arm64 Linux host.
- [ ] **Move off `ubuntu-latest`.** GitHub is migrating the label to Ubuntu 26; pin the
  runner images used by the release and test workflows.

## CI and tests

- [ ] **Installer checks: trigger paths vs shellcheck scope.** `installers-test.yml`
  shellchecks `scripts/*.sh`, but only runs when installer files change, so edits to other
  scripts (e.g. `scripts/build-mac.sh`) are not checked. Add `scripts/**` to the trigger
  paths and a `workflow_dispatch` trigger.
- [ ] **Commit the browser end-to-end tests.** The autofill, migration and passkey
  end-to-end runs (headless Chromium + the unpacked extension + `examples/api_server.rs` +
  fixture pages + a local WebAuthn relying party using `@simplewebauthn/server`) were run
  manually for 12.1.0. Check them into the repository and run them in CI.
- [ ] **Passkey fallback when locked/disconnected, in a real browser.** It's covered by unit
  tests of the service-worker guards; there's no browser test yet.
- [ ] **Passkeys against real relying parties.** Test registration and sign-in on public
  WebAuthn test sites and a few large relying parties (AAGUID/attestation policies,
  `excludeCredentials`, Chrome's own passkey UI racing the wrapper).
- [ ] **Touch ID spot-check on hardware.** Biometric unlock and the optional per-passkey
  Touch ID prompt need a physical Touch ID device.

## Browser extension

- [ ] **Passkey coverage.** Lift the 12.1.0 limitations:
  - algorithms beyond ES256 (currently fall back to the browser);
  - cross-origin iframes (top frame only today);
  - conditional mediation (passkey autofill UI);
  - a signature counter (always 0 today).
- [ ] **Autofill hardening.** The in-page dropdown is an extension-origin iframe, but the
  page can still restyle its host element (clickjacking-style tricks). Consider:
  - requiring a visible, unobscured frame;
  - a short delay before clicks are accepted;
  - moving selection to the toolbar popup for sensitive sites.
- [ ] **Smarter site matching.** Matching is exact host or subdomain without the Public
  Suffix List. Add PSL-aware matching and per-entry extra domains (e.g. one account for
  several domains).
- [ ] **Firefox and Safari.** The backend already admits `moz-extension://` and
  `safari-web-extension://` origins; the extension itself is Chromium-only.

## Desktop app and backend

- [ ] **Re-key on master-password change.** Changing the master password makes sealed
  (imported, not yet migrated) entries and all passkeys unreadable. Add a guided "change
  master password" flow that re-seals legacy passwords and lists the accounts whose
  passwords and passkeys must be rotated.
- [ ] **Reverse match coverage.** Detection tries counters 1–10 with the default crypto
  settings and the current generation mode. Allow a wider counter range and per-entry
  crypto overrides on demand.
- [ ] **Clipboard read permission.** The webview holds `clipboard-manager:allow-read-text`
  for the conditional wipe; move the read behind a Rust command.
- [ ] **Windows and Linux desktop builds.** Replace the macOS Keychain / Touch ID / native
  host registration with per-platform equivalents (Credential Manager, libsecret) and add
  MSI / AppImage / deb bundles.

## iOS app (preview)

- [ ] **Run on devices and simulators.** It's verified so far with typecheck, unit tests,
  `expo-doctor` and an iOS bundle export. It has not yet been exercised on an iPhone (Expo Go,
  SDK 57) or in the iOS simulator.
- [ ] **Faster key stretching.** PBKDF2 (100 000 iterations) runs in pure JS; switch to a
  native crypto module in a development build.
- [ ] **AutoFill and passkey provider extensions.** iOS Password AutoFill and passkeys
  need native app extensions (`ASCredentialProviderViewController`) and an Apple
  Developer account.
- [ ] **Biometric unlock and profile sync.** Optional Face ID unlock; a way to bring desktop
  vault profiles (parameters only) to the phone, e.g. via the existing export format.
- [ ] **Upgrade to Expo SDK 58** once Expo Go for SDK 58 is available in the App Store.

## Housekeeping

- [ ] `context/progress-tracker.md` is out of date (the `passforge-host` sidecar now ships
  inside the app via `externalBin`). Fold it into this roadmap or refresh it.

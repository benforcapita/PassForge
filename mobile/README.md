# PassForge for iOS (preview)

An Expo SDK 57 / React Native app that generates PassForge passwords through a
self-hosted **algorithm server** (`passforge-server`, see the root README
"Deploying your own algorithm server").

- **No server, no password.** The app has no built-in (serverless) algorithm. It runs
  the client half of [`passforge-remote-v1`](../docs/remote-protocol.md) from
  [`passforge-protocol`](../packages/passforge-protocol-js): it blinds site + login +
  master password on the device, sends one 32-byte hash to the server, and finishes the
  password with a key that never leaves the phone.
- Same inputs, same server, same algorithm ⇒ the same password as the desktop app in
  server mode (both use the 100 000-iteration SHA-256 default).
- Stored on the device (Keychain via `expo-secure-store`): server URLs and profile
  parameters only. The master password lives in memory and is cleared whenever the app
  leaves the foreground. Copied passwords are wiped from the clipboard after 30 s.

## Run it

```bash
yarn install && yarn workspace passforge-protocol build   # from the repo root, once
cd mobile
npm install
npx expo start
```

Scan the QR code with **Expo Go** (SDK 57) on an iPhone; Expo Go asks you to sign in to
an Expo account. Simulator or native builds need full Xcode: `npx expo run:ios`, or
`npx eas-cli@latest build --platform ios` in the cloud.

The phone must reach the server over **https** (plain http is accepted for loopback
only, so a LAN test needs TLS, e.g. Caddy in front of `passforge-server`).

## Develop

```bash
npm test            # jest (stores, generate pipeline vs Rust vectors, clipboard wipe)
npx tsc --noEmit
npx expo-doctor
```

## Not yet

- No vault sync with the desktop app; profiles are per device.
- No iOS AutoFill / passkey provider: those are native app extensions
  (`ASCredentialProviderViewController`) that need native code and an Apple Developer
  account. That is the natural next step.

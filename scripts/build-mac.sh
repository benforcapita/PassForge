#!/usr/bin/env bash
# Build PassForge on macOS: desktop .app (with passforge-host bundled as a
# sidecar), install the Chrome native-messaging manifest, and launch.
#
# Usage:
#   ./scripts/build-mac.sh [extension-id]
#
# extension-id: the ID Chrome assigns to the sideloaded extension
#   (chrome://extensions -> Developer mode -> load unpacked
#   packages/passforge-extension/dist -> copy the ID). Omit to skip the
#   native-messaging install (app-only build).
set -euo pipefail
cd "$(dirname "$0")/.."
EXT_ID="${1:-}"

need() { command -v "$1" >/dev/null 2>&1 || { echo "missing: $1 — $2" >&2; exit 1; }; }
need cargo "install Rust via https://rustup.rs"
need node "install Node 22 (e.g. brew install node@22 or nvm install 22)"
need xcodebuild "install Xcode command line tools: xcode-select --install"
command -v corepack >/dev/null 2>&1 && corepack enable >/dev/null 2>&1 || true
need yarn "enable corepack (corepack enable) so yarn 4 is available"

echo "==> yarn install"
yarn install

echo "==> building PassForge.app (frontend + sidecar + bundle)"
yarn workspace passforge-desktop tauri build

APP="desktop/src-tauri/target/release/bundle/macos/PassForge.app"
[ -d "$APP" ] || { echo "error: $APP not found after build" >&2; exit 1; }
HOST="$APP/Contents/MacOS/passforge-host"
[ -x "$HOST" ] || { echo "error: sidecar missing at $HOST" >&2; exit 1; }
echo "built: $APP (sidecar: $HOST)"

if [ -n "$EXT_ID" ]; then
  echo "==> installing native-messaging manifest for extension $EXT_ID"
  ./desktop/src-tauri/native-messaging/install-host.sh "$HOST" "$EXT_ID" chrome
else
  echo "==> skipping native-messaging install (no extension-id given)"
  echo "    rerun with: ./scripts/build-mac.sh <extension-id>"
fi

open "$APP"
echo "==> launched PassForge — first unlock offers 'Remember on this Mac',"
echo "    relaunch and 'Unlock with Touch ID' to verify biometrics."

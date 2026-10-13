#!/usr/bin/env bash
# Builds passforge-host for the current target triple and stages it as a
# Tauri sidecar at src-tauri/binaries/passforge-host-<triple> so `tauri
# build` bundles it inside the app (externalBin).
set -euo pipefail
cd "$(dirname "$0")/../src-tauri"

TRIPLE="$(rustc -vV | sed -n 's/^host: //p')"
SIDECAR="binaries/passforge-host-$TRIPLE"
mkdir -p binaries

# tauri-build validates the externalBin path while compiling
# passforge-host itself, so a first build needs the path to exist
# already. Stage an empty placeholder, then overwrite with the real
# binary — the bundler reads the file at bundle time, not compile time.
[ -f "$SIDECAR" ] || touch "$SIDECAR"

cargo build --release --bin passforge-host
TARGET_DIR="$(git rev-parse --show-toplevel)/target"
cp "$TARGET_DIR/release/passforge-host" "$SIDECAR"
echo "sidecar staged: $SIDECAR"

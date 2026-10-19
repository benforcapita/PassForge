#!/usr/bin/env bash
# Builds passforge-host for the target Tauri is bundling and stages it as a
# sidecar at src-tauri/binaries/passforge-host-<triple> so `tauri build`
# bundles it inside the app (externalBin).
#
# Tauri exports TAURI_ENV_TARGET_TRIPLE to beforeBuildCommand; for
# `tauri build --target universal-apple-darwin` both macOS architectures
# are built and merged with lipo.
set -euo pipefail
cd "$(dirname "$0")/../src-tauri"

HOST_TRIPLE="$(rustc -vV | sed -n 's/^host: //p')"
TRIPLE="${TAURI_ENV_TARGET_TRIPLE:-$HOST_TRIPLE}"
TARGET_DIR="$(git rev-parse --show-toplevel)/target"
mkdir -p binaries

# tauri-build validates the externalBin path while compiling
# passforge-host itself, so a first build needs the path to exist
# already. Stage empty placeholders, then overwrite with the real
# binary — the bundler reads the file at bundle time, not compile time.
stage_placeholder() { [ -f "binaries/passforge-host-$1" ] || touch "binaries/passforge-host-$1"; }

build_for() {
  stage_placeholder "$1"
  cargo build --release --bin passforge-host --target "$1"
  cp "$TARGET_DIR/$1/release/passforge-host" "binaries/passforge-host-$1"
}

if [ "$TRIPLE" = "universal-apple-darwin" ]; then
  stage_placeholder universal-apple-darwin
  build_for aarch64-apple-darwin
  build_for x86_64-apple-darwin
  lipo -create -output binaries/passforge-host-universal-apple-darwin \
    binaries/passforge-host-aarch64-apple-darwin binaries/passforge-host-x86_64-apple-darwin
  # The bundler also copies every [[bin]] of the crate from the target dir,
  # but only lipo-merges the main binary itself — provide the merged host.
  mkdir -p "$TARGET_DIR/universal-apple-darwin/release"
  cp binaries/passforge-host-universal-apple-darwin "$TARGET_DIR/universal-apple-darwin/release/passforge-host"
elif [ "$TRIPLE" = "$HOST_TRIPLE" ]; then
  stage_placeholder "$TRIPLE"
  cargo build --release --bin passforge-host
  cp "$TARGET_DIR/release/passforge-host" "binaries/passforge-host-$TRIPLE"
else
  build_for "$TRIPLE"
fi
echo "sidecar staged: binaries/passforge-host-$TRIPLE"

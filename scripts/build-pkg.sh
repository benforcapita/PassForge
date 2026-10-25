#!/usr/bin/env bash
# Build PassForge-<version>.pkg (installer package) from a built PassForge.app.
#
#   scripts/build-pkg.sh <path/to/PassForge.app> <version> [out-dir]
#
# The postinstall script registers the browser native-messaging host for the
# console user. Set PKG_SIGN_IDENTITY to sign the product (e.g. "Developer ID
# Installer: Name (TEAMID)"); otherwise the pkg is unsigned.
set -euo pipefail
cd "$(dirname "$0")/.."

APP="${1:?usage: build-pkg.sh <path/to/PassForge.app> <version> [out-dir]}"
VERSION="${2:?usage: build-pkg.sh <path/to/PassForge.app> <version> [out-dir]}"
OUT_DIR="${3:-.}"

[ -d "$APP" ] || { echo "error: $APP not found" >&2; exit 1; }
[ -x "$APP/Contents/MacOS/passforge-desktop" ] || {
  echo "error: $APP/Contents/MacOS/passforge-desktop missing" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$OUT_DIR"

pkgbuild \
  --component "$APP" \
  --install-location /Applications \
  --scripts packaging/macos/scripts \
  --identifier com.passforge.desktop \
  --version "$VERSION" \
  "$WORK/passforge-app.pkg"

PRODUCTBUILD=(productbuild
  --distribution packaging/macos/distribution.xml
  --resources packaging/macos/resources
  --package-path "$WORK")
if [ -n "${PKG_SIGN_IDENTITY:-}" ]; then
  PRODUCTBUILD+=(--sign "$PKG_SIGN_IDENTITY")
fi
"${PRODUCTBUILD[@]}" "$OUT_DIR/PassForge-$VERSION.pkg"

echo "built: $OUT_DIR/PassForge-$VERSION.pkg"

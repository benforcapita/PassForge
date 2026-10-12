#!/usr/bin/env bash
# Installs the PassForge native-messaging host manifest for Chrome/Chromium.
# Usage: ./install-host.sh /path/to/passforge-host <extension-id>
set -euo pipefail

HOST_PATH="${1:?path to passforge-host binary required}"
EXT_ID="${2:-REPLACE_WITH_EXTENSION_ID}"

case "$(uname -s)" in
  Darwin)
    DEST="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
    ;;
  Linux)
    DEST="$HOME/.config/google-chrome/NativeMessagingHosts"
    ;;
  *)
    echo "unsupported OS" >&2; exit 1 ;;
esac

mkdir -p "$DEST"
sed -e "s|PASSFORGE_HOST_PATH|$HOST_PATH|" \
    -e "s|PASSFORGE_EXTENSION_ID|$EXT_ID|" \
    "$(dirname "$0")/com.passforge.desktop.json" > "$DEST/com.passforge.desktop.json"
echo "installed to $DEST/com.passforge.desktop.json"

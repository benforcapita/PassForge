#!/usr/bin/env bash
# Installs the PassForge native-messaging host manifest.
# Usage: ./install-host.sh /path/to/passforge-host <extension-id> [browser]
#   browser: chrome (default) | chromium | edge | brave
set -euo pipefail

HOST_PATH="${1:?path to passforge-host binary required}"
EXT_ID="${2:-REPLACE_WITH_EXTENSION_ID}"
BROWSER="${3:-chrome}"

if [ ! -x "$HOST_PATH" ]; then
  echo "error: $HOST_PATH is not an executable" >&2
  exit 1
fi

case "$(uname -s)" in
  Darwin)
    case "$BROWSER" in
      chrome)   DEST="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts" ;;
      chromium) DEST="$HOME/Library/Application Support/Chromium/NativeMessagingHosts" ;;
      edge)     DEST="$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts" ;;
      brave)    DEST="$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts" ;;
      *) echo "unknown browser: $BROWSER" >&2; exit 1 ;;
    esac
    ;;
  Linux)
    case "$BROWSER" in
      chrome)   DEST="$HOME/.config/google-chrome/NativeMessagingHosts" ;;
      chromium) DEST="$HOME/.config/chromium/NativeMessagingHosts" ;;
      edge)     DEST="$HOME/.config/microsoft-edge/NativeMessagingHosts" ;;
      brave)    DEST="$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts" ;;
      *) echo "unknown browser: $BROWSER" >&2; exit 1 ;;
    esac
    ;;
  *)
    echo "unsupported OS" >&2; exit 1 ;;
esac

mkdir -p "$DEST"
sed -e "s|PASSFORGE_HOST_PATH|$HOST_PATH|" \
    -e "s|PASSFORGE_EXTENSION_ID|$EXT_ID|" \
    "$(dirname "$0")/com.passforge.desktop.json" > "$DEST/com.passforge.desktop.json"
echo "installed to $DEST/com.passforge.desktop.json"

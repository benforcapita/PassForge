#!/usr/bin/env bash
# Install passforge-server as a system service (systemd or launchd).
#
#   curl -fsSL https://raw.githubusercontent.com/benforcapita/PassForge/main/scripts/install-server.sh | sudo bash -s -- [flags]
#
# Flags:
#   --version X.Y.Z      release to install (default: latest GitHub release)
#   --from-dir DIR       install from a local dir holding the tarball + SHA256SUMS (no download)
#   --bind HOST:PORT     listen address          (default 127.0.0.1:8787)
#   --name NAME          server name in /v1/info (default "PassForge reference server")
#   --max-concurrent N   concurrent derivations  (default 4)
#   --with-pepper        create /etc/passforge/pepper (kept if it exists) and set PASSFORGE_PEPPER_FILE
#   --no-start           install only; don't enable/start the service
#   --uninstall          stop and remove the service + binary (keeps /etc/passforge)
#   -h, --help           this help
set -euo pipefail

REPO="benforcapita/PassForge"
BIN=/usr/local/bin/passforge-server
UNIT=/etc/systemd/system/passforge-server.service
PLIST=/Library/LaunchDaemons/com.passforge.server.plist
ETC=/etc/passforge

VERSION=""
FROM_DIR=""
BIND="127.0.0.1:8787"
NAME="PassForge reference server"
MAX_CONCURRENT=4
WITH_PEPPER=0
NO_START=0
UNINSTALL=0

usage() { sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --version)        VERSION="${2:?--version needs a value}"; shift 2 ;;
    --from-dir)       FROM_DIR="${2:?--from-dir needs a value}"; shift 2 ;;
    --bind)           BIND="${2:?--bind needs a value}"; shift 2 ;;
    --name)           NAME="${2:?--name needs a value}"; shift 2 ;;
    --max-concurrent) MAX_CONCURRENT="${2:?--max-concurrent needs a value}"; shift 2 ;;
    --with-pepper)    WITH_PEPPER=1; shift ;;
    --no-start)       NO_START=1; shift ;;
    --uninstall)      UNINSTALL=1; shift ;;
    -h|--help)        usage 0 ;;
    *) echo "unknown flag: $1" >&2; usage 1 ;;
  esac
done

say()  { printf '==> %s\n' "$*"; }
die()  { printf 'error: %s\n' "$*" >&2; exit 1; }
need_root() {
  [ "$(id -u)" -eq 0 ] || die "must run as root (try: sudo bash $0 ...)"
}

OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS-$ARCH" in
  Linux-x86_64|Linux-amd64)  ASSET_ARCH="linux-x86_64" ;;
  Linux-aarch64|Linux-arm64) ASSET_ARCH="linux-aarch64" ;;
  Darwin-*)                  ASSET_ARCH="macos-universal" ;;
  *) die "unsupported platform: $OS-$ARCH" ;;
esac

# ---------------------------------------------------------------------------
# Uninstall
# ---------------------------------------------------------------------------
if [ "$UNINSTALL" -eq 1 ]; then
  need_root
  if [ "$OS" = "Linux" ] && command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
    systemctl disable --now passforge-server 2>/dev/null || true
    rm -f "$UNIT"
    systemctl daemon-reload
    say "removed systemd unit"
  elif [ "$OS" = "Darwin" ]; then
    launchctl bootout system "$PLIST" 2>/dev/null || true
    rm -f "$PLIST"
    say "removed launchd daemon"
  fi
  rm -f "$BIN"
  say "removed $BIN"
  say "kept $ETC (contains the pepper, if any) and the passforge user — remove them by hand if unwanted"
  exit 0
fi

need_root

# ---------------------------------------------------------------------------
# Resolve version + fetch/verify the tarball
# ---------------------------------------------------------------------------
if [ -z "$VERSION" ]; then
  [ -n "$FROM_DIR" ] && die "--version is required with --from-dir"
  command -v curl >/dev/null 2>&1 || die "curl is required"
  VERSION="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
    | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"v\{0,1\}\([^"]*\)".*/\1/p' | head -n1)"
  [ -n "$VERSION" ] || die "could not resolve the latest release tag"
fi
say "installing passforge-server $VERSION ($ASSET_ARCH)"

ASSET="passforge-server-$VERSION-$ASSET_ARCH.tar.gz"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

if [ -n "$FROM_DIR" ]; then
  [ -f "$FROM_DIR/$ASSET" ] || die "$FROM_DIR/$ASSET not found"
  [ -f "$FROM_DIR/SHA256SUMS" ] || die "$FROM_DIR/SHA256SUMS not found"
  cp "$FROM_DIR/$ASSET" "$FROM_DIR/SHA256SUMS" "$WORK/"
else
  BASE="https://github.com/$REPO/releases/download/v$VERSION"
  say "downloading $BASE/$ASSET"
  curl -fsSL "$BASE/$ASSET" -o "$WORK/$ASSET"
  curl -fsSL "$BASE/SHA256SUMS" -o "$WORK/SHA256SUMS"
fi

if command -v sha256sum >/dev/null 2>&1; then
  DIGEST="$(sha256sum "$WORK/$ASSET" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  DIGEST="$(shasum -a 256 "$WORK/$ASSET" | awk '{print $1}')"
else
  die "need sha256sum or shasum to verify the download"
fi
EXPECTED="$(awk -v f="$ASSET" '$2 == f {print $1}' "$WORK/SHA256SUMS")"
[ -n "$EXPECTED" ] || die "$ASSET missing from SHA256SUMS"
[ "$DIGEST" = "$EXPECTED" ] || die "checksum mismatch for $ASSET (got $DIGEST, want $EXPECTED)"
say "checksum verified"

tar -xzf "$WORK/$ASSET" -C "$WORK"
install -m 0755 "$WORK/passforge-server" "$BIN"

# ---------------------------------------------------------------------------
# Optional pepper
# ---------------------------------------------------------------------------
PEPPER_ENV=""
if [ "$WITH_PEPPER" -eq 1 ]; then
  install -d -m 0700 "$ETC" 2>/dev/null || mkdir -p "$ETC"
  if [ -f "$ETC/pepper" ]; then
    say "keeping existing $ETC/pepper (never overwritten)"
  else
    openssl rand -hex 32 > "$ETC/pepper"
    chmod 0400 "$ETC/pepper"
    say "generated $ETC/pepper"
  fi
  PEPPER_ENV=1
  cat >&2 <<'EOF'

  *** BACK UP /etc/passforge/pepper LIKE A PRIVATE KEY ***
  Passwords derived with hmac-pepper-v1 can only be reproduced by a
  server holding this pepper. Losing it loses those passwords.

EOF
fi

# ---------------------------------------------------------------------------
# Service: systemd on Linux, launchd on macOS
# ---------------------------------------------------------------------------
if [ "$OS" = "Linux" ]; then
  if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
    id passforge >/dev/null 2>&1 || \
      useradd --system --home /var/lib/passforge --shell /usr/sbin/nologin passforge
    if [ -n "$PEPPER_ENV" ]; then
      chown passforge:passforge "$ETC" "$ETC/pepper"
    fi
    {
      cat <<'UNIT'
[Unit]
Description=PassForge algorithm server (passforge-remote-v1)
After=network-online.target
Wants=network-online.target

[Service]
User=passforge
Group=passforge
ExecStart=/usr/local/bin/passforge-server
UNIT
      printf 'Environment=PASSFORGE_BIND=%s\n' "$BIND"
      printf 'Environment=PASSFORGE_SERVER_NAME=%s\n' "$NAME"
      printf 'Environment=PASSFORGE_MAX_CONCURRENT=%s\n' "$MAX_CONCURRENT"
      [ -n "$PEPPER_ENV" ] && printf 'Environment=PASSFORGE_PEPPER_FILE=%s\n' "$ETC/pepper"
      cat <<'UNIT'
Restart=on-failure
RestartSec=2
# Hardening — the server needs nothing but a socket.
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectControlGroups=yes
RestrictAddressFamilies=AF_INET AF_INET6
MemoryDenyWriteExecute=yes
LockPersonality=yes
# 64 MiB per concurrent Argon2id + headroom:
MemoryMax=1G

[Install]
WantedBy=multi-user.target
UNIT
    } > "$UNIT"
    systemctl daemon-reload
    if [ "$NO_START" -eq 0 ]; then
      systemctl enable --now passforge-server
      say "passforge-server enabled and started"
      say "check: curl http://$BIND/v1/info"
    else
      say "unit written; start it with: systemctl enable --now passforge-server"
    fi
  else
    say "systemd not found — binary installed at $BIN"
    say "run it with: PASSFORGE_BIND=$BIND $BIN"
  fi
elif [ "$OS" = "Darwin" ]; then
  xml_escape() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }
  {
    cat <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.passforge.server</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/passforge-server</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
PLIST
    printf '        <key>PASSFORGE_BIND</key><string>%s</string>\n' "$(xml_escape "$BIND")"
    printf '        <key>PASSFORGE_SERVER_NAME</key><string>%s</string>\n' "$(xml_escape "$NAME")"
    printf '        <key>PASSFORGE_MAX_CONCURRENT</key><string>%s</string>\n' "$(xml_escape "$MAX_CONCURRENT")"
    [ -n "$PEPPER_ENV" ] && \
      printf '        <key>PASSFORGE_PEPPER_FILE</key><string>%s</string>\n' "$ETC/pepper"
    cat <<'PLIST'
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/var/log/passforge-server.log</string>
    <key>StandardErrorPath</key>
    <string>/var/log/passforge-server.log</string>
</dict>
</plist>
PLIST
  } > "$PLIST"
  chmod 0644 "$PLIST"
  launchctl bootout system "$PLIST" 2>/dev/null || true
  if [ "$NO_START" -eq 0 ]; then
    launchctl bootstrap system "$PLIST"
    say "passforge-server loaded (launchd)"
    say "check: curl http://$BIND/v1/info"
  else
    say "plist written; load it with: launchctl bootstrap system $PLIST"
  fi
fi

say "done: $BIN ($ASSET_ARCH, $VERSION)"

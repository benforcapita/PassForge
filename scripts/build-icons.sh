#!/usr/bin/env bash
# Regenerate all PassForge icons from assets/brand/*.svg.
# Run from the repo root: bash scripts/build-icons.sh
set -euo pipefail

cd "$(dirname "$0")/.."

CARGO_TAURI="${CARGO_TAURI:-$HOME/.cargo/bin/cargo-tauri}"
if ! command -v "$CARGO_TAURI" >/dev/null 2>&1; then
  CARGO_TAURI="$(command -v cargo-tauri || true)"
fi
if [ -z "$CARGO_TAURI" ]; then
  echo "error: cargo-tauri not found" >&2
  exit 1
fi

MARK=assets/brand/passforge-mark.svg
GLYPH=assets/brand/passforge-glyph.svg
IOS=assets/brand/passforge-mark-ios.svg

# --- Desktop: full tauri icon set ---------------------------------------------
"$CARGO_TAURI" icon "$MARK" -o desktop/src-tauri/icons
rm -rf desktop/src-tauri/icons/android desktop/src-tauri/icons/ios

# --- Extension: 16/32 from the glyph, 48/128 from the mark ---------------------
EXT_ICONS=packages/passforge-extension/public/icons
mkdir -p "$EXT_ICONS"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

"$CARGO_TAURI" icon "$GLYPH" -o "$TMP/glyph" --png 16,32
"$CARGO_TAURI" icon "$MARK" -o "$TMP/mark" --png 48,128

cp "$TMP/glyph/16x16.png"  "$EXT_ICONS/icon-16.png"
cp "$TMP/glyph/32x32.png"  "$EXT_ICONS/icon-32.png"
cp "$TMP/mark/48x48.png"   "$EXT_ICONS/icon-48.png"
cp "$TMP/mark/128x128.png" "$EXT_ICONS/icon-128.png"

# --- Mobile (iOS): opaque icon + splash ---------------------------------------
mkdir -p mobile/assets
"$CARGO_TAURI" icon "$IOS"  -o "$TMP/ios"    --png 1024
"$CARGO_TAURI" icon "$MARK" -o "$TMP/splash" --png 1024

# App Store icons must not have an alpha channel: flatten RGBA -> RGB.
python3 - "$TMP/ios/1024x1024.png" mobile/assets/icon.png <<'PY'
import struct, sys, zlib

src, dst = sys.argv[1], sys.argv[2]
data = open(src, "rb").read()
assert data[:8] == b"\x89PNG\r\n\x1a\n", "not a PNG"

pos, idat, ihdr = 8, b"", None
while pos < len(data):
    length, ctype = struct.unpack(">I4s", data[pos:pos + 8])
    chunk = data[pos + 8:pos + 8 + length]
    if ctype == b"IHDR":
        ihdr = chunk
    elif ctype == b"IDAT":
        idat += chunk
    pos += 12 + length

w, h, depth, color = struct.unpack(">IIBB", ihdr[:10])
assert depth == 8 and color == 6, "expected 8-bit RGBA PNG"

raw = zlib.decompress(idat)
stride = w * 4
out, prev = bytearray(), bytearray(stride)
pos = 0
for _ in range(h):
    f = raw[pos]
    row = bytearray(raw[pos + 1:pos + 1 + stride])
    pos += 1 + stride
    for i in range(stride):
        a = row[i - 4] if i >= 4 else 0
        b = prev[i]
        c = prev[i - 4] if i >= 4 else 0
        if f == 1:
            row[i] = (row[i] + a) & 0xFF
        elif f == 2:
            row[i] = (row[i] + b) & 0xFF
        elif f == 3:
            row[i] = (row[i] + (a + b) // 2) & 0xFF
        elif f == 4:
            p = a + b - c
            pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
            row[i] = (row[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 0xFF
    prev = row
    out.append(0)
    out.extend(bytearray(v for i, v in enumerate(row) if i % 4 != 3))

def chunk(ctype, payload):
    return struct.pack(">I", len(payload)) + ctype + payload + struct.pack(">I", zlib.crc32(ctype + payload))

png = b"\x89PNG\r\n\x1a\n"
png += chunk(b"IHDR", struct.pack(">IIBB", w, h, 8, 2) + ihdr[10:])
png += chunk(b"IDAT", zlib.compress(bytes(out), 9))
png += chunk(b"IEND", b"")
open(dst, "wb").write(png)
PY

cp "$TMP/splash/1024x1024.png" mobile/assets/splash-icon.png

# --- Docs logo ------------------------------------------------------------------
mkdir -p docs/media
cp "$MARK" docs/media/logo.svg

echo "Icons regenerated:"
echo "  desktop/src-tauri/icons/"
echo "  $EXT_ICONS/"
echo "  mobile/assets/"
echo "  docs/media/logo.svg"

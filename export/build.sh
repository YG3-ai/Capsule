#!/usr/bin/env bash
# Build a Capsule game into a native executable.
#
#   ./export/build.sh [target] [--capsule DIR]
#
#   target        dir | mac | win | linux | all   (default: dir — fast unpacked app)
#   --capsule DIR the capsule folder to wrap (default: the capsule export/ lives in)
#
# Examples:
#   ./export/build.sh                          # wrap this capsule, unpacked, for this OS
#   ./export/build.sh mac                       # macOS .dmg
#   ./export/build.sh all                       # .dmg + .exe + .AppImage
#   ./export/build.sh mac --capsule ~/games/x   # wrap another capsule
#
# Output lands in export/dist/. The capsule itself is never modified and never
# gets a package.json — all tooling stays here in export/.

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
CAPSULE="$HERE/.."        # default: the capsule this export/ folder lives in
TARGET="dir"
VENDOR_THREE=1           # vendor three.js locally so the export runs offline
STAGE="$HERE/.build"
DIST="$HERE/dist"

# --- parse args ---------------------------------------------------------------
while [ $# -gt 0 ]; do
  case "$1" in
    dir|mac|win|linux|all) TARGET="$1"; shift ;;
    --capsule) CAPSULE="${2:?--capsule needs a path}"; shift 2 ;;
    --cdn) VENDOR_THREE=0; shift ;;   # keep loading three from the CDN (needs internet)
    -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
    *) echo "✗ unknown arg: $1  (use dir|mac|win|linux|all [--capsule DIR] [--cdn])" >&2; exit 1 ;;
  esac
done

# --- resolve + VALIDATE before touching anything ------------------------------
if [ ! -d "$CAPSULE" ]; then echo "✗ capsule dir not found: $CAPSULE" >&2; exit 1; fi
CAPSULE="$(cd "$CAPSULE" && pwd)"
if [ ! -f "$CAPSULE/index.html" ]; then
  echo "✗ no index.html in $CAPSULE — that's not a capsule. Aborting before any copy." >&2
  exit 1
fi

echo "▸ capsule:  $CAPSULE"
echo "▸ target:   $TARGET"

# --- stage the game files (exclude editor + tooling + docs + vcs) -------------
rm -rf "$STAGE"
mkdir -p "$STAGE"
rsync -a \
  --exclude '.git' --exclude 'node_modules' --exclude '.DS_Store' \
  --exclude 'export' --exclude 'editor.html' \
  --exclude 'CLAUDE.md' --exclude 'AGENTS.md' --exclude 'README.md' \
  "$CAPSULE"/ "$STAGE"/

# --- drop in the Electron shell ----------------------------------------------
cp "$HERE/main.js" "$STAGE/main.js"
cp "$HERE/package.json" "$STAGE/package.json"

# --- vendor three.js for offline use (build-time only; source capsule untouched)
if [ "$VENDOR_THREE" = "1" ]; then
  THREE_VERSION="$(grep -oE 'three@[0-9]+\.[0-9]+\.[0-9]+' "$STAGE/index.html" | head -1 | cut -d@ -f2)"
  THREE_VERSION="${THREE_VERSION:-0.171.0}"
  echo "▸ vendoring three@$THREE_VERSION for offline use…"
  VDIR="$STAGE/vendor/three"
  mkdir -p "$VDIR/addons"
  TMP="$(mktemp -d)"
  ( cd "$TMP" && npm pack "three@$THREE_VERSION" --silent >/dev/null )
  TGZ="$(ls "$TMP"/three-*.tgz)"
  tar -xzf "$TGZ" -C "$TMP"
  # Copy all build .js files — modern three.module.js re-exports from three.core.js,
  # so the entry alone isn't enough; bring its siblings along.
  cp "$TMP/package/build/"*.js "$VDIR/"
  cp -R "$TMP/package/examples/jsm/." "$VDIR/addons/"
  rm -rf "$TMP"
  # rewrite the importmap's CDN URLs -> local vendor paths (importmap values are
  # double-quoted, so [^"]* safely matches the whole URL regardless of CDN host)
  sed -i '' -E \
    -e 's#https?://[^"]*three@[0-9.]+/build/three\.module\.js#./vendor/three/three.module.js#g' \
    -e 's#https?://[^"]*three@[0-9.]+/examples/jsm/#./vendor/three/addons/#g' \
    "$STAGE/index.html"
  if grep -qE 'unpkg\.com|jsdelivr\.net|cdn\.' "$STAGE/index.html"; then
    echo "  ⚠ a CDN reference still remains in index.html — check its importmap" >&2
  else
    echo "  ✓ importmap now points at ./vendor/three/ (no CDN at runtime)"
  fi
fi

# --- install deps (electron binary is cached globally after the first run) ----
echo "▸ installing electron + electron-builder (first run downloads ~150MB)…"
( cd "$STAGE" && npm install --no-audit --no-fund --loglevel=error )

# --- build --------------------------------------------------------------------
echo "▸ packaging…"
case "$TARGET" in
  dir)   ( cd "$STAGE" && npx electron-builder --dir ) ;;
  mac)   ( cd "$STAGE" && npx electron-builder -m ) ;;
  win)   ( cd "$STAGE" && npx electron-builder -w ) ;;
  linux) ( cd "$STAGE" && npx electron-builder -l ) ;;
  all)   ( cd "$STAGE" && npx electron-builder -mwl ) ;;
esac

# --- collect output -----------------------------------------------------------
mkdir -p "$DIST"
rsync -a --delete --exclude '*-unpacked' "$STAGE/dist/" "$DIST/" 2>/dev/null || true
echo "✓ done → $DIST"
ls -1 "$DIST" 2>/dev/null || true

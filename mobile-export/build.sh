#!/usr/bin/env bash
# Wrap a Capsule game into native iOS / Android apps with Capacitor.
#
#   ./mobile-export/build.sh [target] [--capsule DIR] [--cdn]
#
#   target        ios | android | both   (default: both)
#   --capsule DIR the capsule folder to wrap (default: the capsule export/ lives in)
#   --cdn         keep loading three from the CDN (default: vendor it for offline)
#
# Produces a Capacitor project here in mobile-export/ with the game staged into www/.
# The native iOS/Android *project* is generated; you open it in Xcode / Android Studio to
# build, run on a device/simulator, and submit. npm/Capacitor lives ONLY here — the game
# stays dependency-free.
#
# Requires: Node + npm. For iOS: macOS + Xcode + CocoaPods. For Android: Android Studio + JDK.

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
CAPSULE="$HERE/.."
TARGET="both"
VENDOR_THREE=1
APP_ID="${CAPSULE_APP_ID:-com.capsule.game}"
APP_NAME="${CAPSULE_APP_NAME:-Capsule Game}"

while [ $# -gt 0 ]; do
  case "$1" in
    ios|android|both) TARGET="$1"; shift ;;
    --capsule) CAPSULE="${2:?--capsule needs a path}"; shift 2 ;;
    --cdn) VENDOR_THREE=0; shift ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "✗ unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [ ! -d "$CAPSULE" ]; then echo "✗ capsule dir not found: $CAPSULE" >&2; exit 1; fi
CAPSULE="$(cd "$CAPSULE" && pwd)"
if [ ! -f "$CAPSULE/index.html" ]; then
  echo "✗ no index.html in $CAPSULE — not a capsule. Aborting." >&2; exit 1
fi

echo "▸ capsule:  $CAPSULE"
echo "▸ target:   $TARGET"
echo "▸ app:      $APP_NAME ($APP_ID)"

# --- stage the game into www/ (the Capacitor webDir) -------------------------
WWW="$HERE/www"
rm -rf "$WWW"; mkdir -p "$WWW"
rsync -a \
  --exclude '.git' --exclude 'node_modules' --exclude '.DS_Store' \
  --exclude 'export' --exclude 'mobile-export' --exclude 'app' --exclude 'editor.html' \
  --exclude 'capsule-edit.js' --exclude 'capsule.scenes.json' \
  --exclude 'mosaic' --exclude 'mosaic.json' \
  --exclude 'CLAUDE.md' --exclude 'AGENTS.md' --exclude 'GUIDE.md' --exclude 'SCENES.md' \
  --exclude 'TODO.md' --exclude 'RUN_COMMAND.md' --exclude 'othernotes.md' \
  "$CAPSULE"/ "$WWW"/

# --- vendor three.js for offline, ONLY if the game actually uses a three CDN ---
# (App Store builds shouldn't fetch a CDN.) Framework-agnostic: a Vite/plain game
# has no three importmap, so this is skipped and the staged files ship as-is.
if [ "$VENDOR_THREE" = "1" ]; then
  THREE_VERSION="$(grep -oE 'three@[0-9]+\.[0-9]+\.[0-9]+' "$WWW/index.html" | head -1 | cut -d@ -f2)"
  if [ -z "$THREE_VERSION" ]; then
    echo "▸ no three.js CDN import found — skipping vendor step (works for any web app / bundled dist)"
  else
    echo "▸ vendoring three@$THREE_VERSION for offline use…"
    VDIR="$WWW/vendor/three"; mkdir -p "$VDIR/addons"
    TMP="$(mktemp -d)"
    ( cd "$TMP" && npm pack "three@$THREE_VERSION" --silent >/dev/null )
    tar -xzf "$(ls "$TMP"/three-*.tgz)" -C "$TMP"
    cp "$TMP/package/build/"*.js "$VDIR/"
    cp -R "$TMP/package/examples/jsm/." "$VDIR/addons/"
    rm -rf "$TMP"
    # `sed -i.bak` is portable across GNU (Linux / Git Bash) and BSD (macOS) sed;
    # bare `sed -i ''` is macOS-only and errors elsewhere. Drop the backup after.
    sed -i.bak -E \
      -e 's#https?://[^"]*three@[0-9.]+/build/three\.module\.js#./vendor/three/three.module.js#g' \
      -e 's#https?://[^"]*three@[0-9.]+/examples/jsm/#./vendor/three/addons/#g' \
      "$WWW/index.html"
    rm -f "$WWW/index.html.bak"
    grep -qE 'unpkg\.com|jsdelivr\.net' "$WWW/index.html" \
      && echo "  ⚠ a CDN reference remains — check the importmap" >&2 \
      || echo "  ✓ importmap now points at ./vendor/three/ (offline)"
  fi
fi

# --- capacitor config --------------------------------------------------------
cat > "$HERE/capacitor.config.json" <<JSON
{
  "appId": "$APP_ID",
  "appName": "$APP_NAME",
  "webDir": "www"
}
JSON

# --- install Capacitor + add/sync platforms ----------------------------------
echo "▸ installing Capacitor…"
( cd "$HERE" && npm install --no-audit --no-fund --loglevel=error )

cd "$HERE"
add_platform() {
  local plat="$1" dir="$2"
  if [ -d "$dir" ]; then echo "  • $plat already added"; else npx cap add "$plat"; fi
}
case "$TARGET" in
  ios)     add_platform ios ios ;;
  android) add_platform android android ;;
  both)    add_platform ios ios; add_platform android android ;;
esac
npx cap sync

echo "✓ done."
echo "  iOS:     open mobile-export/ios/App/App.xcworkspace in Xcode → run."
echo "  Android: open mobile-export/android/ in Android Studio → run."
echo "  Touch controls are game code — mobile has no keyboard; add on-screen input."

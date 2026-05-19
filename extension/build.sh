#!/bin/bash
# Chrome, Firefox MV3, ve Firefox MV2 (Zen Browser) için eklenti paketleme
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="$DIR/dist"
rm -rf "$OUT"

SHARED="popup.html popup.js error.html error.js processing.html icons"

# ── Firefox MV3 ──
echo "Firefox MV3 eklentisi paketleniyor..."
mkdir -p "$OUT/firefox"
cp "$DIR/manifest.json" "$OUT/firefox/manifest.json"
cp "$DIR/background.js" "$OUT/firefox/"
for f in $SHARED; do cp -r "$DIR/$f" "$OUT/firefox/"; done
cd "$OUT/firefox"
zip -r -q "$OUT/arc-tracker-firefox.xpi" .
cd "$DIR"
echo "  → dist/arc-tracker-firefox.xpi"

# ── Firefox MV2 (Zen Browser vb.) ──
echo "Firefox MV2 (Zen) eklentisi paketleniyor..."
mkdir -p "$OUT/zen"
cp "$DIR/manifest-firefox-mv2.json" "$OUT/zen/manifest.json"
cp "$DIR/background-mv2.js" "$OUT/zen/"
cp "$DIR/popup-mv2.html" "$OUT/zen/"
cp "$DIR/popup-mv2.js" "$OUT/zen/"
cp "$DIR/error.html" "$OUT/zen/"
cp "$DIR/error.js" "$OUT/zen/"
cp "$DIR/processing.html" "$OUT/zen/"
cp -r "$DIR/icons" "$OUT/zen/"
cd "$OUT/zen"
zip -r -q "$OUT/arc-tracker-zen.xpi" .
cd "$DIR"
echo "  → dist/arc-tracker-zen.xpi"

# ── Chrome MV3 ──
echo "Chrome MV3 eklentisi paketleniyor..."
mkdir -p "$OUT/chrome"
cp "$DIR/manifest-chrome.json" "$OUT/chrome/manifest.json"
cp "$DIR/background.js" "$OUT/chrome/"
for f in $SHARED; do cp -r "$DIR/$f" "$OUT/chrome/"; done
cd "$OUT/chrome"
zip -r -q "$OUT/arc-tracker-chrome.zip" .
cd "$DIR"
echo "  → dist/arc-tracker-chrome.zip"

echo ""
echo "Paketler: $OUT/"
ls -lh "$OUT/"*.{xpi,zip} 2>/dev/null
echo ""
echo "Kurulum:"
echo "  Chrome:  chrome://extensions → Gelistirici modu → .zip'i sürükle veya dist/chrome/ yükle"
echo "  Firefox: about:addons → Dişli → Dosyadan eklenti kur → .xpi seç"
echo "  Zen:     about:addons → Dişli → Dosyadan eklenti kur → .xpi seç"

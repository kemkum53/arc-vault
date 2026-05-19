#!/bin/bash
# Chrome, Firefox MV3, ve Firefox MV2 (Zen Browser) için eklenti paketleme
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="$DIR/dist"
DOWNLOADS="$(cd "$DIR/../api/app/static" && pwd)/downloads"
rm -rf "$OUT"
rm -rf "$DOWNLOADS"
mkdir -p "$DOWNLOADS"

SHARED="popup.html popup.js error.html error.js processing.html icons"

# ── Firefox MV3 ──
echo "Firefox MV3 eklentisi paketleniyor..."
mkdir -p "$OUT/firefox"
cp "$DIR/manifest.json" "$OUT/firefox/manifest.json"
cp "$DIR/background.js" "$OUT/firefox/"
for f in $SHARED; do cp -r "$DIR/$f" "$OUT/firefox/"; done
echo "  → $OUT/firefox/"

# .xpi oluştur (zip formatı)
cd "$OUT/firefox"
zip -r -q "$DOWNLOADS/arc-tracker-firefox.xpi" .
echo "  → arc-tracker-firefox.xpi"
cd "$DIR"

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
echo "  → $OUT/zen/"

# .xpi oluştur
cd "$OUT/zen"
zip -r -q "$DOWNLOADS/arc-tracker-zen.xpi" .
echo "  → arc-tracker-zen.xpi"
cd "$DIR"

# ── Chrome MV3 ──
echo "Chrome MV3 eklentisi paketleniyor..."
mkdir -p "$OUT/chrome"
cp "$DIR/manifest-chrome.json" "$OUT/chrome/manifest.json"
cp "$DIR/background.js" "$OUT/chrome/"
for f in $SHARED; do cp -r "$DIR/$f" "$OUT/chrome/"; done
echo "  → $OUT/chrome/"

# .zip oluştur (Chrome sideload için)
cd "$OUT/chrome"
zip -r -q "$DOWNLOADS/arc-tracker-chrome.zip" .
echo "  → arc-tracker-chrome.zip"
cd "$DIR"

echo ""
echo "Paketler: $DOWNLOADS/"
ls -lh "$DOWNLOADS/"
echo ""
echo "Kurulum:"
echo "  Chrome:  chrome://extensions → Gelistirici modu → .zip'i sürükle veya dist/chrome/ yükle"
echo "  Firefox: about:addons → Dişli → Dosyadan eklenti kur → .xpi seç"
echo "  Zen:     about:addons → Dişli → Dosyadan eklenti kur → .xpi seç"

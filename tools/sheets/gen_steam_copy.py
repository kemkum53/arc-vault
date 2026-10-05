"""Generate steam_copy.gs: Google Sheets per-row Steam copy buttons.

Drawings in Sheets cannot pass arguments to a script, so every row gets two
tiny named functions (steamId_<row>, steamSifre_<row>) that a drawing can be
assigned to. Each one reads the account key in its row at click time, so the
button keeps working when accounts are re-sorted between rows.

Usage: python tools/sheets/gen_steam_copy.py [last_row]
"""

import base64
import sys
from pathlib import Path

FIRST_ROW = 2
LAST_ROW = int(sys.argv[1]) if len(sys.argv) > 1 else 150

HEADER = r'''/**
 * ARC Vault: Steam ID / şifre kopyalama düğmeleri.
 *
 * Kurulum
 *   1. Bu dosyayı Sheet'in Apps Script projesine ekle (Uzantılar > Apps Script).
 *   2. Proje Ayarları > Script Properties:
 *        ARC_VAULT_API_KEY  = sunucudaki INTERNAL_API_KEY
 *        ARC_VAULT_API_BASE = https://arc-vault.kemalkondakci.me   (isteğe bağlı)
 *   3. Apps Script editöründe steamDugmeleriniKur fonksiyonunu bir kez çalıştır.
 *      Hesap anahtarı olan her satırın A hücresinin sağ ucuna iki düğme koyar:
 *      solda "ID", sağda "Şifre". Yeni hesap ekleyince ya da sütun genişliğini
 *      değiştirince tekrar çalıştır; eskileri silip yeniden kurar.
 *      Kaldırmak için: steamDugmeleriniKaldir.
 *
 * Düğme hesaba değil satır numarasına bağlıdır: tıklandığında o satırın KEY_COLUMN
 * hücresindeki "Ad#1234" anahtarını okur. Satırları sıralasan da doğru hesabı alır.
 *
 * Bu dosya tools/sheets/gen_steam_copy.py ile üretilir; elle düzenleme.
 */

var KEY_COLUMN = 1; // "Hesap ID" sütunu (A = 1)

function steamApiGet_(key) {
  var props = PropertiesService.getScriptProperties();
  var apiKey = props.getProperty('ARC_VAULT_API_KEY');
  var base = props.getProperty('ARC_VAULT_API_BASE') || 'https://arc-vault.kemalkondakci.me';
  if (!apiKey) throw new Error('ARC_VAULT_API_KEY tanımlı değil (Proje Ayarları > Script Properties).');
  var res = UrlFetchApp.fetch(base + '/api/sheets/steam?key=' + encodeURIComponent(key), {
    headers: { 'X-Api-Key': apiKey },
    muteHttpExceptions: true,
  });
  var code = res.getResponseCode();
  if (code === 404) throw new Error(key + ' için hesap bulunamadı.');
  if (code !== 200) throw new Error('Sunucu hatası (HTTP ' + code + '). Biraz sonra tekrar dene.');
  return JSON.parse(res.getContentText());
}

function steamCopy_(row, field) {
  var ui = SpreadsheetApp.getUi();
  var sheet = SpreadsheetApp.getActiveSheet();
  var key = String(sheet.getRange(row, KEY_COLUMN).getDisplayValue()).trim();
  if (!key || key.indexOf('#') < 0) {
    ui.alert(row + '. satırda hesap anahtarı (Ad#1234) yok.');
    return;
  }
  var data;
  try {
    data = steamApiGet_(key);
  } catch (e) {
    ui.alert(e.message);
    return;
  }
  var isPass = field === 'password';
  var value = isPass ? data.steam_password : data.steam_username;
  var label = isPass ? 'Şifre' : 'Steam ID';
  if (!value) {
    ui.alert(key + ' için ' + label + ' girilmemiş. Sitede hesabın Ayarlar sayfasından ekleyebilirsin.');
    return;
  }
  var html = HtmlService.createHtmlOutput(steamDialogHtml_(key, label, value, isPass))
    .setWidth(340)
    .setHeight(150);
  ui.showModalDialog(html, label + ' kopyala');
}

// JSON for embedding inside <script>: "<" is escaped so a value can never close the tag.
function steamJs_(x) {
  return JSON.stringify(x).replace(/</g, '\\u003c');
}

function steamDialogHtml_(key, label, value, isPass) {
  // Values go in as escaped JSON and are set via script, never concatenated into markup.
  return '<!doctype html><html><head><meta charset="utf-8"><style>'
    + 'body{font-family:Arial,sans-serif;margin:12px;color:#222}'
    + '.k{font-size:12px;color:#666;margin-bottom:8px}'
    + '.r{display:flex;gap:6px}'
    + 'input{flex:1;font:14px monospace;padding:6px;border:1px solid #bbb;border-radius:4px}'
    + 'button{padding:6px 14px;border:0;border-radius:4px;background:#7b2ff7;color:#fff;font-weight:bold;cursor:pointer}'
    + '#m{margin-top:10px;font-size:12px;color:#2e7d32;min-height:16px}'
    + '</style></head><body>'
    + '<div class="k" id="k"></div>'
    + '<div class="r"><input id="v" readonly><button id="b">Kopyala</button></div>'
    + '<div id="m"></div>'
    + '<script>'
    + 'var key=' + steamJs_(key) + ',label=' + steamJs_(label)
    + ',value=' + steamJs_(value) + ',isPass=' + (isPass ? 'true' : 'false') + ';'
    + 'var v=document.getElementById("v"),m=document.getElementById("m");'
    + 'document.getElementById("k").textContent=key+" · "+label;'
    + 'v.type=isPass?"password":"text";v.value=value;'
    + 'function done(){m.textContent=label+" kopyalandı";setTimeout(function(){google.script.host.close()},700)}'
    + 'function fallback(){v.type="text";v.select();var ok=false;try{ok=document.execCommand("copy")}catch(e){}'
    + 'if(isPass)v.type="password";if(ok)done();else{m.style.color="#c62828";m.textContent="Kopyalanamadı; Ctrl+C ile kopyala"}}'
    + 'function copy(){if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(value).then(done,fallback)}else{fallback()}}'
    + 'document.getElementById("b").onclick=copy;'
    + 'document.addEventListener("keydown",function(e){if(e.key==="Enter")copy()});'
    + 'document.getElementById("b").focus();'
    + '</script></body></html>';
}

// ─── Düğme yerleşimi ─────────────────────────────────────────────────────────

var STEAM_BTN_TAG = 'arcvault-steam'; // only images with this alt title are ours
var STEAM_BTN_W = 36, STEAM_BTN_H = 18, STEAM_BTN_GAP = 3, STEAM_BTN_MARGIN = 4;

function steamBtnBlob_(b64, name) {
  return Utilities.newBlob(Utilities.base64Decode(b64), 'image/png', name);
}

/** Put an "ID" and a "Şifre" button at the right end of each account's key cell. */
function steamDugmeleriniKur() {
  var sheet = SpreadsheetApp.getActiveSheet();
  steamDugmeleriniKaldir_(sheet);
  var colW = sheet.getColumnWidth(KEY_COLUMN);
  var xPw = Math.max(0, colW - STEAM_BTN_W - STEAM_BTN_MARGIN);
  var xId = Math.max(0, xPw - STEAM_BTN_GAP - STEAM_BTN_W);
  var last = sheet.getLastRow();
  var keys = last >= STEAM_FIRST_ROW
    ? sheet.getRange(STEAM_FIRST_ROW, KEY_COLUMN, last - STEAM_FIRST_ROW + 1, 1).getDisplayValues()
    : [];
  var placed = 0, skipped = [];
  for (var i = 0; i < keys.length; i++) {
    var row = STEAM_FIRST_ROW + i;
    var key = String(keys[i][0]).trim();
    if (!key || key.indexOf('#') < 0) continue;
    if (row > STEAM_LAST_ROW) { skipped.push(row); continue; }
    var y = Math.max(0, Math.floor((sheet.getRowHeight(row) - STEAM_BTN_H) / 2));
    sheet.insertImage(steamBtnBlob_(STEAM_ICON_ID, 'id.png'), KEY_COLUMN, row, xId, y)
      .setWidth(STEAM_BTN_W).setHeight(STEAM_BTN_H)
      .setAltTextTitle(STEAM_BTN_TAG).setAltTextDescription('Steam ID kopyala')
      .assignScript('steamId_' + row);
    sheet.insertImage(steamBtnBlob_(STEAM_ICON_PW, 'pw.png'), KEY_COLUMN, row, xPw, y)
      .setWidth(STEAM_BTN_W).setHeight(STEAM_BTN_H)
      .setAltTextTitle(STEAM_BTN_TAG).setAltTextDescription('Şifre kopyala')
      .assignScript('steamSifre_' + row);
    placed++;
  }
  var msg = placed + ' hesaba Steam düğmeleri kondu.';
  if (skipped.length) msg += ' ' + STEAM_LAST_ROW + '. satırdan sonrası atlandı (' + skipped.join(', ')
    + '); gen_steam_copy.py ile daha fazla satır üret.';
  SpreadsheetApp.getActive().toast(msg, 'ARC Vault', 6);
}

function steamDugmeleriniKaldir() {
  var n = steamDugmeleriniKaldir_(SpreadsheetApp.getActiveSheet());
  SpreadsheetApp.getActive().toast(n + ' Steam düğmesi kaldırıldı.', 'ARC Vault', 4);
}

function steamDugmeleriniKaldir_(sheet) {
  var n = 0;
  sheet.getImages().forEach(function (img) {
    if (img.getAltTextTitle() === STEAM_BTN_TAG) { img.remove(); n++; }
  });
  return n;
}

// ─── Satır düğmeleri (düğmelere atanan fonksiyonlar) ────────────────────────
'''


ICONS = Path(__file__).with_name("icons")


def main() -> None:
    icon_id = base64.b64encode((ICONS / "steam_id.png").read_bytes()).decode()
    icon_pw = base64.b64encode((ICONS / "steam_pw.png").read_bytes()).decode()
    lines = [
        HEADER,
        "\n",
        f"var STEAM_FIRST_ROW = {FIRST_ROW}, STEAM_LAST_ROW = {LAST_ROW};\n",
        f"var STEAM_ICON_ID = '{icon_id}';\n",
        f"var STEAM_ICON_PW = '{icon_pw}';\n",
        "\n",
    ]
    for row in range(FIRST_ROW, LAST_ROW + 1):
        lines.append(f"function steamId_{row}() {{ steamCopy_({row}, 'id'); }}\n")
        lines.append(f"function steamSifre_{row}() {{ steamCopy_({row}, 'password'); }}\n")
    out = Path(__file__).with_name("steam_copy.gs")
    out.write_text("".join(lines), encoding="utf-8", newline="\n")
    print(f"{out} written: rows {FIRST_ROW}-{LAST_ROW}")


if __name__ == "__main__":
    main()

/**
 * ARC Vault: Steam ID / şifre kopyalama düğmeleri.
 *
 * Kurulum
 *   1. Bu dosyayı Sheet'in Apps Script projesine ekle (Uzantılar > Apps Script).
 *   2. Proje Ayarları > Script Properties:
 *        ARC_VAULT_API_KEY  = sunucudaki INTERNAL_API_KEY
 *        ARC_VAULT_API_BASE = https://arc-vault.kemalkondakci.me   (isteğe bağlı)
 *   3. Bir satıra iki çizim (Ekle > Çizim) koy. Çizime sağ tık > ⋮ > Komut dosyası ata:
 *        5. satırdaki düğmeler için:  steamId_5   ve   steamSifre_5
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

// ─── Satır düğmeleri (çizime atanacak fonksiyonlar) ─────────────────────────
function steamId_2() { steamCopy_(2, 'id'); }
function steamSifre_2() { steamCopy_(2, 'password'); }
function steamId_3() { steamCopy_(3, 'id'); }
function steamSifre_3() { steamCopy_(3, 'password'); }
function steamId_4() { steamCopy_(4, 'id'); }
function steamSifre_4() { steamCopy_(4, 'password'); }
function steamId_5() { steamCopy_(5, 'id'); }
function steamSifre_5() { steamCopy_(5, 'password'); }
function steamId_6() { steamCopy_(6, 'id'); }
function steamSifre_6() { steamCopy_(6, 'password'); }
function steamId_7() { steamCopy_(7, 'id'); }
function steamSifre_7() { steamCopy_(7, 'password'); }
function steamId_8() { steamCopy_(8, 'id'); }
function steamSifre_8() { steamCopy_(8, 'password'); }
function steamId_9() { steamCopy_(9, 'id'); }
function steamSifre_9() { steamCopy_(9, 'password'); }
function steamId_10() { steamCopy_(10, 'id'); }
function steamSifre_10() { steamCopy_(10, 'password'); }
function steamId_11() { steamCopy_(11, 'id'); }
function steamSifre_11() { steamCopy_(11, 'password'); }
function steamId_12() { steamCopy_(12, 'id'); }
function steamSifre_12() { steamCopy_(12, 'password'); }
function steamId_13() { steamCopy_(13, 'id'); }
function steamSifre_13() { steamCopy_(13, 'password'); }
function steamId_14() { steamCopy_(14, 'id'); }
function steamSifre_14() { steamCopy_(14, 'password'); }
function steamId_15() { steamCopy_(15, 'id'); }
function steamSifre_15() { steamCopy_(15, 'password'); }
function steamId_16() { steamCopy_(16, 'id'); }
function steamSifre_16() { steamCopy_(16, 'password'); }
function steamId_17() { steamCopy_(17, 'id'); }
function steamSifre_17() { steamCopy_(17, 'password'); }
function steamId_18() { steamCopy_(18, 'id'); }
function steamSifre_18() { steamCopy_(18, 'password'); }
function steamId_19() { steamCopy_(19, 'id'); }
function steamSifre_19() { steamCopy_(19, 'password'); }
function steamId_20() { steamCopy_(20, 'id'); }
function steamSifre_20() { steamCopy_(20, 'password'); }
function steamId_21() { steamCopy_(21, 'id'); }
function steamSifre_21() { steamCopy_(21, 'password'); }
function steamId_22() { steamCopy_(22, 'id'); }
function steamSifre_22() { steamCopy_(22, 'password'); }
function steamId_23() { steamCopy_(23, 'id'); }
function steamSifre_23() { steamCopy_(23, 'password'); }
function steamId_24() { steamCopy_(24, 'id'); }
function steamSifre_24() { steamCopy_(24, 'password'); }
function steamId_25() { steamCopy_(25, 'id'); }
function steamSifre_25() { steamCopy_(25, 'password'); }
function steamId_26() { steamCopy_(26, 'id'); }
function steamSifre_26() { steamCopy_(26, 'password'); }
function steamId_27() { steamCopy_(27, 'id'); }
function steamSifre_27() { steamCopy_(27, 'password'); }
function steamId_28() { steamCopy_(28, 'id'); }
function steamSifre_28() { steamCopy_(28, 'password'); }
function steamId_29() { steamCopy_(29, 'id'); }
function steamSifre_29() { steamCopy_(29, 'password'); }
function steamId_30() { steamCopy_(30, 'id'); }
function steamSifre_30() { steamCopy_(30, 'password'); }
function steamId_31() { steamCopy_(31, 'id'); }
function steamSifre_31() { steamCopy_(31, 'password'); }
function steamId_32() { steamCopy_(32, 'id'); }
function steamSifre_32() { steamCopy_(32, 'password'); }
function steamId_33() { steamCopy_(33, 'id'); }
function steamSifre_33() { steamCopy_(33, 'password'); }
function steamId_34() { steamCopy_(34, 'id'); }
function steamSifre_34() { steamCopy_(34, 'password'); }
function steamId_35() { steamCopy_(35, 'id'); }
function steamSifre_35() { steamCopy_(35, 'password'); }
function steamId_36() { steamCopy_(36, 'id'); }
function steamSifre_36() { steamCopy_(36, 'password'); }
function steamId_37() { steamCopy_(37, 'id'); }
function steamSifre_37() { steamCopy_(37, 'password'); }
function steamId_38() { steamCopy_(38, 'id'); }
function steamSifre_38() { steamCopy_(38, 'password'); }
function steamId_39() { steamCopy_(39, 'id'); }
function steamSifre_39() { steamCopy_(39, 'password'); }
function steamId_40() { steamCopy_(40, 'id'); }
function steamSifre_40() { steamCopy_(40, 'password'); }
function steamId_41() { steamCopy_(41, 'id'); }
function steamSifre_41() { steamCopy_(41, 'password'); }
function steamId_42() { steamCopy_(42, 'id'); }
function steamSifre_42() { steamCopy_(42, 'password'); }
function steamId_43() { steamCopy_(43, 'id'); }
function steamSifre_43() { steamCopy_(43, 'password'); }
function steamId_44() { steamCopy_(44, 'id'); }
function steamSifre_44() { steamCopy_(44, 'password'); }
function steamId_45() { steamCopy_(45, 'id'); }
function steamSifre_45() { steamCopy_(45, 'password'); }
function steamId_46() { steamCopy_(46, 'id'); }
function steamSifre_46() { steamCopy_(46, 'password'); }
function steamId_47() { steamCopy_(47, 'id'); }
function steamSifre_47() { steamCopy_(47, 'password'); }
function steamId_48() { steamCopy_(48, 'id'); }
function steamSifre_48() { steamCopy_(48, 'password'); }
function steamId_49() { steamCopy_(49, 'id'); }
function steamSifre_49() { steamCopy_(49, 'password'); }
function steamId_50() { steamCopy_(50, 'id'); }
function steamSifre_50() { steamCopy_(50, 'password'); }
function steamId_51() { steamCopy_(51, 'id'); }
function steamSifre_51() { steamCopy_(51, 'password'); }
function steamId_52() { steamCopy_(52, 'id'); }
function steamSifre_52() { steamCopy_(52, 'password'); }
function steamId_53() { steamCopy_(53, 'id'); }
function steamSifre_53() { steamCopy_(53, 'password'); }
function steamId_54() { steamCopy_(54, 'id'); }
function steamSifre_54() { steamCopy_(54, 'password'); }
function steamId_55() { steamCopy_(55, 'id'); }
function steamSifre_55() { steamCopy_(55, 'password'); }
function steamId_56() { steamCopy_(56, 'id'); }
function steamSifre_56() { steamCopy_(56, 'password'); }
function steamId_57() { steamCopy_(57, 'id'); }
function steamSifre_57() { steamCopy_(57, 'password'); }
function steamId_58() { steamCopy_(58, 'id'); }
function steamSifre_58() { steamCopy_(58, 'password'); }
function steamId_59() { steamCopy_(59, 'id'); }
function steamSifre_59() { steamCopy_(59, 'password'); }
function steamId_60() { steamCopy_(60, 'id'); }
function steamSifre_60() { steamCopy_(60, 'password'); }
function steamId_61() { steamCopy_(61, 'id'); }
function steamSifre_61() { steamCopy_(61, 'password'); }
function steamId_62() { steamCopy_(62, 'id'); }
function steamSifre_62() { steamCopy_(62, 'password'); }
function steamId_63() { steamCopy_(63, 'id'); }
function steamSifre_63() { steamCopy_(63, 'password'); }
function steamId_64() { steamCopy_(64, 'id'); }
function steamSifre_64() { steamCopy_(64, 'password'); }
function steamId_65() { steamCopy_(65, 'id'); }
function steamSifre_65() { steamCopy_(65, 'password'); }
function steamId_66() { steamCopy_(66, 'id'); }
function steamSifre_66() { steamCopy_(66, 'password'); }
function steamId_67() { steamCopy_(67, 'id'); }
function steamSifre_67() { steamCopy_(67, 'password'); }
function steamId_68() { steamCopy_(68, 'id'); }
function steamSifre_68() { steamCopy_(68, 'password'); }
function steamId_69() { steamCopy_(69, 'id'); }
function steamSifre_69() { steamCopy_(69, 'password'); }
function steamId_70() { steamCopy_(70, 'id'); }
function steamSifre_70() { steamCopy_(70, 'password'); }
function steamId_71() { steamCopy_(71, 'id'); }
function steamSifre_71() { steamCopy_(71, 'password'); }
function steamId_72() { steamCopy_(72, 'id'); }
function steamSifre_72() { steamCopy_(72, 'password'); }
function steamId_73() { steamCopy_(73, 'id'); }
function steamSifre_73() { steamCopy_(73, 'password'); }
function steamId_74() { steamCopy_(74, 'id'); }
function steamSifre_74() { steamCopy_(74, 'password'); }
function steamId_75() { steamCopy_(75, 'id'); }
function steamSifre_75() { steamCopy_(75, 'password'); }
function steamId_76() { steamCopy_(76, 'id'); }
function steamSifre_76() { steamCopy_(76, 'password'); }
function steamId_77() { steamCopy_(77, 'id'); }
function steamSifre_77() { steamCopy_(77, 'password'); }
function steamId_78() { steamCopy_(78, 'id'); }
function steamSifre_78() { steamCopy_(78, 'password'); }
function steamId_79() { steamCopy_(79, 'id'); }
function steamSifre_79() { steamCopy_(79, 'password'); }
function steamId_80() { steamCopy_(80, 'id'); }
function steamSifre_80() { steamCopy_(80, 'password'); }
function steamId_81() { steamCopy_(81, 'id'); }
function steamSifre_81() { steamCopy_(81, 'password'); }
function steamId_82() { steamCopy_(82, 'id'); }
function steamSifre_82() { steamCopy_(82, 'password'); }
function steamId_83() { steamCopy_(83, 'id'); }
function steamSifre_83() { steamCopy_(83, 'password'); }
function steamId_84() { steamCopy_(84, 'id'); }
function steamSifre_84() { steamCopy_(84, 'password'); }
function steamId_85() { steamCopy_(85, 'id'); }
function steamSifre_85() { steamCopy_(85, 'password'); }
function steamId_86() { steamCopy_(86, 'id'); }
function steamSifre_86() { steamCopy_(86, 'password'); }
function steamId_87() { steamCopy_(87, 'id'); }
function steamSifre_87() { steamCopy_(87, 'password'); }
function steamId_88() { steamCopy_(88, 'id'); }
function steamSifre_88() { steamCopy_(88, 'password'); }
function steamId_89() { steamCopy_(89, 'id'); }
function steamSifre_89() { steamCopy_(89, 'password'); }
function steamId_90() { steamCopy_(90, 'id'); }
function steamSifre_90() { steamCopy_(90, 'password'); }
function steamId_91() { steamCopy_(91, 'id'); }
function steamSifre_91() { steamCopy_(91, 'password'); }
function steamId_92() { steamCopy_(92, 'id'); }
function steamSifre_92() { steamCopy_(92, 'password'); }
function steamId_93() { steamCopy_(93, 'id'); }
function steamSifre_93() { steamCopy_(93, 'password'); }
function steamId_94() { steamCopy_(94, 'id'); }
function steamSifre_94() { steamCopy_(94, 'password'); }
function steamId_95() { steamCopy_(95, 'id'); }
function steamSifre_95() { steamCopy_(95, 'password'); }
function steamId_96() { steamCopy_(96, 'id'); }
function steamSifre_96() { steamCopy_(96, 'password'); }
function steamId_97() { steamCopy_(97, 'id'); }
function steamSifre_97() { steamCopy_(97, 'password'); }
function steamId_98() { steamCopy_(98, 'id'); }
function steamSifre_98() { steamCopy_(98, 'password'); }
function steamId_99() { steamCopy_(99, 'id'); }
function steamSifre_99() { steamCopy_(99, 'password'); }
function steamId_100() { steamCopy_(100, 'id'); }
function steamSifre_100() { steamCopy_(100, 'password'); }
function steamId_101() { steamCopy_(101, 'id'); }
function steamSifre_101() { steamCopy_(101, 'password'); }
function steamId_102() { steamCopy_(102, 'id'); }
function steamSifre_102() { steamCopy_(102, 'password'); }
function steamId_103() { steamCopy_(103, 'id'); }
function steamSifre_103() { steamCopy_(103, 'password'); }
function steamId_104() { steamCopy_(104, 'id'); }
function steamSifre_104() { steamCopy_(104, 'password'); }
function steamId_105() { steamCopy_(105, 'id'); }
function steamSifre_105() { steamCopy_(105, 'password'); }
function steamId_106() { steamCopy_(106, 'id'); }
function steamSifre_106() { steamCopy_(106, 'password'); }
function steamId_107() { steamCopy_(107, 'id'); }
function steamSifre_107() { steamCopy_(107, 'password'); }
function steamId_108() { steamCopy_(108, 'id'); }
function steamSifre_108() { steamCopy_(108, 'password'); }
function steamId_109() { steamCopy_(109, 'id'); }
function steamSifre_109() { steamCopy_(109, 'password'); }
function steamId_110() { steamCopy_(110, 'id'); }
function steamSifre_110() { steamCopy_(110, 'password'); }
function steamId_111() { steamCopy_(111, 'id'); }
function steamSifre_111() { steamCopy_(111, 'password'); }
function steamId_112() { steamCopy_(112, 'id'); }
function steamSifre_112() { steamCopy_(112, 'password'); }
function steamId_113() { steamCopy_(113, 'id'); }
function steamSifre_113() { steamCopy_(113, 'password'); }
function steamId_114() { steamCopy_(114, 'id'); }
function steamSifre_114() { steamCopy_(114, 'password'); }
function steamId_115() { steamCopy_(115, 'id'); }
function steamSifre_115() { steamCopy_(115, 'password'); }
function steamId_116() { steamCopy_(116, 'id'); }
function steamSifre_116() { steamCopy_(116, 'password'); }
function steamId_117() { steamCopy_(117, 'id'); }
function steamSifre_117() { steamCopy_(117, 'password'); }
function steamId_118() { steamCopy_(118, 'id'); }
function steamSifre_118() { steamCopy_(118, 'password'); }
function steamId_119() { steamCopy_(119, 'id'); }
function steamSifre_119() { steamCopy_(119, 'password'); }
function steamId_120() { steamCopy_(120, 'id'); }
function steamSifre_120() { steamCopy_(120, 'password'); }
function steamId_121() { steamCopy_(121, 'id'); }
function steamSifre_121() { steamCopy_(121, 'password'); }
function steamId_122() { steamCopy_(122, 'id'); }
function steamSifre_122() { steamCopy_(122, 'password'); }
function steamId_123() { steamCopy_(123, 'id'); }
function steamSifre_123() { steamCopy_(123, 'password'); }
function steamId_124() { steamCopy_(124, 'id'); }
function steamSifre_124() { steamCopy_(124, 'password'); }
function steamId_125() { steamCopy_(125, 'id'); }
function steamSifre_125() { steamCopy_(125, 'password'); }
function steamId_126() { steamCopy_(126, 'id'); }
function steamSifre_126() { steamCopy_(126, 'password'); }
function steamId_127() { steamCopy_(127, 'id'); }
function steamSifre_127() { steamCopy_(127, 'password'); }
function steamId_128() { steamCopy_(128, 'id'); }
function steamSifre_128() { steamCopy_(128, 'password'); }
function steamId_129() { steamCopy_(129, 'id'); }
function steamSifre_129() { steamCopy_(129, 'password'); }
function steamId_130() { steamCopy_(130, 'id'); }
function steamSifre_130() { steamCopy_(130, 'password'); }
function steamId_131() { steamCopy_(131, 'id'); }
function steamSifre_131() { steamCopy_(131, 'password'); }
function steamId_132() { steamCopy_(132, 'id'); }
function steamSifre_132() { steamCopy_(132, 'password'); }
function steamId_133() { steamCopy_(133, 'id'); }
function steamSifre_133() { steamCopy_(133, 'password'); }
function steamId_134() { steamCopy_(134, 'id'); }
function steamSifre_134() { steamCopy_(134, 'password'); }
function steamId_135() { steamCopy_(135, 'id'); }
function steamSifre_135() { steamCopy_(135, 'password'); }
function steamId_136() { steamCopy_(136, 'id'); }
function steamSifre_136() { steamCopy_(136, 'password'); }
function steamId_137() { steamCopy_(137, 'id'); }
function steamSifre_137() { steamCopy_(137, 'password'); }
function steamId_138() { steamCopy_(138, 'id'); }
function steamSifre_138() { steamCopy_(138, 'password'); }
function steamId_139() { steamCopy_(139, 'id'); }
function steamSifre_139() { steamCopy_(139, 'password'); }
function steamId_140() { steamCopy_(140, 'id'); }
function steamSifre_140() { steamCopy_(140, 'password'); }
function steamId_141() { steamCopy_(141, 'id'); }
function steamSifre_141() { steamCopy_(141, 'password'); }
function steamId_142() { steamCopy_(142, 'id'); }
function steamSifre_142() { steamCopy_(142, 'password'); }
function steamId_143() { steamCopy_(143, 'id'); }
function steamSifre_143() { steamCopy_(143, 'password'); }
function steamId_144() { steamCopy_(144, 'id'); }
function steamSifre_144() { steamCopy_(144, 'password'); }
function steamId_145() { steamCopy_(145, 'id'); }
function steamSifre_145() { steamCopy_(145, 'password'); }
function steamId_146() { steamCopy_(146, 'id'); }
function steamSifre_146() { steamCopy_(146, 'password'); }
function steamId_147() { steamCopy_(147, 'id'); }
function steamSifre_147() { steamCopy_(147, 'password'); }
function steamId_148() { steamCopy_(148, 'id'); }
function steamSifre_148() { steamCopy_(148, 'password'); }
function steamId_149() { steamCopy_(149, 'id'); }
function steamSifre_149() { steamCopy_(149, 'password'); }
function steamId_150() { steamCopy_(150, 'id'); }
function steamSifre_150() { steamCopy_(150, 'password'); }

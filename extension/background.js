/**
 * ARC Vault — Background Script (Chrome + Firefox)
 *
 * 127.0.0.1:49172 callback'ini yakalar ve API'ye iletir.
 *
 * Akış:
 * 1. Web sitesi /refresh-token/start çağırır → auth_url + state döner
 * 2. Web sitesi auth_url'i yeni sekmede açar
 * 3. Kullanıcı Xbox login yapar
 * 4. Xbox → 127.0.0.1:49172?code=...&state=... redirect eder
 * 5. Bu eklenti URL'i yakalar, code+state'i API'ye POST eder
 * 6. API arctracker'a ileterek token'ı yeniler
 */

// Cross-browser uyumluluk — Firefox: browser.*, Chrome: chrome.*
const ext = typeof browser !== "undefined" ? browser : chrome;

// API base URL — storage'dan okunur, varsayılan localhost
async function getApiBase() {
  try {
    const data = await ext.storage.local.get("apiBase");
    return data.apiBase || "http://localhost:8000";
  } catch (e) {
    console.warn("[ARC Tracker] Storage okunamadı:", e);
    return "http://localhost:8000";
  }
}

// Tüm tab navigasyonlarını dinle (filtre olmadan — daha güvenilir)
ext.webNavigation.onBeforeNavigate.addListener(async (details) => {
  // Sadece ana frame
  if (details.frameId !== 0) return;

  // URL'i kontrol et
  if (!details.url || !details.url.startsWith("http://127.0.0.1:49172")) return;

  let url;
  try {
    url = new URL(details.url);
  } catch {
    return;
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code || !state) {
    console.warn("[ARC Tracker] Callback URL'de code veya state yok:", details.url);
    return;
  }

  console.log("[ARC Tracker] Callback yakalandı! state:", state.substring(0, 20));

  // API'ye gönder
  let apiBase;
  try {
    apiBase = await getApiBase();
    console.log("[ARC Tracker] API base:", apiBase);

    const resp = await fetch(`${apiBase}/api/refresh-token/callback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, state }),
    });

    const result = await resp.json();
    console.log("[ARC Tracker] API yanıtı:", JSON.stringify(result));

    // Tab'ı başarı/hata sayfasına yönlendir
    const redirectUrl = resp.ok
      ? `${apiBase}/static/refresh-success.html`
      : `${apiBase}/static/refresh-error.html`;

    ext.tabs.update(details.tabId, { url: redirectUrl });

    // Badge ile bildirim göster
    if (resp.ok) {
      ext.action.setBadgeText({ text: "✓" });
      ext.action.setBadgeBackgroundColor({ color: "#4caf50" });
      setTimeout(() => ext.action.setBadgeText({ text: "" }), 5000);
    }
  } catch (err) {
    console.error("[ARC Tracker] API hatası:", err.message || err);
    console.error("[ARC Tracker] apiBase:", apiBase);

    // Hata sayfası göster
    ext.tabs.update(details.tabId, {
      url: ext.runtime.getURL("error.html"),
    });
  }
});

// Eklenti kurulduğunda varsayılan API URL'i ayarla
ext.runtime.onInstalled.addListener(async () => {
  try {
    const data = await ext.storage.local.get("apiBase");
    if (!data.apiBase) {
      await ext.storage.local.set({ apiBase: "http://localhost:8000" });
    }
  } catch (e) {
    console.warn("[ARC Tracker] İlk kurulum storage hatası:", e);
  }
  console.log("[ARC Tracker] Eklenti kuruldu.");
});

/**
 * ARC Vault — Background Script (MV2 — Firefox / Zen Browser)
 */

function getApiBase(callback) {
  try {
    browser.storage.local.get("apiBase").then(function(data) {
      callback((data && data.apiBase) || "http://localhost:8000");
    }).catch(function() {
      callback("http://localhost:8000");
    });
  } catch(e) {
    callback("http://localhost:8000");
  }
}

function showError(tabId, errMsg, apiBase) {
  var errorUrl = browser.runtime.getURL("error.html")
    + "?error=" + encodeURIComponent(errMsg || "Bilinmeyen hata")
    + "&api=" + encodeURIComponent(apiBase || "?");
  console.error("[ARC Tracker] Hata sayfasına yönlendiriliyor:", errorUrl);
  browser.tabs.update(tabId, { url: errorUrl });
}

browser.webNavigation.onBeforeNavigate.addListener(function(details) {
  if (details.frameId !== 0) return;
  if (!details.url || details.url.indexOf("http://127.0.0.1:49172") !== 0) return;

  var url;
  try {
    url = new URL(details.url);
  } catch(e) {
    return;
  }

  var code = url.searchParams.get("code");
  var state = url.searchParams.get("state");

  if (!code || !state) {
    console.warn("[ARC Tracker] code veya state yok:", details.url);
    return;
  }

  console.log("[ARC Tracker] Callback yakalandı!");
  console.log("[ARC Tracker] code:", code.substring(0, 20) + "...");
  console.log("[ARC Tracker] state:", state);

  var tabId = details.tabId;

  // Hemen "işleniyor" sayfasına yönlendir — 127.0.0.1 beklemesin
  browser.tabs.update(tabId, { url: browser.runtime.getURL("processing.html") });

  getApiBase(function(apiBase) {
    console.log("[ARC Tracker] API base:", apiBase);
    var endpoint = apiBase + "/api/refresh-token/callback";
    console.log("[ARC Tracker] POST:", endpoint);

    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: code, state: state })
    })
    .then(function(resp) {
      console.log("[ARC Tracker] HTTP status:", resp.status);
      return resp.text().then(function(text) {
        console.log("[ARC Tracker] Raw yanıt:", text.substring(0, 500));
        var result;
        try {
          result = JSON.parse(text);
        } catch(e) {
          showError(tabId, "API JSON parse hatası: " + text.substring(0, 200), apiBase);
          return;
        }

        if (resp.ok && result.status !== "error") {
          console.log("[ARC Tracker] Başarılı! Yönlendiriliyor...");
          browser.tabs.update(tabId, { url: apiBase + "/static/refresh-success.html" });
          try {
            browser.browserAction.setBadgeText({ text: "OK" });
            browser.browserAction.setBadgeBackgroundColor({ color: "#4caf50" });
            setTimeout(function() { browser.browserAction.setBadgeText({ text: "" }); }, 5000);
          } catch(e) {}
        } else {
          var msg = result.detail || result.message || "HTTP " + resp.status;
          console.warn("[ARC Tracker] API hata yanıtı:", msg);
          browser.tabs.update(tabId, {
            url: apiBase + "/static/refresh-error.html?error=" + encodeURIComponent(msg)
          });
        }
      });
    })
    .catch(function(err) {
      var errMsg = err.message || String(err);
      console.error("[ARC Tracker] Fetch hatası:", errMsg);
      showError(tabId, errMsg, apiBase);
    });
  });
});

browser.runtime.onInstalled.addListener(function() {
  browser.storage.local.get("apiBase").then(function(data) {
    if (!data || !data.apiBase) {
      browser.storage.local.set({ apiBase: "http://localhost:8000" });
    }
  }).catch(function() {
    browser.storage.local.set({ apiBase: "http://localhost:8000" });
  });
  console.log("[ARC Tracker] Eklenti kuruldu.");
});

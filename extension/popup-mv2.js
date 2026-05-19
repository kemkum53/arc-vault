// MV2 — Promise tabanlı (Firefox/Zen)
browser.storage.local.get("apiBase").then(function(data) {
  document.getElementById("apiBase").value = (data && data.apiBase) || "http://localhost:8000";
}).catch(function() {
  document.getElementById("apiBase").value = "http://localhost:8000";
});

document.getElementById("saveBtn").addEventListener("click", function() {
  var val = document.getElementById("apiBase").value.trim().replace(/\/+$/, "");
  browser.storage.local.set({ apiBase: val }).then(function() {
    var status = document.getElementById("status");
    status.style.display = "block";
    status.textContent = "Kaydedildi!";
    status.style.color = "#4caf50";
    setTimeout(function() { status.style.display = "none"; }, 2000);
  }).catch(function(e) {
    var status = document.getElementById("status");
    status.style.display = "block";
    status.textContent = "Kaydetme hatası: " + e.message;
    status.style.color = "#f44336";
  });
});

document.getElementById("testBtn").addEventListener("click", function() {
  var status = document.getElementById("status");
  var apiBase = document.getElementById("apiBase").value.trim().replace(/\/+$/, "");

  status.style.display = "block";
  status.textContent = "Test ediliyor...";
  status.style.color = "#ff9800";

  fetch(apiBase + "/health", { method: "GET" })
    .then(function(resp) {
      if (resp.ok) {
        status.textContent = "✓ API bağlantısı başarılı! (" + resp.status + ")";
        status.style.color = "#4caf50";
      } else {
        status.textContent = "✗ API yanıt verdi ama hata: HTTP " + resp.status;
        status.style.color = "#f44336";
      }
    })
    .catch(function(err) {
      status.textContent = "✗ API'ye ulaşılamıyor: " + (err.message || String(err));
      status.style.color = "#f44336";
    });
});

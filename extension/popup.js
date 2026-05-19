// Cross-browser uyumluluk
const api = typeof browser !== "undefined" ? browser : chrome;

// Kayıtlı API URL'i yükle
api.storage.local.get("apiBase").then((data) => {
  document.getElementById("apiBase").value = data.apiBase || "http://localhost:8000";
});

// Kaydet
document.getElementById("saveBtn").addEventListener("click", () => {
  const val = document.getElementById("apiBase").value.trim().replace(/\/+$/, "");
  api.storage.local.set({ apiBase: val }).then(() => {
    const status = document.getElementById("status");
    status.style.display = "block";
    setTimeout(() => (status.style.display = "none"), 2000);
  });
});

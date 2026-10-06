"use client";

import { useEffect, useState } from "react";
import { Icon, Button } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { getHarvesterInfo, rotateHarvesterKey, type HarvesterInfo } from "@/lib/api";

interface Props {
  onClose: () => void;
}

const stepStyle: React.CSSProperties = {
  fontFamily: "var(--font-ui)", fontSize: 13, color: "var(--fg-3)", lineHeight: 1.5,
};

export function HarvesterModal({ onClose }: Props) {
  const { isAdmin } = useAuth();
  const [info, setInfo] = useState<HarvesterInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [rotating, setRotating] = useState(false);

  useEffect(() => {
    getHarvesterInfo()
      .then(setInfo)
      .catch((err) => setError(err instanceof Error ? err.message : "Bilgi alınamadı"));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const copyKey = async () => {
    if (!info) return;
    try {
      await navigator.clipboard.writeText(info.api_key);
      setNotice("API key panoya kopyalandı.");
    } catch {
      setShowKey(true);
      setNotice("Panoya kopyalanamadı; key aşağıda açık, elle seçip kopyalayabilirsin.");
    }
  };

  const rotate = async () => {
    setRotating(true);
    setError(null);
    try {
      setInfo(await rotateHarvesterKey());
      setShowKey(true);
      setNotice("Yeni API key oluşturuldu. Eski key artık kabul edilmiyor.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Key yenilenemedi");
    } finally {
      setRotating(false);
      setConfirmRotate(false);
    }
  };

  const masked = info ? info.api_key.slice(0, 4) + "•".repeat(24) + info.api_key.slice(-4) : "";

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 100,
      background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div style={{
        width: 520, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto",
        background: "var(--bg-2)", border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)", boxShadow: "0 24px 80px rgba(0,0,0,0.5)",
        padding: 20, display: "flex", flexDirection: "column", gap: 16,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Icon name="download" size={18} style={{ color: "#00d2ff" }} />
            <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 16, color: "var(--fg-1)" }}>
              ARC Vault Harvester
            </span>
            {info && (
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-5)" }}>
                v{info.version} · Windows
              </span>
            )}
          </div>
          <button onClick={onClose} title="Kapat" style={{
            background: "none", border: "none", cursor: "pointer", color: "var(--fg-4)", padding: 4,
          }}>
            <Icon name="x" size={18} />
          </button>
        </div>

        <p style={{ ...stepStyle, margin: 0 }}>
          Harvester Windows'ta arka planda çalışır. Oyuna giriş yaptığında Embark oturumunu
          siteye gönderir, hesabın token'ı kendiliğinden yenilenir.
        </p>

        {error && (
          <div style={{
            fontFamily: "var(--font-ui)", fontSize: 12.5, color: "#f44336",
            background: "rgba(244,67,54,0.08)", padding: "8px 10px", borderRadius: "var(--radius)",
          }}>{error}</div>
        )}

        {info && (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <a href={info.setup_url} style={{ textDecoration: "none", flex: "1 1 200px" }}>
                <Button variant="primary" icon="download" full>Kurulumu indir</Button>
              </a>
              <a href={info.portable_url} style={{ textDecoration: "none", flex: "1 1 160px" }}
                title="Kurulum gerektirmeyen tek dosya">
                <Button variant="ghost" full>Taşınabilir .exe</Button>
              </a>
            </div>

            <ol style={{ ...stepStyle, margin: 0, paddingLeft: 18, listStyle: "decimal", display: "flex", flexDirection: "column", gap: 4 }}>
              <li>Kurulumu indirip çalıştır.</li>
              <li>Uygulama ilk açılışta API key ister; aşağıdaki key'i kopyalayıp yapıştır.</li>
              <li>Key'i sonradan değiştirmek için sistem tepsisindeki simgeye sağ tıkla, "API Key Güncelle"yi seç.</li>
            </ol>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{
                fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--fg-5)",
                textTransform: "uppercase", letterSpacing: "0.06em",
              }}>API key</span>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <code style={{
                  flex: 1, minWidth: 0, overflowX: "auto", whiteSpace: "nowrap",
                  fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--fg-1)",
                  background: "var(--bg-1)", border: "1px solid var(--border)",
                  borderRadius: "var(--radius)", padding: "9px 10px", userSelect: "all",
                }}>{showKey ? info.api_key : masked}</code>
                <button onClick={() => setShowKey(v => !v)} className="av-icon-btn"
                  title={showKey ? "Gizle" : "Göster"} style={{ padding: 8 }}>
                  <Icon name={showKey ? "eye-off" : "eye"} size={15} />
                </button>
                <button onClick={copyKey} className="av-icon-btn" title="Kopyala" style={{ padding: 8 }}>
                  <Icon name="copy" size={15} />
                </button>
              </div>
              {notice && (
                <span style={{ fontFamily: "var(--font-ui)", fontSize: 12, color: "#4caf50" }}>{notice}</span>
              )}
              <span style={{ fontFamily: "var(--font-ui)", fontSize: 12, color: "var(--fg-5)" }}>
                Bu key yalnızca harvester'ın token göndermesine izin verir. Siteye giriş için kullanılamaz.
              </span>
            </div>

            {isAdmin && (
              <div style={{
                borderTop: "1px solid var(--border)", paddingTop: 12,
                display: "flex", flexDirection: "column", gap: 8,
              }}>
                {!confirmRotate ? (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-5)" }}>
                      {info.key_updated_at
                        ? `son değişiklik ${new Date(info.key_updated_at).toLocaleString("tr-TR")} · ${info.key_updated_by ?? "?"}`
                        : ""}
                    </span>
                    <Button variant="ghost" onClick={() => setConfirmRotate(true)}>Key'i yenile</Button>
                  </div>
                ) : (
                  <>
                    <span style={{ fontFamily: "var(--font-ui)", fontSize: 12.5, color: "#ffb020" }}>
                      Yeni key oluşunca eski key'i kullanan kurulumlar, yeni key girilene kadar token gönderemez.
                    </span>
                    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                      <Button variant="ghost" onClick={() => setConfirmRotate(false)}>Vazgeç</Button>
                      <Button variant="primary" onClick={rotate}>{rotating ? "Yenileniyor…" : "Yenile"}</Button>
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        )}

        {!info && !error && (
          <span style={{ ...stepStyle, color: "var(--fg-5)" }}>yükleniyor…</span>
        )}
      </div>
    </div>
  );
}

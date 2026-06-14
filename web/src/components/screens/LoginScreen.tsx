"use client";

import { useState, useEffect } from "react";
import { Icon, Button, Wordmark } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useT, useLang } from "@/lib/i18n";
import { getApiBase } from "@/lib/api";

const inputStyle: React.CSSProperties = {
  background: "var(--bg-input)",
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius)",
  padding: "11px 12px",
  color: "var(--fg-2)",
  fontSize: 13.5,
  fontFamily: "var(--font-ui)",
  outline: "none",
  width: "100%",
};

export function LoginScreen() {
  const { login } = useAuth();
  const t = useT();
  const { lang, setLang } = useLang();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSetup, setIsSetup] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const base = getApiBase();
        const res = await fetch(`${base}/api/auth/setup-status`);
        if (res.ok) {
          const data = await res.json();
          setIsSetup(data.needs_setup === true);
        }
      } catch {
        setIsSetup(false);
      } finally {
        setChecked(true);
      }
    })();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;
    setBusy(true);
    setError(null);
    try {
      if (isSetup) {
        const base = getApiBase();
        const res = await fetch(`${base}/api/auth/setup`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
        });
        if (!res.ok) {
          throw new Error(t("login.setupFailed"));
        }
      }
      await login(username, password);
    } catch {
      setError(isSetup ? t("login.setupFailed") : t("login.invalidCredentials"));
    } finally {
      setBusy(false);
    }
  };

  if (!checked) return null;

  return (
    <div style={{
      minHeight: "100vh",
      background: "radial-gradient(circle at 70% 20%, rgba(123,47,247,0.18), transparent 60%), radial-gradient(circle at 20% 80%, rgba(0,210,255,0.12), transparent 55%), var(--bg-1)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 40,
    }}>
      <div style={{
        width: 400, maxWidth: "100%",
        background: "var(--bg-2)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "0 24px 80px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.04) inset",
        padding: "40px",
        display: "flex", flexDirection: "column", gap: 24,
      }}>
        <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
          <Wordmark size={22} />
          <div style={{
            width: 80, height: 80,
            backgroundImage: "url('/arc_vault_logo.png')",
            backgroundSize: "contain", backgroundRepeat: "no-repeat", backgroundPosition: "center",
            filter: "drop-shadow(0 0 20px rgba(0,210,255,0.25))",
          }} />
          {isSetup ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <h2 style={{
                margin: 0, fontFamily: "var(--font-display)", fontWeight: 700,
                fontSize: 20, color: "var(--fg-1)",
              }}>{t("login.setup")}</h2>
              <span style={{ fontFamily: "var(--font-ui)", fontSize: 13, color: "var(--fg-4)" }}>
                {t("login.setupDesc")}
              </span>
            </div>
          ) : (
            <h2 style={{
              margin: 0, fontFamily: "var(--font-display)", fontWeight: 700,
              fontSize: 20, color: "var(--fg-1)",
            }}>{t("login.title")}</h2>
          )}
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{
              fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 11,
              color: "var(--fg-4)", textTransform: "uppercase", letterSpacing: "0.14em",
            }}>{t("login.username")}</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              style={inputStyle}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{
              fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 11,
              color: "var(--fg-4)", textTransform: "uppercase", letterSpacing: "0.14em",
            }}>{t("login.password")}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={inputStyle}
            />
          </div>

          {error && (
            <div style={{
              padding: "8px 12px",
              background: "rgba(244,67,54,0.08)", border: "1px solid rgba(244,67,54,0.25)",
              borderRadius: "var(--radius)",
              fontSize: 12, color: "#f44336", fontFamily: "var(--font-ui)",
              display: "flex", alignItems: "center", gap: 8,
            }}>
              <Icon name="triangle-alert" size={14} />
              {error}
            </div>
          )}

          <Button variant="primary" icon={isSetup ? "shield" : "lock"} full type="submit">
            {busy ? t("login.wait") : isSetup ? t("login.createAdmin") : t("login.submit")}
          </Button>
        </form>

        {/* Language toggle */}
        <button
          onClick={() => setLang(lang === "tr" ? "en" : "tr")}
          style={{
            alignSelf: "center",
            display: "flex", alignItems: "center", gap: 6,
            padding: "5px 14px",
            background: "transparent",
            border: "1px solid var(--border-strong)",
            borderRadius: 999,
            cursor: "pointer",
            fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600,
            color: "var(--fg-4)",
          }}
        >
          <Icon name="languages" size={14} />
          {lang === "tr" ? "English" : "Türkçe"}
        </button>
      </div>
    </div>
  );
}

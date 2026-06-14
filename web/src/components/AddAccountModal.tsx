"use client";

import { useState } from "react";
import { Icon, Button } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { createAccount } from "@/lib/api";

interface AddAccountModalProps {
  onCreated: (accountId: string) => void;
  onClose: () => void;
}

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

export function AddAccountModal({ onCreated, onClose }: AddAccountModalProps) {
  const t = useT();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!email || !password) return;
    setBusy(true);
    setError(null);
    try {
      const account = await createAccount(email, password);
      onCreated(account.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("modal.addFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(8px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 440, maxWidth: "100%",
          background: "var(--bg-2)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "0 24px 80px rgba(0,0,0,0.5)",
          padding: "28px 28px 24px",
          display: "flex", flexDirection: "column", gap: 20,
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h2 style={{
              margin: 0, fontFamily: "var(--font-display)", fontWeight: 600,
              fontSize: 20, color: "var(--fg-1)",
            }}>{t("modal.addAccount")}</h2>
            <span style={{
              fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-5)",
            }}>{t("modal.credentials")}</span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "var(--fg-4)", padding: 4, borderRadius: "var(--radius-sm)",
            }}
          >
            <Icon name="x" size={18} />
          </button>
        </div>

        {/* Form */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{
              fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 11,
              color: "var(--fg-4)", textTransform: "uppercase", letterSpacing: "0.14em",
            }}>{t("modal.email")}</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="arctracker@example.com"
              style={inputStyle}
              autoFocus
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{
              fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 11,
              color: "var(--fg-4)", textTransform: "uppercase", letterSpacing: "0.14em",
            }}>{t("modal.password")}</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("modal.passwordPlaceholder")}
              style={inputStyle}
              onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
            />
          </label>
        </div>

        {/* Error */}
        {error && (
          <div style={{
            padding: "8px 12px",
            background: "rgba(244,67,54,0.08)",
            border: "1px solid rgba(244,67,54,0.25)",
            borderRadius: "var(--radius)",
            fontFamily: "var(--font-mono)", fontSize: 12, color: "#f44336",
          }}>{error}</div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: 10 }}>
          <Button variant="primary" icon="plus" full onClick={handleSubmit}>
            {busy ? t("modal.adding") : t("modal.addAccount")}
          </Button>
          <Button variant="ghost" onClick={onClose}>{t("modal.cancel")}</Button>
        </div>

        {/* Hint */}
        <div style={{
          padding: "8px 12px",
          background: "rgba(255,152,0,0.06)",
          border: "1px solid rgba(255,152,0,0.2)",
          borderRadius: "var(--radius)",
          display: "flex", gap: 8, alignItems: "flex-start",
          fontSize: 11.5, color: "var(--fg-4)", lineHeight: 1.5,
        }}>
          <span style={{ color: "#ff9800", display: "inline-flex", flexShrink: 0, marginTop: 1 }}>
            <Icon name="info" size={14} />
          </span>
          <span>{t("modal.hint")}</span>
        </div>
      </div>
    </div>
  );
}

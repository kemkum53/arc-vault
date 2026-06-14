"use client";

import { useEffect, useState } from "react";
import { Icon, Button } from "@/components/ui";
import { useT, useLang } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { assignPendingToken, getAccountOptions, getPendingTokens, type AccountOption, type PendingTokenResponse } from "@/lib/api";

interface Props {
  onClose: () => void;
}

type Tab = "general" | "sync" | "tokens";

function Toggle({ label, on, onChange }: { label: string; on?: boolean; onChange?: (v: boolean) => void }) {
  const [v, setV] = useState(!!on);
  return (
    <div onClick={() => { setV(!v); onChange?.(!v); }} style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "10px 0", cursor: "pointer",
      borderBottom: "1px solid var(--border)",
    }}>
      <span style={{ fontFamily: "var(--font-ui)", fontSize: 13.5, color: "var(--fg-2)" }}>{label}</span>
      <span style={{
        width: 34, height: 18, background: v ? "linear-gradient(135deg, #7b2ff7, #00d2ff)" : "var(--border-strong)",
        borderRadius: 999, position: "relative", transition: "background 220ms", display: "inline-block",
      }}>
        <span style={{
          position: "absolute", top: 2, left: v ? 18 : 2,
          width: 14, height: 14, background: "#fff", borderRadius: 999,
          transition: "left 220ms cubic-bezier(0.16,1,0.3,1)",
        }} />
      </span>
    </div>
  );
}

export function SettingsModal({ onClose }: Props) {
  const t = useT();
  const { lang, setLang } = useLang();
  const { isAdmin } = useAuth();
  const [tab, setTab] = useState<Tab>("general");

  const tabs: { key: Tab; label: string; icon: string }[] = [
    { key: "general", label: t("settings.general"), icon: "settings" },
    { key: "sync", label: t("settings.syncTab"), icon: "refresh-cw" },
  ];
  if (isAdmin) {
    tabs.push({ key: "tokens", label: t("settings.pendingTokens"), icon: "link-2" });
  }

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
          width: 480, maxWidth: "100%", maxHeight: "80vh",
          background: "var(--bg-2)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "0 24px 80px rgba(0,0,0,0.5)",
          display: "flex", flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{
          padding: "16px 20px",
          borderBottom: "1px solid var(--border)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Icon name="settings" size={18} style={{ color: "var(--fg-3)" }} />
            <span style={{
              fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 16, color: "var(--fg-1)",
            }}>{t("settings.title")}</span>
          </div>
          <button onClick={onClose} style={{
            background: "none", border: "none", cursor: "pointer", color: "var(--fg-4)", padding: 4,
          }}>
            <Icon name="x" size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div style={{
          display: "flex", borderBottom: "1px solid var(--border)",
          padding: "0 20px",
        }}>
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "10px 16px",
                background: "none", border: "none", cursor: "pointer",
                fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 12.5,
                color: tab === t.key ? "#7b2ff7" : "var(--fg-4)",
                borderBottom: tab === t.key ? "2px solid #7b2ff7" : "2px solid transparent",
                marginBottom: -1,
                transition: "all 150ms",
              }}
            >
              <Icon name={t.icon} size={14} />
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ padding: "16px 20px", flex: 1, overflowY: "auto" }}>
          {tab === "general" && <GeneralTab lang={lang} setLang={setLang} />}
          {tab === "sync" && <SyncTab />}
          {tab === "tokens" && isAdmin && <PendingTokensTab />}
        </div>
      </div>
    </div>
  );
}

function maskId(value: string | null) {
  if (!value) return "-";
  return `...${value.slice(-8)}`;
}

function formatDate(value: string | null) {
  if (!value) return "-";
  try { return new Date(value).toLocaleString(); } catch { return value; }
}

function accountLabel(account: AccountOption) {
  const name = account.label || account.arctracker_email || account.id;
  const tail = account.embark_user_id ? ` · ...${account.embark_user_id.slice(-8)}` : "";
  return `${name}${tail}`;
}

function PendingTokensTab() {
  const t = useT();
  const [tokens, setTokens] = useState<PendingTokenResponse[]>([]);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    const [pending, accs] = await Promise.all([getPendingTokens(), getAccountOptions()]);
    setTokens(pending);
    setAccounts(accs);
  };

  useEffect(() => {
    load().catch((err) => setMessage(err instanceof Error ? err.message : t("settings.pendingLoadFailed")));
  }, []);

  const assign = async (token: PendingTokenResponse) => {
    const accountId = selected[token.id];
    if (!accountId) return;
    setBusyId(token.id);
    setMessage(null);
    try {
      await assignPendingToken(token.id, accountId);
      setMessage(t("settings.pendingAssigned"));
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : t("settings.pendingAssignFailed"));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{
        padding: "10px 12px",
        background: "rgba(0,210,255,0.06)",
        border: "1px solid rgba(0,210,255,0.18)",
        borderRadius: "var(--radius)",
        fontSize: 12,
        color: "var(--fg-4)",
        lineHeight: 1.5,
      }}>
        {t("settings.pendingHint")}
      </div>

      {tokens.length === 0 ? (
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--fg-5)", padding: "12px 0" }}>
          {t("settings.pendingEmpty")}
        </div>
      ) : tokens.map((token) => (
        <div key={token.id} style={{
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          padding: 12,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          background: "var(--bg-1)",
        }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 14px", fontFamily: "var(--font-mono)", fontSize: 11.5 }}>
            <span style={{ color: "var(--fg-4)" }}>embark_user_id <b style={{ color: "var(--fg-2)" }}>{maskId(token.embark_user_id)}</b></span>
            <span style={{ color: "var(--fg-4)" }}>sub <b style={{ color: "var(--fg-2)" }}>{maskId(token.sub)}</b></span>
            <span style={{ color: "var(--fg-4)" }}>exp <b style={{ color: "var(--fg-2)" }}>{formatDate(token.token_expires_at)}</b></span>
            <span style={{ color: "var(--fg-4)" }}>seen <b style={{ color: "var(--fg-2)" }}>{token.seen_count}</b></span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <select
              value={selected[token.id] || ""}
              onChange={(e) => setSelected((prev) => ({ ...prev, [token.id]: e.target.value }))}
              style={{
                flex: 1,
                background: "var(--bg-input)",
                border: "1px solid var(--border-strong)",
                borderRadius: "var(--radius)",
                color: "var(--fg-2)",
                padding: "8px 10px",
                fontFamily: "var(--font-ui)",
                fontSize: 12,
              }}
            >
              <option value="">{t("settings.selectAccount")}</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>{accountLabel(account)}</option>
              ))}
            </select>
            <Button variant="primary" icon="link-2" onClick={() => assign(token)}>
              {busyId === token.id ? t("settings.assigning") : t("settings.assign")}
            </Button>
          </div>
        </div>
      ))}

      {message && (
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: message.includes("API") ? "#f44336" : "#4caf50" }}>
          {message}
        </div>
      )}
    </div>
  );
}

function GeneralTab({ lang, setLang }: { lang: string; setLang: (l: "tr" | "en") => void }) {
  const t = useT();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 0", borderBottom: "1px solid var(--border)",
      }}>
        <span style={{ fontFamily: "var(--font-ui)", fontSize: 13.5, color: "var(--fg-2)" }}>
          {t("settings.language")}
        </span>
        <div style={{ display: "flex", gap: 4 }}>
          {(["tr", "en"] as const).map((l) => (
            <button
              key={l}
              onClick={() => setLang(l)}
              style={{
                padding: "5px 14px",
                borderRadius: "var(--radius)",
                border: lang === l ? "1px solid rgba(123,47,247,0.4)" : "1px solid var(--border)",
                background: lang === l ? "rgba(123,47,247,0.1)" : "transparent",
                color: lang === l ? "#7b2ff7" : "var(--fg-4)",
                fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600,
                cursor: "pointer",
                transition: "all 150ms",
              }}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 0", borderBottom: "1px solid var(--border)",
      }}>
        <span style={{ fontFamily: "var(--font-ui)", fontSize: 13.5, color: "var(--fg-2)" }}>
          {t("settings.version")}
        </span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--fg-5)" }}>
          v1.0.0
        </span>
      </div>
    </div>
  );
}

function SyncTab() {
  const t = useT();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <Toggle label={t("set.autoSync")} on />
      <Toggle label={t("set.questNotify")} on />
      <Toggle label={t("set.tokenWarn")} on />
      <Toggle label={t("set.telemetry")} />
    </div>
  );
}

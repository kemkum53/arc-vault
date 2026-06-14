"use client";

import { useState } from "react";
import { Icon } from "@/components/ui";
import { useT } from "@/lib/i18n";
import type { AccountResponse } from "@/lib/types";

interface AccountCardProps {
  account: AccountResponse;
  onClick: () => void;
  onSync?: (id: string) => Promise<void>;
  status?: string;
}

function timeSince(isoDate: string, t: ReturnType<typeof useT>): string {
  try {
    const diff = Date.now() - new Date(isoDate).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return t("time.justNow");
    if (mins < 60) return `${mins} ${t("time.minutesAgo")}`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} ${t("time.hoursAgo")}`;
    return `${Math.floor(hours / 24)} ${t("time.daysAgo")}`;
  } catch {
    return "?";
  }
}

export function AccountCard({ account, onClick, onSync, status }: AccountCardProps) {
  const t = useT();
  const [syncing, setSyncing] = useState(false);
  const embarkName = account.display_name;
  const disc = account.display_name_discriminator || "0000";
  const expired = account.is_token_expired ?? false;
  const apiSyncing = account.sync_status === "syncing";
  const busy = status || (syncing || apiSyncing ? "syncing" : null);

  const handleSync = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (syncing || !onSync) return;
    setSyncing(true);
    try { await onSync(account.id); } finally { setSyncing(false); }
  };

  return (
    <div
      style={{
        background: "var(--bg-2)",
        border: `1px solid ${busy === "syncing" ? "rgba(0,210,255,0.35)" : "var(--border)"}`,
        boxShadow: busy === "syncing" ? "0 0 16px rgba(0,210,255,0.1)" : undefined,
        borderRadius: "var(--radius-md)",
        padding: "20px 22px",
        transition: "all 200ms cubic-bezier(0.16,1,0.3,1)",
        display: "flex",
        flexDirection: "column",
        gap: 14,
        position: "relative",
        overflow: "hidden",
      }}
      onMouseEnter={(e) => {
        if (!busy) {
          (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(123,47,247,0.4)";
          (e.currentTarget as HTMLDivElement).style.boxShadow = "0 8px 32px rgba(123,47,247,0.12), 0 0 0 1px rgba(123,47,247,0.15)";
        }
        (e.currentTarget as HTMLDivElement).style.transform = "translateY(-2px)";
      }}
      onMouseLeave={(e) => {
        if (!busy) {
          (e.currentTarget as HTMLDivElement).style.borderColor = "var(--border)";
          (e.currentTarget as HTMLDivElement).style.boxShadow = "none";
        }
        (e.currentTarget as HTMLDivElement).style.transform = "translateY(0)";
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{
          width: 42, height: 42, borderRadius: "var(--radius)",
          background: "linear-gradient(135deg, #7b2ff7, #00d2ff)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16, color: "#fff",
          flexShrink: 0,
        }}>
          {(embarkName || "?")[0]?.toUpperCase()}
        </div>
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
          <span style={{
            fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 14, color: "var(--fg-1)",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {embarkName || "?"}
            {embarkName && <span style={{ color: "var(--fg-5)", fontWeight: 400 }}>#{disc}</span>}
          </span>
          <span style={{
            fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-4)",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {account.embark_user_id ? `Embark ...${account.embark_user_id.slice(-8)}` : ""}
          </span>
        </div>
        {/* Per-card actions */}
        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          {onSync && (
            <button onClick={handleSync} className="av-icon-btn"
              title={t("card.sync")}
              style={{ width: 30, height: 30, padding: 0 }}>
              <Icon name="recycle" size={14}
                style={syncing ? { animation: "av-spin 1s linear infinite" } : undefined} />
            </button>
          )}
        </div>
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: "var(--border)" }} />

      {/* Stats + Open button */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px", flex: 1 }}>
          <MiniStat label={t("card.token")}
            value={expired ? "EXPIRED" : "VALID"}
            accent={expired ? "#f44336" : "#4caf50"} />
          <MiniStat label={t("card.lastSync")} value={account.last_sync_at ? timeSince(account.last_sync_at, t) : "-"} />
          <MiniStat label={t("card.totalValue")} value={account.total_value != null ? account.total_value.toLocaleString() : "-"} />
        </div>
        <button
          onClick={onClick}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "8px 14px",
            background: "rgba(123,47,247,0.1)",
            border: "1px solid rgba(123,47,247,0.25)",
            borderRadius: "var(--radius)",
            color: "#7b2ff7",
            fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 12,
            cursor: "pointer",
            transition: "all 150ms",
            flexShrink: 0,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = "rgba(123,47,247,0.2)";
            (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(123,47,247,0.5)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = "rgba(123,47,247,0.1)";
            (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(123,47,247,0.25)";
          }}
        >
          {t("card.open")}
          <Icon name="chevron-right" size={13} />
        </button>
      </div>

      {/* Progress bar */}
      {busy && (
        <div style={{
          position: "absolute", bottom: 0, left: 0, right: 0, height: 3,
          background: "rgba(255,255,255,0.03)", overflow: "hidden",
        }}>
          <div style={{
            width: "40%", height: "100%",
            background: busy === "syncing"
              ? "linear-gradient(90deg, transparent, #00d2ff, transparent)"
              : "linear-gradient(90deg, transparent, #00d2ff, transparent)",
            animation: "av-sweep 1.2s ease-in-out infinite",
          }} />
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{
        fontFamily: "var(--font-ui)", fontSize: 10.5, color: "var(--fg-5)",
        textTransform: "uppercase", letterSpacing: "0.1em",
      }}>{label}</span>
      <span style={{
        fontFamily: "var(--font-mono)", fontSize: 13, color: accent || "var(--fg-2)",
        fontWeight: 500,
      }}>{value}</span>
    </div>
  );
}

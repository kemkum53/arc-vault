"use client";

import { Icon } from "@/components/ui";
import { useT } from "@/lib/i18n";
import type { DisplayAccount } from "@/lib/types";

interface TopbarProps {
  title: string;
  subtitle?: string;
  account: DisplayAccount;
  onSync: () => void;
  syncing: boolean;
  syncProgress: number;
}

export function Topbar({ title, subtitle, account, onSync, syncing }: TopbarProps) {
  const t = useT();

  return (
    <header style={{
      height: 56, flexShrink: 0,
      borderBottom: "1px solid var(--border)",
      background: "var(--bg-1)",
      display: "flex", alignItems: "center",
      padding: "0 28px", gap: 14,
      position: "sticky", top: 0, zIndex: 10,
    }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <h1 style={{
          margin: 0, fontFamily: "var(--font-display)", fontWeight: 700,
          fontSize: 18, color: "var(--fg-1)", letterSpacing: "0.02em",
        }}>{title}</h1>
        {subtitle && (
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--fg-5)" }}>{subtitle}</span>
        )}
      </div>

      <div style={{ flex: 1 }} />

      <button
        onClick={onSync}
        disabled={syncing}
        style={{
          display: "flex", alignItems: "center", gap: 7,
          padding: "7px 14px",
          background: syncing
            ? "rgba(0,210,255,0.06)"
            : "rgba(123,47,247,0.06)",
          border: `1px solid ${syncing ? "rgba(0,210,255,0.2)" : "rgba(123,47,247,0.18)"}`,
          borderRadius: "var(--radius)",
          color: syncing ? "#00d2ff" : "var(--fg-3)",
          fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 12,
          cursor: syncing ? "default" : "pointer",
          transition: "all 200ms",
          whiteSpace: "nowrap",
        }}
        onMouseEnter={(e) => {
          if (!syncing) {
            (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(123,47,247,0.4)";
            (e.currentTarget as HTMLButtonElement).style.color = "#b388ff";
            (e.currentTarget as HTMLButtonElement).style.background = "rgba(123,47,247,0.1)";
          }
        }}
        onMouseLeave={(e) => {
          if (!syncing) {
            (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(123,47,247,0.18)";
            (e.currentTarget as HTMLButtonElement).style.color = "var(--fg-3)";
            (e.currentTarget as HTMLButtonElement).style.background = "rgba(123,47,247,0.06)";
          }
        }}
      >
        <Icon name="recycle" size={14} style={syncing ? { animation: "av-spin 1.2s linear infinite" } : undefined} />
        {syncing ? t("topbar.syncing") : t("topbar.sync")}
      </button>

      {/* sync progress line */}
      <div style={{
        position: "absolute", left: 0, right: 0, bottom: -1, height: 2, overflow: "hidden",
        opacity: syncing ? 1 : 0,
        transition: "opacity 500ms ease",
        pointerEvents: "none",
      }}>
        <div style={{
          position: "absolute", top: 0, bottom: 0, width: "40%",
          background: "linear-gradient(90deg, transparent 0%, #00d2ff 30%, #7b2ff7 70%, transparent 100%)",
          animation: syncing ? "av-sweep 1.6s ease-in-out infinite" : "none",
        }} />
      </div>
    </header>
  );
}

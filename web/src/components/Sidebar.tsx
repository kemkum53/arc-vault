"use client";

import { Icon, Wordmark } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useT, useLang } from "@/lib/i18n";
import type { DisplayAccount, DisplaySyncSummary } from "@/lib/types";

interface SidebarProps {
  active: string;
  onChange: (id: string) => void;
  account: DisplayAccount;
  syncSummary?: DisplaySyncSummary;
  onBack?: () => void;
}

function SidebarItem({ item, active, onClick }: {
  item: { id: string; label: string; icon: string; count?: string };
  active: boolean;
  onClick: () => void;
}) {
  return (
    <div onClick={onClick} style={{
      position: "relative",
      display: "flex", alignItems: "center", gap: 10,
      padding: "9px 12px",
      borderRadius: "var(--radius)",
      color: active ? "var(--fg-1)" : "var(--fg-3)",
      background: active ? "linear-gradient(90deg, rgba(123,47,247,0.18), rgba(0,210,255,0.06))" : "transparent",
      fontFamily: "var(--font-ui)", fontWeight: 500, fontSize: 13.5,
      cursor: "pointer",
      transition: "all 180ms cubic-bezier(0.16,1,0.3,1)",
    }}
    onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.03)"; }}
    onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
    >
      {active && (
        <span style={{
          position: "absolute", left: 0, top: 7, bottom: 7, width: 2,
          background: "linear-gradient(180deg, #7b2ff7, #00d2ff)", borderRadius: 2,
        }} />
      )}
      <Icon name={item.icon} size={18} />
      <span style={{ flex: 1 }}>{item.label}</span>
      {item.count && (
        <span style={{
          fontFamily: "var(--font-mono)", fontSize: 11,
          color: active ? "#00d2ff" : "var(--fg-5)",
        }}>{item.count}</span>
      )}
    </div>
  );
}

export function Sidebar({ active, onChange, account, syncSummary, onBack }: SidebarProps) {
  const { isAdmin, logout, user } = useAuth();
  const t = useT();
  const { lang, setLang } = useLang();

  const items = [
    { id: "dashboard", label: t("nav.dashboard"),  icon: "layout-dashboard" },
    { id: "inventory", label: t("nav.inventory"),   icon: "boxes",          count: syncSummary ? String(syncSummary.syncedItems) : undefined },
    { id: "quests",    label: t("nav.quests"),      icon: "target",         count: syncSummary ? String(syncSummary.syncedQuests) : undefined },
    { id: "blueprints",label: t("nav.blueprints"),  icon: "scroll-text",    count: syncSummary ? String(syncSummary.syncedBlueprints) : undefined },
    { id: "hideout",   label: t("nav.hideout"),     icon: "warehouse" },
    { id: "projects",  label: t("nav.projects"),    icon: "clipboard-list", count: syncSummary ? String(syncSummary.syncedProjects) : undefined },
  ];
  const footerItems = [
    ...(isAdmin ? [{ id: "settings",  label: t("nav.settings"),    icon: "settings-2" }] : []),
  ];

  return (
    <aside style={{
      width: 240, flexShrink: 0,
      background: "var(--bg-2)",
      borderRight: "1px solid var(--border)",
      display: "flex", flexDirection: "column",
      padding: "20px 14px",
      gap: 4,
      height: "100vh",
      position: "sticky", top: 0,
    }}>
      <div style={{ padding: "4px 8px 18px", borderBottom: "1px solid var(--border)", marginBottom: 10 }}>
        <div
          onClick={onBack}
          style={{ cursor: onBack ? "pointer" : "default" }}
          title={onBack ? t("nav.allAccounts") : undefined}
        >
          <Wordmark size={18} />
        </div>
      </div>

      {/* Character info */}
      <div style={{
        padding: "10px 12px",
        background: "var(--bg-3)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        display: "flex", alignItems: "center", gap: 10,
        marginBottom: 12,
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: "var(--radius)",
          background: "linear-gradient(135deg, #7b2ff7, #00d2ff)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 13, color: "#fff",
          flexShrink: 0,
        }}>{account.displayName?.[0]?.toUpperCase() || "?"}</div>
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <span style={{
            fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 13, color: "var(--fg-1)",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {account.displayName}
            <span style={{ color: "var(--fg-5)", fontWeight: 400 }}>#{account.discriminator}</span>
          </span>
          <span style={{
            fontFamily: "var(--font-mono)", fontSize: 10, color: account.isTokenExpired ? "#f44336" : "#4caf50",
            textTransform: "uppercase", letterSpacing: "0.1em",
          }}>{account.isTokenExpired ? "EXPIRED" : "VALID"}</span>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {items.map(item => (
          <SidebarItem key={item.id} item={item} active={active === item.id} onClick={() => onChange(item.id)} />
        ))}
      </div>

      <div style={{ flex: 1 }} />

      {footerItems.map(item => (
        <SidebarItem key={item.id} item={item} active={active === item.id} onClick={() => onChange(item.id)} />
      ))}

      {/* Language toggle */}
      <button
        onClick={() => setLang(lang === "tr" ? "en" : "tr")}
        style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          padding: "7px 0",
          background: "transparent",
          border: "1px solid var(--border-strong)",
          borderRadius: "var(--radius)",
          cursor: "pointer",
          fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600,
          color: "var(--fg-3)",
          transition: "all 180ms",
          marginBottom: 6,
        }}
      >
        <Icon name="languages" size={14} />
        {lang === "tr" ? "EN" : "TR"}
      </button>

      <div style={{
        padding: "12px",
        background: "var(--bg-3)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        display: "flex", alignItems: "center", gap: 10,
      }}>
        <div style={{
          width: 34, height: 34, borderRadius: "var(--radius)",
          background: user?.role === "admin"
            ? "linear-gradient(135deg, #7b2ff7, #5a1fd0)"
            : "linear-gradient(135deg, #00d2ff, #0090b0)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 14, color: "#fff",
        }}>{user?.username?.[0]?.toUpperCase() || "?"}</div>
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
          <span style={{
            fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 13, color: "var(--fg-1)",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>{user?.username}</span>
          <span style={{
            fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-5)",
            textTransform: "uppercase", letterSpacing: "0.1em",
          }}>{user?.role}</span>
        </div>
        <button onClick={logout} title={t("nav.logout")} className="av-icon-btn" style={{ width: 28, height: 28, flexShrink: 0 }}>
          <Icon name="log-out" size={14} />
        </button>
      </div>
    </aside>
  );
}

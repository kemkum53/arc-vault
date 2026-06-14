"use client";

import { Icon, Chip } from "@/components/ui";
import { useT } from "@/lib/i18n";
import type { DisplayHideoutModule } from "@/lib/types";

interface HideoutScreenProps {
  modules: DisplayHideoutModule[];
}

function LevelDots({ level, max, upgrading }: { level: number; max: number; upgrading?: boolean }) {
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center", flex: 1 }}>
      {Array.from({ length: max }).map((_, i) => {
        const filled = i < level;
        const next = i === level && upgrading;
        return (
          <span key={i} style={{
            flex: 1, height: 6, borderRadius: 2,
            background: filled ? "linear-gradient(90deg, #00d2ff, #7b2ff7)"
              : next ? "repeating-linear-gradient(90deg, rgba(0,210,255,0.5) 0 4px, transparent 4px 8px)"
              : "rgba(255,255,255,0.05)",
            border: next ? "1px solid rgba(0,210,255,0.3)" : "1px solid transparent",
          }} />
        );
      })}
    </div>
  );
}

function ModuleCard({ module: m }: { module: DisplayHideoutModule }) {
  const t = useT();
  const tone = m.locked ? "neutral" as const : (m.upgrading ? "info" as const : (m.level === m.max ? "success" as const : "brand" as const));
  return (
    <div style={{
      background: "var(--bg-2)",
      border: `1px solid ${m.upgrading ? "rgba(0,210,255,0.35)" : "var(--border)"}`,
      borderRadius: "var(--radius-md)", padding: "16px 18px",
      display: "flex", flexDirection: "column", gap: 12,
      opacity: m.locked ? 0.55 : 1, position: "relative", overflow: "hidden",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{
          width: 44, height: 44, borderRadius: "var(--radius)",
          background: m.locked ? "rgba(255,255,255,0.04)" : "rgba(0,210,255,0.10)",
          border: `1px solid ${m.locked ? "var(--border)" : "rgba(0,210,255,0.30)"}`,
          color: m.locked ? "var(--fg-5)" : "#00d2ff",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <Icon name={m.icon} size={20} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 14, color: "var(--fg-1)" }}>{m.name}</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-5)", letterSpacing: "0.04em" }}>{m.id}</span>
        </div>
        {m.locked
          ? <Icon name="lock" size={16} style={{ color: "var(--fg-5)" }} />
          : <Chip tone={tone}>Lv {m.level}/{m.max}</Chip>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <LevelDots level={m.level} max={m.max} upgrading={m.upgrading} />
      </div>
      {m.upgrading && (
        <div style={{
          padding: "8px 10px", background: "rgba(0,210,255,0.06)",
          border: "1px solid rgba(0,210,255,0.25)", borderRadius: "var(--radius-sm)",
          display: "flex", alignItems: "center", gap: 8,
          fontFamily: "var(--font-mono)", fontSize: 11.5, color: "#00d2ff",
        }}>
          <Icon name="refresh-cw" size={14} />
          <span>{t("hideout.upgrading")} → Lv {m.level + 1}</span>
          {m.eta && <span style={{ marginLeft: "auto", color: "var(--fg-4)" }}>ETA {m.eta}</span>}
        </div>
      )}
      {m.locked && (
        <div style={{
          padding: "8px 10px", background: "rgba(255,152,0,0.06)",
          border: "1px solid rgba(255,152,0,0.25)", borderRadius: "var(--radius-sm)",
          display: "flex", alignItems: "center", gap: 8,
          fontFamily: "var(--font-mono)", fontSize: 11.5, color: "#ff9800",
        }}>
          <Icon name="lock" size={14} />
          <span>{t("hideout.notUnlocked")}</span>
        </div>
      )}
    </div>
  );
}

export function HideoutScreen({ modules }: HideoutScreenProps) {
  const t = useT();
  const installed = modules.filter(m => !m.locked);
  const locked = modules.filter(m => m.locked);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{
        background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)",
        padding: "18px 20px", display: "flex", alignItems: "center", gap: 22,
      }}>
        <div style={{
          width: 56, height: 56, borderRadius: "var(--radius)",
          background: "linear-gradient(135deg, rgba(123,47,247,0.25), rgba(0,210,255,0.18))",
          border: "1px solid rgba(123,47,247,0.4)",
          display: "flex", alignItems: "center", justifyContent: "center", color: "#00d2ff",
        }}>
          <Icon name="warehouse" size={26} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 20, color: "var(--fg-1)" }}>{t("hideout.title")}</h2>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--fg-4)" }}>
            {installed.length} {t("hideout.modulesInstalled")} · {locked.length} {t("hideout.locked")}
          </span>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <Chip tone="info">{modules.filter(m => m.upgrading).length} upgrading</Chip>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
        {modules.map(m => <ModuleCard key={m.id} module={m} />)}
      </div>
      {modules.length === 0 && (
        <div style={{ textAlign: "center", padding: 40, fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--fg-5)" }}>
          {t("hideout.empty")}
        </div>
      )}
    </div>
  );
}

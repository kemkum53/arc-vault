"use client";

import { useState, useEffect } from "react";
import { Icon, Chip, StatCard, ProgressBar } from "@/components/ui";
import { TRADERS, RARITY } from "@/lib/constants";
import { useT, useLang } from "@/lib/i18n";
import type { DashboardData, DisplayQuest, DisplayProject, TraderKey } from "@/lib/types";

function Countdown({ target }: { target: string }) {
  const { lang } = useLang();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const diff = new Date(target).getTime() - now;
  if (diff <= 0) return <span style={{ color: "#f44336" }}>{lang === "en" ? "Expired" : "Süresi doldu"}</span>;
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  const parts: string[] = [];
  if (lang === "en") {
    if (d > 0) parts.push(`${d}d`);
    parts.push(`${h}h`, `${String(m).padStart(2, "0")}m`, `${String(s).padStart(2, "0")}s`);
  } else {
    if (d > 0) parts.push(`${d}g`);
    parts.push(`${h}s`, `${String(m).padStart(2, "0")}dk`, `${String(s).padStart(2, "0")}sn`);
  }
  return <>{parts.join(" ")}</>;
}

interface DashboardScreenProps {
  data: DashboardData;
  syncing: boolean;
  syncProgress: number;
  onGoTo: (id: string) => void;
}

function Panel({ title, subtitle, action, children }: {
  title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section style={{
      background: "var(--bg-2)", border: "1px solid var(--border)",
      borderRadius: "var(--radius-md)", padding: "16px 18px",
      display: "flex", flexDirection: "column", gap: 14,
    }}>
      <header style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <h3 style={{ margin: 0, fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 16, color: "var(--fg-1)", letterSpacing: "0.01em" }}>{title}</h3>
        {subtitle && <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-5)" }}>{subtitle}</span>}
        {action && <div style={{ marginLeft: "auto" }}>{action}</div>}
      </header>
      {children}
    </section>
  );
}

function SyncRing({ active }: { active: boolean }) {
  return (
    <div style={{
      width: 44, height: 44, borderRadius: "50%",
      background: active
        ? "conic-gradient(from -90deg, #00d2ff 0deg, #7b2ff7 270deg, rgba(255,255,255,0.06) 270deg 360deg)"
        : "conic-gradient(from -90deg, #4caf50 0deg, #4caf50 360deg)",
      display: "flex", alignItems: "center", justifyContent: "center",
      boxShadow: active ? "0 0 0 1px rgba(123,47,247,0.4), 0 0 18px rgba(0,210,255,0.18)" : "0 0 0 1px rgba(76,175,80,0.35)",
      animation: active ? "av-spin 2.2s linear infinite" : "none", flexShrink: 0,
    }}>
      <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--bg-2)",
        display: "flex", alignItems: "center", justifyContent: "center", color: active ? "#00d2ff" : "#4caf50" }}>
        <Icon name={active ? "refresh-cw" : "check-circle-2"} size={16} />
      </div>
    </div>
  );
}

function SyncStat({ label, value }: { label: string; value: number }) {
  return (
    <div style={{
      padding: "8px 10px", background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)",
      borderRadius: "var(--radius-sm)", display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
    }}>
      <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, color: "#00d2ff", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{value}</span>
      <span style={{ fontFamily: "var(--font-ui)", fontWeight: 500, fontSize: 10, color: "var(--fg-5)", textTransform: "uppercase", letterSpacing: "0.14em" }}>{label}</span>
    </div>
  );
}

function QuestRow({ quest }: { quest: DisplayQuest }) {
  const trader = TRADERS[quest.trader as TraderKey] || { color: "var(--fg-3)", name: quest.traderName };
  const pct = quest.target > 0 ? (quest.progress / quest.target) * 100 : 0;
  return (
    <div style={{
      padding: "10px 12px", background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)",
      borderLeft: `2px solid ${trader.color}`, borderRadius: "var(--radius-sm)",
      display: "flex", flexDirection: "column", gap: 8,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: trader.color, textTransform: "uppercase", letterSpacing: "0.14em" }}>{trader.name}</span>
        <span style={{ fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 13, color: "var(--fg-1)" }}>{quest.name}</span>
        <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-4)" }}>
          {quest.progress.toLocaleString()}/{quest.target.toLocaleString()}
        </span>
      </div>
      <ProgressBar value={pct} accent={trader.color} height={4} />
    </div>
  );
}

function ProjectMini({ project }: { project: DisplayProject }) {
  const phasePct = project.phaseCount > 0 ? ((project.phase - 1) / project.phaseCount) * 100 : 0;
  return (
    <div style={{
      padding: "14px", background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)",
      borderRadius: "var(--radius-sm)", display: "flex", flexDirection: "column", gap: 10,
    }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 14, color: "var(--fg-1)" }}>{project.name}</span>
        <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-4)" }}>
          phase {project.phase} / {project.phaseCount}
        </span>
      </div>
      <ProgressBar value={phasePct} accent="gradient" height={4} />
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {project.goals.map(g => (
          <div key={g.name} style={{
            display: "grid", gridTemplateColumns: "1fr auto auto", gap: 10, alignItems: "center",
            fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--fg-3)",
          }}>
            <span style={{ color: g.have >= g.need ? "#4caf50" : "var(--fg-3)" }}>{g.name}</span>
            <span style={{ color: "var(--fg-4)" }}>{g.have}/{g.need}</span>
            <span style={{ width: 60 }}>
              <ProgressBar value={g.need > 0 ? (g.have / g.need) * 100 : 0} accent={g.have >= g.need ? "#4caf50" : "gradient"} height={3} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DashboardScreen({ data, syncing, syncProgress, onGoTo }: DashboardScreenProps) {
  const t = useT();
  const { account, economy: E, syncSummary: S, inventory, quests, projects } = data;
  const slotsPct = E.maxSlots > 0 ? (E.usedSlots / E.maxSlots) * 100 : 0;
  const activeQuests = quests.filter(q => !q.completed);

  const weaponGroups = (() => {
    const map = new Map<string, { item: typeof inventory[0]; count: number }>();
    for (const item of inventory) {
      if (item.category !== "weapons") continue;
      const key = item.baseId;
      const existing = map.get(key);
      if (existing) {
        existing.count += item.q;
      } else {
        map.set(key, { item, count: item.q });
      }
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  })();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      {/* Hero greeting */}
      <div style={{
        padding: "22px 26px",
        backgroundImage: "linear-gradient(135deg, rgba(123,47,247,0.10), rgba(0,210,255,0.04) 60%, transparent)",
        backgroundColor: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)",
        display: "flex", gap: 24, alignItems: "center", position: "relative", overflow: "hidden",
      }}>
        <div style={{
          width: 80, height: 80, flexShrink: 0,
          backgroundImage: "url('/arc_vault_logo.png')", backgroundSize: "contain", backgroundRepeat: "no-repeat", backgroundPosition: "center",
          filter: "drop-shadow(0 0 14px rgba(0,210,255,0.25))",
        }} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="t-label">{t("dash.welcome")}</span>
          <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 26, color: "var(--fg-1)", letterSpacing: "0.02em" }}>
            {account.displayName}<span style={{ color: "var(--fg-5)", fontWeight: 400 }}>#{account.discriminator}</span>
          </h2>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--fg-4)" }}>
            {S.syncedItems} items · {S.syncedBlueprints} blueprints · {S.syncedQuests} quests
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
          <Chip tone={account.isTokenExpired ? "danger" : "success"} icon={account.isTokenExpired ? "triangle-alert" : "check-circle-2"}>
            {account.isTokenExpired ? t("dash.tokenExpired") : t("dash.tokenValid")}
          </Chip>
          {account.tokenExpiresAt && (
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--fg-5)" }}>
              {t("dash.expires")} <Countdown target={account.tokenExpiresAt} />
            </span>
          )}
        </div>
      </div>

      {/* Stat row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        <StatCard label={t("dash.credits")} value={E.credits.toLocaleString()} meta={t("dash.allSources")}
          footer={<ProgressBar value={68} accent="gradient" />} />
        <StatCard label={t("dash.raiderTokens")} value={E.raiderTokens.toLocaleString()} meta={t("dash.weeklyCap")}
          footer={<ProgressBar value={E.raiderTokens} max={1000} accent="#b06bff" />} />
        <StatCard label={t("dash.stash")} value={`${E.usedSlots}/${E.maxSlots}`} unit={t("dash.slots")}
          accent={slotsPct > 95 ? "#ff9800" : "var(--fg-1)"} meta={slotsPct > 95 ? t("dash.nearlyFull") : ""}
          footer={<ProgressBar value={slotsPct} accent={slotsPct > 95 ? "#ff9800" : "gradient"} />} />
        <StatCard label="XP" value={E.xp > 0 ? (E.xp / 1000).toFixed(0) : "0"} unit="k"
          footer={<ProgressBar value={62} accent="gradient" />} />
      </div>

      {/* Sync summary band */}
      <div style={{
        background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)",
        padding: "16px 20px", display: "flex", alignItems: "center", gap: 22,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <SyncRing active={syncing} />
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 14, color: "var(--fg-1)" }}>
              {syncing ? t("dash.syncRunning") : t("dash.synced")}
            </span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-4)" }}>
              5 endpoint · parallel · {syncing ? `${syncProgress}%` : `${S.unmappedCount} unmapped`}
            </span>
          </div>
        </div>
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
          <SyncStat label="items" value={S.syncedItems} />
          <SyncStat label="blueprints" value={S.syncedBlueprints} />
          <SyncStat label="quests" value={S.syncedQuests} />
          <SyncStat label="hideout" value={S.syncedHideout} />
          <SyncStat label="projects" value={S.syncedProjects} />
        </div>
        {S.unmappedCount > 0 && <Chip tone="warning">{S.unmappedCount} unmapped</Chip>}
      </div>

      {/* Bottom grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16 }}>
        <Panel title={t("dash.weapons")} subtitle={`${weaponGroups.length} ${t("dash.weaponTypes")}`}
          action={<button onClick={() => onGoTo("inventory")} className="av-link">{t("dash.openInventory")} <Icon name="arrow-up-right" size={13} /></button>}>
          {weaponGroups.length > 0 ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8 }}>
              {weaponGroups.map(({ item, count }) => {
                const rc = RARITY[item.r as import("@/lib/types").Rarity] || RARITY.common;
                return (
                  <div key={item.baseId} style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "8px 10px",
                    background: "rgba(255,255,255,0.02)",
                    border: `1px solid ${rc.border}`,
                    borderRadius: "var(--radius-sm)",
                  }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: "var(--radius-sm)", flexShrink: 0,
                      background: `radial-gradient(circle at 50% 45%, ${rc.glow}, transparent 70%), #0a0a0f`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      overflow: "hidden",
                    }}>
                      {item.image ? (
                        <img src={item.image} alt="" style={{ width: "80%", height: "80%", objectFit: "contain" }} />
                      ) : (
                        <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 12, color: rc.color }}>{item.glyph}</span>
                      )}
                    </div>
                    <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column" }}>
                      <span style={{
                        fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 12, color: rc.color,
                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                      }}>{item.n}</span>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--fg-4)" }}>
                        x{count}{item.t ? ` · T${item.t}` : ""}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--fg-5)" }}>{t("dash.noWeapons")}</span>
          )}
        </Panel>

        <Panel title={t("dash.activeQuests")} subtitle={`${activeQuests.length} in progress`}
          action={<button onClick={() => onGoTo("quests")} className="av-link">{t("dash.viewAll")} <Icon name="arrow-up-right" size={13} /></button>}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {activeQuests.slice(0, 4).map(q => <QuestRow key={q.id} quest={q} />)}
            {activeQuests.length === 0 && (
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--fg-5)" }}>{t("dash.noActiveQuests")}</span>
            )}
          </div>
        </Panel>
      </div>

      {/* Projects */}
      {projects.length > 0 && (
        <Panel title={t("dash.activeProjects")} subtitle="hideout build queue"
          action={<button onClick={() => onGoTo("projects")} className="av-link">{t("dash.viewAll")} <Icon name="arrow-up-right" size={13} /></button>}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            {projects.map(p => <ProjectMini key={p.id} project={p} />)}
          </div>
        </Panel>
      )}
    </div>
  );
}

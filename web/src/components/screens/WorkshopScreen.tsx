"use client";

import { useState, useEffect, useMemo } from "react";
import { Icon, Chip } from "@/components/ui";
import { getWorkshopProgress } from "@/lib/api";
import type { WorkshopProgressResponse, WorkshopEntry, WorkshopItem, WorkshopAccountInfo } from "@/lib/types";

const CDN_BASE = "https://cdn.arctracker.io/items/";
const STORAGE_KEY_ACCOUNT = "arc_vault_workshop_account";

function accLabel(acc: WorkshopAccountInfo): string {
  const name = acc.display_name ?? acc.id.slice(0, 8);
  return acc.discriminator ? `${name}#${acc.discriminator}` : name;
}

function levelCanDo(items: WorkshopItem[], inventory: Record<string, number>): number {
  if (!items.length) return 0;
  return items.every(i => (inventory[i.item_id] ?? 0) >= i.required_per_account) ? 1 : 0;
}

interface SummaryItem {
  item_id: string;
  name: string;
  required: number;
  have: number;
  missing: number;
  sources: string[];
}

function buildSummary(
  workshops: Record<string, WorkshopEntry>,
  inventory: Record<string, number>,
): SummaryItem[] {
  const map: Record<string, { name: string; total: number; sources: string[] }> = {};
  for (const [wsName, ws] of Object.entries(workshops)) {
    for (const [lvNum, level] of Object.entries(ws.levels)) {
      for (const item of level.items) {
        if (!map[item.item_id]) map[item.item_id] = { name: item.name, total: 0, sources: [] };
        map[item.item_id].total += item.required_per_account;
        map[item.item_id].sources.push(`${wsName} Lv${lvNum}`);
      }
    }
  }
  return Object.entries(map)
    .map(([item_id, d]) => ({
      item_id,
      name: d.name,
      required: d.total,
      have: inventory[item_id] ?? 0,
      missing: Math.max(0, d.total - (inventory[item_id] ?? 0)),
      sources: d.sources,
    }))
    .sort((a, b) => b.missing - a.missing || a.name.localeCompare(b.name));
}

// ─── Hesap seçici ────────────────────────────────────────────────────────────

function AccountSelector({ accounts, selectedId, onChange }: {
  accounts: WorkshopAccountInfo[];
  selectedId: string;
  onChange: (id: string) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
      <Icon name="user" size={11} style={{ color: "var(--fg-5)", flexShrink: 0 }} />
      <select
        value={selectedId}
        onChange={e => onChange(e.target.value)}
        style={{
          background: "var(--bg-3)", border: "1px solid var(--border-strong)",
          borderRadius: "var(--radius-sm)", color: "var(--fg-1)",
          fontFamily: "var(--font-ui)", fontSize: 11.5,
          padding: "2px 6px", height: 24, cursor: "pointer", outline: "none",
          maxWidth: 160,
        }}
      >
        {accounts.map(acc => (
          <option key={acc.id} value={acc.id}>{accLabel(acc)}</option>
        ))}
      </select>
    </div>
  );
}

// ─── Özet: compact satır ────────────────────────────────────────────────────

function SummaryRow({ item }: { item: SummaryItem }) {
  const pct = item.required > 0 ? Math.min(100, (item.have / item.required) * 100) : 100;
  const ok = item.missing === 0;
  const color = ok ? "#4caf50" : item.have > 0 ? "#ff9800" : "#f44336";

  return (
    <div
      title={item.sources.join(", ")}
      style={{
        display: "flex", flexDirection: "column", gap: 6, padding: "8px 10px",
        background: "var(--bg-2)", border: `1px solid ${ok ? "rgba(76,175,80,0.18)" : "var(--border)"}`,
        borderRadius: "var(--radius-md)", opacity: ok ? 0.6 : 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <img
          src={`${CDN_BASE}${item.item_id}.png`} alt=""
          width={20} height={20}
          style={{ flexShrink: 0, borderRadius: 3, objectFit: "contain", background: "rgba(255,255,255,0.04)" }}
          onError={e => { (e.target as HTMLImageElement).style.visibility = "hidden"; }}
        />
        <span style={{ fontFamily: "var(--font-ui)", fontSize: 11.5, color: "var(--fg-2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {item.name}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div style={{ flex: 1, height: 3, background: "rgba(255,255,255,0.06)", borderRadius: 2, overflow: "hidden", minWidth: 0 }}>
          <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 2 }} />
        </div>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color, flexShrink: 0, whiteSpace: "nowrap" }}>
          {item.have}<span style={{ color: "var(--fg-5)" }}>/{item.required}</span>
          {item.missing > 0 && <span style={{ color: "#f44336" }}> -{item.missing}</span>}
        </span>
      </div>
    </div>
  );
}

function SummaryTab({ summary }: { summary: SummaryItem[] }) {
  const [search, setSearch] = useState("");
  const filtered = search ? summary.filter(i => i.name.toLowerCase().includes(search.toLowerCase())) : summary;
  const nMissing = filtered.filter(i => i.missing > 0).length;
  const nOk = filtered.filter(i => i.missing === 0).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 6, background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "0 10px", height: 28 }}>
          <Icon name="search" size={12} style={{ color: "var(--fg-5)" }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="İtem ara..."
            style={{ flex: 1, background: "none", border: "none", outline: "none", fontFamily: "var(--font-ui)", fontSize: 12, color: "var(--fg-1)" }} />
        </div>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#f44336", whiteSpace: "nowrap" }}>{nMissing} eksik</span>
        <span style={{ color: "var(--fg-6)" }}>·</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#4caf50", whiteSpace: "nowrap" }}>{nOk} tamam</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
        {filtered.map(item => <SummaryRow key={item.item_id} item={item} />)}
        {filtered.length === 0 && (
          <span style={{ gridColumn: "1/-1", fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--fg-5)", textAlign: "center", padding: 16 }}>Sonuç yok</span>
        )}
      </div>
    </div>
  );
}

// ─── Tezgahlar sekmesi ──────────────────────────────────────────────────────

function ItemLine({ item, lvCanDo, inventory }: { item: WorkshopItem; lvCanDo: number; inventory: Record<string, number> }) {
  const have = inventory[item.item_id] ?? 0;
  const req = item.required_per_account;
  const canDo = Math.floor(have / req);
  const missing = Math.max(0, req - have);
  const isBottleneck = canDo === lvCanDo && lvCanDo < 1;
  const color = have >= req ? "#4caf50" : have > 0 ? "#ff9800" : "#f44336";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "3px 8px", borderRadius: 3, background: isBottleneck ? "rgba(244,67,54,0.05)" : "transparent", border: isBottleneck ? "1px solid rgba(244,67,54,0.18)" : "1px solid transparent" }}>
      <img src={`${CDN_BASE}${item.item_id}.png`} alt="" width={16} height={16}
        style={{ borderRadius: 2, flexShrink: 0, objectFit: "contain", background: "rgba(255,255,255,0.04)" }}
        onError={e => { (e.target as HTMLImageElement).style.visibility = "hidden"; }} />
      <span style={{ flex: 1, fontFamily: "var(--font-ui)", fontSize: 11.5, color: isBottleneck ? "var(--fg-1)" : "var(--fg-4)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {item.name}
        {isBottleneck && <span style={{ fontFamily: "var(--font-mono)", fontSize: 8.5, color: "#f44336", marginLeft: 5, textTransform: "uppercase", letterSpacing: "0.06em" }}>darboğaz</span>}
      </span>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color, flexShrink: 0 }}>
        {have}<span style={{ color: "var(--fg-5)" }}>/{req}</span>
      </span>
      {missing > 0 && <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "#f44336", flexShrink: 0, minWidth: 28, textAlign: "right" }}>-{missing}</span>}
    </div>
  );
}

function LevelRow({ levelNum, items, inventory }: { levelNum: string; items: WorkshopItem[]; inventory: Record<string, number> }) {
  const [open, setOpen] = useState(false);
  const canDo = levelCanDo(items, inventory);
  const done = canDo >= 1;
  const bottleneck = !done && items.length > 0
    ? items.reduce((a, b) => {
        const ra = (inventory[a.item_id] ?? 0) / a.required_per_account;
        const rb = (inventory[b.item_id] ?? 0) / b.required_per_account;
        return ra <= rb ? a : b;
      })
    : null;
  const pct = done ? 100 : (() => {
    if (!items.length) return 0;
    const ratios = items.map(i => Math.min(1, (inventory[i.item_id] ?? 0) / i.required_per_account));
    return (ratios.reduce((a, b) => a + b, 0) / ratios.length) * 100;
  })();
  const color = done ? "#4caf50" : pct > 0 ? "#ff9800" : "#f44336";

  return (
    <div>
      <button onClick={() => setOpen(o => !o)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", background: open ? "rgba(255,255,255,0.03)" : "transparent", border: "none", borderRadius: open ? "var(--radius-sm) var(--radius-sm) 0 0" : "var(--radius-sm)", cursor: "pointer" }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, color: "var(--fg-5)", textTransform: "uppercase", letterSpacing: "0.06em", flexShrink: 0, minWidth: 36 }}>Lv {levelNum}</span>
        <div style={{ flex: 1, height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 2, overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 2 }} />
        </div>
        {!done && bottleneck && !open && (
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, color: "var(--fg-5)", flexShrink: 0, maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {bottleneck.name}
          </span>
        )}
        {done
          ? <Icon name="check-circle" size={12} style={{ color: "#4caf50", flexShrink: 0 }} />
          : <Icon name={open ? "chevron-up" : "chevron-down"} size={11} style={{ color: "var(--fg-5)", flexShrink: 0 }} />}
      </button>
      {open && (
        <div style={{ padding: "3px 6px 6px", background: "rgba(0,0,0,0.15)", border: "1px solid var(--border)", borderTop: "none", borderRadius: "0 0 var(--radius-sm) var(--radius-sm)", display: "flex", flexDirection: "column", gap: 1 }}>
          {items.map(item => <ItemLine key={item.item_id} item={item} lvCanDo={canDo} inventory={inventory} />)}
        </div>
      )}
    </div>
  );
}

function WorkshopCard({ name, data, inventory }: { name: string; data: WorkshopEntry; inventory: Record<string, number> }) {
  const levels = Object.entries(data.levels);
  const results = levels.map(([, l]) => levelCanDo(l.items, inventory));
  const allDone = results.every(r => r >= 1);
  const anyDone = results.some(r => r >= 1);
  const totalCan = results.filter(r => r >= 1).length;
  const totalMax = levels.length;
  return (
    <div style={{ background: "var(--bg-2)", border: `1px solid ${allDone ? "rgba(76,175,80,0.3)" : "var(--border)"}`, borderRadius: "var(--radius-md)", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ flex: 1, fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 12.5, color: "var(--fg-1)" }}>{name}</span>
        <Chip tone={allDone ? "success" : anyDone ? "brand" : "neutral"} dot={false} style={{ fontSize: 10 }}>{totalCan}/{totalMax}</Chip>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {levels.map(([levelNum, level]) => <LevelRow key={levelNum} levelNum={levelNum} items={level.items} inventory={inventory} />)}
      </div>
    </div>
  );
}

function BenchesTab({ workshops, inventory }: { workshops: [string, WorkshopEntry][]; inventory: Record<string, number> }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
      {workshops.map(([name, data]) => <WorkshopCard key={name} name={name} data={data} inventory={inventory} />)}
    </div>
  );
}

// ─── Ana ekran ───────────────────────────────────────────────────────────────

export function WorkshopScreen() {
  const [data, setData] = useState<WorkshopProgressResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"summary" | "benches">("summary");
  const [selectedId, setSelectedId] = useState<string>(() =>
    typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY_ACCOUNT) ?? "" : ""
  );

  useEffect(() => {
    getWorkshopProgress()
      .then(setData)
      .catch(e => setError(e instanceof Error ? e.message : "Bilinmeyen hata"))
      .finally(() => setLoading(false));
  }, []);

  const handleSelect = (id: string) => {
    setSelectedId(id);
    localStorage.setItem(STORAGE_KEY_ACCOUNT, id);
  };

  const resolvedId = selectedId || data?.accounts[0]?.id || "";
  const selectedInventory = useMemo(
    () => data?.accounts.find(a => a.id === resolvedId)?.inventory ?? {},
    [data, resolvedId],
  );

  const summary = useMemo(() => data ? buildSummary(data.workshops, selectedInventory) : [], [data, selectedInventory]);
  const workshops = useMemo(() => data ? Object.entries(data.workshops) : [], [data]);

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 48 }}>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--fg-5)" }}>Yükleniyor...</span>
    </div>
  );

  if (error) return (
    <div style={{ padding: "10px 14px", borderRadius: "var(--radius-md)", background: "rgba(244,67,54,0.08)", border: "1px solid rgba(244,67,54,0.25)", fontFamily: "var(--font-mono)", fontSize: 12, color: "#f44336" }}>
      Hata: {error}
    </div>
  );

  if (!data) return null;

  const nMissing = summary.filter(i => i.missing > 0).length;
  const nOk = summary.filter(i => i.missing === 0).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Compact header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)" }}>
        <Icon name="hammer" size={14} style={{ color: "var(--fg-4)", flexShrink: 0 }} />
        <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 14, color: "var(--fg-1)" }}>Workshop</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--fg-5)" }}>
          <span style={{ color: "#4caf50" }}>{nOk}</span> tamam · <span style={{ color: "#f44336" }}>{nMissing}</span> eksik
        </span>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", background: "var(--bg-3)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: 2, gap: 2 }}>
          {(["summary", "benches"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: "3px 10px", border: "none", borderRadius: 4,
              background: tab === t ? "rgba(123,47,247,0.25)" : "transparent",
              color: tab === t ? "var(--fg-1)" : "var(--fg-5)",
              fontFamily: "var(--font-ui)", fontSize: 11.5, fontWeight: tab === t ? 600 : 400,
              cursor: "pointer",
            }}>
              {t === "summary" ? "Özet" : "Tezgahlar"}
            </button>
          ))}
        </div>
        <AccountSelector accounts={data.accounts} selectedId={resolvedId} onChange={handleSelect} />
      </div>

      {tab === "summary" ? <SummaryTab summary={summary} /> : <BenchesTab workshops={workshops} inventory={selectedInventory} />}
    </div>
  );
}

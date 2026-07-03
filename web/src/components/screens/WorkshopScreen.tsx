"use client";

import { useState, useEffect, useMemo } from "react";
import { Icon, Chip } from "@/components/ui";
import { getWorkshopProgress } from "@/lib/api";
import type { WorkshopProgressResponse, WorkshopEntry, WorkshopItem, WorkshopAccountInfo } from "@/lib/types";

const CDN_BASE = "https://cdn.arctracker.io/items/";
const STORAGE_KEY_ACCOUNT = "arc_vault_workshop_account";
const STORAGE_KEY_N = "arc_vault_workshop_n";

// ─── Hesaplama ────────────────────────────────────────────────────────────────

function levelCanDo(items: WorkshopItem[], inventory: Record<string, number>, n: number): boolean {
  if (!items.length) return false;
  return items.every(i => (inventory[i.item_id] ?? 0) >= i.required_per_account * n);
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
  n: number,
): SummaryItem[] {
  const map: Record<string, { name: string; total: number; sources: string[] }> = {};
  for (const [wsName, ws] of Object.entries(workshops)) {
    for (const [lvNum, level] of Object.entries(ws.levels)) {
      for (const item of level.items) {
        if (!map[item.item_id]) map[item.item_id] = { name: item.name, total: 0, sources: [] };
        map[item.item_id].total += item.required_per_account * n;
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

// ─── Hesap sayısı seçici ──────────────────────────────────────────────────────

const btnSm: React.CSSProperties = {
  width: 22, height: 22, border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
  background: "var(--bg-3)", color: "var(--fg-3)", cursor: "pointer", fontSize: 13,
  display: "flex", alignItems: "center", justifyContent: "center",
};

function CountPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-5)" }}>hesap</span>
      <button onClick={() => onChange(Math.max(1, value - 1))} style={btnSm}>−</button>
      <input
        type="number" min={1} max={99} value={value}
        onChange={e => { const v = parseInt(e.target.value, 10); if (!isNaN(v) && v >= 1 && v <= 99) onChange(v); }}
        style={{ width: 36, height: 22, textAlign: "center", fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 700, color: "var(--fg-1)", background: "var(--bg-3)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-sm)", outline: "none" }}
      />
      <button onClick={() => onChange(Math.min(99, value + 1))} style={btnSm}>+</button>
    </div>
  );
}

// ─── Özet satırı ─────────────────────────────────────────────────────────────

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

// ─── Tezgahlar sekmesi ───────────────────────────────────────────────────────

function ItemLine({ item, inventory, n }: { item: WorkshopItem; inventory: Record<string, number>; n: number }) {
  const have = inventory[item.item_id] ?? 0;
  const req = item.required_per_account * n;
  const missing = Math.max(0, req - have);
  const isBottleneck = have < req && (have / req) <= Math.min(...[have / req]);
  const color = have >= req ? "#4caf50" : have > 0 ? "#ff9800" : "#f44336";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "3px 8px", borderRadius: 3, background: missing > 0 ? "rgba(244,67,54,0.03)" : "transparent", border: missing > 0 ? "1px solid rgba(244,67,54,0.1)" : "1px solid transparent" }}>
      <img src={`${CDN_BASE}${item.item_id}.png`} alt="" width={16} height={16}
        style={{ borderRadius: 2, flexShrink: 0, objectFit: "contain", background: "rgba(255,255,255,0.04)" }}
        onError={e => { (e.target as HTMLImageElement).style.visibility = "hidden"; }} />
      <span style={{ flex: 1, fontFamily: "var(--font-ui)", fontSize: 11.5, color: missing > 0 ? "var(--fg-2)" : "var(--fg-4)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {item.name}
      </span>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color, flexShrink: 0 }}>
        {have}<span style={{ color: "var(--fg-5)" }}>/{req}</span>
      </span>
      {missing > 0 && (
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "#f44336", flexShrink: 0, minWidth: 32, textAlign: "right" }}>-{missing}</span>
      )}
    </div>
  );
}

function LevelRow({ levelNum, items, inventory, n }: { levelNum: string; items: WorkshopItem[]; inventory: Record<string, number>; n: number }) {
  const [open, setOpen] = useState(false);
  const done = levelCanDo(items, inventory, n);
  const bottleneck = !done && items.length > 0
    ? items.reduce((a, b) => {
        const ra = (inventory[a.item_id] ?? 0) / (a.required_per_account * n);
        const rb = (inventory[b.item_id] ?? 0) / (b.required_per_account * n);
        return ra <= rb ? a : b;
      })
    : null;
  const pct = done ? 100 : (() => {
    if (!items.length) return 0;
    const ratios = items.map(i => Math.min(1, (inventory[i.item_id] ?? 0) / (i.required_per_account * n)));
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
          {items.map(item => <ItemLine key={item.item_id} item={item} inventory={inventory} n={n} />)}
        </div>
      )}
    </div>
  );
}

function WorkshopCard({ name, entry, inventory, n }: { name: string; entry: WorkshopEntry; inventory: Record<string, number>; n: number }) {
  const levels = Object.entries(entry.levels);
  const results = levels.map(([, l]) => levelCanDo(l.items, inventory, n));
  const allDone = results.every(Boolean);
  const anyDone = results.some(Boolean);
  const totalCan = results.filter(Boolean).length;
  const totalMax = levels.length;
  return (
    <div style={{ background: "var(--bg-2)", border: `1px solid ${allDone ? "rgba(76,175,80,0.3)" : "var(--border)"}`, borderRadius: "var(--radius-md)", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ flex: 1, fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 12.5, color: "var(--fg-1)" }}>{name}</span>
        <Chip tone={allDone ? "success" : anyDone ? "brand" : "neutral"} dot={false} style={{ fontSize: 10 }}>{totalCan}/{totalMax}</Chip>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {levels.map(([levelNum, level]) => (
          <LevelRow key={levelNum} levelNum={levelNum} items={level.items} inventory={inventory} n={n} />
        ))}
      </div>
    </div>
  );
}

function BenchesTab({ workshops, inventory, n }: { workshops: [string, WorkshopEntry][]; inventory: Record<string, number>; n: number }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
      {workshops.map(([name, entry]) => (
        <WorkshopCard key={name} name={name} entry={entry} inventory={inventory} n={n} />
      ))}
    </div>
  );
}

// ─── Ana ekran ────────────────────────────────────────────────────────────────

export function WorkshopScreen() {
  const [data, setData] = useState<WorkshopProgressResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"summary" | "benches">("summary");
  // Aktif hesabı global key'den oku — bu ekranda seçici yok
  const [selectedId] = useState<string>(() =>
    typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY_ACCOUNT) ?? "" : ""
  );
  const [n, setN] = useState<number>(() => {
    if (typeof window === "undefined") return 1;
    const saved = localStorage.getItem(STORAGE_KEY_N);
    return saved && !isNaN(parseInt(saved, 10)) ? parseInt(saved, 10) : 1;
  });

  useEffect(() => {
    getWorkshopProgress()
      .then(setData)
      .catch(e => setError(e instanceof Error ? e.message : "Bilinmeyen hata"))
      .finally(() => setLoading(false));
  }, []);

  const handleN = (val: number) => { setN(val); localStorage.setItem(STORAGE_KEY_N, String(val)); };

  const resolvedId = useMemo(
    () => (data?.accounts.some((a: WorkshopAccountInfo) => a.id === selectedId) ? selectedId : data?.accounts[0]?.id) ?? "",
    [data, selectedId],
  );

  const selectedInventory = useMemo(
    () => data?.accounts.find((a: WorkshopAccountInfo) => a.id === resolvedId)?.inventory ?? {},
    [data, resolvedId],
  );

  const summary = useMemo(
    () => data ? buildSummary(data.workshops, selectedInventory, n) : [],
    [data, selectedInventory, n],
  );
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
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)" }}>
        <Icon name="hammer" size={14} style={{ color: "var(--fg-4)", flexShrink: 0 }} />
        <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 14, color: "var(--fg-1)" }}>Workshop</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--fg-5)" }}>
          <span style={{ color: "#4caf50" }}>{nOk}</span> tamam · <span style={{ color: "#f44336" }}>{nMissing}</span> eksik
        </span>
        <div style={{ flex: 1 }} />
        <CountPicker value={n} onChange={handleN} />
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
      </div>

      {tab === "summary"
        ? <SummaryTab summary={summary} />
        : <BenchesTab workshops={workshops} inventory={selectedInventory} n={n} />}
    </div>
  );
}

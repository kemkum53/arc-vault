"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Icon } from "@/components/ui";
import { getExpeditionProgress, getSupplySelection, putSupplySelection } from "@/lib/api";
import type {
  ExpeditionProgressResponse, ExpeditionEntry, ExpeditionItem,
  ExpeditionSupplyCat, ItemInfo, WorkshopAccountInfo,
} from "@/lib/types";

const CDN_BASE = "https://cdn.arctracker.io/items/";
const STORAGE_KEY_N = "arc_vault_expedition_n";
// Workshop ile paylaşılan aktif hesap anahtarı — expedition kendi seçici göstermez
const STORAGE_KEY_ACTIVE_ACCOUNT = "arc_vault_workshop_account";
const STORAGE_KEY_SUPPLY_INC = "arc_vault_supply_included";

// ─── Hesaplama ───────────────────────────────────────────────────────────────

function phaseCanDo(items: ExpeditionItem[], inventory: Record<string, number>, n: number): number {
  if (!items.length) return 0;
  return Math.min(n, ...items.map(i => Math.floor((inventory[i.item_id] ?? 0) / i.required_per_account)));
}

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(0) + "k";
  return String(n);
}

function computeReserved(exp: ExpeditionEntry, n: number): Record<string, number> {
  const reserved: Record<string, number> = {};
  for (const phase of Object.values(exp.phases)) {
    if (phase.type === "supply" || !phase.items) continue;
    for (const item of phase.items) {
      reserved[item.item_id] = (reserved[item.item_id] ?? 0) + item.required_per_account * n;
    }
  }
  return reserved;
}

// Sadece included set'indeki itemler sayılır — boş set = hiçbir şey katkıda bulunmaz
function computeSupply(
  inventory: Record<string, number>,
  itemInfo: Record<string, ItemInfo>,
  reserved: Record<string, number>,
  included: Set<string>,
): Record<string, number> {
  const available: Record<string, number> = {};
  for (const [itemId, qty] of Object.entries(inventory)) {
    if (!included.has(itemId)) continue;
    const remaining = Math.max(0, qty - (reserved[itemId] ?? 0));
    if (remaining <= 0) continue;
    const info = itemInfo[itemId];
    if (!info || !info.category) continue;
    available[info.category] = (available[info.category] ?? 0) + info.value * remaining;
  }
  return available;
}

function loadIncluded(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const s = localStorage.getItem(STORAGE_KEY_SUPPLY_INC);
    return s ? new Set(JSON.parse(s) as string[]) : new Set();
  } catch { return new Set(); }
}

// ─── Tur seçici ──────────────────────────────────────────────────────────────

const btnSm: React.CSSProperties = {
  width: 22, height: 22, border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
  background: "var(--bg-3)", color: "var(--fg-3)", cursor: "pointer", fontSize: 13,
  display: "flex", alignItems: "center", justifyContent: "center",
};

function RunPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-5)" }}>tur</span>
      <button onClick={() => onChange(Math.max(1, value - 1))} style={btnSm}>−</button>
      <input type="number" min={1} max={99} value={value}
        onChange={e => { const v = parseInt(e.target.value, 10); if (!isNaN(v) && v >= 1 && v <= 99) onChange(v); }}
        style={{ width: 36, height: 22, textAlign: "center", fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 700, color: "var(--fg-1)", background: "var(--bg-3)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-sm)", outline: "none" }} />
      <button onClick={() => onChange(Math.min(99, value + 1))} style={btnSm}>+</button>
    </div>
  );
}

// ─── Özet kart ───────────────────────────────────────────────────────────────

interface SummaryItem {
  item_id: string; name: string;
  total_required: number; have: number; missing: number; sources: string[];
}

function buildSummary(exp: ExpeditionEntry, inventory: Record<string, number>, n: number): SummaryItem[] {
  const map: Record<string, { name: string; total: number; sources: string[] }> = {};
  for (const [phaseNum, phase] of Object.entries(exp.phases)) {
    if (phase.type === "supply" || !phase.items) continue;
    for (const item of phase.items) {
      if (!map[item.item_id]) map[item.item_id] = { name: item.name, total: 0, sources: [] };
      map[item.item_id].total += item.required_per_account * n;
      map[item.item_id].sources.push(`Aşama ${phaseNum} — ${phase.name}`);
    }
  }
  return Object.entries(map)
    .map(([item_id, d]) => ({
      item_id, name: d.name, total_required: d.total,
      have: inventory[item_id] ?? 0,
      missing: Math.max(0, d.total - (inventory[item_id] ?? 0)),
      sources: d.sources,
    }))
    .sort((a, b) => b.missing - a.missing || a.name.localeCompare(b.name));
}

function SummaryCard({ item }: { item: SummaryItem }) {
  const pct = item.total_required > 0 ? Math.min(100, (item.have / item.total_required) * 100) : 100;
  const ok = item.missing === 0;
  const color = ok ? "#4caf50" : item.have > 0 ? "#ff9800" : "#f44336";
  return (
    <div title={item.sources.join("\n")} style={{ display: "flex", flexDirection: "column", gap: 6, padding: "8px 10px", background: "var(--bg-2)", border: `1px solid ${ok ? "rgba(76,175,80,0.18)" : "var(--border)"}`, borderRadius: "var(--radius-md)", opacity: ok ? 0.6 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <img src={`${CDN_BASE}${item.item_id}.png`} alt="" width={20} height={20}
          style={{ flexShrink: 0, borderRadius: 3, objectFit: "contain", background: "rgba(255,255,255,0.04)" }}
          onError={e => { (e.target as HTMLImageElement).style.visibility = "hidden"; }} />
        <span style={{ fontFamily: "var(--font-ui)", fontSize: 11.5, color: "var(--fg-2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.name}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div style={{ flex: 1, height: 3, background: "rgba(255,255,255,0.06)", borderRadius: 2, overflow: "hidden", minWidth: 0 }}>
          <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 2 }} />
        </div>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color, flexShrink: 0, whiteSpace: "nowrap" }}>
          {item.have}<span style={{ color: "var(--fg-5)" }}>/{item.total_required}</span>
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
        {filtered.map(item => <SummaryCard key={item.item_id} item={item} />)}
        {filtered.length === 0 && <span style={{ gridColumn: "1/-1", fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--fg-5)", textAlign: "center", padding: 16 }}>Sonuç yok</span>}
      </div>
    </div>
  );
}

// ─── Kategori içi item satırı ─────────────────────────────────────────────────

interface CatItemEntry {
  id: string;
  name: string;
  value: number;
  rawQty: number;
  availableQty: number;
}

function SupplyItemRow({ item, isIncluded, onToggle }: {
  item: CatItemEntry;
  isIncluded: boolean;
  onToggle: (id: string) => void;
}) {
  const hasInv = item.rawQty > 0;
  const contribution = isIncluded && item.availableQty > 0 ? item.availableQty * item.value : 0;
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 6px", borderRadius: 3, cursor: "pointer", background: isIncluded && hasInv ? "rgba(123,47,247,0.06)" : "transparent", border: isIncluded ? "1px solid rgba(123,47,247,0.15)" : "1px solid transparent" }}>
      <input type="checkbox" checked={isIncluded} onChange={() => onToggle(item.id)}
        style={{ cursor: "pointer", flexShrink: 0, accentColor: "#7b2ff7" }} />
      <img src={`${CDN_BASE}${item.id}.png`} alt="" width={14} height={14}
        style={{ borderRadius: 2, flexShrink: 0, objectFit: "contain", background: "rgba(255,255,255,0.04)" }}
        onError={e => { (e.target as HTMLImageElement).style.visibility = "hidden"; }} />
      <span style={{ flex: 1, fontFamily: "var(--font-ui)", fontSize: 11, color: hasInv ? "var(--fg-2)" : "var(--fg-5)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {item.name}
      </span>
      {hasInv && (
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-4)", flexShrink: 0 }}>
          ×{item.availableQty.toLocaleString()}
        </span>
      )}
      {hasInv && isIncluded && contribution > 0 ? (
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "#4caf50", flexShrink: 0, minWidth: 42, textAlign: "right" }}>+{fmt(contribution)}</span>
      ) : (
        <span style={{ minWidth: 42 }} />
      )}
    </label>
  );
}

// ─── Kategori bölümü (arama + liste) ─────────────────────────────────────────

function SupplyCategorySection({ catKey, cat, items, included, onToggle, availableCoins, n, isBottleneck, done }: {
  catKey: string;
  cat: ExpeditionSupplyCat;
  items: CatItemEntry[];
  included: Set<string>;
  onToggle: (id: string) => void;
  availableCoins: Record<string, number>;
  n: number;
  isBottleneck: boolean;
  done: boolean;
}) {
  const [search, setSearch] = useState("");

  const have = availableCoins[catKey] ?? 0;
  const requiredTotal = cat.required_per_run * n;
  const catCanDo = Math.floor(have / cat.required_per_run);
  const catOk = catCanDo >= n;
  const catColor = catOk ? "#4caf50" : have > 0 ? "#ff9800" : "#f44336";

  // Arama varsa: eşleşen tüm itemler; yoksa: yalnızca seçili itemler
  const displayItems = useMemo(() => {
    if (search.trim()) {
      const q = search.toLowerCase();
      return items.filter(i => i.name.toLowerCase().includes(q));
    }
    return items.filter(i => included.has(i.id));
  }, [items, search, included]);

  const selectedCount = items.filter(i => included.has(i.id)).length;

  return (
    <div>
      {/* Kategori başlığı */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", background: isBottleneck ? "rgba(244,67,54,0.06)" : "rgba(255,255,255,0.03)", borderRadius: 4, marginBottom: 6, border: isBottleneck ? "1px solid rgba(244,67,54,0.2)" : "1px solid transparent" }}>
        <span style={{ flex: 1, fontFamily: "var(--font-ui)", fontSize: 11.5, fontWeight: 600, color: "var(--fg-2)" }}>
          {cat.name}
          {isBottleneck && !done && <span style={{ fontFamily: "var(--font-mono)", fontSize: 8.5, color: "#f44336", marginLeft: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>darboğaz</span>}
        </span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-5)", marginRight: 4 }}>
          {selectedCount} seçili
        </span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: catColor }}>
          {fmt(have)}<span style={{ color: "var(--fg-5)" }}>/{fmt(requiredTotal)}</span>
        </span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, fontWeight: 600, color: catColor, minWidth: 24, textAlign: "right" }}>
          ×{Math.min(catCanDo, n)}
        </span>
      </div>

      {/* Arama çubuğu */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "0 8px", height: 26, marginBottom: 4, marginLeft: 4 }}>
        <Icon name="search" size={11} style={{ color: "var(--fg-5)", flexShrink: 0 }} />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="İtem ara..."
          style={{ flex: 1, background: "none", border: "none", outline: "none", fontFamily: "var(--font-ui)", fontSize: 11, color: "var(--fg-1)" }}
        />
        {search && (
          <button onClick={() => setSearch("")} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--fg-5)", fontSize: 12, padding: 0, lineHeight: 1 }}>×</button>
        )}
      </div>

      {/* Item listesi */}
      <div style={{ display: "flex", flexDirection: "column", gap: 1, paddingLeft: 4 }}>
        {displayItems.map(item => (
          <SupplyItemRow
            key={item.id}
            item={item}
            isIncluded={included.has(item.id)}
            onToggle={onToggle}
          />
        ))}
        {displayItems.length === 0 && !search.trim() && (
          <div style={{ padding: "6px 8px", fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-6)", fontStyle: "italic" }}>
            Seçili item yok — yukarıdan arayıp ekleyin
          </div>
        )}
        {displayItems.length === 0 && search.trim() && (
          <div style={{ padding: "6px 8px", fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-6)" }}>
            Sonuç yok
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Phase 5: Yükleme Alanı satırı ──────────────────────────────────────────

function SupplyPhaseRow({ supply, availableCoins, n, itemInfo, inventory, reserved, included, onToggle }: {
  supply: Record<string, ExpeditionSupplyCat>;
  availableCoins: Record<string, number>;
  n: number;
  itemInfo: Record<string, ItemInfo>;
  inventory: Record<string, number>;
  reserved: Record<string, number>;
  included: Set<string>;
  onToggle: (itemId: string) => void;
}) {
  const [open, setOpen] = useState(false);

  const cats = Object.entries(supply);
  const canDos = cats.map(([key, cat]) => Math.floor((availableCoins[key] ?? 0) / cat.required_per_run));
  const overallCanDo = cats.length > 0 ? Math.min(n, ...canDos) : 0;
  const done = overallCanDo >= n;
  const pct = n > 0 ? (Math.min(overallCanDo, n) / n) * 100 : 0;
  const color = done ? "#4caf50" : overallCanDo > 0 ? "#ff9800" : "#f44336";
  const minCanDo = cats.length > 0 ? Math.min(...canDos) : 0;
  const bottleneckIdx = !done && cats.length > 0 ? canDos.indexOf(minCanDo) : -1;

  // Her kategori için item listesi
  const catItems = useMemo((): Record<string, CatItemEntry[]> => {
    const result: Record<string, CatItemEntry[]> = {};
    for (const catKey of Object.keys(supply)) result[catKey] = [];
    for (const [id, info] of Object.entries(itemInfo)) {
      if (!info.category || !(info.category in supply)) continue;
      const rawQty = inventory[id] ?? 0;
      const availableQty = Math.max(0, rawQty - (reserved[id] ?? 0));
      result[info.category].push({ id, name: info.name, value: info.value, rawQty, availableQty });
    }
    for (const cat of Object.keys(result)) {
      // Sıralama: envanterde olanlar önce (miktara göre azalan), sonra alfabetik
      result[cat].sort((a, b) => {
        if ((a.rawQty > 0) !== (b.rawQty > 0)) return a.rawQty > 0 ? -1 : 1;
        if (a.rawQty !== b.rawQty) return b.rawQty - a.rawQty;
        return a.name.localeCompare(b.name);
      });
    }
    return result;
  }, [itemInfo, supply, inventory, reserved]);

  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", background: open ? "rgba(255,255,255,0.03)" : "transparent", border: "none", borderRadius: open ? "var(--radius-sm) var(--radius-sm) 0 0" : "var(--radius-sm)", cursor: "pointer" }}
      >
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, color: "var(--fg-5)", textTransform: "uppercase", letterSpacing: "0.06em", flexShrink: 0, minWidth: 28 }}>A5</span>
        <span style={{ fontFamily: "var(--font-ui)", fontSize: 11, color: "var(--fg-3)", flexShrink: 0, maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Yükleme Alanı</span>
        <div style={{ flex: 1, height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 2, overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 2 }} />
        </div>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600, color, flexShrink: 0, minWidth: 32, textAlign: "right" }}>{Math.min(overallCanDo, n)}/{n}</span>
        {!done && bottleneckIdx >= 0 && !open && (
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, color: "var(--fg-5)", flexShrink: 0, maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {cats[bottleneckIdx][1].name}
          </span>
        )}
        {done
          ? <Icon name="check-circle" size={12} style={{ color: "#4caf50", flexShrink: 0 }} />
          : <Icon name={open ? "chevron-up" : "chevron-down"} size={11} style={{ color: "var(--fg-5)", flexShrink: 0 }} />}
      </button>

      {open && (
        <div style={{ padding: "10px 10px 14px", background: "rgba(0,0,0,0.15)", border: "1px solid var(--border)", borderTop: "none", borderRadius: "0 0 var(--radius-sm) var(--radius-sm)", display: "flex", flexDirection: "column", gap: 16 }}>
          {cats.map(([catKey, cat], idx) => (
            <SupplyCategorySection
              key={catKey}
              catKey={catKey}
              cat={cat}
              items={catItems[catKey] ?? []}
              included={included}
              onToggle={onToggle}
              availableCoins={availableCoins}
              n={n}
              isBottleneck={!done && idx === bottleneckIdx}
              done={done}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Item aşaması satırı ─────────────────────────────────────────────────────

function ItemLine({ item, phCanDo, inventory, n }: { item: ExpeditionItem; phCanDo: number; inventory: Record<string, number>; n: number }) {
  const have = inventory[item.item_id] ?? 0;
  const canDo = Math.floor(have / item.required_per_account);
  const requiredTotal = item.required_per_account * n;
  const missing = Math.max(0, requiredTotal - have);
  const isBottleneck = canDo === phCanDo && canDo < n;
  const color = canDo === 0 ? "#f44336" : canDo < n ? "#ff9800" : "#4caf50";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "3px 8px", borderRadius: 3, background: isBottleneck ? "rgba(244,67,54,0.05)" : "transparent", border: isBottleneck ? "1px solid rgba(244,67,54,0.18)" : "1px solid transparent" }}>
      <img src={`${CDN_BASE}${item.item_id}.png`} alt="" width={16} height={16}
        style={{ borderRadius: 2, flexShrink: 0, objectFit: "contain", background: "rgba(255,255,255,0.04)" }}
        onError={e => { (e.target as HTMLImageElement).style.visibility = "hidden"; }} />
      <span style={{ flex: 1, fontFamily: "var(--font-ui)", fontSize: 11.5, color: isBottleneck ? "var(--fg-1)" : "var(--fg-4)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {item.name}
        {isBottleneck && <span style={{ fontFamily: "var(--font-mono)", fontSize: 8.5, color: "#f44336", marginLeft: 5, textTransform: "uppercase", letterSpacing: "0.06em" }}>darboğaz</span>}
      </span>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color, flexShrink: 0, whiteSpace: "nowrap" }}>
        {have}<span style={{ color: "var(--fg-5)" }}>/{requiredTotal}</span>
      </span>
      {missing > 0 && <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "#f44336", flexShrink: 0, minWidth: 28, textAlign: "right" }}>-{missing}</span>}
    </div>
  );
}

function ItemPhaseRow({ phaseNum, name, items, inventory, n }: { phaseNum: string; name: string; items: ExpeditionItem[]; inventory: Record<string, number>; n: number }) {
  const [open, setOpen] = useState(false);
  const canDo = phaseCanDo(items, inventory, n);
  const done = canDo >= n;
  const bottleneck = !done && items.length > 0
    ? items.reduce((a, b) => {
        const ra = (inventory[a.item_id] ?? 0) / a.required_per_account;
        const rb = (inventory[b.item_id] ?? 0) / b.required_per_account;
        return ra <= rb ? a : b;
      })
    : null;
  const pct = n > 0 ? (Math.min(canDo, n) / n) * 100 : 0;
  const color = done ? "#4caf50" : canDo > 0 ? "#ff9800" : "#f44336";
  return (
    <div>
      <button onClick={() => setOpen(o => !o)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", background: open ? "rgba(255,255,255,0.03)" : "transparent", border: "none", borderRadius: open ? "var(--radius-sm) var(--radius-sm) 0 0" : "var(--radius-sm)", cursor: "pointer" }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, color: "var(--fg-5)", textTransform: "uppercase", letterSpacing: "0.06em", flexShrink: 0, minWidth: 28 }}>A{phaseNum}</span>
        <span style={{ fontFamily: "var(--font-ui)", fontSize: 11, color: "var(--fg-3)", flexShrink: 0, maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
        <div style={{ flex: 1, height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 2, overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 2 }} />
        </div>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600, color, flexShrink: 0, minWidth: 32, textAlign: "right" }}>{Math.min(canDo, n)}/{n}</span>
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
          {items.map(item => <ItemLine key={item.item_id} item={item} phCanDo={canDo} inventory={inventory} n={n} />)}
        </div>
      )}
    </div>
  );
}

// ─── Sefer sekmesi ───────────────────────────────────────────────────────────

function ExpeditionTab({ exp, inventory, itemInfo, n, included, onToggleItem }: {
  exp: ExpeditionEntry;
  inventory: Record<string, number>;
  itemInfo: Record<string, ItemInfo>;
  n: number;
  included: Set<string>;
  onToggleItem: (id: string) => void;
}) {
  const [view, setView] = useState<"summary" | "phases">("summary");

  const reserved = useMemo(() => computeReserved(exp, n), [exp, n]);
  const summary = useMemo(() => buildSummary(exp, inventory, n), [exp, inventory, n]);
  const availableCoins = useMemo(() => computeSupply(inventory, itemInfo, reserved, included), [inventory, itemInfo, reserved, included]);

  const phases = Object.entries(exp.phases);
  const nMissing = summary.filter(i => i.missing > 0).length;
  const nOk = summary.filter(i => i.missing === 0).length;

  if (phases.length === 0) {
    return (
      <div style={{ padding: "32px 0", textAlign: "center" }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--fg-5)" }}>Bu sefer için veri bulunamadı.</span>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <div style={{ display: "flex", background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: 2, gap: 2 }}>
          {(["summary", "phases"] as const).map(v => (
            <button key={v} onClick={() => setView(v)} style={{ padding: "3px 10px", border: "none", borderRadius: 3, background: view === v ? "rgba(123,47,247,0.25)" : "transparent", color: view === v ? "var(--fg-1)" : "var(--fg-5)", fontFamily: "var(--font-ui)", fontSize: 11.5, fontWeight: view === v ? 600 : 400, cursor: "pointer" }}>
              {v === "summary" ? "Özet" : "Aşamalar"}
            </button>
          ))}
        </div>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#f44336" }}>{nMissing} eksik</span>
        <span style={{ color: "var(--fg-6)" }}>·</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#4caf50" }}>{nOk} tamam</span>
      </div>

      {view === "summary" ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
          {summary.map(item => <SummaryCard key={item.item_id} item={item} />)}
        </div>
      ) : (
        <div style={{ background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "6px 8px", display: "flex", flexDirection: "column", gap: 2 }}>
          {phases.map(([phaseNum, phase]) =>
            phase.type === "supply" && phase.supply ? (
              <SupplyPhaseRow
                key={phaseNum}
                supply={phase.supply}
                availableCoins={availableCoins}
                n={n}
                itemInfo={itemInfo}
                inventory={inventory}
                reserved={reserved}
                included={included}
                onToggle={onToggleItem}
              />
            ) : (
              <ItemPhaseRow key={phaseNum} phaseNum={phaseNum} name={phase.name} items={phase.items ?? []} inventory={inventory} n={n} />
            )
          )}
        </div>
      )}
    </div>
  );
}

// ─── Ana ekran ───────────────────────────────────────────────────────────────

type TabKey = "Sefer 1" | "Sefer 2" | "Sefer 3" | "Sefer 4";
const EXP_TABS: TabKey[] = ["Sefer 1", "Sefer 2", "Sefer 3", "Sefer 4"];

export function ExpeditionScreen() {
  const [data, setData] = useState<ExpeditionProgressResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<TabKey>("Sefer 1");
  const [n, setN] = useState<number>(() => {
    if (typeof window === "undefined") return 1;
    const saved = localStorage.getItem(STORAGE_KEY_N);
    return saved && !isNaN(parseInt(saved, 10)) ? parseInt(saved, 10) : 1;
  });
  // Workshop ile aynı aktif hesabı kullan — expedition kendi seçici göstermez
  const [selectedId] = useState<string>(() =>
    typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY_ACTIVE_ACCOUNT) ?? "" : ""
  );
  const [included, setIncluded] = useState<Set<string>>(loadIncluded);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    getExpeditionProgress().then(setData)
      .catch(e => setError(e instanceof Error ? e.message : "Bilinmeyen hata"))
      .finally(() => setLoading(false));

    // DB'den seçimleri çek, localStorage'ı ezmeden önce yükle
    getSupplySelection()
      .then(({ included: arr }) => {
        const s = new Set(arr);
        setIncluded(s);
        localStorage.setItem(STORAGE_KEY_SUPPLY_INC, JSON.stringify(arr));
      })
      .catch(() => { /* localStorage değeri geçerli kalmaya devam eder */ });
  }, []);

  const handleN = (val: number) => { setN(val); localStorage.setItem(STORAGE_KEY_N, String(val)); };

  const toggleItem = useCallback((itemId: string) => {
    setIncluded(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      const arr = [...next];
      localStorage.setItem(STORAGE_KEY_SUPPLY_INC, JSON.stringify(arr));
      // 800ms bekle — kullanıcı birden fazla toggle yaparsa tek istek gider
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        putSupplySelection(arr).catch(console.error);
      }, 800);
      return next;
    });
  }, []);

  const resolvedId = selectedId || data?.accounts[0]?.id || "";
  const selectedInventory = useMemo(
    () => data?.accounts.find(a => a.id === resolvedId)?.inventory ?? {},
    [data, resolvedId],
  );

  const activeExp = data?.expeditions[active];
  const itemInfo = data?.item_info ?? {};

  const allPhases = useMemo(() => {
    if (!data) return { done: 0, total: 0 };
    let done = 0, total = 0;
    for (const exp of Object.values(data.expeditions)) {
      for (const phase of Object.values(exp.phases)) {
        if (phase.type === "supply") continue;
        total++;
        if (phaseCanDo(phase.items ?? [], selectedInventory, n) >= n) done++;
      }
    }
    return { done, total };
  }, [data, selectedInventory, n]);

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 48 }}>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--fg-5)" }}>Yükleniyor...</span>
    </div>
  );
  if (error) return (
    <div style={{ padding: "10px 14px", borderRadius: "var(--radius-md)", background: "rgba(244,67,54,0.08)", border: "1px solid rgba(244,67,54,0.25)", fontFamily: "var(--font-mono)", fontSize: 12, color: "#f44336" }}>Hata: {error}</div>
  );
  if (!data) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)" }}>
        <Icon name="compass" size={14} style={{ color: "var(--fg-4)", flexShrink: 0 }} />
        <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 14, color: "var(--fg-1)" }}>Sefer</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--fg-5)" }}>
          {allPhases.done}/{allPhases.total} aşama tamam
        </span>
        <div style={{ flex: 1 }} />
        <RunPicker value={n} onChange={handleN} />
      </div>

      {/* Sefer sekme seçici */}
      <div style={{ display: "flex", gap: 4, background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: 4 }}>
        {EXP_TABS.map(tab => {
          const exp = data.expeditions[tab];
          const phases = exp ? Object.values(exp.phases).filter(p => p.type !== "supply") : [];
          const donePh = phases.filter(p => phaseCanDo(p.items ?? [], selectedInventory, n) >= n).length;
          const isActive = active === tab;
          return (
            <button key={tab} onClick={() => setActive(tab)} style={{ flex: 1, padding: "6px 4px", border: "none", borderRadius: "var(--radius-sm)", background: isActive ? "linear-gradient(90deg, rgba(123,47,247,0.22), rgba(0,210,255,0.10))" : "transparent", color: isActive ? "var(--fg-1)" : "var(--fg-4)", fontFamily: "var(--font-ui)", fontSize: 12.5, fontWeight: isActive ? 600 : 400, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
              <span>{tab}</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, color: donePh === phases.length ? "#4caf50" : isActive ? "var(--fg-4)" : "var(--fg-6)" }}>
                {donePh}/{phases.length}
              </span>
            </button>
          );
        })}
      </div>

      {activeExp
        ? <ExpeditionTab
            key={active}
            exp={activeExp}
            inventory={selectedInventory}
            itemInfo={itemInfo}
            n={n}
            included={included}
            onToggleItem={toggleItem}
          />
        : <div style={{ padding: "32px 0", textAlign: "center" }}><span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--fg-5)" }}>Veri bulunamadı</span></div>}
    </div>
  );
}

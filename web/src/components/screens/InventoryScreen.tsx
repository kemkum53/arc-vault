"use client";

import { useState } from "react";
import { Icon, Chip, ItemTile } from "@/components/ui";
import { RARITY } from "@/lib/constants";
import { useT, useLang } from "@/lib/i18n";
import type { DisplayItem, DisplayEconomy, DisplaySyncSummary, DisplayLoadout, Rarity } from "@/lib/types";

const SLOT_BADGE: Record<string, string> = {
  "Augment":     "AUG",
  "Shield":      "SLD",
  "Weapon 1":    "WPN·1",
  "Weapon 2":    "WPN·2",
  "Backpack":    "BP",
  "Quick Use":   "QU",
  "Augmented":   "AUG·S",
  "Safe Pocket": "SAFE",
};

interface InventoryScreenProps {
  items: DisplayItem[];
  economy: DisplayEconomy;
  syncSummary: DisplaySyncSummary;
  loadout?: DisplayLoadout | null;
}


function SegmentedControl({ options, value, onChange }: {
  options: { id: string; label: string }[]; value: string; onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: "inline-flex", padding: 3, background: "var(--bg-input)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius)" }}>
      {options.map(o => {
        const active = o.id === value;
        return (
          <button key={o.id} onClick={() => onChange(o.id)} style={{
            padding: "5px 12px",
            background: active ? "linear-gradient(135deg, rgba(123,47,247,0.4), rgba(0,210,255,0.3))" : "transparent",
            color: active ? "#fff" : "var(--fg-3)", border: "none", borderRadius: 4, cursor: "pointer",
            fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 12, letterSpacing: "0.04em",
            transition: "all 180ms cubic-bezier(0.16,1,0.3,1)",
          }}>{o.label}</button>
        );
      })}
    </div>
  );
}

function RarityFilter({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div style={{ display: "inline-flex", gap: 6 }}>
      {options.map(r => {
        const c = r === "all" ? { color: "var(--fg-3)" } : RARITY[r as Rarity];
        const active = r === value;
        return (
          <button key={r} onClick={() => onChange(r)} style={{
            padding: "5px 10px",
            background: active ? `${c.color}22` : "transparent",
            border: `1px solid ${active ? c.color : "var(--border-strong)"}`,
            color: c.color, borderRadius: "var(--radius)", cursor: "pointer",
            fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 11,
            letterSpacing: "0.12em", textTransform: "uppercase",
            transition: "all 180ms cubic-bezier(0.16,1,0.3,1)",
          }}>{r === "all" ? "All" : r}</button>
        );
      })}
    </div>
  );
}

export function InventoryScreen({ items, economy, syncSummary, loadout }: InventoryScreenProps) {
  const t = useT();
  const { lang } = useLang();
  const [rarity, setRarity] = useState("all");
  const [type, setType] = useState("all");
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<"name" | "rarity">("rarity");
  const [groupDur, setGroupDur] = useState(false);

  const CATEGORIES = [
    { id: "all", label: "ALL" },
    { id: "loadout", label: "LOADOUT" },
    { id: "augments", label: "AUGMENTS" },
    { id: "shields", label: "SHIELDS" },
    { id: "weapons", label: "WEAPONS" },
    { id: "ammunitions", label: "AMMUNITIONS" },
    { id: "weapon_mods", label: "WEAPON MODS" },
    { id: "quick_use", label: "QUICK USE" },
    { id: "keys", label: "KEYS" },
    { id: "crafting_materials", label: "CRAFTING MATERIALS" },
    { id: "misc", label: "MISC" },
  ];

  const loadoutItems: DisplayItem[] = (() => {
    if (!loadout) return [];
    const out: DisplayItem[] = [];
    const push = (slot: typeof loadout.augment, slotKey: string, category: string, subtitle: string) => {
      if (!slot) return;
      out.push({
        i: `lo_${slotKey}_${slot.itemId}`,
        baseId: slot.itemId,
        n: slot.name,
        q: slot.quantity,
        d: slot.durability,
        dMax: slot.durMax,
        t: slot.tier,
        r: slot.rarity,
        type: category,
        category,
        glyph: slot.glyph,
        subtitle,
        image: slot.image,
        mods: slot.mods,
      });
    };
    push(loadout.augment,  "augment",  "augments", "Augment");
    push(loadout.shield,   "shield",   "shields",  "Shield");
    push(loadout.weapon1,  "weapon1",  "weapons",  "Weapon 1");
    push(loadout.weapon2,  "weapon2",  "weapons",  "Weapon 2");
    loadout.backpack.forEach((s, idx)       => push(s, `bp_${idx}`,  s.mods.length > 0 ? "weapons" : "misc", "Backpack"));
    loadout.quickItems.forEach((s, idx)     => push(s, `qi_${idx}`,  s.mods.length > 0 ? "weapons" : "misc", "Quick Use"));
    loadout.augmentedSlots.forEach((s, idx) => push(s, `aug_${idx}`, s.mods.length > 0 ? "weapons" : "misc", "Augmented"));
    loadout.safePocket.forEach((s, idx)     => push(s, `sp_${idx}`,  s.mods.length > 0 ? "weapons" : "misc", "Safe Pocket"));

    // Aynı item tipini birleştir (mods olan silahlar ayrı kalır)
    const grouped = new Map<string, DisplayItem>();
    for (const item of out) {
      const key = item.mods.length > 0 ? item.i : item.baseId;
      if (grouped.has(key)) {
        grouped.get(key)!.q += item.q;
      } else {
        grouped.set(key, { ...item, i: `lo_group_${key}` });
      }
    }
    return Array.from(grouped.values());
  })();

  const displayItems = (() => {
    if (!groupDur) return items;
    const durBand = (d?: number) => {
      if (d == null) return "";
      if (d >= 100) return "full";
      if (d >= 65) return "mid";
      return "low";
    };
    const nonWeapons: DisplayItem[] = [];
    const weaponMap = new Map<string, DisplayItem>();
    const durAcc = new Map<string, { sum: number; count: number }>();
    for (const item of items) {
      if (item.category !== "weapons") { nonWeapons.push(item); continue; }
      const key = `${item.baseId}__${item.t ?? ""}__${durBand(item.d)}`;
      const existing = weaponMap.get(key);
      if (existing) {
        existing.q += item.q;
        if (item.d != null) {
          const acc = durAcc.get(key)!;
          acc.sum += item.d;
          acc.count += 1;
        }
      } else {
        weaponMap.set(key, { ...item, mods: [] });
        durAcc.set(key, { sum: item.d ?? 0, count: item.d != null ? 1 : 0 });
      }
    }
    for (const [key, item] of weaponMap) {
      const acc = durAcc.get(key)!;
      if (acc.count > 0) item.d = Math.round(acc.sum / acc.count);
    }
    return [...nonWeapons, ...weaponMap.values()];
  })();

  // LOADOUT: sadece loadout itemleri.
  // Diğer kategoriler: envanter (DB). Envanter zaten loadout itemlerini içeriyor
  // (sync_service yazıyor). Eksik kalırsa loadout'tan tamamla; kategoriyi
  // displayItems'tan al (referans verisi doğru kategoriyi bilir).
  const invCategoryByBaseId = new Map(displayItems.map(i => [i.baseId, i.category]));
  const enrichedLoadoutItems = loadoutItems.map(i => ({
    ...i,
    category: invCategoryByBaseId.get(i.baseId) ?? i.category,
    type: invCategoryByBaseId.get(i.baseId) ?? i.type,
  }));

  const baseItems = (() => {
    if (type === "loadout") return enrichedLoadoutItems;
    const existingBaseIds = new Set(displayItems.map(i => i.baseId));
    const extras = enrichedLoadoutItems.filter(i => !existingBaseIds.has(i.baseId));
    return extras.length ? [...displayItems, ...extras] : displayItems;
  })();

  const filtered = baseItems.filter(item => {
    if (rarity !== "all" && item.r !== rarity) return false;
    if (type !== "all" && type !== "loadout" && item.category !== type) return false;
    if (query) {
      const q = query.toLowerCase();
      const nameMatch = item.n.toLowerCase().includes(q);
      const modMatch = item.mods.some(m => m.name.toLowerCase().includes(q));
      if (!nameMatch && !modMatch) return false;
    }
    return true;
  }).sort((a, b) => {
    if (sortBy === "rarity") {
      const order: Record<string, number> = { legendary: 0, epic: 1, rare: 2, uncommon: 3, common: 4 };
      const diff = (order[a.r] ?? 5) - (order[b.r] ?? 5);
      if (diff !== 0) return diff;
    }
    return a.n.localeCompare(b.n, lang);
  });

  const RARITIES = ["all", "common", "uncommon", "rare", "epic", "legendary"];
  const SORT_OPTIONS = [
    { id: "name" as const, label: t("inv.sortName") },
    { id: "rarity" as const, label: t("inv.sortRarity") },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* ── Toolbar (full width) ── */}
      <div style={{
        background: "var(--bg-2)", border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)", overflow: "hidden",
      }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "12px 16px", borderBottom: "1px solid var(--border)",
        }}>
          <div style={{
            flex: "1 1 200px", display: "flex", alignItems: "center", gap: 8,
            background: "var(--bg-input)", border: "1px solid var(--border-strong)",
            borderRadius: "var(--radius)", padding: "0 12px", height: 34,
          }}>
            <Icon name="search" size={15} style={{ color: "var(--fg-5)", flexShrink: 0 }} />
            <input value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder={t("inv.search")}
              style={{ flex: 1, background: "transparent", border: "none", outline: "none",
                color: "var(--fg-2)", fontFamily: "var(--font-ui)", fontSize: 13 }} />
            {query && (
              <button onClick={() => setQuery("")} style={{
                background: "none", border: "none", padding: 0, cursor: "pointer",
                color: "var(--fg-5)", display: "flex", flexShrink: 0,
              }}><Icon name="x" size={13} /></button>
            )}
          </div>
          <div style={{ width: 1, height: 20, background: "var(--border)" }} />
          <SegmentedControl options={SORT_OPTIONS} value={sortBy} onChange={(v) => setSortBy(v as "name" | "rarity")} />
          <label onClick={() => setGroupDur(!groupDur)} style={{
            display: "flex", alignItems: "center", gap: 6, cursor: "pointer",
            padding: "5px 10px", borderRadius: "var(--radius)",
            background: groupDur ? "rgba(123,47,247,0.08)" : "transparent",
            border: `1px solid ${groupDur ? "rgba(123,47,247,0.25)" : "transparent"}`,
            fontFamily: "var(--font-ui)", fontSize: 12, color: groupDur ? "#b388ff" : "var(--fg-4)",
            userSelect: "none", transition: "all 180ms", whiteSpace: "nowrap",
          }}>
            <span style={{
              width: 15, height: 15, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center",
              border: `1.5px solid ${groupDur ? "#7b2ff7" : "var(--border-strong)"}`,
              background: groupDur ? "rgba(123,47,247,0.2)" : "transparent", transition: "all 180ms",
            }}>
              {groupDur && <Icon name="check" size={10} style={{ color: "#b388ff" }} />}
            </span>
            {t("inv.groupDur")}
          </label>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px" }}>
          <div style={{ flex: 1, overflow: "auto", display: "flex" }}>
            <SegmentedControl options={CATEGORIES} value={type} onChange={setType} />
          </div>
          <div style={{ width: 1, height: 20, background: "var(--border)", flexShrink: 0 }} />
          <RarityFilter value={rarity} onChange={setRarity} options={RARITIES} />
        </div>
      </div>

      {/* ── Stats (full width) ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "0 4px" }}>
        <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 18, color: "var(--fg-1)" }}>
          {filtered.length} <span style={{ fontSize: 13, fontWeight: 400, color: "var(--fg-4)" }}>item</span>
        </span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--fg-5)" }}>
          {economy.usedSlots}/{economy.maxSlots} {t("dash.slots")}
        </span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--fg-5)" }}>
          {economy.totalValue.toLocaleString()} c
        </span>
        <div style={{ flex: 1 }} />
        <Chip tone="success">{syncSummary.syncedItems} synced</Chip>
      </div>

      {/* ── Items grid ── */}
      <div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))", gap: 8 }}>
          {filtered.map(item => (
            <ItemTile
              key={item.i}
              item={item}
              slotBadge={type === "loadout" ? SLOT_BADGE[item.subtitle] ?? item.subtitle : undefined}
            />
          ))}
        </div>
        {filtered.length === 0 && (
          <div style={{ textAlign: "center", padding: 40, fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--fg-5)" }}>
            {type === "loadout" ? t("inv.empty") : items.length === 0 ? t("inv.empty") : t("inv.noMatch")}
          </div>
        )}
      </div>
    </div>
  );
}

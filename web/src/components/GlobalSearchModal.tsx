"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/ui";
import { useT, useLang } from "@/lib/i18n";
import { RARITY } from "@/lib/constants";
import { getSyncedData, getItemsReference, getModsReference } from "@/lib/api";
import type { AccountResponse, ItemReference, ModReference, Rarity } from "@/lib/types";

interface Props {
  accounts: AccountResponse[];
  onClose: () => void;
}

interface ModEntry {
  mod_id: string;
  name: string;
  rarity: Rarity;
  image?: string;
}

interface InventoryEntry {
  itemId: string;
  baseId: string;
  name: string;
  rarity: Rarity;
  type: string;
  category: string;
  image?: string;
  quantity: number;
  tier: string | null;
  durability: number | null;
  durabilityMax: number | null;
  mods: ModEntry[];
  modNames: string[];
}

interface AccountData {
  accountId: string;
  accountName: string;
  items: InventoryEntry[];
}

interface StackedGroup {
  baseId: string;
  entries: { charName: string; item: InventoryEntry }[];
  primary: InventoryEntry;
}

// ─── Mod slot sistemi (aynı ItemTile ile) ───

type SlotKey = "muzzle" | "grip" | "magazine" | "stock";

const MOD_SLOT_PATTERNS: [RegExp, SlotKey][] = [
  [/compensator/i, "muzzle"], [/silencer/i, "muzzle"], [/muzzle/i, "muzzle"],
  [/extended_barrel/i, "muzzle"], [/shotgun_choke/i, "muzzle"],
  [/kinetic_converter/i, "stock"], [/grip/i, "grip"], [/anvil_splitter/i, "grip"],
  [/mag/i, "magazine"], [/stock/i, "stock"],
];

function classifyMod(modId: string): SlotKey {
  for (const [pat, slot] of MOD_SLOT_PATTERNS) {
    if (pat.test(modId)) return slot;
  }
  return "muzzle";
}

const WEAPON_SLOTS: Record<string, SlotKey[]> = {
  arpeggio: ["muzzle","grip","magazine","stock"], bobcat: ["muzzle","grip","magazine","stock"],
  il_toro: ["muzzle","grip","magazine","stock"], kettle: ["muzzle","grip","magazine","stock"],
  osprey: ["muzzle","grip","magazine","stock"], stitcher: ["muzzle","grip","magazine","stock"],
  vulcano: ["muzzle","grip","magazine","stock"], canto: ["muzzle","grip","magazine","stock"],
  bettina: ["muzzle","grip","stock"], ferro: ["muzzle","grip","stock"], rattler: ["muzzle","grip","stock"],
  renegade: ["muzzle","magazine","stock"], torrente: ["muzzle","magazine","stock"],
  tempest: ["muzzle","grip","magazine"],
  anvil: ["muzzle","grip"], aphelion: ["grip","stock"], hullcracker: ["grip","stock"],
  burletta: ["muzzle","magazine"], venator: ["grip","magazine"],
  hairpin: ["magazine"],
  dolabra: [], equalizer: [], jupiter: [], rascal: [],
};

function getAvailableSlots(baseId: string): SlotKey[] {
  return WEAPON_SLOTS[baseId] || ["muzzle","grip","magazine","stock"];
}

// ─── Helpers ───

function normalizeRarity(r: string | null | undefined): Rarity {
  if (!r) return "common";
  const lower = r.toLowerCase();
  if (["common","uncommon","rare","epic","legendary"].includes(lower)) return lower as Rarity;
  return "common";
}

function proxyCdnUrl(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  return url.replace("https://cdn.arctracker.io/", "/cdn/");
}

const CATEGORY_MAP: Record<string, string> = {
  "augment":"augments","shield":"shields","assault rifle":"weapons","smg":"weapons",
  "pistol":"weapons","shotgun":"weapons","battle rifle":"weapons","lmg":"weapons",
  "sniper rifle":"weapons","hand cannon":"weapons","ammunition":"ammunitions",
  "modification":"weapon_mods","quick use":"quick_use","key":"keys",
  "recyclable":"crafting_materials","topside material":"crafting_materials",
  "refined material":"crafting_materials","basic material":"crafting_materials",
  "nature":"crafting_materials","special":"weapons","trinket":"misc",
  "blueprint":"misc","misc":"misc",
};

// ─── StatRow ───

function StatRow({ label, value, color, bar }: { label: string; value: string; color: string; bar?: number }) {
  return (
    <div style={{ padding: "4px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontFamily: "var(--font-ui)", fontSize: 11, color: "var(--fg-4)" }}>{label}</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700, color }}>{value}</span>
      </div>
      {typeof bar === "number" && (
        <div style={{ marginTop: 3, height: 3, borderRadius: 2, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
          <div style={{ width: `${Math.min(bar, 100)}%`, height: "100%", background: color, borderRadius: 2 }} />
        </div>
      )}
    </div>
  );
}

// ─── Tooltip (aynı envanterdeki gibi, yandan çıkar) ───

type Side = "left" | "right";

function SearchModSlot({ mod, slotKey }: { mod: ModEntry | undefined; slotKey: string }) {
  const [hover, setHover] = useState(false);
  const filled = !!mod;
  const mRarity = filled ? RARITY[mod!.rarity] || RARITY.common : null;

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        flex: 1, aspectRatio: "1", borderRadius: 6, position: "relative",
        background: filled ? `${mRarity!.color}15` : "rgba(255,255,255,0.02)",
        border: `1.5px solid ${filled && hover ? mRarity!.color : filled ? `${mRarity!.color}55` : "rgba(255,255,255,0.06)"}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        overflow: "visible", cursor: filled ? "default" : undefined,
        transition: "border-color 120ms ease",
      }}
    >
      {filled ? (
        <img
          src={mod!.image || `/cdn/items/v2/${mod!.mod_id}.png`}
          alt={mod!.name}
          style={{ width: "75%", height: "75%", objectFit: "contain" }}
        />
      ) : (
        <div style={{ width: 16, height: 16, borderRadius: 3, border: "1.5px dashed rgba(255,255,255,0.08)" }} />
      )}
      {filled && hover && (
        <div style={{
          position: "absolute", bottom: "calc(100% + 6px)", left: "50%",
          transform: "translateX(-50%)", whiteSpace: "nowrap",
          background: "#0c0c16", border: `1px solid ${mRarity!.color}`,
          borderRadius: 6, padding: "4px 8px",
          boxShadow: `0 4px 12px rgba(0,0,0,0.6), 0 0 8px ${mRarity!.glow}`,
          zIndex: 1001,
          animation: "av-fade-in 80ms ease-out",
        }}>
          <span style={{
            fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600,
            color: mRarity!.color,
          }}>{mod!.name}</span>
          <div style={{
            position: "absolute", bottom: -4, left: "50%",
            width: 7, height: 7, background: "#0c0c16",
            border: `1px solid ${mRarity!.color}`,
            borderTop: "none", borderLeft: "none",
            transform: "translateX(-50%) rotate(45deg)",
          }} />
        </div>
      )}
    </div>
  );
}

function SearchTooltip({ item, side, owners, tileRect }: {
  item: InventoryEntry; side: Side; owners?: string[]; tileRect: DOMRect;
}) {
  const r = RARITY[item.rarity] || RARITY.common;
  const isWeapon = item.category === "weapons";

  const modsBySlot = new Map<SlotKey, ModEntry>();
  for (const mod of item.mods) {
    modsBySlot.set(classifyMod(mod.mod_id), mod);
  }
  const availableSlots = isWeapon ? getAvailableSlots(item.baseId) : [];

  const tooltipWidth = isWeapon ? 220 : 180;
  const tileCenterY = tileRect.top + tileRect.height / 2;
  const left = side === "right" ? tileRect.right + 12 : tileRect.left - 12 - tooltipWidth;

  const arrowStyle: React.CSSProperties = side === "right"
    ? { position: "absolute", top: "50%", left: -5, width: 10, height: 10, background: "#0c0c16",
        border: `1px solid ${r.color}`, borderTop: "none", borderRight: "none",
        transform: "translateY(-50%) rotate(45deg)" }
    : { position: "absolute", top: "50%", right: -5, width: 10, height: 10, background: "#0c0c16",
        border: `1px solid ${r.color}`, borderBottom: "none", borderLeft: "none",
        transform: "translateY(-50%) rotate(45deg)" };

  return (
    <div style={{
      position: "fixed", left, top: tileCenterY, transform: "translateY(-50%)", zIndex: 9999,
      width: tooltipWidth,
      background: "#0c0c16",
      border: `1px solid ${r.color}`,
      borderRadius: 10,
      boxShadow: `0 12px 40px rgba(0,0,0,0.85), 0 0 16px ${r.glow}`,
      overflow: "visible",
      animation: side === "right" ? "av-tooltip-right 120ms ease-out" : "av-tooltip-left 120ms ease-out",
    }}>
      <div style={arrowStyle} />

      <div style={{
        padding: "10px 12px 0",
        fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 13,
        color: r.color, lineHeight: 1.3,
      }}>{item.name}</div>

      <div style={{ display: "flex", gap: 5, padding: "6px 12px 0", flexWrap: "wrap", alignItems: "center" }}>
        <span style={{
          padding: "2px 7px", borderRadius: 3, background: "rgba(255,255,255,0.08)",
          fontFamily: "var(--font-mono)", fontSize: 8, fontWeight: 700,
          color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.1em",
        }}>{item.type || item.category}</span>
        <span style={{
          padding: "2px 7px", borderRadius: 3, background: `${r.color}22`,
          fontFamily: "var(--font-mono)", fontSize: 8, fontWeight: 700,
          color: r.color, textTransform: "uppercase", letterSpacing: "0.1em",
        }}>{item.rarity}</span>
        {item.quantity > 1 && (
          <span style={{
            marginLeft: "auto", padding: "2px 7px", borderRadius: 3,
            background: "rgba(0,210,255,0.12)",
            fontFamily: "var(--font-mono)", fontSize: 8, fontWeight: 700, color: "#00d2ff",
          }}>x{item.quantity}</span>
        )}
      </div>

      {isWeapon && availableSlots.length > 0 && (
        <div style={{ padding: "10px 12px 0" }}>
          <div style={{ display: "flex", gap: 5 }}>
            {availableSlots.map(slotKey => (
              <SearchModSlot key={slotKey} mod={modsBySlot.get(slotKey)} slotKey={slotKey} />
            ))}
          </div>
        </div>
      )}

      <div style={{ padding: "8px 12px 10px", display: "flex", flexDirection: "column" }}>
        {item.tier && <StatRow label="Tier" value={item.tier} color={r.color} />}
        {item.durability != null && (() => {
          const pct = item.durabilityMax ? Math.round(item.durability! / item.durabilityMax * 100) : item.durability!;
          const label = item.durabilityMax ? `${item.durability}/${item.durabilityMax}` : `${item.durability}%`;
          return (
            <StatRow
              label="Durability"
              value={label}
              color={pct > 50 ? "#4caf50" : pct > 20 ? "#ff9800" : "#f44336"}
              bar={pct}
            />
          );
        })()}
        {!isWeapon && item.quantity > 1 && <StatRow label="Adet" value={`${item.quantity}`} color="#00d2ff" />}
      </div>

      {owners && owners.length > 0 && (
        <div style={{ padding: "0 12px 8px", display: "flex", gap: 4, flexWrap: "wrap" }}>
          {owners.map(name => (
            <span key={name} style={{
              padding: "2px 6px", borderRadius: 3,
              background: "rgba(123,47,247,0.12)",
              fontFamily: "var(--font-mono)", fontSize: 8, fontWeight: 600,
              color: "#7b2ff7",
            }}>{name.split("#")[0]}</span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── StackedTile ───

function StackedTile({ group, q }: { group: StackedGroup; q: string }) {
  const item = group.primary;
  const count = group.entries.length;
  const totalQty = group.entries.reduce((s, e) => s + e.item.quantity, 0);
  const [hovered, setHovered] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const [side, setSide] = useState<Side>("right");
  const [tileRect, setTileRect] = useState<DOMRect | null>(null);
  const tileRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rc = RARITY[item.rarity] || RARITY.common;
  const modMatch = item.modNames.some(mn => mn.toLowerCase().includes(q));
  const owners = [...new Set(group.entries.map(e => e.charName))];

  const handleEnter = () => {
    if (hideRef.current) { clearTimeout(hideRef.current); hideRef.current = null; }
    setHovered(true);
    if (tileRef.current) {
      const rect = tileRef.current.getBoundingClientRect();
      setSide(rect.left + rect.width / 2 > window.innerWidth / 2 ? "left" : "right");
      setTileRect(rect);
    }
    timerRef.current = setTimeout(() => setShowTooltip(true), 250);
  };
  const handleLeave = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    hideRef.current = setTimeout(() => {
      setHovered(false);
      setShowTooltip(false);
    }, 100);
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (hideRef.current) clearTimeout(hideRef.current);
    };
  }, []);

  return (
    <div style={{ position: "relative", marginRight: count > 1 ? 4 : 0, marginBottom: count > 1 ? 4 : 0 }}>
      {count > 2 && (
        <div style={{
          position: "absolute", inset: 0,
          transform: "translate(4px, 4px)",
          background: "var(--bg-3)",
          border: `1px solid ${rc.border}`,
          borderRadius: 8,
        }} />
      )}
      {count > 1 && (
        <div style={{
          position: "absolute", inset: 0,
          transform: "translate(2px, 2px)",
          background: "var(--bg-2)",
          border: `1px solid ${rc.border}`,
          borderRadius: 8,
        }} />
      )}
      <div
        ref={tileRef}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        style={{
          position: "relative",
          zIndex: hovered ? 100 : 1,
          background: "var(--bg-2)",
          border: `1px solid ${hovered ? rc.color : rc.border}`,
          borderRadius: 8,
          padding: 6,
          display: "flex", flexDirection: "column", gap: 3,
          cursor: "default",
          transition: "all 150ms cubic-bezier(0.16,1,0.3,1)",
          boxShadow: hovered ? `0 0 14px ${rc.glow}` : "none",
        }}
      >
        {showTooltip && tileRect && createPortal(
          <SearchTooltip item={{ ...item, quantity: totalQty }} side={side} owners={owners} tileRect={tileRect} />,
          document.body
        )}

        <div style={{
          aspectRatio: "1", borderRadius: 6,
          background: `radial-gradient(circle at 50% 45%, ${rc.glow}, transparent 70%), #0a0a0f`,
          display: "flex", alignItems: "center", justifyContent: "center",
          position: "relative", overflow: "hidden",
        }}>
          {item.image ? (
            <img src={item.image} alt={item.name} style={{ maxWidth: "78%", maxHeight: "78%", objectFit: "contain" }} />
          ) : (
            <span style={{
              fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16,
              color: "var(--fg-1)", letterSpacing: "0.04em",
            }}>{item.name.substring(0, 2).toUpperCase()}</span>
          )}
          {item.tier && (
            <span style={{
              position: "absolute", top: 3, left: 4,
              fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 700,
              color: rc.color, textShadow: "0 1px 3px #000",
            }}>{item.tier}</span>
          )}
          {item.durability != null && (() => {
            const barPct = item.durabilityMax ? Math.round(item.durability! / item.durabilityMax * 100) : item.durability!;
            return (
              <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 2, background: "rgba(0,0,0,0.5)" }}>
                <div style={{
                  width: `${Math.min(barPct, 100)}%`, height: "100%",
                  background: barPct > 50 ? "#4caf50" : barPct > 20 ? "#ff9800" : "#f44336",
                }} />
              </div>
            );
          })()}
          {modMatch && (
            <div style={{
              position: "absolute", top: 3, right: 4,
              width: 6, height: 6, borderRadius: "50%",
              background: "#b06bff", boxShadow: "0 0 6px rgba(176,107,255,0.6)",
            }} />
          )}
        </div>

        <div style={{
          fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 10,
          color: rc.color, lineHeight: 1.2,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          textAlign: "center", padding: "0 2px",
        }}>{item.name}</div>
      </div>

      {totalQty > 1 && (
        <div style={{
          position: "absolute", top: -5, right: -5,
          minWidth: 18, height: 18,
          background: "linear-gradient(135deg, #7b2ff7, #00d2ff)",
          borderRadius: 9,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 700,
          color: "#fff",
          border: "2px solid var(--bg-2)",
          zIndex: 101,
          padding: "0 3px",
        }}>{totalQty}</div>
      )}
    </div>
  );
}

// ─── Modal ───

export function GlobalSearchModal({ accounts, onClose }: Props) {
  const t = useT();
  const { lang } = useLang();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [accountsData, setAccountsData] = useState<AccountData[]>([]);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadAll = useCallback(async () => {
    try {
      const [itemsRef, modsRef] = await Promise.all([getItemsReference(), getModsReference()]);

      const resolveModEntry = (modId: string): ModEntry => {
        const mr = modsRef[modId] || (() => {
          const stripped = modId.replace(/_(iv|iii|ii|i)(?=_|$)/, "");
          return stripped !== modId ? modsRef[stripped] : undefined;
        })();
        return {
          mod_id: modId,
          name: mr ? (lang === "en" ? mr.name_en || mr.name_tr : mr.name_tr || mr.name_en) : modId.replace(/_/g, " "),
          rarity: normalizeRarity(mr?.rarity),
          image: proxyCdnUrl(mr?.image),
        };
      };

      const results: AccountData[] = [];

      await Promise.all(accounts.map(async (acc) => {
        const accName = acc.display_name
          ? `${acc.display_name}#${acc.display_name_discriminator || "0000"}`
          : "?";
        try {
          const data = await getSyncedData(acc.id);
          const items: InventoryEntry[] = data.inventory.map(inv => {
            const ref = resolveRef(inv.item_id, inv.tier, itemsRef);
            const name = ref
              ? (lang === "en" ? ref.name_en || ref.name_tr : ref.name_tr || ref.name_en)
              : inv.item_id;
            const typeRaw = ref?.type || "";
            const category = CATEGORY_MAP[typeRaw.toLowerCase()] || "misc";
            const isWeapon = category === "weapons";
            const WEAPON_MAX_DUR: Record<string, number> = { "I": 100, "II": 110, "III": 120, "IV": 130 };
            let dur = inv.durability;
            let durMax: number | null = null;
            if (isWeapon && dur != null && inv.tier) {
              durMax = WEAPON_MAX_DUR[inv.tier] || 100;
              dur = Math.round(durMax * dur / 100);
            }
            const modEntries = inv.mods.map(m => resolveModEntry(m.mod_id));
            return {
              itemId: inv.item_id,
              baseId: inv.item_id,
              name,
              rarity: normalizeRarity(ref?.rarity),
              type: typeRaw,
              category,
              image: proxyCdnUrl(ref?.image),
              quantity: inv.quantity,
              tier: inv.tier,
              durability: dur,
              durabilityMax: durMax,
              mods: modEntries,
              modNames: modEntries.map(m => m.name),
            };
          });
          results.push({ accountId: acc.id, accountName: accName, items });
        } catch { /* skip */ }
      }));

      setAccountsData(results);
    } catch { /* ignore */ }
    setLoading(false);
  }, [accounts, lang]);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const q = query.toLowerCase().trim();

  const rarityOrder: Record<string, number> = { legendary: 0, epic: 1, rare: 2, uncommon: 3, common: 4 };

  function durBand(dur: number | null): string {
    if (dur == null) return "";
    if (dur >= 100) return "full";
    if (dur >= 65) return "mid";
    return "low";
  }

  function itemStackKey(item: InventoryEntry): string {
    const modsPart = [...item.mods].sort((a, b) => a.mod_id.localeCompare(b.mod_id))
      .map(m => m.mod_id).join("|");
    const isWeapon = item.category === "weapons";
    const durPart = isWeapon ? durBand(item.durability) : String(item.durability ?? "");
    return `${item.baseId}__${item.tier ?? ""}__${durPart}__${modsPart}`;
  }

  function stackItems(items: InventoryEntry[], charName: string): StackedGroup[] {
    const groups = new Map<string, { charName: string; item: InventoryEntry }[]>();
    for (const item of items) {
      const key = itemStackKey(item);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push({ charName, item });
    }
    return Array.from(groups.entries())
      .map(([key, entries]) => {
        entries.sort((a, b) => (rarityOrder[a.item.rarity] ?? 5) - (rarityOrder[b.item.rarity] ?? 5));
        let primary = entries[0].item;
        if (primary.category === "weapons" && entries.length > 1) {
          let durSum = 0, durCount = 0;
          for (const e of entries) {
            if (e.item.durability != null) { durSum += e.item.durability; durCount++; }
          }
          if (durCount > 1) {
            primary = { ...primary, durability: Math.round(durSum / durCount) };
          }
        }
        return { baseId: key, entries, primary };
      })
      .sort((a, b) => (rarityOrder[a.primary.rarity] ?? 5) - (rarityOrder[b.primary.rarity] ?? 5) || a.primary.name.localeCompare(b.primary.name, lang));
  }

  const filteredAccounts = q.length >= 2
    ? accountsData.map(acc => {
        const matchingItems = acc.items.filter(item =>
          item.name.toLowerCase().includes(q) ||
          item.itemId.toLowerCase().includes(q) ||
          item.modNames.some(mn => mn.toLowerCase().includes(q))
        );
        if (matchingItems.length === 0) return null;
        return { ...acc, items: matchingItems, stacked: stackItems(matchingItems, acc.accountName) };
      }).filter(Boolean) as (AccountData & { stacked: StackedGroup[] })[]
    : [];

  const totalItems = filteredAccounts.reduce((s, a) => s + a.items.length, 0);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        background: "rgba(0,0,0,0.7)",
        backdropFilter: "blur(12px)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "min(10vh, 80px) 24px 24px",
        animation: "av-fade-in 150ms ease-out",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 720, maxWidth: "100%", maxHeight: "80vh",
          background: "var(--bg-2)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 16,
          boxShadow: "0 32px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(123,47,247,0.08), 0 0 60px rgba(123,47,247,0.04)",
          display: "flex", flexDirection: "column",
          overflow: "hidden",
          animation: "av-slide-up 200ms cubic-bezier(0.16,1,0.3,1)",
        }}
      >
        <div style={{
          height: 2, flexShrink: 0,
          background: "linear-gradient(90deg, rgba(123,47,247,0.6), rgba(0,210,255,0.6), rgba(123,47,247,0.6))",
        }} />

        <div style={{
          padding: "18px 24px",
          display: "flex", alignItems: "center", gap: 14,
          borderBottom: `1px solid ${focused ? "rgba(123,47,247,0.15)" : "rgba(255,255,255,0.05)"}`,
          transition: "border-color 200ms ease",
        }}>
          <Icon name="search" size={20} style={{
            color: focused ? "#7b2ff7" : "var(--fg-4)",
            transition: "color 200ms ease", flexShrink: 0,
          }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={t("home.searchPlaceholder")}
            style={{
              flex: 1, background: "none", border: "none", outline: "none",
              color: "var(--fg-1)", fontSize: 16, fontFamily: "var(--font-display)",
              fontWeight: 500, letterSpacing: "0.02em",
            }}
          />
          {query && (
            <button onClick={() => setQuery("")} style={{
              background: "rgba(255,255,255,0.05)", border: "none", cursor: "pointer",
              color: "var(--fg-4)", padding: "3px 6px", borderRadius: 4,
              display: "flex", alignItems: "center",
            }}><Icon name="x" size={12} /></button>
          )}
          <button onClick={onClose} style={{
            background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 6, cursor: "pointer", color: "var(--fg-5)", padding: "3px 8px",
            fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, letterSpacing: "0.04em",
          }}>ESC</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
          {loading ? (
            <div style={{ padding: 60, textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
              <div style={{
                width: 32, height: 32, borderRadius: "50%",
                background: "conic-gradient(from -90deg, #00d2ff 0deg, #7b2ff7 270deg, rgba(255,255,255,0.04) 270deg 360deg)",
                display: "flex", alignItems: "center", justifyContent: "center",
                animation: "av-spin 2.2s linear infinite",
              }}><div style={{ width: 22, height: 22, borderRadius: "50%", background: "var(--bg-2)" }} /></div>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--fg-5)", letterSpacing: "0.06em" }}>
                {t("home.searchLoading")}
              </span>
            </div>
          ) : q.length < 2 ? (
            <div style={{ padding: "50px 40px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
              <Icon name="search" size={32} style={{ color: "var(--fg-5)", opacity: 0.4 }} />
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--fg-5)", letterSpacing: "0.04em", lineHeight: 1.6 }}>
                {t("home.searchHint")}
              </span>
            </div>
          ) : filteredAccounts.length === 0 ? (
            <div style={{ padding: "50px 40px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
              <Icon name="x" size={32} style={{ color: "var(--fg-5)", opacity: 0.3 }} />
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--fg-5)", letterSpacing: "0.04em" }}>
                {t("home.searchEmpty")}
              </span>
            </div>
          ) : (
            filteredAccounts.map((acc, accIdx) => (
              <div key={acc.accountId} style={accIdx > 0 ? { borderTop: "1px solid rgba(255,255,255,0.04)" } : undefined}>
                <div style={{
                  padding: "14px 24px 8px",
                  display: "flex", alignItems: "center", gap: 10,
                  position: "sticky", top: 0,
                  background: "var(--bg-2)", zIndex: 110,
                }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: 6,
                    background: "linear-gradient(135deg, rgba(123,47,247,0.15), rgba(0,210,255,0.1))",
                    border: "1px solid rgba(123,47,247,0.2)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <Icon name="user-plus" size={12} style={{ color: "#7b2ff7" }} />
                  </div>
                  <span style={{
                    fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 14,
                    color: "var(--fg-1)", letterSpacing: "0.03em",
                  }}>{acc.accountName}</span>
                  <span style={{
                    fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-5)",
                    background: "rgba(255,255,255,0.03)", padding: "2px 8px", borderRadius: 4,
                  }}>{acc.items.length}</span>
                </div>

                <div style={{
                  padding: "4px 24px 16px",
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(90px, 1fr))",
                  gap: 10,
                }}>
                  {acc.stacked.map(group => (
                    <StackedTile key={group.baseId} group={group} q={q} />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        {!loading && q.length >= 2 && filteredAccounts.length > 0 && (
          <div style={{
            padding: "10px 24px",
            borderTop: "1px solid rgba(255,255,255,0.05)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-5)", letterSpacing: "0.06em" }}>
              <span style={{ color: "#00d2ff" }}>{totalItems}</span> sonuç · <span style={{ color: "#7b2ff7" }}>{filteredAccounts.length}</span> karakter
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

const TIER_MAP: Record<string, string> = { "I":"i","II":"ii","III":"iii","IV":"iv","V":"v" };

function resolveRef(
  itemId: string, tier: string | null, ref: Record<string, ItemReference>
): ItemReference | undefined {
  if (ref[itemId]) return ref[itemId];
  if (tier) {
    const suffix = TIER_MAP[tier.toUpperCase()];
    if (suffix) {
      const k = `${itemId}_${suffix}`;
      if (ref[k]) return ref[k];
    }
  }
  const prefix = itemId + "_";
  for (const key of Object.keys(ref)) {
    if (key.startsWith(prefix)) return ref[key];
  }
  const stripped = itemId.replace(/_(iv|iii|ii|i)(?=_|$)/, "");
  if (stripped !== itemId && ref[stripped]) return ref[stripped];
  return undefined;
}

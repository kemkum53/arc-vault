"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { RARITY } from "@/lib/constants";
import type { Rarity, DisplayItemMod } from "@/lib/types";

interface ItemData {
  i: string;
  baseId: string;
  n: string;
  q: number;
  d?: number;
  dMax?: number;
  t?: string;
  r: string;
  glyph: string;
  subtitle: string;
  category: string;
  image?: string;
  mods: DisplayItemMod[];
}

interface ItemTileProps {
  item: ItemData;
  slotBadge?: string;
  onClick?: () => void;
}

// ─── Mod slot sistemi ───

type SlotKey = "muzzle" | "grip" | "magazine" | "stock";

const MOD_SLOT_PATTERNS: [RegExp, SlotKey][] = [
  [/compensator/i,       "muzzle"],
  [/silencer/i,          "muzzle"],
  [/muzzle/i,            "muzzle"],
  [/extended_barrel/i,   "muzzle"],
  [/shotgun_choke/i,     "muzzle"],
  [/kinetic_converter/i, "stock"],
  [/grip/i,              "grip"],
  [/anvil_splitter/i,    "grip"],
  [/mag/i,               "magazine"],
  [/stock/i,             "stock"],
];

function classifyMod(modId: string): SlotKey {
  for (const [pat, slot] of MOD_SLOT_PATTERNS) {
    if (pat.test(modId)) return slot;
  }
  return "muzzle";
}

// Her silahın desteklediği mod slotları (wiki + oyun içi doğrulanmış)
const WEAPON_SLOTS: Record<string, SlotKey[]> = {
  // 4 slot: muzzle + grip + magazine + stock
  arpeggio:  ["muzzle", "grip", "magazine", "stock"],
  bobcat:    ["muzzle", "grip", "magazine", "stock"],
  il_toro:   ["muzzle", "grip", "magazine", "stock"],
  kettle:    ["muzzle", "grip", "magazine", "stock"],
  osprey:    ["muzzle", "grip", "magazine", "stock"],
  stitcher:  ["muzzle", "grip", "magazine", "stock"],
  vulcano:   ["muzzle", "grip", "magazine", "stock"],
  canto:     ["muzzle", "grip", "magazine", "stock"],

  // 3 slot: muzzle + grip + stock (şarjör yok)
  bettina:   ["muzzle", "grip", "stock"],
  ferro:     ["muzzle", "grip", "stock"],
  rattler:   ["muzzle", "grip", "stock"],

  // 3 slot: muzzle + magazine + stock (tutamaç yok)
  renegade:  ["muzzle", "magazine", "stock"],
  torrente:  ["muzzle", "magazine", "stock"],

  // 3 slot: muzzle + grip + magazine (dipçik yok)
  tempest:   ["muzzle", "grip", "magazine"],

  // 2 slot
  anvil:     ["muzzle", "grip"],        // muzzle + special/grip
  aphelion:  ["grip", "stock"],          // grip + stock
  hullcracker: ["grip", "stock"],        // grip + stock
  burletta:  ["muzzle", "magazine"],     // muzzle + magazine
  venator:   ["grip", "magazine"],       // grip + magazine

  // 1 slot
  hairpin:   ["magazine"],               // sadece şarjör

  // 0 slot — hiç mod takılmaz
  dolabra:   [],
  equalizer: [],
  jupiter:   [],
  rascal:    [],
};

function getAvailableSlots(baseId: string): SlotKey[] {
  return WEAPON_SLOTS[baseId] || ["muzzle", "grip", "magazine", "stock"];
}

function modImageUrl(modId: string): string {
  return `/cdn/items/v2/${modId}.png`;
}

// ─── Tooltip ───

type Side = "left" | "right";

function ModSlot({ mod, slotKey }: { mod: DisplayItemMod | undefined; slotKey: string }) {
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
          src={mod!.image || modImageUrl(mod!.mod_id)}
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

function Tooltip({ item, side }: { item: ItemData; side: Side }) {
  const r = RARITY[item.r as Rarity] || RARITY.common;
  const isWeapon = item.category === "weapons" || item.mods.length > 0;

  const modsBySlot = new Map<SlotKey, DisplayItemMod>();
  for (const mod of item.mods) {
    modsBySlot.set(classifyMod(mod.mod_id), mod);
  }

  const availableSlots = isWeapon ? getAvailableSlots(item.baseId) : [];

  const posStyle: React.CSSProperties = side === "right"
    ? { left: "calc(100% + 12px)", top: "50%", transform: "translateY(-50%)" }
    : { right: "calc(100% + 12px)", top: "50%", transform: "translateY(-50%)" };

  const arrowStyle: React.CSSProperties = side === "right"
    ? {
        position: "absolute", top: "50%", left: -5,
        width: 10, height: 10, background: "#0c0c16",
        border: `1px solid ${r.color}`,
        borderTop: "none", borderRight: "none",
        transform: "translateY(-50%) rotate(45deg)",
      }
    : {
        position: "absolute", top: "50%", right: -5,
        width: 10, height: 10, background: "#0c0c16",
        border: `1px solid ${r.color}`,
        borderBottom: "none", borderLeft: "none",
        transform: "translateY(-50%) rotate(45deg)",
      };

  return (
    <div style={{
      position: "absolute", ...posStyle, zIndex: 1000,
      width: isWeapon ? 220 : 180,
      background: "#0c0c16",
      border: `1px solid ${r.color}`,
      borderRadius: 10,
      boxShadow: `0 12px 40px rgba(0,0,0,0.85), 0 0 16px ${r.glow}`,
      overflow: "visible",
      animation: side === "right" ? "av-tooltip-right 120ms ease-out" : "av-tooltip-left 120ms ease-out",
    }}>
      <div style={arrowStyle} />

      {/* Name */}
      <div style={{
        padding: "10px 12px 0",
        fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 13,
        color: r.color, lineHeight: 1.3,
      }}>{item.n}</div>

      {/* Badges */}
      <div style={{ display: "flex", gap: 5, padding: "6px 12px 0", flexWrap: "wrap", alignItems: "center" }}>
        <span style={{
          padding: "2px 7px", borderRadius: 3,
          background: "rgba(255,255,255,0.08)",
          fontFamily: "var(--font-mono)", fontSize: 8, fontWeight: 700,
          color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.1em",
        }}>{item.subtitle || item.category}</span>
        <span style={{
          padding: "2px 7px", borderRadius: 3,
          background: `${r.color}22`,
          fontFamily: "var(--font-mono)", fontSize: 8, fontWeight: 700,
          color: r.color, textTransform: "uppercase", letterSpacing: "0.1em",
        }}>{item.r}</span>
        {item.q > 1 && (
          <span style={{
            marginLeft: "auto", padding: "2px 7px", borderRadius: 3,
            background: "rgba(0,210,255,0.12)",
            fontFamily: "var(--font-mono)", fontSize: 8, fontWeight: 700,
            color: "#00d2ff",
          }}>x{item.q}</span>
        )}
      </div>

      {/* Mod slots */}
      {isWeapon && availableSlots.length > 0 && (
        <div style={{ padding: "10px 12px 0" }}>
          <div style={{ display: "flex", gap: 5 }}>
            {availableSlots.map(slotKey => (
              <ModSlot key={slotKey} mod={modsBySlot.get(slotKey)} slotKey={slotKey} />
            ))}
          </div>
        </div>
      )}

      {/* Stats */}
      <div style={{ padding: "8px 12px 10px", display: "flex", flexDirection: "column" }}>
        {item.t && <StatRow label="Tier" value={item.t} color={r.color} />}
        {typeof item.d === "number" && (() => {
          const pct = item.dMax ? Math.round(item.d / item.dMax * 100) : item.d;
          const label = item.dMax ? `${item.d}/${item.dMax}` : `${item.d}%`;
          return (
            <StatRow
              label="Durability"
              value={label}
              color={pct > 50 ? "#4caf50" : pct > 20 ? "#ff9800" : "#f44336"}
              bar={pct}
            />
          );
        })()}
        {!isWeapon && item.q > 1 && <StatRow label="Adet" value={`${item.q}`} color="#00d2ff" />}
      </div>
    </div>
  );
}

function StatRow({ label, value, color, bar }: {
  label: string; value: string; color: string; bar?: number;
}) {
  return (
    <div style={{ padding: "4px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontFamily: "var(--font-ui)", fontSize: 11, color: "var(--fg-4)" }}>{label}</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700, color }}>{value}</span>
      </div>
      {typeof bar === "number" && (
        <div style={{
          marginTop: 3, height: 3, borderRadius: 2,
          background: "rgba(255,255,255,0.06)", overflow: "hidden",
        }}>
          <div style={{
            width: `${Math.min(bar, 100)}%`, height: "100%",
            background: color, borderRadius: 2,
          }} />
        </div>
      )}
    </div>
  );
}

// ─── ItemTile ───

export function ItemTile({ item, slotBadge, onClick }: ItemTileProps) {
  const r = RARITY[item.r as Rarity] || RARITY.common;
  const [hovered, setHovered] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const [side, setSide] = useState<Side>("right");
  const tileRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const calcSide = useCallback(() => {
    if (!tileRef.current) return;
    const rect = tileRef.current.getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    setSide(midX > window.innerWidth / 2 ? "left" : "right");
  }, []);

  const handleEnter = () => {
    if (hideRef.current) { clearTimeout(hideRef.current); hideRef.current = null; }
    setHovered(true);
    calcSide();
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
    <div ref={tileRef} className="av-tile" onClick={onClick}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      style={{
        position: "relative",
        zIndex: hovered ? 100 : 1,
        background: "var(--bg-2)",
        border: `1px solid ${hovered ? r.color : r.border}`,
        borderRadius: "var(--radius)",
        padding: 8,
        display: "flex",
        flexDirection: "column",
        gap: 4,
        cursor: "pointer",
        transition: "all 180ms cubic-bezier(0.16,1,0.3,1)",
      }}>
      {showTooltip && <Tooltip item={item} side={side} />}
      <div style={{
        aspectRatio: "1",
        borderRadius: "var(--radius-sm)",
        background: `radial-gradient(circle at 50% 45%, ${r.glow}, transparent 70%), #0a0a0f`,
        display: "flex", alignItems: "center", justifyContent: "center",
        position: "relative",
        fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18,
        color: "var(--fg-1)", letterSpacing: "0.04em", overflow: "hidden",
      }}>
        {item.image ? (
          <img src={item.image} alt={item.n} style={{ maxWidth: "80%", maxHeight: "80%", objectFit: "contain" }} />
        ) : (
          item.glyph
        )}
        {item.q > 1 && (
          <span style={{
            position: "absolute", bottom: 4, right: 6,
            fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600,
            color: "var(--fg-1)", textShadow: "0 1px 2px #000",
          }}>x{item.q}</span>
        )}
        {item.t && (
          <span style={{
            position: "absolute", top: 4, left: 6,
            fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 700,
            color: r.color, textShadow: "0 1px 2px #000",
          }}>{item.t}</span>
        )}
        {slotBadge && (
          <span style={{
            position: "absolute", bottom: 4, left: 5,
            fontFamily: "var(--font-mono)", fontSize: 8, fontWeight: 700,
            color: "rgba(255,255,255,0.45)", letterSpacing: "0.06em",
            background: "rgba(0,0,0,0.55)", borderRadius: 3,
            padding: "1px 3px", lineHeight: 1,
          }}>{slotBadge}</span>
        )}
      </div>
    </div>
  );
}

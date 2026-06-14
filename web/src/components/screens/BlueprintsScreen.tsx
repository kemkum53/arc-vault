"use client";

import { useState } from "react";
import { Icon, ProgressBar } from "@/components/ui";
import { RARITY } from "@/lib/constants";
import { useT } from "@/lib/i18n";
import type { DisplayBlueprint, Rarity } from "@/lib/types";

interface BlueprintsScreenProps {
  blueprints: DisplayBlueprint[];
}

function BlueprintCard({ bp }: { bp: DisplayBlueprint }) {
  const r = RARITY[bp.rarity as Rarity] || RARITY.common;
  return (
    <div style={{
      background: bp.learned ? "var(--bg-2)" : "rgba(255,255,255,0.015)",
      border: `1px solid ${bp.learned ? r.border : "var(--border)"}`,
      borderRadius: "var(--radius)", padding: 8,
      display: "flex", flexDirection: "column", gap: 5,
      opacity: bp.learned ? 1 : 0.5, position: "relative", overflow: "hidden",
    }}>
      <div style={{
        aspectRatio: "1", borderRadius: "var(--radius-sm)",
        background: bp.learned
          ? `radial-gradient(circle at 50% 50%, ${r.glow}, transparent 70%), #0a0a0f`
          : "repeating-linear-gradient(45deg, rgba(255,255,255,0.02) 0 4px, transparent 4px 8px), #0a0a0f",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: bp.learned ? r.color : "var(--fg-5)",
      }}>
        {bp.image ? (
          <img src={bp.image} alt={bp.n} style={{ maxWidth: "70%", maxHeight: "70%", objectFit: "contain" }} />
        ) : (
          <Icon name={bp.learned ? "scroll-text" : "lock"} size={20} />
        )}
      </div>
    </div>
  );
}

export function BlueprintsScreen({ blueprints }: BlueprintsScreenProps) {
  const t = useT();
  const [filter, setFilter] = useState<"all" | "learned" | "unlearned">("all");
  const learnedList = blueprints.filter(b => b.learned);
  const total = blueprints.length;

  const filtered = filter === "all" ? blueprints
    : filter === "learned" ? blueprints.filter(b => b.learned)
    : blueprints.filter(b => !b.learned);

  const filterOptions: { id: "all" | "learned" | "unlearned"; label: string }[] = [
    { id: "all", label: `${t("bp.all")} (${total})` },
    { id: "learned", label: `${t("bp.learnedFilter")} (${learnedList.length})` },
    { id: "unlearned", label: `${t("bp.unlearnedFilter")} (${total - learnedList.length})` },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{
        background: "var(--bg-2)", border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)", padding: "16px 20px",
        display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap",
      }}>
        <Icon name="scroll-text" size={24} style={{ color: "#b06bff" }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 18, color: "var(--fg-1)" }}>Blueprints</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--fg-4)" }}>
            {learnedList.length} / {total} {t("bp.learned")} · {total - learnedList.length} {t("bp.undiscovered")}
          </span>
        </div>
        <div style={{ display: "inline-flex", padding: 3, background: "var(--bg-input)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius)", marginLeft: 8 }}>
          {filterOptions.map(o => {
            const active = o.id === filter;
            return (
              <button key={o.id} onClick={() => setFilter(o.id)} style={{
                padding: "5px 12px",
                background: active ? "linear-gradient(135deg, rgba(123,47,247,0.4), rgba(0,210,255,0.3))" : "transparent",
                color: active ? "#fff" : "var(--fg-3)", border: "none", borderRadius: 4, cursor: "pointer",
                fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 12, letterSpacing: "0.04em",
                transition: "all 180ms cubic-bezier(0.16,1,0.3,1)",
              }}>{o.label}</button>
            );
          })}
        </div>
        <div style={{ marginLeft: "auto", width: 220 }}>
          <ProgressBar value={total > 0 ? (learnedList.length / total) * 100 : 0} height={6} accent="#b06bff" />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))", gap: 8 }}>
        {filtered.map(b => <BlueprintCard key={b.id} bp={b} />)}
      </div>

      {blueprints.length === 0 && (
        <div style={{ textAlign: "center", padding: 40, fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--fg-5)" }}>
          {t("bp.empty")}
        </div>
      )}
    </div>
  );
}

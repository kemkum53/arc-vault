"use client";

import { useState, useEffect } from "react";
import { Icon, Chip } from "@/components/ui";
import { getWorkshopProgress } from "@/lib/api";
import type { WorkshopProgressResponse, WorkshopEntry, WorkshopItem } from "@/lib/types";

const CDN_BASE = "https://cdn.arctracker.io/items/";

function ItemRow({ item }: { item: WorkshopItem }) {
  const pct = item.required_total > 0 ? Math.min(1, item.have / item.required_total) : 1;
  const color = item.complete ? "#4caf50" : item.have > 0 ? "#ff9800" : "#f44336";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 0" }}>
      <img
        src={`${CDN_BASE}${item.item_id}.png`}
        alt=""
        width={24}
        height={24}
        style={{ borderRadius: 4, flexShrink: 0, objectFit: "contain", background: "rgba(255,255,255,0.04)" }}
        onError={(e) => { (e.target as HTMLImageElement).style.visibility = "hidden"; }}
      />
      <span style={{ flex: 1, fontFamily: "var(--font-ui)", fontSize: 12.5, color: "var(--fg-2)" }}>
        {item.name}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 60, height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 2, overflow: "hidden" }}>
          <div style={{ width: `${pct * 100}%`, height: "100%", background: color, borderRadius: 2, transition: "width 0.3s" }} />
        </div>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color, minWidth: 52, textAlign: "right" }}>
          {item.have}/{item.required_total}
        </span>
      </div>
    </div>
  );
}

function LevelRow({ levelNum, level }: { levelNum: string; level: { complete: boolean; items: WorkshopItem[] } }) {
  const [open, setOpen] = useState(!level.complete);
  const missing = level.items.filter(i => !i.complete).length;
  return (
    <div style={{ borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 8,
          padding: "7px 10px",
          background: level.complete ? "rgba(76,175,80,0.08)" : "rgba(255,255,255,0.03)",
          border: `1px solid ${level.complete ? "rgba(76,175,80,0.25)" : "var(--border)"}`,
          borderRadius: open ? "var(--radius-sm) var(--radius-sm) 0 0" : "var(--radius-sm)",
          cursor: "pointer", textAlign: "left",
        }}
      >
        {level.complete
          ? <Icon name="check-circle" size={13} style={{ color: "#4caf50", flexShrink: 0 }} />
          : <Icon name="circle" size={13} style={{ color: "var(--fg-5)", flexShrink: 0 }} />
        }
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: level.complete ? "#4caf50" : "var(--fg-3)", flex: 1 }}>
          Seviye {levelNum}
        </span>
        {!level.complete && missing > 0 && (
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "#f44336" }}>
            {missing} eksik
          </span>
        )}
        <Icon
          name={open ? "chevron-up" : "chevron-down"}
          size={12}
          style={{ color: "var(--fg-5)", flexShrink: 0 }}
        />
      </button>
      {open && (
        <div style={{
          padding: "8px 10px",
          background: "rgba(0,0,0,0.15)",
          border: "1px solid var(--border)", borderTop: "none",
          borderRadius: "0 0 var(--radius-sm) var(--radius-sm)",
          display: "flex", flexDirection: "column", gap: 2,
        }}>
          {level.items.map(item => (
            <ItemRow key={item.item_id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

function WorkshopCard({ name, data }: { name: string; data: WorkshopEntry }) {
  const levels = Object.entries(data.levels);
  const completedCount = levels.filter(([, l]) => l.complete).length;
  const total = levels.length;
  const allDone = completedCount === total;
  const pct = total > 0 ? Math.round((completedCount / total) * 100) : 0;

  return (
    <div style={{
      background: "var(--bg-2)",
      border: `1px solid ${allDone ? "rgba(76,175,80,0.35)" : "var(--border)"}`,
      borderRadius: "var(--radius-md)",
      padding: "16px 18px",
      display: "flex", flexDirection: "column", gap: 12,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{
          width: 38, height: 38, borderRadius: "var(--radius)", flexShrink: 0,
          background: allDone ? "rgba(76,175,80,0.12)" : "rgba(0,210,255,0.08)",
          border: `1px solid ${allDone ? "rgba(76,175,80,0.3)" : "rgba(0,210,255,0.2)"}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          color: allDone ? "#4caf50" : "#00d2ff",
        }}>
          <Icon name="hammer" size={17} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 13.5, color: "var(--fg-1)" }}>
            {name}
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--fg-5)", marginTop: 2 }}>
            {completedCount}/{total} seviye
          </div>
        </div>
        <Chip tone={allDone ? "success" : completedCount > 0 ? "brand" : "neutral"} dot={false}>
          {pct}%
        </Chip>
      </div>

      <div style={{ height: 3, background: "rgba(255,255,255,0.06)", borderRadius: 2, overflow: "hidden" }}>
        <div style={{
          height: "100%",
          width: `${pct}%`,
          background: allDone ? "#4caf50" : "linear-gradient(90deg, #7b2ff7, #00d2ff)",
          borderRadius: 2, transition: "width 0.4s ease",
        }} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {levels.map(([levelNum, level]) => (
          <LevelRow key={levelNum} levelNum={levelNum} level={level} />
        ))}
      </div>
    </div>
  );
}

export function WorkshopScreen() {
  const [data, setData] = useState<WorkshopProgressResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getWorkshopProgress()
      .then(setData)
      .catch(e => setError(e instanceof Error ? e.message : "Bilinmeyen hata"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 60 }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--fg-5)" }}>
          Yükleniyor...
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        padding: "14px 18px", borderRadius: "var(--radius-md)", margin: 0,
        background: "rgba(244,67,54,0.08)", border: "1px solid rgba(244,67,54,0.25)",
        fontFamily: "var(--font-mono)", fontSize: 12.5, color: "#f44336",
      }}>
        Hata: {error}
      </div>
    );
  }

  if (!data) return null;

  const workshops = Object.entries(data.workshops);
  const totalLevels = workshops.reduce((s, [, w]) => s + Object.keys(w.levels).length, 0);
  const doneLevels = workshops.reduce((s, [, w]) =>
    s + Object.values(w.levels).filter(l => l.complete).length, 0);
  const overallPct = totalLevels > 0 ? Math.round((doneLevels / totalLevels) * 100) : 0;
  const allDone = doneLevels === totalLevels;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Header */}
      <div style={{
        background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)",
        padding: "18px 20px", display: "flex", alignItems: "center", gap: 20,
      }}>
        <div style={{
          width: 52, height: 52, borderRadius: "var(--radius)", flexShrink: 0,
          background: "linear-gradient(135deg, rgba(123,47,247,0.22), rgba(0,210,255,0.15))",
          border: "1px solid rgba(123,47,247,0.35)",
          display: "flex", alignItems: "center", justifyContent: "center", color: "#00d2ff",
        }}>
          <Icon name="hammer" size={24} />
        </div>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 19, color: "var(--fg-1)" }}>
            Workshop
          </h2>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--fg-4)" }}>
            {data.account_count} karakter · {doneLevels}/{totalLevels} seviye tamamlandı
          </span>
        </div>
        <Chip tone={allDone ? "success" : doneLevels > 0 ? "brand" : "neutral"} dot={false}>
          {overallPct}%
        </Chip>
      </div>

      {/* Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 14 }}>
        {workshops.map(([name, wsData]) => (
          <WorkshopCard key={name} name={name} data={wsData} />
        ))}
      </div>
    </div>
  );
}

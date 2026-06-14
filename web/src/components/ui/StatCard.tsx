"use client";

interface StatCardProps {
  label: string;
  value: string | number;
  unit?: string;
  delta?: number | string;
  meta?: string;
  accent?: string;
  footer?: React.ReactNode;
  style?: React.CSSProperties;
}

export function StatCard({ label, value, unit, delta, meta, accent, footer, style = {} }: StatCardProps) {
  return (
    <div style={{
      background: "var(--bg-2)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-md)",
      padding: "16px 18px",
      display: "flex",
      flexDirection: "column",
      gap: 12,
      ...style,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span className="t-label">{label}</span>
        {meta && <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-5)" }}>{meta}</span>}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <span className="t-stat" style={{ color: accent || "var(--fg-1)" }}>{value}</span>
        {unit && <span style={{ fontFamily: "var(--font-ui)", fontWeight: 500, fontSize: 13, color: "var(--fg-4)", textTransform: "uppercase", letterSpacing: "0.1em" }}>{unit}</span>}
        {delta != null && (
          <span style={{
            marginLeft: "auto",
            fontFamily: "var(--font-mono)", fontSize: 12,
            color: typeof delta === "number" ? (delta >= 0 ? "#4caf50" : "#f44336") : "#4caf50",
          }}>
            {typeof delta === "number" ? (delta >= 0 ? "+" : "") + delta.toLocaleString() : delta}
          </span>
        )}
      </div>
      {footer}
    </div>
  );
}

"use client";

interface ProgressBarProps {
  value: number;
  max?: number;
  height?: number;
  accent?: string;
  style?: React.CSSProperties;
}

export function ProgressBar({ value, max = 100, height = 6, accent = "gradient", style = {} }: ProgressBarProps) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const fillBg = accent === "gradient"
    ? "linear-gradient(90deg, #00d2ff, #7b2ff7)"
    : accent;
  return (
    <div style={{
      height, background: "rgba(255,255,255,0.04)", borderRadius: 999, overflow: "hidden", ...style,
    }}>
      <div style={{
        height: "100%",
        width: `${pct}%`,
        background: fillBg,
        borderRadius: "inherit",
        transition: "width 280ms cubic-bezier(0.16,1,0.3,1)",
      }} />
    </div>
  );
}

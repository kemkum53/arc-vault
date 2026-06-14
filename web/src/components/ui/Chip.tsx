"use client";

import { Icon } from "./Icon";

interface ChipProps {
  children: React.ReactNode;
  tone?: "success" | "warning" | "danger" | "info" | "brand" | "neutral";
  icon?: string;
  dot?: boolean;
  style?: React.CSSProperties;
}

const tones: Record<string, { color: string; bg: string }> = {
  success: { color: "#4caf50", bg: "rgba(76,175,80,0.14)" },
  warning: { color: "#ff9800", bg: "rgba(255,152,0,0.14)" },
  danger:  { color: "#f44336", bg: "rgba(244,67,54,0.14)" },
  info:    { color: "#00d2ff", bg: "rgba(0,210,255,0.10)" },
  brand:   { color: "#b06bff", bg: "rgba(176,107,255,0.14)" },
  neutral: { color: "var(--fg-3)", bg: "rgba(255,255,255,0.04)" },
};

export function Chip({ children, tone = "info", icon, dot = true, style = {} }: ChipProps) {
  const t = tones[tone];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "4px 10px", borderRadius: 999,
      fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 11,
      letterSpacing: "0.12em", textTransform: "uppercase",
      color: t.color, background: t.bg,
      ...style,
    }}>
      {dot && !icon && <span style={{ width: 6, height: 6, borderRadius: 999, background: "currentColor" }} />}
      {icon && <Icon name={icon} size={12} />}
      {children}
    </span>
  );
}

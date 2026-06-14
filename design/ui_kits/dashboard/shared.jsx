// ARC Vault — shared UI primitives.
// Token usage from ../../colors_and_type.css

const { useState, useEffect, useRef } = React;

// ---------- Icon — Lucide static-load wrapper (icons in ./icons via window.LUCIDE map)
// We render inline SVG paths so we don't depend on a network round-trip at load time.

const LUCIDE = {
  "layout-dashboard": '<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>',
  "boxes":            '<path d="M2.97 12.92 2 13.5v6.4c0 .43.21.83.56 1.06l5.27 3.42c.37.24.83.24 1.2 0L14.31 21V12.5L9.07 9.34l-6.1 3.58Z"/><path d="m9.07 9.34 5.24 3.16 5.24-3.16-5.24-3.16-5.24 3.16Z"/><path d="M14.31 12.5V21l5.27-3.42c.35-.23.56-.63.56-1.06v-6.4l-.97-.58-4.86 2.96Z"/>',
  "scroll-text":      '<path d="M15 12h-5"/><path d="M15 8h-5"/><path d="M19 17V5a2 2 0 0 0-2-2H4"/><path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3"/>',
  "target":           '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  "warehouse":        '<path d="M22 8.35V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.35"/><path d="M2 8 12 2l10 6"/><path d="M6 18h12"/><path d="M6 14h12"/>',
  "clipboard-list":   '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>',
  "settings-2":       '<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
  "refresh-cw":       '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/>',
  "link-2":           '<path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><line x1="8" x2="16" y1="12" y2="12"/>',
  "log-out":          '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>',
  "search":           '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  "triangle-alert":   '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  "check-circle-2":   '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  "x":                '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  "chevron-right":    '<path d="m9 18 6-6-6-6"/>',
  "chevron-down":     '<path d="m6 9 6 6 6-6"/>',
  "sliders-horizontal":'<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>',
  "lock":             '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  "plus":             '<path d="M12 5v14"/><path d="M5 12h14"/>',
  "arrow-up-right":   '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>',
  "circle-dot":       '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="1"/>',
  "shield":           '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  "wrench":           '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  "swords":           '<polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" x2="19" y1="19" y2="13"/><line x1="16" x2="20" y1="16" y2="20"/><line x1="19" x2="21" y1="21" y2="19"/><polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5"/><line x1="5" x2="9" y1="14" y2="18"/><line x1="7" x2="4" y1="17" y2="20"/><line x1="3" x2="5" y1="19" y2="21"/>',
  "recycle":          '<path d="M7 19H4.815a1.83 1.83 0 0 1-1.57-.881 1.785 1.785 0 0 1-.004-1.784L7.196 9.5"/><path d="M11 19h8.203a1.83 1.83 0 0 0 1.556-.89 1.784 1.784 0 0 0 0-1.775l-1.226-2.12"/><path d="m14 16-3 3 3 3"/><path d="M8.293 13.596 4.5 9.5l-3.6 1.875"/><path d="m12.182 13.876 5.5-9.5L13 5"/><path d="m17.5 5 1 4.5"/>',
  "heart-pulse":      '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/><path d="M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27"/>',
  "cpu":              '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/>',
  "sprout":           '<path d="M7 20h10"/><path d="M10 20c5.5-2.5.8-6.4 3-10"/><path d="M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8z"/><path d="M14.1 6c-.7-3.1-2.5-3-3.4-4.2-.3.9-.8 1.9-1.4 3.1.6.4 1.2 1 1.7 1.7 1.1-.2 2.2-.4 3.1-.6"/>',
  "map":              '<path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"/><path d="M15 5.764v15"/><path d="M9 3.236v15"/>',
  "arrow-down-up":    '<path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="m21 8-4-4-4 4"/><path d="M17 4v16"/>',
};

function Icon({ name, size = 18, stroke = 1.5, style = {}, className = "" }) {
  const paths = LUCIDE[name];
  if (!paths) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      className={className}
      dangerouslySetInnerHTML={{ __html: paths }}
    />
  );
}

// ---------- Button
function Button({ children, variant = "primary", icon, onClick, full, type = "button", className = "" }) {
  const base = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    fontFamily: "var(--font-ui)",
    fontWeight: 600,
    fontSize: 13,
    letterSpacing: "0.06em",
    padding: "10px 18px",
    border: "1px solid transparent",
    borderRadius: "var(--radius)",
    cursor: "pointer",
    transition: "all 220ms cubic-bezier(0.16,1,0.3,1)",
    width: full ? "100%" : "auto",
  };
  const variants = {
    primary: { background: "linear-gradient(135deg, #7b2ff7, #00d2ff)", color: "#fff" },
    secondary: { background: "transparent", border: "1px solid var(--border-strong)", color: "var(--fg-2)" },
    ghost: { background: "transparent", color: "var(--fg-3)" },
    danger: { background: "linear-gradient(135deg, #ff9800, #f44336)", color: "#fff" },
    dangerOutline: { background: "transparent", border: "1px solid rgba(244,67,54,0.45)", color: "#f44336" },
  };
  return (
    <button type={type} onClick={onClick} className={`av-btn av-btn-${variant} ${className}`} style={{ ...base, ...variants[variant] }}>
      {icon && <Icon name={icon} size={16} />}
      {children}
    </button>
  );
}

// ---------- Chip
function Chip({ children, tone = "info", icon, dot = true, style = {} }) {
  const tones = {
    success: { color: "#4caf50", bg: "rgba(76,175,80,0.14)" },
    warning: { color: "#ff9800", bg: "rgba(255,152,0,0.14)" },
    danger:  { color: "#f44336", bg: "rgba(244,67,54,0.14)" },
    info:    { color: "#00d2ff", bg: "rgba(0,210,255,0.10)" },
    brand:   { color: "#b06bff", bg: "rgba(176,107,255,0.14)" },
    neutral: { color: "var(--fg-3)", bg: "rgba(255,255,255,0.04)" },
  };
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

// ---------- Rarity color
const RARITY = {
  common:    { color: "#b8b8c8", border: "rgba(184,184,200,0.25)", glow: "rgba(184,184,200,0.10)" },
  uncommon:  { color: "#4caf50", border: "rgba(76,175,80,0.40)",   glow: "rgba(76,175,80,0.18)" },
  rare:      { color: "#00d2ff", border: "rgba(0,210,255,0.45)",   glow: "rgba(0,210,255,0.22)" },
  epic:      { color: "#b06bff", border: "rgba(176,107,255,0.50)", glow: "rgba(176,107,255,0.25)" },
  legendary: { color: "#ff9800", border: "rgba(255,152,0,0.50)",   glow: "rgba(255,152,0,0.22)" },
};

function ItemTile({ item, onClick }) {
  const r = RARITY[item.r];
  return (
    <div className="av-tile" onClick={onClick} style={{
      background: "var(--bg-2)",
      border: `1px solid ${r.border}`,
      borderRadius: "var(--radius-md)",
      padding: 10,
      display: "flex",
      flexDirection: "column",
      gap: 6,
      cursor: "pointer",
      transition: "all 180ms cubic-bezier(0.16,1,0.3,1)",
    }}>
      <div style={{
        aspectRatio: "1",
        borderRadius: "var(--radius-sm)",
        background: `radial-gradient(circle at 50% 45%, ${r.glow}, transparent 70%), #0a0a0f`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        fontFamily: "var(--font-display)",
        fontWeight: 700,
        fontSize: 24,
        color: "var(--fg-1)",
        letterSpacing: "0.04em",
      }}>
        {item.glyph}
        {item.q > 1 && (
          <span style={{
            position: "absolute", bottom: 4, right: 6,
            fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600,
            color: "var(--fg-1)", textShadow: "0 1px 2px #000",
          }}>×{item.q}</span>
        )}
        {item.t && (
          <span style={{
            position: "absolute", top: 4, left: 6,
            fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 700,
            color: r.color, textShadow: "0 1px 2px #000",
          }}>{item.t}</span>
        )}
      </div>
      <div style={{
        fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 12, color: "var(--fg-2)",
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
      }}>{item.n}</div>
      <div style={{
        display: "flex", justifyContent: "space-between",
        fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-4)",
        textTransform: "uppercase", letterSpacing: "0.06em",
      }}>
        <span style={{ color: r.color }}>{item.r}</span>
        {typeof item.d === "number" && <span>{item.d}%</span>}
      </div>
    </div>
  );
}

// ---------- ProgressBar (gradient fill)
function ProgressBar({ value, max = 100, height = 6, accent = "gradient", style = {} }) {
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

// ---------- StatCard
function StatCard({ label, value, unit, delta, meta, accent, footer, style = {} }) {
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
            color: delta >= 0 ? "#4caf50" : "#f44336",
          }}>
            {delta >= 0 ? "+" : ""}{typeof delta === "number" ? delta.toLocaleString() : delta}
          </span>
        )}
      </div>
      {footer}
    </div>
  );
}

// ---------- WordmarkLockup
function Wordmark({ size = 16, withEmblem = true }) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      {withEmblem && (
        <div style={{
          width: size * 1.6, height: size * 1.6,
          backgroundImage: "url('../../assets/arc_vault_logo.png')",
          backgroundSize: "contain", backgroundRepeat: "no-repeat", backgroundPosition: "center",
        }} />
      )}
      <span style={{
        fontFamily: "var(--font-display)", fontWeight: 700,
        fontSize: size, letterSpacing: "0.06em",
        background: "linear-gradient(90deg, #00d2ff, #7b2ff7)",
        WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
      }}>
        ARC<span style={{ fontWeight: 400, opacity: 0.92 }}>VAULT</span>
      </span>
    </div>
  );
}

// ---------- TraderDot
const TRADERS = {
  shani:   { color: "#ff7a59", name: "Shani" },
  celeste: { color: "#b06bff", name: "Celeste" },
  apollo:  { color: "#ffc857", name: "Apollo" },
  lance:   { color: "#4dd0e1", name: "Lance" },
  tian:    { color: "#66bb6a", name: "Tian Wen" },
};

Object.assign(window, {
  Icon, Button, Chip, ItemTile, ProgressBar, StatCard, Wordmark,
  RARITY, TRADERS, LUCIDE,
});

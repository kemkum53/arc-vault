"use client";

import { Icon } from "./Icon";

interface ButtonProps {
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "dangerOutline";
  icon?: string;
  iconSpin?: boolean;
  onClick?: () => void;
  full?: boolean;
  type?: "button" | "submit";
  className?: string;
}

const variantStyles: Record<string, React.CSSProperties> = {
  primary: { background: "linear-gradient(135deg, #7b2ff7, #00d2ff)", color: "#fff", border: "none" },
  secondary: { background: "transparent", border: "1px solid var(--border-strong)", color: "var(--fg-2)" },
  ghost: { background: "transparent", color: "var(--fg-3)" },
  danger: { background: "linear-gradient(135deg, #ff9800, #f44336)", color: "#fff" },
  dangerOutline: { background: "transparent", border: "1px solid rgba(244,67,54,0.45)", color: "#f44336" },
};

export function Button({ children, variant = "primary", icon, iconSpin, onClick, full, type = "button", className = "" }: ButtonProps) {
  const base: React.CSSProperties = {
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

  return (
    <button
      type={type}
      onClick={onClick}
      className={`av-btn av-btn-${variant} ${className}`}
      style={{ ...base, ...variantStyles[variant] }}
    >
      {icon && <Icon name={icon} size={16} style={iconSpin ? { animation: "av-spin 1s linear infinite" } : undefined} />}
      {children}
    </button>
  );
}

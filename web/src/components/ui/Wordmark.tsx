"use client";

interface WordmarkProps {
  size?: number;
  withEmblem?: boolean;
}

export function Wordmark({ size = 16, withEmblem = true }: WordmarkProps) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      {withEmblem && (
        <div style={{
          width: size * 1.6, height: size * 1.6,
          backgroundImage: "url('/arc_vault_logo.png')",
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

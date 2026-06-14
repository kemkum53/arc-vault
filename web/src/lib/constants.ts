// ARC Vault — Design constants

export const RARITY = {
  common:    { color: "#b8b8c8", border: "rgba(184,184,200,0.25)", glow: "rgba(184,184,200,0.10)" },
  uncommon:  { color: "#4caf50", border: "rgba(76,175,80,0.40)",   glow: "rgba(76,175,80,0.18)" },
  rare:      { color: "#00d2ff", border: "rgba(0,210,255,0.45)",   glow: "rgba(0,210,255,0.22)" },
  epic:      { color: "#b06bff", border: "rgba(176,107,255,0.50)", glow: "rgba(176,107,255,0.25)" },
  legendary: { color: "#ff9800", border: "rgba(255,152,0,0.50)",   glow: "rgba(255,152,0,0.22)" },
} as const;

export const TRADERS = {
  shani:   { color: "#ff7a59", name: "Shani" },
  celeste: { color: "#b06bff", name: "Celeste" },
  apollo:  { color: "#ffc857", name: "Apollo" },
  lance:   { color: "#4dd0e1", name: "Lance" },
  tian:    { color: "#66bb6a", name: "Tian Wen" },
} as const;

// ARC Vault — Inventory screen.

function InventoryScreen() {
  const [rarity, setRarity] = React.useState("all");
  const [type, setType]     = React.useState("all");
  const [query, setQuery]   = React.useState("");

  const filtered = MOCK.inventory.filter(item => {
    if (rarity !== "all" && item.r !== rarity) return false;
    if (type !== "all" && item.type !== type)  return false;
    if (query && !item.n.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  const RARITIES = ["all", "common", "uncommon", "rare", "epic", "legendary"];
  const TYPES    = [
    { id: "all", label: "Hepsi" },
    { id: "weapon", label: "Silahlar" },
    { id: "consumable", label: "Consumable" },
    { id: "resource", label: "Kaynak" },
    { id: "blueprint", label: "Blueprint" },
    { id: "key", label: "Anahtar" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Filter bar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
        background: "var(--bg-2)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        padding: "14px 16px",
      }}>
        <div style={{
          flex: "1 1 220px", display: "flex", alignItems: "center", gap: 8,
          background: "var(--bg-input)", border: "1px solid var(--border-strong)",
          borderRadius: "var(--radius)", padding: "8px 12px",
          color: "var(--fg-4)", height: 36,
        }}>
          <Icon name="search" size={16} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="anvil, ak-74, bandage..."
            style={{
              flex: 1, background: "transparent", border: "none", outline: "none",
              color: "var(--fg-2)", fontFamily: "var(--font-ui)", fontSize: 13,
            }}
          />
        </div>
        <SegmentedControl options={TYPES} value={type} onChange={setType} />
        <RarityFilter value={rarity} onChange={setRarity} options={RARITIES} />
        <button className="av-icon-btn" title="Sort">
          <Icon name="arrow-down-up" size={16} />
        </button>
      </div>

      {/* Header strip */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
        <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 20, color: "var(--fg-1)" }}>
          {filtered.length} item
        </h2>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--fg-4)" }}>
          {MOCK.economy.usedSlots} / {MOCK.economy.maxSlots} slot kullanılıyor · total value {MOCK.economy.totalValue.toLocaleString()} c
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <Chip tone="info">live</Chip>
          <Chip tone="success">{MOCK.syncSummary.syncedItems} synced</Chip>
        </div>
      </div>

      {/* Grid */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(116px, 1fr))", gap: 12,
      }}>
        {filtered.map(item => <ItemTile key={item.i} item={item} />)}
      </div>
    </div>
  );
}

function SegmentedControl({ options, value, onChange }) {
  return (
    <div style={{
      display: "inline-flex", padding: 3,
      background: "var(--bg-input)", border: "1px solid var(--border-strong)",
      borderRadius: "var(--radius)",
    }}>
      {options.map(o => {
        const active = o.id === value;
        return (
          <button key={o.id} onClick={() => onChange(o.id)} style={{
            padding: "5px 12px",
            background: active ? "linear-gradient(135deg, rgba(123,47,247,0.4), rgba(0,210,255,0.3))" : "transparent",
            color: active ? "#fff" : "var(--fg-3)",
            border: "none", borderRadius: 4, cursor: "pointer",
            fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 12,
            letterSpacing: "0.04em",
            transition: "all 180ms cubic-bezier(0.16,1,0.3,1)",
          }}>{o.label}</button>
        );
      })}
    </div>
  );
}

function RarityFilter({ value, onChange, options }) {
  return (
    <div style={{ display: "inline-flex", gap: 6 }}>
      {options.map(r => {
        const c = r === "all" ? { color: "var(--fg-3)" } : RARITY[r];
        const active = r === value;
        return (
          <button key={r} onClick={() => onChange(r)} style={{
            padding: "5px 10px",
            background: active ? `${c.color}22` : "transparent",
            border: `1px solid ${active ? c.color : "var(--border-strong)"}`,
            color: c.color,
            borderRadius: "var(--radius)",
            cursor: "pointer",
            fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 11,
            letterSpacing: "0.12em", textTransform: "uppercase",
            transition: "all 180ms cubic-bezier(0.16,1,0.3,1)",
          }}>{r === "all" ? "All" : r}</button>
        );
      })}
    </div>
  );
}

Object.assign(window, { InventoryScreen });

// ARC Vault — Topbar with title, search, sync button, and account state.

function Topbar({ title, subtitle, account, onSync, syncing, syncProgress }) {
  const tokenChip = account.isTokenExpired
    ? <Chip tone="danger" icon="triangle-alert">Token Expired</Chip>
    : <Chip tone="success" icon="check-circle-2">Embark Linked</Chip>;

  return (
    <header style={{
      height: 64, flexShrink: 0,
      borderBottom: "1px solid var(--border)",
      background: "var(--bg-1)",
      display: "flex", alignItems: "center",
      padding: "0 28px", gap: 18,
      position: "sticky", top: 0, zIndex: 10,
    }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <h1 style={{
          margin: 0, fontFamily: "var(--font-display)", fontWeight: 700,
          fontSize: 20, color: "var(--fg-1)", letterSpacing: "0.02em",
        }}>{title}</h1>
        {subtitle && (
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-4)" }}>{subtitle}</span>
        )}
      </div>

      {/* Search */}
      <div style={{
        marginLeft: 24, marginRight: "auto",
        background: "var(--bg-2)",
        border: "1px solid var(--border-strong)",
        borderRadius: "var(--radius)",
        height: 36, width: 320, maxWidth: "32%",
        display: "flex", alignItems: "center", gap: 8,
        padding: "0 12px",
        color: "var(--fg-4)",
      }}>
        <Icon name="search" size={16} />
        <input
          type="text"
          placeholder="Ara: item, quest, blueprint..."
          style={{
            flex: 1, background: "transparent", border: "none", outline: "none",
            color: "var(--fg-2)", fontSize: 13, fontFamily: "var(--font-ui)",
          }}
        />
        <kbd style={{
          padding: "2px 6px", fontFamily: "var(--font-mono)", fontSize: 10,
          background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)",
          borderRadius: 4, color: "var(--fg-4)",
        }}>⌘K</kbd>
      </div>

      {tokenChip}

      <Button variant="primary" icon="refresh-cw" onClick={onSync}>
        {syncing ? "Senkronize Ediliyor..." : "Senkronize Et"}
      </Button>

      {/* Sweep bar — visible during sync */}
      {syncing && (
        <div style={{
          position: "absolute", left: 0, right: 0, bottom: -1, height: 2,
          overflow: "hidden",
        }}>
          <div style={{
            position: "absolute", inset: 0,
            background: "linear-gradient(90deg, transparent, #00d2ff, #7b2ff7, transparent)",
            transform: "translateX(-30%)",
            animation: "av-sweep 1.4s cubic-bezier(0.4,0,0.2,1) infinite",
          }} />
        </div>
      )}
    </header>
  );
}

Object.assign(window, { Topbar });

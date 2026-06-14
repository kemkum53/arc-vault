// ARC Vault — Sidebar
const { useState: useStateSb } = React;

function Sidebar({ active, onChange, account }) {
  const items = [
    { id: "dashboard", label: "Dashboard",  icon: "layout-dashboard" },
    { id: "inventory", label: "Envanter",   icon: "boxes",         count: "302" },
    { id: "quests",    label: "Questler",   icon: "target",        count: "8 / 100" },
    { id: "blueprints",label: "Blueprints", icon: "scroll-text",   count: "12" },
    { id: "hideout",   label: "Hideout",    icon: "warehouse" },
    { id: "projects",  label: "Projeler",   icon: "clipboard-list",count: "2" },
  ];
  const footerItems = [
    { id: "settings",  label: "Ayarlar",    icon: "settings-2" },
  ];

  return (
    <aside style={{
      width: 240, flexShrink: 0,
      background: "var(--bg-2)",
      borderRight: "1px solid var(--border)",
      display: "flex", flexDirection: "column",
      padding: "20px 14px",
      gap: 4,
      height: "100vh",
      position: "sticky", top: 0,
    }}>
      {/* Brand */}
      <div style={{ padding: "4px 8px 18px", borderBottom: "1px solid var(--border)", marginBottom: 14 }}>
        <Wordmark size={18} />
        <div style={{
          marginTop: 6, fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--fg-5)",
          letterSpacing: "0.04em",
        }}>v1.0.0 · arc raiders companion</div>
      </div>

      {/* Nav */}
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {items.map(item => (
          <SidebarItem key={item.id} item={item} active={active === item.id} onClick={() => onChange(item.id)} />
        ))}
      </div>

      <div style={{ flex: 1 }} />

      {footerItems.map(item => (
        <SidebarItem key={item.id} item={item} active={active === item.id} onClick={() => onChange(item.id)} />
      ))}

      {/* Account card */}
      <div style={{
        marginTop: 10, padding: "12px",
        background: "var(--bg-3)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        display: "flex", alignItems: "center", gap: 10,
      }}>
        <div style={{
          width: 34, height: 34, borderRadius: "var(--radius)",
          background: "linear-gradient(135deg, #7b2ff7, #00d2ff)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 14, color: "#fff",
        }}>K</div>
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <span style={{
            fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 13, color: "var(--fg-1)",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {account.displayName}
            <span style={{ color: "var(--fg-5)", fontWeight: 400 }}>#{account.discriminator}</span>
          </span>
          <span style={{
            fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-4)",
            textTransform: "uppercase", letterSpacing: "0.1em",
          }}>{account.provider} · linked</span>
        </div>
      </div>
    </aside>
  );
}

function SidebarItem({ item, active, onClick }) {
  return (
    <div onClick={onClick} style={{
      position: "relative",
      display: "flex", alignItems: "center", gap: 10,
      padding: "9px 12px",
      borderRadius: "var(--radius)",
      color: active ? "var(--fg-1)" : "var(--fg-3)",
      background: active ? "linear-gradient(90deg, rgba(123,47,247,0.18), rgba(0,210,255,0.06))" : "transparent",
      fontFamily: "var(--font-ui)", fontWeight: 500, fontSize: 13.5,
      cursor: "pointer",
      transition: "all 180ms cubic-bezier(0.16,1,0.3,1)",
    }}
    onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
    onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
    >
      {active && (
        <span style={{
          position: "absolute", left: 0, top: 7, bottom: 7, width: 2,
          background: "linear-gradient(180deg, #7b2ff7, #00d2ff)", borderRadius: 2,
        }} />
      )}
      <Icon name={item.icon} size={18} />
      <span style={{ flex: 1 }}>{item.label}</span>
      {item.count && (
        <span style={{
          fontFamily: "var(--font-mono)", fontSize: 11,
          color: active ? "#00d2ff" : "var(--fg-5)",
        }}>{item.count}</span>
      )}
    </div>
  );
}

Object.assign(window, { Sidebar });

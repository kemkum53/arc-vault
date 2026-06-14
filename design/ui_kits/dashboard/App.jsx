// ARC Vault — App shell. Switches between screens.

function App() {
  const [linked, setLinked]       = React.useState(true);   // start logged-in for quick preview
  const [active, setActive]       = React.useState("dashboard");
  const [syncing, setSyncing]     = React.useState(false);
  const [progress, setProgress]   = React.useState(0);

  const account = MOCK.account;

  const handleSync = () => {
    if (syncing) return;
    setSyncing(true); setProgress(0);
    let p = 0;
    const tick = setInterval(() => {
      p += 6 + Math.random() * 10;
      if (p >= 100) { p = 100; clearInterval(tick); setTimeout(() => setSyncing(false), 360); }
      setProgress(Math.round(p));
    }, 120);
  };

  if (!linked) {
    return <ConnectScreen onConnect={() => setLinked(true)} />;
  }

  const screens = {
    dashboard:  { title: "Dashboard",  subtitle: `last sync 13m · ${MOCK.syncSummary.unmappedCount} unmapped`,    el: <DashboardScreen syncing={syncing} syncProgress={progress} account={account} onGoTo={setActive} /> },
    inventory:  { title: "Envanter",   subtitle: `${MOCK.economy.usedSlots} / ${MOCK.economy.maxSlots} slot · ${MOCK.inventory.length} preview`, el: <InventoryScreen /> },
    quests:     { title: "Questler",   subtitle: `${MOCK.quests.length} active · 5 traders`, el: <QuestsScreen /> },
    blueprints: { title: "Blueprints", subtitle: `12 öğrenilmiş · 35 kalan`,                 el: <BlueprintsStub /> },
    hideout:    { title: "Hideout",    subtitle: `7 modül kurulu · 2 kilitli`,               el: <HideoutScreen /> },
    projects:   { title: "Projeler",   subtitle: `${MOCK.projects.length} aktif · hideout queue`, el: <ProjectsScreen /> },
    settings:   { title: "Ayarlar",    subtitle: `account · sync · extension`,              el: <SettingsScreen account={account} onDisconnect={() => { setLinked(false); setActive("dashboard"); }} /> },
  };
  const s = screens[active];

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--bg-1)" }}>
      <Sidebar active={active} onChange={setActive} account={account} />
      <main style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <Topbar title={s.title} subtitle={s.subtitle} account={account} onSync={handleSync} syncing={syncing} syncProgress={progress} />
        <div style={{ padding: "24px 28px", flex: 1, overflow: "auto" }} data-screen-label={`02 ${s.title}`}>
          {s.el}
        </div>
      </main>
    </div>
  );
}

function BlueprintsStub() {
  const bps = [
    { id: "anvil_blueprint",   n: "Anvil",      learned: true,  rarity: "legendary" },
    { id: "bobcat_blueprint",  n: "Bobcat",     learned: true,  rarity: "rare" },
    { id: "ak74_blueprint",    n: "AK-74",      learned: true,  rarity: "epic" },
    { id: "longshot_blueprint",n: "Longshot",   learned: true,  rarity: "rare" },
    { id: "scrapper_blueprint",n: "Scrapper",   learned: true,  rarity: "uncommon" },
    { id: "compensator_bp",    n: "Compensator",learned: true,  rarity: "uncommon" },
    { id: "shield_mod_bp",     n: "Shield Mod", learned: false, rarity: "epic" },
    { id: "scope_bp",          n: "Scope",      learned: false, rarity: "rare" },
    { id: "fang_blueprint",    n: "Fang",       learned: false, rarity: "legendary" },
    { id: "stim_bp",           n: "Stim",       learned: true,  rarity: "rare" },
    { id: "stealth_plating_bp",n: "Stealth Plt",learned: false, rarity: "epic" },
    { id: "magazine_xl_bp",    n: "Magazine XL",learned: true,  rarity: "uncommon" },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{
        background: "var(--bg-2)", border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)", padding: "16px 20px",
        display: "flex", alignItems: "center", gap: 18,
      }}>
        <Icon name="scroll-text" size={24} style={{ color: "#b06bff" }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 18, color: "var(--fg-1)" }}>Blueprints</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--fg-4)" }}>
            {bps.filter(b => b.learned).length} / {bps.length} öğrenilmiş · {bps.filter(b => !b.learned).length} keşfedilmedi
          </span>
        </div>
        <div style={{ marginLeft: "auto", width: 220 }}>
          <ProgressBar value={(bps.filter(b => b.learned).length / bps.length) * 100} height={6} accent="#b06bff" />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
        {bps.map(b => <BlueprintCard key={b.id} bp={b} />)}
      </div>
    </div>
  );
}

function BlueprintCard({ bp }) {
  const r = RARITY[bp.rarity];
  return (
    <div style={{
      background: bp.learned ? "var(--bg-2)" : "rgba(255,255,255,0.015)",
      border: `1px solid ${bp.learned ? r.border : "var(--border)"}`,
      borderRadius: "var(--radius-md)",
      padding: 14,
      display: "flex", flexDirection: "column", gap: 10,
      opacity: bp.learned ? 1 : 0.5,
      position: "relative", overflow: "hidden",
    }}>
      <div style={{
        height: 80, borderRadius: "var(--radius-sm)",
        background: bp.learned
          ? `radial-gradient(circle at 50% 50%, ${r.glow}, transparent 70%), #0a0a0f`
          : "repeating-linear-gradient(45deg, rgba(255,255,255,0.02) 0 4px, transparent 4px 8px), #0a0a0f",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: bp.learned ? r.color : "var(--fg-5)",
      }}>
        <Icon name={bp.learned ? "scroll-text" : "lock"} size={28} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{
          fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 13,
          color: bp.learned ? "var(--fg-1)" : "var(--fg-4)",
        }}>BP: {bp.n}</span>
        <span style={{
          fontFamily: "var(--font-mono)", fontSize: 10, color: r.color,
          textTransform: "uppercase", letterSpacing: "0.14em",
        }}>{bp.rarity} {bp.learned ? "" : "· locked"}</span>
      </div>
    </div>
  );
}

function SettingsScreen({ account, onDisconnect }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 720 }}>
      <SettingsCard title="Embark Account" subtitle="connected via arctracker.io">
        <Row label="Display Name"     value={`${account.displayName}#${account.discriminator}`} />
        <Row label="Provider"         value={account.provider.toUpperCase()} mono />
        <Row label="Embark User ID"   value="4159475767003566701" mono />
        <Row label="Linked At"        value="2026-05-17 23:20" mono />
        <Row label="Token Expires"    value="2026-05-21 13:07 UTC" mono accent="#4caf50" />
        <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
          <Button variant="primary" icon="refresh-cw">Token Yenile</Button>
          <Button variant="dangerOutline" icon="log-out" onClick={onDisconnect}>Hesabı Kaldır</Button>
        </div>
      </SettingsCard>

      <SettingsCard title="API & Extension" subtitle="local sync endpoint">
        <Row label="API Base"         value="http://localhost:8000" mono />
        <Row label="OAuth Callback"   value="127.0.0.1:49172" mono />
        <Row label="Extension"        value="ARC Vault — Token Refresh v1.0.0" mono accent="#4caf50" />
        <Row label="Last Sync"        value="13 dakika önce — 47 items, 12 BP, 8 quests" />
      </SettingsCard>

      <SettingsCard title="Sync" subtitle="behavior">
        <Toggle label="Otomatik sync (her 30 dk)" on />
        <Toggle label="Yeni quest tamamlandığında bildir" on />
        <Toggle label="Token süresi dolmadan 24h önce uyar" on />
        <Toggle label="Telemetri gönder" off />
      </SettingsCard>
    </div>
  );
}

function SettingsCard({ title, subtitle, children }) {
  return (
    <div style={{
      background: "var(--bg-2)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-md)",
      padding: "20px 22px",
      display: "flex", flexDirection: "column", gap: 12,
    }}>
      <div style={{ paddingBottom: 10, borderBottom: "1px solid var(--border)" }}>
        <h3 style={{ margin: 0, fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 16, color: "var(--fg-1)" }}>{title}</h3>
        {subtitle && <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-5)" }}>{subtitle}</span>}
      </div>
      {children}
    </div>
  );
}

function Row({ label, value, mono, accent }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
      <span style={{ fontFamily: "var(--font-ui)", fontSize: 13, color: "var(--fg-4)" }}>{label}</span>
      <span style={{
        fontFamily: mono ? "var(--font-mono)" : "var(--font-ui)",
        fontSize: 13, color: accent || "var(--fg-2)",
      }}>{value}</span>
    </div>
  );
}

function Toggle({ label, on }) {
  const [v, setV] = React.useState(!!on);
  return (
    <div onClick={() => setV(!v)} style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "8px 0", cursor: "pointer",
    }}>
      <span style={{ fontFamily: "var(--font-ui)", fontSize: 13.5, color: "var(--fg-2)" }}>{label}</span>
      <span style={{
        width: 34, height: 18,
        background: v ? "linear-gradient(135deg, #7b2ff7, #00d2ff)" : "var(--border-strong)",
        borderRadius: 999,
        position: "relative",
        transition: "background 220ms",
      }}>
        <span style={{
          position: "absolute", top: 2, left: v ? 18 : 2,
          width: 14, height: 14, background: "#fff", borderRadius: 999,
          transition: "left 220ms cubic-bezier(0.16,1,0.3,1)",
        }} />
      </span>
    </div>
  );
}

Object.assign(window, { App, BlueprintsStub, SettingsScreen });

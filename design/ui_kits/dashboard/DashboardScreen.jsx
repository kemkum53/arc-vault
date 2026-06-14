// ARC Vault — Dashboard screen.

function DashboardScreen({ syncing, syncProgress, account, onGoTo }) {
  const E = MOCK.economy;
  const S = MOCK.syncSummary;
  const slotsPct = (E.usedSlots / E.maxSlots) * 100;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      {/* Hero greeting */}
      <div style={{
        padding: "22px 26px",
        background: "var(--grad-panel), var(--bg-2)",
        backgroundImage: "linear-gradient(135deg, rgba(123,47,247,0.10), rgba(0,210,255,0.04) 60%, transparent), var(--bg-2)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        display: "flex", gap: 24, alignItems: "center",
        position: "relative", overflow: "hidden",
      }}>
        <div style={{
          width: 80, height: 80, flexShrink: 0,
          backgroundImage: "url('../../assets/arc_vault_logo.png')",
          backgroundSize: "contain", backgroundRepeat: "no-repeat", backgroundPosition: "center",
          filter: "drop-shadow(0 0 14px rgba(0,210,255,0.25))",
        }} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="t-label">Hoş geldin, raider</span>
          <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 26, color: "var(--fg-1)", letterSpacing: "0.02em" }}>
            {account.displayName}<span style={{ color: "var(--fg-5)", fontWeight: 400 }}>#{account.discriminator}</span>
          </h2>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--fg-4)" }}>
            Son sync: 13 dakika önce · {S.syncedItems} items · {S.syncedBlueprints} blueprints · {S.syncedQuests} quests
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
          <Chip tone="success" icon="check-circle-2">Token Valid · 24h</Chip>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--fg-5)" }}>
            expires 2026-05-21 13:07 UTC
          </span>
        </div>
      </div>

      {/* Stat row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        <StatCard
          label="Credits"
          value={E.credits.toLocaleString()}
          delta={8420}
          meta="all sources"
          footer={<ProgressBar value={68} accent="gradient" />}
        />
        <StatCard
          label="Raider Tokens"
          value={E.raiderTokens.toLocaleString()}
          delta={120}
          meta="weekly cap 1000"
          footer={<ProgressBar value={E.raiderTokens} max={1000} accent="#b06bff" />}
        />
        <StatCard
          label="Stash"
          value={`${E.usedSlots}/${E.maxSlots}`}
          unit="slots"
          accent={slotsPct > 95 ? "#ff9800" : "var(--fg-1)"}
          meta={slotsPct > 95 ? "nearly full" : ""}
          footer={<ProgressBar value={slotsPct} accent={slotsPct > 95 ? "#ff9800" : "gradient"} />}
        />
        <StatCard
          label="XP"
          value={(E.xp / 1000).toFixed(0)}
          unit="k"
          delta={"+38k"}
          meta="lvl 42 → 43"
          footer={<ProgressBar value={62} accent="gradient" />}
        />
      </div>

      {/* Sync summary band */}
      <div style={{
        background: "var(--bg-2)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        padding: "16px 20px",
        display: "flex", alignItems: "center", gap: 22,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <SyncRing active={syncing} />
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 14, color: "var(--fg-1)" }}>
              {syncing ? "Senkronizasyon çalışıyor" : "Senkronize"}
            </span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-4)" }}>
              5 endpoint · paralel · {syncing ? `${syncProgress}%` : "0 unmapped"}
            </span>
          </div>
        </div>
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
          <SyncStat label="items"      value={S.syncedItems} />
          <SyncStat label="blueprints" value={S.syncedBlueprints} />
          <SyncStat label="quests"     value={S.syncedQuests} />
          <SyncStat label="hideout"    value={S.syncedHideout} />
          <SyncStat label="projects"   value={S.syncedProjects} />
        </div>
        {S.unmappedCount > 0 && (
          <Chip tone="warning">{S.unmappedCount} unmapped</Chip>
        )}
      </div>

      {/* Bottom grid — recent inventory + active quests */}
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16 }}>
        <Panel
          title="Son Eklenenler"
          subtitle="post-raid drop · last 24h"
          action={<button onClick={() => onGoTo("inventory")} className="av-link">
            Envanteri Aç <Icon name="arrow-up-right" size={13} />
          </button>}
        >
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10 }}>
            {MOCK.inventory.slice(0, 6).map(item => <ItemTile key={item.i} item={item} />)}
          </div>
        </Panel>

        <Panel
          title="Aktif Questler"
          subtitle={`${MOCK.quests.filter(q => !q.completed).length} in progress`}
          action={<button onClick={() => onGoTo("quests")} className="av-link">
            Hepsi <Icon name="arrow-up-right" size={13} />
          </button>}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {MOCK.quests.filter(q => !q.completed).slice(0, 4).map(q => (
              <QuestRow key={q.id} quest={q} compact />
            ))}
          </div>
        </Panel>
      </div>

      {/* Projects band */}
      <Panel
        title="Aktif Projeler"
        subtitle="hideout build queue"
        action={<button onClick={() => onGoTo("projects")} className="av-link">
          Hepsi <Icon name="arrow-up-right" size={13} />
        </button>}
      >
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          {MOCK.projects.map(p => <ProjectMini key={p.id} project={p} />)}
        </div>
      </Panel>
    </div>
  );
}

function Panel({ title, subtitle, action, children }) {
  return (
    <section style={{
      background: "var(--bg-2)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-md)",
      padding: "16px 18px",
      display: "flex", flexDirection: "column", gap: 14,
    }}>
      <header style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <h3 style={{
          margin: 0, fontFamily: "var(--font-display)", fontWeight: 600,
          fontSize: 16, color: "var(--fg-1)", letterSpacing: "0.01em",
        }}>{title}</h3>
        {subtitle && (
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-5)" }}>{subtitle}</span>
        )}
        {action && <div style={{ marginLeft: "auto" }}>{action}</div>}
      </header>
      {children}
    </section>
  );
}

function SyncRing({ active }) {
  return (
    <div style={{
      width: 44, height: 44, borderRadius: "50%",
      background: active
        ? "conic-gradient(from -90deg, #00d2ff 0deg, #7b2ff7 270deg, rgba(255,255,255,0.06) 270deg 360deg)"
        : "conic-gradient(from -90deg, #4caf50 0deg, #4caf50 360deg)",
      display: "flex", alignItems: "center", justifyContent: "center",
      boxShadow: active
        ? "0 0 0 1px rgba(123,47,247,0.4), 0 0 18px rgba(0,210,255,0.18)"
        : "0 0 0 1px rgba(76,175,80,0.35)",
      animation: active ? "av-spin 2.2s linear infinite" : "none",
      flexShrink: 0,
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: "50%", background: "var(--bg-2)",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: active ? "#00d2ff" : "#4caf50",
      }}>
        <Icon name={active ? "refresh-cw" : "check-circle-2"} size={16} />
      </div>
    </div>
  );
}

function SyncStat({ label, value }) {
  return (
    <div style={{
      padding: "8px 10px",
      background: "rgba(255,255,255,0.02)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-sm)",
      display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
    }}>
      <span style={{
        fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18,
        color: "#00d2ff", fontVariantNumeric: "tabular-nums", lineHeight: 1,
      }}>{value}</span>
      <span style={{
        fontFamily: "var(--font-ui)", fontWeight: 500, fontSize: 10,
        color: "var(--fg-5)", textTransform: "uppercase", letterSpacing: "0.14em",
      }}>{label}</span>
    </div>
  );
}

function QuestRow({ quest, compact }) {
  const trader = TRADERS[quest.trader];
  const pct = (quest.progress / quest.target) * 100;
  return (
    <div style={{
      padding: "10px 12px",
      background: "rgba(255,255,255,0.02)",
      border: "1px solid var(--border)",
      borderLeft: `2px solid ${trader.color}`,
      borderRadius: "var(--radius-sm)",
      display: "flex", flexDirection: "column", gap: 8,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{
          fontFamily: "var(--font-mono)", fontSize: 10,
          color: trader.color, textTransform: "uppercase", letterSpacing: "0.14em",
        }}>{trader.name}</span>
        <span style={{ fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 13, color: "var(--fg-1)" }}>
          {quest.name}
        </span>
        <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-4)" }}>
          {quest.progress.toLocaleString()}/{quest.target.toLocaleString()}
        </span>
      </div>
      {!compact && (
        <span style={{ fontFamily: "var(--font-ui)", fontSize: 12, color: "var(--fg-3)" }}>{quest.objective}</span>
      )}
      <ProgressBar value={pct} accent={trader.color} height={4} />
    </div>
  );
}

function ProjectMini({ project }) {
  const phasePct = ((project.phase - 1) / project.phaseCount) * 100;
  return (
    <div style={{
      padding: "14px",
      background: "rgba(255,255,255,0.02)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-sm)",
      display: "flex", flexDirection: "column", gap: 10,
    }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 14, color: "var(--fg-1)" }}>{project.name}</span>
        <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-4)" }}>
          phase {project.phase} / {project.phaseCount}
        </span>
      </div>
      <ProgressBar value={phasePct} accent="gradient" height={4} />
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {project.goals.map(g => (
          <div key={g.name} style={{
            display: "grid", gridTemplateColumns: "1fr auto auto", gap: 10, alignItems: "center",
            fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--fg-3)",
          }}>
            <span style={{ color: g.have >= g.need ? "#4caf50" : "var(--fg-3)" }}>{g.name}</span>
            <span style={{ color: "var(--fg-4)" }}>{g.have}/{g.need}</span>
            <span style={{ width: 60 }}>
              <ProgressBar value={(g.have / g.need) * 100} accent={g.have >= g.need ? "#4caf50" : "gradient"} height={3} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { DashboardScreen, Panel, QuestRow, ProjectMini });

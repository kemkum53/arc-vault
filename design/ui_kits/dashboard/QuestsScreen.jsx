// ARC Vault — Quests screen.

function QuestsScreen() {
  const [traderFilter, setTraderFilter] = React.useState("all");
  const traders = [
    { id: "all", name: "Tümü", color: "var(--fg-2)" },
    { id: "shani", name: "Shani", color: TRADERS.shani.color },
    { id: "celeste", name: "Celeste", color: TRADERS.celeste.color },
    { id: "apollo", name: "Apollo", color: TRADERS.apollo.color },
    { id: "lance", name: "Lance", color: TRADERS.lance.color },
    { id: "tian", name: "Tian Wen", color: TRADERS.tian.color },
  ];
  const filtered = MOCK.quests.filter(q => traderFilter === "all" || q.trader === traderFilter);
  const inProgress = filtered.filter(q => !q.completed);
  const completed  = filtered.filter(q =>  q.completed);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Trader filter */}
      <div style={{
        display: "flex", gap: 8, padding: "12px 14px", flexWrap: "wrap",
        background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)",
      }}>
        {traders.map(t => {
          const active = t.id === traderFilter;
          return (
            <button key={t.id} onClick={() => setTraderFilter(t.id)} style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              padding: "6px 14px",
              border: `1px solid ${active ? t.color : "var(--border-strong)"}`,
              background: active ? `${t.color}1a` : "transparent",
              borderRadius: 999,
              color: active ? t.color : "var(--fg-3)",
              fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 12,
              cursor: "pointer",
              transition: "all 180ms cubic-bezier(0.16,1,0.3,1)",
            }}>
              {t.id !== "all" && <span style={{ width: 8, height: 8, borderRadius: 999, background: t.color }} />}
              {t.name}
            </button>
          );
        })}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <Chip tone="brand">{inProgress.length} aktif</Chip>
          <Chip tone="success">{completed.length} tamamlandı</Chip>
        </div>
      </div>

      {/* Active section */}
      <SectionHeader title="Aktif" count={inProgress.length} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {inProgress.map(q => <QuestCard key={q.id} quest={q} />)}
      </div>

      {completed.length > 0 && (
        <React.Fragment>
          <SectionHeader title="Tamamlandı" count={completed.length} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            {completed.map(q => <QuestCard key={q.id} quest={q} />)}
          </div>
        </React.Fragment>
      )}
    </div>
  );
}

function SectionHeader({ title, count }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 4 }}>
      <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 18, color: "var(--fg-1)" }}>{title}</h2>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-4)" }}>{count}</span>
      <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
    </div>
  );
}

function QuestCard({ quest }) {
  const trader = TRADERS[quest.trader];
  const pct = (quest.progress / quest.target) * 100;
  return (
    <div style={{
      background: "var(--bg-2)",
      border: "1px solid var(--border)",
      borderLeft: `3px solid ${trader.color}`,
      borderRadius: "var(--radius-md)",
      padding: "16px 18px",
      display: "flex", flexDirection: "column", gap: 14,
      opacity: quest.completed ? 0.7 : 1,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{
          padding: "3px 10px", borderRadius: 999, fontFamily: "var(--font-mono)",
          fontSize: 10, fontWeight: 700, color: trader.color, background: `${trader.color}1f`,
          textTransform: "uppercase", letterSpacing: "0.16em",
        }}>{trader.name}</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-5)" }}>
          {quest.map.replace(/_/g, " ")}
        </span>
        <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-4)" }}>
          +{quest.xp.toLocaleString()} xp
        </span>
        {quest.completed && <Icon name="check-circle-2" size={16} style={{ color: "#4caf50" }} />}
      </div>

      <div>
        <h3 style={{
          margin: 0, fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 17,
          color: "var(--fg-1)", letterSpacing: "0.01em",
        }}>{quest.name}</h3>
        <p style={{
          margin: "6px 0 0", fontFamily: "var(--font-ui)", fontSize: 13, color: "var(--fg-3)",
          lineHeight: 1.55,
        }}>{quest.objective}</p>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <ProgressBar value={pct} accent={quest.completed ? "#4caf50" : trader.color} height={6} style={{ flex: 1 }} />
        <span style={{
          fontFamily: "var(--font-mono)", fontSize: 12, color: quest.completed ? "#4caf50" : "var(--fg-2)",
          fontVariantNumeric: "tabular-nums", minWidth: 88, textAlign: "right",
        }}>
          {quest.progress.toLocaleString()} / {quest.target.toLocaleString()}
        </span>
      </div>

      <div style={{
        display: "flex", alignItems: "center", gap: 8, paddingTop: 10,
        borderTop: "1px solid var(--border)", flexWrap: "wrap",
      }}>
        <span className="t-label">Ödül</span>
        {quest.reward.map((r, i) => (
          <span key={i} style={{
            padding: "3px 10px",
            background: "rgba(255,255,255,0.03)",
            border: "1px solid var(--border-strong)",
            borderRadius: 4,
            fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-2)",
          }}>{r.qty ? `${r.qty}× ` : ""}{r.item}</span>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { QuestsScreen, SectionHeader });

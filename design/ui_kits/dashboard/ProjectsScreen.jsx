// ARC Vault — Projects screen.

function ProjectsScreen() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
        <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 20, color: "var(--fg-1)" }}>
          {MOCK.projects.length} aktif proje
        </h2>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--fg-4)" }}>
          hideout build queue · phases stored as Json
        </span>
        <div style={{ marginLeft: "auto" }}>
          <Button variant="secondary" icon="plus">Yeni Proje</Button>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {MOCK.projects.map(p => <ProjectCard key={p.id} project={p} />)}
      </div>
    </div>
  );
}

function ProjectCard({ project }) {
  const phasePct = ((project.phase - 0.5) / project.phaseCount) * 100;
  return (
    <div style={{
      background: "var(--bg-2)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-md)",
      padding: "20px 22px",
      display: "grid",
      gridTemplateColumns: "1.1fr 1.4fr",
      gap: 26,
    }}>
      {/* Left — title + phase timeline */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <span className="t-label">Project</span>
          <h3 style={{
            margin: "6px 0 4px",
            fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 22,
            color: "var(--fg-1)", letterSpacing: "0.02em",
          }}>{project.name}</h3>
          <p style={{ margin: 0, fontFamily: "var(--font-ui)", fontSize: 13, color: "var(--fg-3)", lineHeight: 1.55 }}>
            {project.description}
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
          <div style={{
            display: "flex", justifyContent: "space-between",
            fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-4)",
            textTransform: "uppercase", letterSpacing: "0.12em",
          }}>
            <span>Phase {project.phase} of {project.phaseCount}</span>
            <span>{Math.round(phasePct)}%</span>
          </div>
          <PhaseTrack phase={project.phase} count={project.phaseCount} />
        </div>
      </div>

      {/* Right — goals */}
      <div style={{
        display: "flex", flexDirection: "column", gap: 8,
        padding: "16px 18px",
        background: "rgba(255,255,255,0.02)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-sm)",
      }}>
        <span className="t-label">Phase {project.phase} Hedefleri</span>
        {project.goals.map(g => {
          const done = g.have >= g.need;
          return (
            <div key={g.name} style={{
              display: "grid", gridTemplateColumns: "auto 1fr auto auto", gap: 12, alignItems: "center",
              padding: "8px 10px",
              background: done ? "rgba(76,175,80,0.06)" : "transparent",
              borderRadius: "var(--radius-sm)",
            }}>
              <span style={{
                width: 18, height: 18, borderRadius: 999,
                border: `1.5px solid ${done ? "#4caf50" : "var(--border-strong)"}`,
                background: done ? "#4caf50" : "transparent",
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                color: done ? "#fff" : "transparent",
              }}>
                {done && <Icon name="check-circle-2" size={11} />}
              </span>
              <span style={{
                fontFamily: "var(--font-ui)", fontWeight: 500, fontSize: 13.5,
                color: done ? "#4caf50" : "var(--fg-2)",
                textDecoration: done ? "line-through" : "none",
                textDecorationColor: "rgba(76,175,80,0.5)",
              }}>{g.name}</span>
              <span style={{
                fontFamily: "var(--font-mono)", fontSize: 12,
                color: done ? "#4caf50" : "var(--fg-4)", minWidth: 56, textAlign: "right",
              }}>{g.have} / {g.need}</span>
              <span style={{ width: 80 }}>
                <ProgressBar value={(g.have / g.need) * 100} accent={done ? "#4caf50" : "gradient"} height={4} />
              </span>
            </div>
          );
        })}

        <div style={{
          marginTop: 6, paddingTop: 10, borderTop: "1px solid var(--border)",
          display: "flex", gap: 8,
        }}>
          <Button variant="primary" icon="check-circle-2">Phase'i Tamamla</Button>
          <Button variant="ghost">Detay</Button>
        </div>
      </div>
    </div>
  );
}

function PhaseTrack({ phase, count }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {Array.from({ length: count }).map((_, i) => {
        const done    = i + 1 < phase;
        const current = i + 1 === phase;
        return (
          <React.Fragment key={i}>
            <span style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 26, height: 26, borderRadius: 999, flexShrink: 0,
              background: done
                ? "linear-gradient(135deg, #7b2ff7, #00d2ff)"
                : current
                  ? "rgba(0,210,255,0.10)"
                  : "rgba(255,255,255,0.03)",
              border: `1px solid ${done ? "transparent" : current ? "rgba(0,210,255,0.45)" : "var(--border-strong)"}`,
              color: done ? "#fff" : current ? "#00d2ff" : "var(--fg-5)",
              fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700,
            }}>{i + 1}</span>
            {i < count - 1 && (
              <span style={{
                flex: 1, height: 2,
                background: done ? "linear-gradient(90deg, #7b2ff7, #00d2ff)" : "rgba(255,255,255,0.04)",
                borderRadius: 1,
              }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

Object.assign(window, { ProjectsScreen });

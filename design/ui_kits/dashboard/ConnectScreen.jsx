// ARC Vault — Connect/login screen (Embark account linking).

function ConnectScreen({ onConnect }) {
  const [email, setEmail] = React.useState("kemkum@arc-vault.io");
  const [password, setPassword] = React.useState("••••••••••");
  const [busy, setBusy] = React.useState(false);

  const connect = () => {
    setBusy(true);
    setTimeout(() => { setBusy(false); onConnect(); }, 1600);
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "radial-gradient(circle at 70% 20%, rgba(123,47,247,0.18), transparent 60%), radial-gradient(circle at 20% 80%, rgba(0,210,255,0.12), transparent 55%), var(--bg-1)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 40,
    }}>
      <div style={{
        width: 920, maxWidth: "100%",
        background: "var(--bg-2)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "0 24px 80px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.04) inset",
        display: "grid", gridTemplateColumns: "1.1fr 1fr",
        overflow: "hidden",
      }}>
        {/* Left — branded hero */}
        <div style={{
          padding: "40px 40px 36px",
          background: "linear-gradient(180deg, rgba(123,47,247,0.10), rgba(0,210,255,0.04) 60%, transparent)",
          borderRight: "1px solid var(--border)",
          display: "flex", flexDirection: "column", gap: 24,
          position: "relative", overflow: "hidden",
        }}>
          <Wordmark size={22} />
          <div style={{
            width: 180, height: 180, margin: "16px auto 4px",
            backgroundImage: "url('../../assets/arc_vault_logo.png')",
            backgroundSize: "contain", backgroundRepeat: "no-repeat", backgroundPosition: "center",
            filter: "drop-shadow(0 0 28px rgba(0,210,255,0.25)) drop-shadow(0 0 40px rgba(123,47,247,0.28))",
          }} />

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <h1 style={{
              margin: 0, fontFamily: "var(--font-display)", fontWeight: 700,
              fontSize: 32, lineHeight: 1.15, letterSpacing: "0.02em",
              color: "var(--fg-1)",
            }}>Envanterin tek<br/>komuta merkezi.</h1>
            <p style={{
              margin: 0, fontFamily: "var(--font-ui)", fontSize: 14,
              color: "var(--fg-3)", lineHeight: 1.55, maxWidth: 360,
            }}>
              arctracker.io hesabını bağla. ARC Vault envanterini, blueprintlerini,
              questlerini ve hideout modüllerini paralel olarak senkronize eder.
            </p>
          </div>

          <div style={{
            marginTop: "auto",
            display: "flex", flexDirection: "column", gap: 8,
            paddingTop: 16, borderTop: "1px solid var(--border)",
          }}>
            <ConnectFeature icon="boxes"          label="565 item · 100 quest · 9 modül kapsama" />
            <ConnectFeature icon="refresh-cw"     label="5 endpoint paralel sync · ortalama 3s" />
            <ConnectFeature icon="lock"           label="Token yenilemesi tarayıcı eklentisi ile" />
          </div>
        </div>

        {/* Right — form */}
        <div style={{ padding: "40px", display: "flex", flexDirection: "column", gap: 22 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="t-label">Step 1</span>
            <h2 style={{
              margin: 0, fontFamily: "var(--font-display)", fontWeight: 600,
              fontSize: 22, color: "var(--fg-1)",
            }}>arctracker.io hesabını bağla</h2>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Field label="Email">
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={inputStyle}
              />
            </Field>
            <Field label="Şifre">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={inputStyle}
              />
            </Field>
            <Field label="API Adresi" hint="Lokal ARC Vault sunucusu">
              <input
                value="http://localhost:8000"
                readOnly
                style={{ ...inputStyle, color: "var(--fg-4)" }}
              />
            </Field>
          </div>

          <Button variant="primary" icon="link-2" full onClick={connect}>
            {busy ? "Bağlanılıyor..." : "Connect Embark"}
          </Button>

          <div style={{
            padding: "10px 12px",
            background: "rgba(255,152,0,0.08)",
            border: "1px solid rgba(255,152,0,0.25)",
            borderRadius: "var(--radius)",
            display: "flex", gap: 10, alignItems: "flex-start",
            fontSize: 12, color: "var(--fg-3)", lineHeight: 1.5,
          }}>
            <span style={{ color: "#ff9800", display: "inline-flex" }}>
              <Icon name="triangle-alert" size={16} />
            </span>
            <span>
              Token süresi dolduğunda <strong style={{ color: "#ff9800" }}>ARC Vault tarayıcı eklentisi</strong> Xbox OAuth callback'ini <code style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>127.0.0.1:49172</code> üzerinden yakalar. Eklenti kurulu olmalı.
            </span>
          </div>

          <div style={{
            marginTop: -4,
            fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-5)",
            textAlign: "center",
          }}>
            arctracker.io · cdn.arctracker.io · embark
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{
        display: "flex", justifyContent: "space-between",
        fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 11,
        color: "var(--fg-4)", textTransform: "uppercase", letterSpacing: "0.14em",
      }}>
        <span>{label}</span>
        {hint && <span style={{ textTransform: "none", letterSpacing: "0.04em", color: "var(--fg-5)" }}>{hint}</span>}
      </span>
      {children}
    </label>
  );
}

const inputStyle = {
  background: "var(--bg-input)",
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius)",
  padding: "11px 12px",
  color: "var(--fg-2)",
  fontSize: 13.5,
  fontFamily: "var(--font-ui)",
  outline: "none",
};

function ConnectFeature({ icon, label }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      fontFamily: "var(--font-ui)", fontSize: 13, color: "var(--fg-3)",
    }}>
      <span style={{
        width: 28, height: 28, borderRadius: "var(--radius-sm)",
        background: "rgba(0,210,255,0.10)", color: "#00d2ff",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
      }}>
        <Icon name={icon} size={14} />
      </span>
      <span>{label}</span>
    </div>
  );
}

Object.assign(window, { ConnectScreen });

"use client";

import { useState, useEffect } from "react";
import { Button, Icon } from "@/components/ui";
import { useT, useLang } from "@/lib/i18n";
import type { DisplayAccount } from "@/lib/types";
import { deleteAccount, getSteamCredentials, updateAccount } from "@/lib/api";

function Countdown({ target }: { target: string }) {
  const { lang } = useLang();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const diff = new Date(target).getTime() - now;
  if (diff <= 0) return <span style={{ color: "#f44336" }}>{lang === "en" ? "Expired" : "Süresi doldu"}</span>;
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  const parts: string[] = [];
  if (lang === "en") {
    if (d > 0) parts.push(`${d}d`);
    parts.push(`${h}h`, `${String(m).padStart(2, "0")}m`, `${String(s).padStart(2, "0")}s`);
  } else {
    if (d > 0) parts.push(`${d}g`);
    parts.push(`${h}s`, `${String(m).padStart(2, "0")}dk`, `${String(s).padStart(2, "0")}sn`);
  }
  return <>{parts.join(" ")}</>;
}
interface SettingsScreenProps {
  account: DisplayAccount;
  accountId: string;
  onDisconnect: () => void;
}

function SettingsCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)",
      padding: "20px 22px", display: "flex", flexDirection: "column", gap: 12,
    }}>
      <div style={{ paddingBottom: 10, borderBottom: "1px solid var(--border)" }}>
        <h3 style={{ margin: 0, fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 16, color: "var(--fg-1)" }}>{title}</h3>
        {subtitle && <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-5)" }}>{subtitle}</span>}
      </div>
      {children}
    </div>
  );
}

function Row({ label, value, mono, accent }: { label: string; value: React.ReactNode; mono?: boolean; accent?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
      <span style={{ fontFamily: "var(--font-ui)", fontSize: 13, color: "var(--fg-4)" }}>{label}</span>
      <span style={{ fontFamily: mono ? "var(--font-mono)" : "var(--font-ui)", fontSize: 13, color: accent || "var(--fg-2)" }}>{value}</span>
    </div>
  );
}

const fieldInput: React.CSSProperties = {
  flex: 1, minWidth: 0, background: "var(--bg-input)", border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius)", color: "var(--fg-1)", fontFamily: "var(--font-mono)", fontSize: 13,
  padding: "7px 10px", outline: "none",
};
const iconBtn: React.CSSProperties = {
  width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", padding: 0,
  background: "var(--bg-3)", border: "1px solid var(--border)", borderRadius: "var(--radius)",
  color: "var(--fg-3)", cursor: "pointer", flexShrink: 0,
};

/** Steam login for the account: stored encrypted, shown masked, copyable. */
function SteamCard({ accountId }: { accountId: string }) {
  const [creds, setCreds] = useState<{ user: string; pass: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reveal, setReveal] = useState(false);
  const [editing, setEditing] = useState(false);
  const [formUser, setFormUser] = useState("");
  const [formPass, setFormPass] = useState("");
  const [showFormPass, setShowFormPass] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setCreds(null);
    setEditing(false);
    getSteamCredentials(accountId)
      .then(c => { if (!cancelled) setCreds({ user: c.steam_username ?? "", pass: c.steam_password ?? "" }); })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [accountId]);

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(n => (n === msg ? null : n)), 3000);
  };

  const copy = async (value: string, what: string) => {
    try {
      await navigator.clipboard.writeText(value);
      flash(`${what} kopyalandı`);
    } catch {
      setError("Panoya kopyalanamadı; tarayıcı izin vermedi");
    }
  };

  const startEdit = () => {
    setFormUser(creds?.user ?? "");
    setFormPass(creds?.pass ?? "");
    setShowFormPass(false);
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const user = formUser.trim();
      await updateAccount(accountId, { steam_username: user, steam_password: formPass });
      setCreds({ user, pass: formPass });
      setEditing(false);
      flash(user || formPass ? "Steam bilgileri kaydedildi" : "Steam bilgileri silindi");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const empty = <span style={{ color: "var(--fg-5)", fontFamily: "var(--font-ui)" }}>girilmemiş</span>;
  const valueRow = (label: string, value: string, secret: boolean, what: string) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 0" }}>
      <span style={{ fontFamily: "var(--font-ui)", fontSize: 13, color: "var(--fg-4)", width: 80, flexShrink: 0 }}>{label}</span>
      <span style={{ flex: 1, minWidth: 0, fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--fg-1)", overflow: "hidden", textOverflow: "ellipsis" }}>
        {!value ? empty : secret && !reveal ? "•".repeat(Math.min(value.length, 14)) : value}
      </span>
      {secret && value && (
        <button style={iconBtn} onClick={() => setReveal(r => !r)} title={reveal ? "Gizle" : "Göster"}>
          <Icon name={reveal ? "eye-off" : "eye"} size={15} />
        </button>
      )}
      <button style={{ ...iconBtn, opacity: value ? 1 : 0.4, cursor: value ? "pointer" : "default" }}
        disabled={!value} onClick={() => copy(value, what)} title={`${what} kopyala`}>
        <Icon name="copy" size={15} />
      </button>
    </div>
  );

  return (
    <SettingsCard title="Steam" subtitle="giriş bilgileri · şifreli saklanır">
      {error && <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "#f44336" }}>{error}</span>}
      {!creds && !error && <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--fg-5)" }}>yükleniyor...</span>}
      {creds && !editing && (
        <>
          {valueRow("Steam ID", creds.user, false, "Steam ID")}
          {valueRow("Şifre", creds.pass, true, "Şifre")}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
            <Button variant="secondary" icon="edit-2" onClick={startEdit}>
              {creds.user || creds.pass ? "Düzenle" : "Steam bilgisi ekle"}
            </Button>
            {notice && <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "#4caf50" }}>{notice}</span>}
          </div>
        </>
      )}
      {creds && editing && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontFamily: "var(--font-ui)", fontSize: 13, color: "var(--fg-4)", width: 80 }}>Steam ID</span>
            <input value={formUser} onChange={e => setFormUser(e.target.value)} style={fieldInput}
              autoComplete="off" spellCheck={false} placeholder="kullanıcı adı" />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontFamily: "var(--font-ui)", fontSize: 13, color: "var(--fg-4)", width: 80 }}>Şifre</span>
            <input value={formPass} onChange={e => setFormPass(e.target.value)} style={fieldInput}
              type={showFormPass ? "text" : "password"} autoComplete="new-password" spellCheck={false} />
            <button style={iconBtn} onClick={() => setShowFormPass(s => !s)} title={showFormPass ? "Gizle" : "Göster"}>
              <Icon name={showFormPass ? "eye-off" : "eye"} size={15} />
            </button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
            <Button variant="primary" icon="check" onClick={save}>{saving ? "Kaydediliyor" : "Kaydet"}</Button>
            <Button variant="ghost" onClick={() => setEditing(false)}>Vazgeç</Button>
            <span style={{ fontFamily: "var(--font-ui)", fontSize: 12, color: "var(--fg-5)" }}>
              İkisini de boş bırakıp kaydedersen bilgiler silinir.
            </span>
          </div>
        </>
      )}
    </SettingsCard>
  );
}

export function SettingsScreen({ account, accountId, onDisconnect }: SettingsScreenProps) {
  const t = useT();
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!confirm(t("set.confirmDelete"))) return;
    setDeleting(true);
    try {
      await deleteAccount(accountId);
      onDisconnect();
    } catch (err) {
      console.error("Hesap silme hatası:", err);
      setDeleting(false);
    }
  };

  const formatDate = (iso: string) => {
    if (!iso) return "-";
    try { return new Date(iso).toISOString().replace("T", " ").slice(0, 19); } catch { return iso; }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 720 }}>
      <SettingsCard title={t("set.embarkAccount")} subtitle={t("set.connectedVia")}>
        <Row label={t("set.displayName")} value={`${account.displayName}#${account.discriminator}`} />
        <Row label={t("set.provider")} value={account.provider.toUpperCase()} mono />
        <Row label={t("set.linkedAt")} value={formatDate(account.linkedAt)} mono />
        <Row label={t("set.tokenExpires")}
          value={account.tokenExpiresAt ? <Countdown target={account.tokenExpiresAt} /> : "-"}
          mono accent={account.isTokenExpired ? "#f44336" : "#4caf50"} />
        <Row label={t("set.tokenStatus")} value={account.isTokenExpired ? "EXPIRED" : "VALID"} mono
          accent={account.isTokenExpired ? "#f44336" : "#4caf50"} />
        <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
          <Button variant="dangerOutline" icon="log-out" onClick={handleDelete}>
            {deleting ? t("set.removing") : t("set.removeAccount")}
          </Button>
        </div>
      </SettingsCard>

      <SteamCard accountId={accountId} />
    </div>
  );
}

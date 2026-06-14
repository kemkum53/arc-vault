"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui";
import { useT, useLang } from "@/lib/i18n";
import type { DisplayAccount } from "@/lib/types";
import { deleteAccount } from "@/lib/api";

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

    </div>
  );
}

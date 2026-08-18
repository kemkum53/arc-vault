"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import { HomeScreen } from "@/components/screens/HomeScreen";
import { DashboardScreen } from "@/components/screens/DashboardScreen";
import { InventoryScreen } from "@/components/screens/InventoryScreen";
import { QuestsScreen } from "@/components/screens/QuestsScreen";
import { BlueprintsScreen } from "@/components/screens/BlueprintsScreen";
import { HideoutScreen } from "@/components/screens/HideoutScreen";
import { ProjectsScreen } from "@/components/screens/ProjectsScreen";
import { SettingsScreen } from "@/components/screens/SettingsScreen";
import { WorkshopScreen } from "@/components/screens/WorkshopScreen";
import { ExpeditionScreen } from "@/components/screens/ExpeditionScreen";
import { LoginScreen } from "@/components/screens/LoginScreen";
import { AddAccountModal } from "@/components/AddAccountModal";
import { UserManagementModal } from "@/components/UserManagementModal";
import { GlobalSearchModal } from "@/components/GlobalSearchModal";
import { SettingsModal } from "@/components/SettingsModal";
import { useAuth } from "@/lib/auth";
import { useT, useLang } from "@/lib/i18n";
import {
  getAccounts,
  getAccount,
  getSyncedData,
  triggerSync,
  getItemsReference,
  getQuestsReference,
  getHideoutReference,
  getModsReference,
} from "@/lib/api";
import { buildDashboardData } from "@/lib/transform";
import type { AccountResponse, DashboardData, SyncDataResponse, ItemReference, QuestReference, HideoutReference, ModReference } from "@/lib/types";

type View = "home" | "account";

const ORDER_KEY = "arc_vault_account_order";

function sortByOrder(accs: AccountResponse[]): AccountResponse[] {
  try {
    const saved = localStorage.getItem(ORDER_KEY);
    if (!saved) return accs;
    const order: string[] = JSON.parse(saved);
    const idx = new Map(order.map((id, i) => [id, i]));
    return [...accs].sort((a, b) => (idx.get(a.id) ?? 999) - (idx.get(b.id) ?? 999));
  } catch {
    return accs;
  }
}

export default function Home() {
  const { user, loading: authLoading, isAdmin } = useAuth();
  const t = useT();
  const { lang } = useLang();
  const tRef = useRef(t);
  const langRef = useRef(lang);
  tRef.current = t;
  langRef.current = lang;
  const [view, setView] = useState<View>("home");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<AccountResponse[]>([]);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [active, setActive] = useState("dashboard");
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showUserModal, setShowUserModal] = useState(false);
  const [bulkSyncing, setBulkSyncing] = useState(false);
  const [bulkStatus, setBulkStatus] = useState<string | null>(null);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [cardStatuses, setCardStatuses] = useState<Record<string, string>>({});
  const [workshopRefreshKey, setWorkshopRefreshKey] = useState(0);
  const syncPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Raw data for re-transform on language change
  const [rawData, setRawData] = useState<{
    account: AccountResponse;
    syncData: SyncDataResponse;
    itemsRef: Record<string, ItemReference>;
    questsRef: Record<string, QuestReference>;
    hideoutRef: Record<string, HideoutReference>;
    modsRef: Record<string, ModReference>;
  } | null>(null);

  const handleSetActive = useCallback((tab: string) => {
    setActive(tab);
    if (accountId) {
      window.location.hash = `${accountId}/${tab}`;
    }
  }, [accountId]);

  const loadData = useCallback(async (accId: string) => {
    try {
      const [account, syncData, itemsRef, questsRef, hideoutRef, modsRef] = await Promise.all([
        getAccount(accId),
        getSyncedData(accId),
        getItemsReference(),
        getQuestsReference(),
        getHideoutReference(),
        getModsReference(),
      ]);

      setRawData({ account, syncData, itemsRef, questsRef, hideoutRef, modsRef });
      const dashboard = buildDashboardData(account, syncData, itemsRef, questsRef, hideoutRef, modsRef, langRef.current);
      setData(dashboard);
      setError(null);
    } catch (err) {
      console.error("Data load error:", err);
      setError(err instanceof Error ? err.message : tRef.current("common.unknownError"));
    }
  }, []);

  const stopSyncPoll = useCallback(() => {
    if (syncPollRef.current) {
      clearInterval(syncPollRef.current);
      syncPollRef.current = null;
    }
  }, []);

  const startSyncPoll = useCallback(() => {
    stopSyncPoll();
    syncPollRef.current = setInterval(async () => {
      try {
        const accs = await getAccounts();
        setAccounts(sortByOrder(accs));
        const stillSyncing = accs.filter(a => a.sync_status === "syncing");
        const statuses: Record<string, string> = {};
        for (const a of stillSyncing) statuses[a.id] = "syncing";
        setCardStatuses(prev => {
          const next = { ...prev };
          for (const id of Object.keys(next)) {
            if (next[id] === "syncing" && !statuses[id]) delete next[id];
          }
          return { ...next, ...statuses };
        });
        if (stillSyncing.length === 0) {
          stopSyncPoll();
          setBulkSyncing(false);
          setBulkStatus(null);
        }
      } catch { /* ignore */ }
    }, 3000);
  }, [stopSyncPoll]);

  const loadAccounts = useCallback(async () => {
    try {
      const accs = await getAccounts();
      setAccounts(sortByOrder(accs));
      const syncing = accs.filter(a => a.sync_status === "syncing");
      if (syncing.length > 0) {
        setBulkSyncing(true);
        const total = accs.length;
        const done = total - syncing.length;
        setBulkStatus(`Sync devam ediyor (${done}/${total})`);
        setCardStatuses(prev => {
          const next = { ...prev };
          for (const a of syncing) next[a.id] = "syncing";
          return next;
        });
        startSyncPoll();
      }
    } catch (err) {
      console.error("Account list error:", err);
      setError(tRef.current("common.apiDown"));
    }
  }, [startSyncPoll]);

  const updateHash = useCallback((accId: string | null, tab: string) => {
    if (accId) {
      window.location.hash = `${accId}/${tab}`;
    } else {
      history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  // Re-transform when language changes
  useEffect(() => {
    if (rawData) {
      const dashboard = buildDashboardData(
        rawData.account, rawData.syncData, rawData.itemsRef,
        rawData.questsRef, rawData.hideoutRef, rawData.modsRef, lang,
      );
      setData(dashboard);
    }
  }, [lang, rawData]);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    async function init() {
      try {
        await loadAccounts();

        const hash = window.location.hash.slice(1);
        if (hash) {
          const [hashAccId, hashTab] = hash.split("/");
          if (hashAccId) {
            setAccountId(hashAccId);
            setActive(hashTab || "dashboard");
            setView("account");
            await loadData(hashAccId);
          }
        }
      } finally {
        setLoading(false);
      }
    }
    init();
    return () => stopSyncPoll();
  }, [user, loadAccounts, loadData, stopSyncPoll]);

  const handleSelectAccount = useCallback(async (id: string) => {
    setAccountId(id);
    setActive("dashboard");
    setView("account");
    updateHash(id, "dashboard");
    setLoading(true);
    try {
      await loadData(id);
    } finally {
      setLoading(false);
    }
  }, [loadData, updateHash]);

  const handleBackToHome = useCallback(async () => {
    setView("home");
    setAccountId(null);
    setData(null);
    setActive("dashboard");
    setError(null);
    updateHash(null, "dashboard");
    await loadAccounts();
  }, [loadAccounts, updateHash]);

  const handleAccountCreated = useCallback(async (newAccountId: string) => {
    setShowAddModal(false);
    await loadAccounts();

    setAccountId(newAccountId);
    setActive("dashboard");
    setView("account");
    updateHash(newAccountId, "dashboard");

    try {
      await triggerSync(newAccountId, true);
      await loadData(newAccountId);
    } catch (err) {
      console.error("New account setup error:", err);
      try { await loadData(newAccountId); } catch { /* ignore */ }
    }
  }, [loadAccounts, loadData]);

  const handleSync = useCallback(async () => {
    if (syncing || !accountId) return;
    setSyncing(true);
    setSyncProgress(0);

    let p = 0;
    const tick = setInterval(() => {
      p += 4 + Math.random() * 8;
      if (p >= 90) { clearInterval(tick); p = 90; }
      setSyncProgress(Math.round(p));
    }, 150);

    try {
      await triggerSync(accountId, true);
      clearInterval(tick);
      setSyncProgress(100);
      await loadData(accountId);
      setWorkshopRefreshKey(k => k + 1);
    } catch (err) {
      console.error("Sync error:", err);
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      clearInterval(tick);
      setTimeout(() => {
        setSyncing(false);
        setSyncProgress(0);
      }, 400);
    }
  }, [syncing, accountId, loadData]);

  const handleDisconnect = useCallback(async () => {
    setView("home");
    setAccountId(null);
    setData(null);
    setActive("dashboard");
    await loadAccounts();
  }, [loadAccounts]);

  const handleCardSync = useCallback(async (id: string) => {
    setCardStatuses(prev => ({ ...prev, [id]: "syncing" }));
    try {
      await triggerSync(id, true);
    } catch { /* ignore */ }
    setCardStatuses(prev => { const n = { ...prev }; delete n[id]; return n; });
    const accs = await getAccounts();
    setAccounts(sortByOrder(accs));
  }, []);

  const handleSyncAll = useCallback(async () => {
    if (bulkSyncing || accounts.length === 0) return;
    const activeAccounts = accounts.filter(a => !a.is_token_expired);
    if (activeAccounts.length === 0) return;
    stopSyncPoll();
    setBulkSyncing(true);
    setBulkStatus(null);
    let ok = 0;
    let fail = 0;
    for (let i = 0; i < activeAccounts.length; i++) {
      const acc = activeAccounts[i];
      const name = acc.display_name || `#${i + 1}`;
      setBulkStatus(`Sync: ${name} (${i + 1}/${activeAccounts.length})`);
      setCardStatuses(prev => ({ ...prev, [acc.id]: "syncing" }));
      try {
        await triggerSync(acc.id, true);
        ok++;
      } catch {
        fail++;
      }
      setCardStatuses(prev => { const n = { ...prev }; delete n[acc.id]; return n; });
    }
    const accs = await getAccounts();
    setAccounts(sortByOrder(accs));
    setBulkSyncing(false);
    setBulkStatus(`Senkronizasyon tamamlandı! ${ok} başarılı${fail ? `, ${fail} başarısız` : ""}`);
    setTimeout(() => setBulkStatus(null), 5000);
  }, [bulkSyncing, accounts, stopSyncPoll]);

  const handleReorder = useCallback((orderedIds: string[]) => {
    localStorage.setItem(ORDER_KEY, JSON.stringify(orderedIds));
    setAccounts(prev => {
      const map = new Map(prev.map(a => [a.id, a]));
      const sorted: AccountResponse[] = [];
      for (const id of orderedIds) {
        const acc = map.get(id);
        if (acc) sorted.push(acc);
      }
      for (const a of prev) {
        if (!orderedIds.includes(a.id)) sorted.push(a);
      }
      return sorted;
    });
  }, []);

  if (authLoading) {
    return (
      <div style={{
        minHeight: "100vh", background: "var(--bg-1)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <div style={{
          width: 48, height: 48, borderRadius: "50%",
          background: "conic-gradient(from -90deg, #00d2ff 0deg, #7b2ff7 270deg, rgba(255,255,255,0.06) 270deg 360deg)",
          display: "flex", alignItems: "center", justifyContent: "center",
          animation: "av-spin 2.2s linear infinite",
        }}>
          <div style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--bg-1)" }} />
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  if (loading && view === "home" && accounts.length === 0) {
    return (
      <div style={{
        minHeight: "100vh", background: "var(--bg-1)",
        display: "flex", alignItems: "center", justifyContent: "center",
        flexDirection: "column", gap: 16,
      }}>
        <div style={{
          width: 48, height: 48, borderRadius: "50%",
          background: "conic-gradient(from -90deg, #00d2ff 0deg, #7b2ff7 270deg, rgba(255,255,255,0.06) 270deg 360deg)",
          display: "flex", alignItems: "center", justifyContent: "center",
          animation: "av-spin 2.2s linear infinite",
        }}>
          <div style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--bg-1)" }} />
        </div>
        <span style={{
          fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--fg-4)",
          letterSpacing: "0.04em",
        }}>{t("common.loading")}</span>
      </div>
    );
  }

  if (view === "home") {
    return (
      <>
        <HomeScreen
          accounts={accounts}
          onSelectAccount={handleSelectAccount}
          onAddAccount={() => setShowAddModal(true)}
          onManageUsers={() => setShowUserModal(true)}
          onSyncAll={handleSyncAll}
          onGlobalSearch={() => setShowSearchModal(true)}
          onSettings={() => setShowSettingsModal(true)}
          onSyncAccount={handleCardSync}
          cardStatuses={cardStatuses}
          bulkSyncing={bulkSyncing}
          bulkStatus={bulkStatus}
          onReorder={handleReorder}
          loading={false}
        />
        {showAddModal && (
          <AddAccountModal
            onCreated={handleAccountCreated}
            onClose={() => setShowAddModal(false)}
          />
        )}
        {showUserModal && (
          <UserManagementModal onClose={() => setShowUserModal(false)} />
        )}
        {showSearchModal && (
          <GlobalSearchModal accounts={accounts} onClose={() => setShowSearchModal(false)} />
        )}
        {showSettingsModal && (
          <SettingsModal onClose={() => setShowSettingsModal(false)} />
        )}
      </>
    );
  }

  if (!data || !accountId) {
    return (
      <div style={{
        minHeight: "100vh", background: "var(--bg-1)",
        display: "flex", alignItems: "center", justifyContent: "center",
        flexDirection: "column", gap: 16,
      }}>
        <div style={{
          width: 48, height: 48, borderRadius: "50%",
          background: "conic-gradient(from -90deg, #00d2ff 0deg, #7b2ff7 270deg, rgba(255,255,255,0.06) 270deg 360deg)",
          display: "flex", alignItems: "center", justifyContent: "center",
          animation: "av-spin 2.2s linear infinite",
        }}>
          <div style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--bg-1)" }} />
        </div>
        <span style={{
          fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--fg-4)",
        }}>{t("common.loadingData")}</span>
      </div>
    );
  }

  const errorBanner = error ? (
    <div style={{
      padding: "10px 16px", margin: "0 28px 0",
      background: "rgba(244,67,54,0.08)", border: "1px solid rgba(244,67,54,0.25)",
      borderRadius: "var(--radius)", color: "#f44336",
      fontFamily: "var(--font-mono)", fontSize: 12,
      display: "flex", alignItems: "center", gap: 8,
    }}>
      <span>{t("common.error")}: {error}</span>
      <button onClick={() => setError(null)} style={{
        marginLeft: "auto", background: "none", border: "none", color: "#f44336", cursor: "pointer",
        fontFamily: "var(--font-mono)", fontSize: 12,
      }}>{t("common.close")}</button>
    </div>
  ) : null;

  const screens: Record<string, { title: string; subtitle: string; el: React.ReactNode }> = {
    dashboard: {
      title: t("nav.dashboard"),
      subtitle: data.account.lastSyncAt
        ? `last sync ${timeSince(data.account.lastSyncAt)} · ${data.syncSummary.unmappedCount} unmapped`
        : t("sub.noSync"),
      el: <DashboardScreen data={data} syncing={syncing} syncProgress={syncProgress} onGoTo={handleSetActive} />,
    },
    inventory: {
      title: t("nav.inventory"),
      subtitle: `${data.economy.usedSlots} / ${data.economy.maxSlots} slot · ${data.inventory.length} item`,
      el: <InventoryScreen items={data.inventory} economy={data.economy} syncSummary={data.syncSummary} loadout={data.loadout} />,
    },
    quests: {
      title: t("nav.quests"),
      subtitle: `${data.quests.filter(q => q.completed).length} ${t("sub.completed")} · 5 ${t("sub.traders")}`,
      el: <QuestsScreen quests={data.quests} />,
    },
    blueprints: {
      title: t("nav.blueprints"),
      subtitle: `${data.blueprints.filter(b => b.learned).length} ${t("sub.learned")} · ${data.blueprints.filter(b => !b.learned).length} ${t("sub.remaining")}`,
      el: <BlueprintsScreen blueprints={data.blueprints} />,
    },
    hideout: {
      title: t("nav.hideout"),
      subtitle: `${data.hideoutModules.filter(m => !m.locked).length} ${t("sub.installed")} · ${data.hideoutModules.filter(m => m.locked).length} ${t("sub.locked")}`,
      el: <HideoutScreen modules={data.hideoutModules} />,
    },
    projects: {
      title: t("nav.projects"),
      subtitle: `${data.projects.length} ${t("sub.active")} · hideout queue`,
      el: <ProjectsScreen projects={data.projects} />,
    },
    workshop: {
      title: "Workshop",
      subtitle: "tüm karakterler geneli",
      el: <WorkshopScreen key={workshopRefreshKey} />,
    },
    expedition: {
      title: "Expedition",
      subtitle: "sefer gereksinimleri",
      el: <ExpeditionScreen />,
    },
    settings: {
      title: t("nav.settings"),
      subtitle: "account · sync",
      el: <SettingsScreen
        account={data.account}
        accountId={accountId}
        onDisconnect={handleDisconnect}
      />,
    },
  };

  const s = screens[active === "settings" && !isAdmin ? "dashboard" : active] || screens.dashboard;

  return (
    <div style={{ display: "flex", height: "100vh", background: "var(--bg-1)" }}>
      <Sidebar
        active={active}
        onChange={handleSetActive}
        account={data.account}
        syncSummary={data.syncSummary}
        onBack={handleBackToHome}
      />
      <main style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <Topbar
          title={s.title}
          subtitle={s.subtitle}
          account={data.account}
          onSync={handleSync}
          syncing={syncing}
          syncProgress={syncProgress}
        />
        {errorBanner}
        <div style={{ padding: "24px 28px", flex: 1, overflowX: "clip", overflowY: "auto" }}>
          {s.el}
        </div>
      </main>
    </div>
  );
}

function timeSince(isoDate: string): string {
  try {
    const diff = Date.now() - new Date(isoDate).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
  } catch {
    return "?";
  }
}

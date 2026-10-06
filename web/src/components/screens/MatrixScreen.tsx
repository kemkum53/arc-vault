"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Icon, Wordmark, WeaponSlots } from "@/components/ui";
import { RARITY } from "@/lib/constants";
import {
  getItemsReference, getMatrixBreakdown, getMatrixInventory, getMatrixMounted, getMatrixViews, putMatrixViews, triggerSync,
  MatrixConflict, getMatrixSyncStatus, startMatrixSync, stopMatrixSync, ApiError,
} from "@/lib/api";
import type { SharedMatrixViews } from "@/lib/api";
import { hrefFor, onPlainClick, routes } from "@/lib/nav";
import { getSteamCredentials } from "@/lib/api";
import type { SteamCredentials } from "@/lib/api";
import type {
  AccountResponse, DisplayItemMod, ItemReference, MatrixAccount, MatrixBreakdown, MatrixBucket, MatrixColumn, MatrixMounted,
  MatrixStack, MatrixSyncStatus, MatrixView,
  Rarity,
} from "@/lib/types";

// ─── Constants ───────────────────────────────────────────────────────────────

const ACTIVE_VIEW_KEY = "arc_vault_matrix_view";
const OTHER_SECTION = "__other";
const TIERS = ["I", "II", "III", "IV"];
const WEAPON_MAX_DURABILITY: Record<string, number> = { I: 100, II: 110, III: 120, IV: 130 };
const WEAPON_TYPES = new Set([
  "assault rifle", "smg", "pistol", "shotgun", "battle rifle",
  "lmg", "sniper rifle", "hand cannon", "special",
]);
const BUCKETS: MatrixBucket[] = ["full", "half", "low", "total"];
const PALETTE = [
  "#FFB300", "#43A047", "#26C6DA", "#E040FB", "#FF7043", "#5C6BC0",
  "#FFF176", "#81D4FA", "#A5D6A7", "#B39DDB", "#F48FB1", "#EF9A9A",
  "#4FC3F7", "#9E9E9E",
];
const TIER_SUFFIX = /_(iv|iii|ii|i)$/;

// ─── Catalog ─────────────────────────────────────────────────────────────────

interface CatalogEntry {
  id: string;
  name: string;
  altName: string;
  image?: string;
  rarity: string;
  isWeapon: boolean;
  isMod: boolean;
  hasTiers: boolean;
  /** Tiers that exist for this base, lowest first (e.g. ["I", "II", "III"]). */
  tiers: string[];
}

function proxyCdnUrl(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  return url.replace("https://cdn.arctracker.io/", "/cdn/");
}

/**
 * Collapse tier variants (bobcat_i..bobcat_iv) into one base entry, the way sync stores them.
 * Headers use the English in-game name; the Turkish one is kept for search.
 */
function buildCatalog(ref: Record<string, ItemReference>): Map<string, CatalogEntry> {
  const rank = (k: string) => ({ i: 1, ii: 2, iii: 3, iv: 4 }[k.match(TIER_SUFFIX)?.[1] ?? ""] ?? 0);
  // Pick one reference key per base: the highest tier, or the plain key.
  const best = new Map<string, string>();
  for (const key of Object.keys(ref)) {
    const base = key.replace(TIER_SUFFIX, "");
    const prev = best.get(base);
    if (!prev || rank(key) > rank(prev)) best.set(base, key);
  }
  const tiersOf = new Map<string, string[]>();
  for (const key of Object.keys(ref)) {
    const m = key.match(TIER_SUFFIX);
    if (!m) continue;
    const base = key.replace(TIER_SUFFIX, "");
    tiersOf.set(base, [...(tiersOf.get(base) ?? []), m[1].toUpperCase()]);
  }
  const order = ["I", "II", "III", "IV"];
  const out = new Map<string, CatalogEntry>();
  for (const [base, key] of best) {
    const meta = ref[key];
    const tiered = rank(key) > 0;
    const strip = (n: string) => (tiered ? n.replace(/\s+(IV|III|II|I)$/, "") : n);
    out.set(base, {
      id: base,
      name: strip(meta.name_en || meta.name_tr || base),
      altName: strip(meta.name_tr || ""),
      image: proxyCdnUrl(meta.image),
      rarity: (meta.rarity || "common").toLowerCase(),
      isWeapon: WEAPON_TYPES.has(String(meta.type || "").toLowerCase()),
      isMod: String(meta.type || "").toLowerCase() === "modification",
      hasTiers: tiered,
      tiers: (tiersOf.get(base) ?? []).sort((a, b) => order.indexOf(a) - order.indexOf(b)),
    });
  }
  return out;
}

// ─── Counting ────────────────────────────────────────────────────────────────

type Counts = Record<MatrixBucket, number>;
const emptyCounts = (): Counts => ({ full: 0, half: 0, low: 0, total: 0 });

/** Same thresholds as the sheet export: full at max, half at >= max/2, low at >= 1. */
function stackBucket(stack: MatrixStack, isWeapon: boolean): MatrixBucket | null {
  const max = isWeapon && stack.tier ? WEAPON_MAX_DURABILITY[stack.tier] ?? 100 : 100;
  // arctracker omits durability at full charge, so a missing value means 100%.
  const pct = stack.durability ?? 100;
  const abs = Math.round((max * pct) / 100);
  if (abs >= max) return "full";
  if (abs >= Math.floor(max / 2)) return "half";
  if (abs >= 1) return "low";
  return null;
}

function countColumn(acc: MatrixAccount, col: MatrixColumn, entry: CatalogEntry | undefined): Counts {
  const c = emptyCounts();
  for (const s of acc.items[col.itemId] ?? []) {
    if (s.mounted && !col.includeMounted) continue;
    if (col.tier && s.tier !== col.tier) continue;
    const b = stackBucket(s, !!entry?.isWeapon);
    if (!b) continue;
    if (col.fullOnly && b !== "full") continue;
    c[b] += s.qty;
    c.total += s.qty;
  }
  return c;
}

/** Header name: attachments and other tiered non-weapons say which tier they count. */
function columnName(col: MatrixColumn, entry: CatalogEntry | undefined): string {
  const name = entry?.name ?? col.itemId;
  if (!entry?.hasTiers || entry.isWeapon) return name;
  return col.tier ? `${name} ${col.tier}` : `${name} (tüm)`;
}

function bucketLabel(col: MatrixColumn, b: MatrixBucket, entry: CatalogEntry | undefined): string {
  if (b === "total") return "Adet";
  if (entry?.isWeapon && col.tier) {
    const max = WEAPON_MAX_DURABILITY[col.tier] ?? 100;
    const half = Math.floor(max / 2);
    return b === "full" ? String(max) : b === "half" ? String(half) : `1-${half - 1}`;
  }
  return b === "full" ? "Tam" : b === "half" ? "%50+" : "<%50";
}

// ─── Defaults ────────────────────────────────────────────────────────────────

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function makeColumn(itemId: string, entry: CatalogEntry | undefined, index: number, tier?: string | null): MatrixColumn {
  const weapon = !!entry?.isWeapon;
  return {
    id: uid(),
    itemId,
    tier: tier !== undefined ? tier : weapon ? "IV" : null,
    buckets: weapon ? ["full", "half"] : ["total"],
    fullOnly: false,
    inTotal: weapon,
    color: PALETTE[index % PALETTE.length],
  };
}

const DEFAULT_WEAPONS = [
  "tempest", "bobcat", "il_toro", "vulcano", "renegade", "venator", "anvil",
  "burletta", "torrente", "osprey", "canto", "bettina", "arpeggio",
];
const DEFAULT_GEAR = [
  "medium_shield", "vita_spray", "snap_hook", "herbal_bandage", "surge_shield_recharger",
  "trigger_nade", "showstopper", "wolfpack", "deadline",
  "looting_mk3_survivor", "buried_city_town_hall_key",
];
const FULL_ONLY_DEFAULT = new Set(["medium_shield", "vita_spray", "snap_hook"]);

function defaultViews(catalog: Map<string, CatalogEntry>): MatrixView[] {
  const weapons = DEFAULT_WEAPONS.map((id, i) => makeColumn(id, catalog.get(id), i));
  weapons.push({ ...makeColumn("raider_hatch_key", catalog.get("raider_hatch_key"), 13), label: "Key" });
  const gear = DEFAULT_GEAR.map((id, i) => ({
    ...makeColumn(id, catalog.get(id), i),
    fullOnly: FULL_ONLY_DEFAULT.has(id),
  }));
  const base = { showExpired: true, hideEmpty: false };
  return [
    { id: uid(), name: "Silahlar", columns: weapons, ...base },
    { id: uid(), name: "Ekipman", columns: gear, ...base },
  ];
}

// ─── Small UI pieces ─────────────────────────────────────────────────────────

const panel: React.CSSProperties = {
  background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)",
};
const ghostBtn: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 6, padding: "7px 12px",
  background: "var(--bg-3)", border: "1px solid var(--border)", borderRadius: "var(--radius)",
  color: "var(--fg-2)", fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 13, cursor: "pointer",
};
const primaryBtn: React.CSSProperties = {
  ...ghostBtn, background: "linear-gradient(135deg, #7b2ff7, #5a1fd0)",
  border: "1px solid rgba(123,47,247,0.4)", color: "#fff",
};
const tinyBtn: React.CSSProperties = {
  width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center",
  background: "var(--bg-3)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
  color: "var(--fg-3)", cursor: "pointer", padding: 0,
};
const input: React.CSSProperties = {
  background: "var(--bg-input)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius)",
  color: "var(--fg-1)", fontFamily: "var(--font-ui)", fontSize: 13, padding: "6px 10px", outline: "none",
};

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      padding: "3px 8px", borderRadius: "var(--radius-pill)", cursor: "pointer",
      fontFamily: "var(--font-mono)", fontSize: 11,
      background: on ? "rgba(0,210,255,0.12)" : "transparent",
      border: `1px solid ${on ? "rgba(0,210,255,0.45)" : "var(--border-strong)"}`,
      color: on ? "#00d2ff" : "var(--fg-4)",
    }}>{children}</button>
  );
}

function ItemIcon({ entry, size = 28 }: { entry?: CatalogEntry; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (!entry?.image || broken) {
    return <div style={{ width: size, height: size, borderRadius: 4, background: "var(--bg-4)" }} />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={entry.image} alt="" width={size} height={size} onError={() => setBroken(true)}
      style={{ objectFit: "contain", display: "block" }} />
  );
}

function timeSince(iso: string | null): string {
  if (!iso) return "hiç senkronize edilmedi";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "az önce";
  if (mins < 60) return `${mins} dk önce`;
  const h = Math.floor(mins / 60);
  return h < 24 ? `${h} sa önce` : `${Math.floor(h / 24)} gün önce`;
}

/**
 * Converts views saved with the old grouped rows (account groups or custom
 * sections) to a flat, hand-ordered account list, keeping who was visible.
 */
function migrateView(v: MatrixView, accounts: AccountResponse[]): MatrixView {
  const { sections, groupOrder: _groupOrder, hiddenGroups, ...rest } = v;
  if (v.accountOrder || v.hiddenAccounts) return rest;
  const hiddenKeys = new Set(hiddenGroups ?? []);
  if (sections?.length) {
    const placed = new Set(sections.flatMap(sec => sec.accountIds));
    const hidden = sections.filter(sec => hiddenKeys.has(sec.id)).flatMap(sec => sec.accountIds);
    if (hiddenKeys.has(OTHER_SECTION)) hidden.push(...accounts.filter(a => !placed.has(a.id)).map(a => a.id));
    return { ...rest, accountOrder: sections.flatMap(sec => sec.accountIds), hiddenAccounts: hidden };
  }
  const hidden = accounts.filter(a => hiddenKeys.has(a.group_name || "")).map(a => a.id);
  return { ...rest, hiddenAccounts: hidden };
}

/** Rows in the view's manual order; unlisted accounts follow in home-screen order. */
function orderedAccounts(view: MatrixView, data: MatrixAccount[], accounts: AccountResponse[]): MatrixAccount[] {
  const home = new Map(accounts.map((a, i) => [a.id, i]));
  const pinned = new Map((view.accountOrder ?? []).map((id, i) => [id, i]));
  return [...data].sort((a, b) => {
    const pa = pinned.get(a.id);
    const pb = pinned.get(b.id);
    if (pa !== undefined && pb !== undefined) return pa - pb;
    if (pa !== undefined) return -1;
    if (pb !== undefined) return 1;
    return (home.get(a.id) ?? 999) - (home.get(b.id) ?? 999);
  });
}

type RowSync = { state: "queued" | "syncing" | "done" | "error"; msg?: string };

// ─── Screen ──────────────────────────────────────────────────────────────────

interface MatrixScreenProps {
  accounts: AccountResponse[];
  onBack: () => void;
  onSelectAccount: (id: string) => void;
}

export function MatrixScreen({ accounts, onBack, onSelectAccount }: MatrixScreenProps) {
  const [catalog, setCatalog] = useState<Map<string, CatalogEntry> | null>(null);
  const [itemsRef, setItemsRef] = useState<Record<string, ItemReference>>({});
  const [cellSel, setCellSel] = useState<CellSelection | null>(null);
  const [views, setViews] = useState<MatrixView[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState<MatrixView | null>(null);
  const [data, setData] = useState<MatrixAccount[] | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [leaveAsk, setLeaveAsk] = useState<null | (() => void)>(null);
  // Local, short-lived row marks (this tab's single-row syncs and "just updated" glows).
  const [rowSync, setRowSync] = useState<Record<string, RowSync>>({});
  // Site-wide state from the server: bulk run and every account's sync_status.
  const [server, setServer] = useState<MatrixSyncStatus | null>(null);
  const bulk = server?.bulk?.running ? server.bulk : null;
  const accountsRef = useRef(accounts);
  accountsRef.current = accounts;

  // Shared layouts: version guards saves, meta says who changed them last.
  const [version, setVersion] = useState(0);
  const [meta, setMeta] = useState<{ by: string | null; at: string | null }>({ by: null, at: null });
  const applyShared = useCallback((s: SharedMatrixViews, cat: Map<string, CatalogEntry>) => {
    const list = s.views && s.views.length
      ? s.views.map(v => migrateView(v, accountsRef.current))
      : defaultViews(cat);
    setViews(list);
    setVersion(s.version);
    setMeta({ by: s.updated_by, at: s.updated_at });
    return list;
  }, []);

  // Catalog + saved views
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [ref, saved] = await Promise.all([getItemsReference(), getMatrixViews()]);
        if (cancelled) return;
        const cat = buildCatalog(ref);
        setItemsRef(ref);
        setCatalog(cat);
        const list = applyShared(saved, cat);
        let stored: string | null = null;
        try { stored = localStorage.getItem(ACTIVE_VIEW_KEY); } catch {}
        setActiveId(list.some(v => v.id === stored) ? stored : list[0].id);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [applyShared]);

  // Others edit the same layouts: re-read them when the tab regains focus (not mid-edit).
  const draftRef = useRef<MatrixView | null>(null);
  useEffect(() => {
    const onFocus = async () => {
      if (draftRef.current || !catalog) return;
      try {
        const s = await getMatrixViews();
        if (s.version === version) return;
        const list = applyShared(s, catalog);
        setActiveId(id => (list.some(v => v.id === id) ? id : list[0].id));
      } catch { /* keep what is on screen */ }
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [catalog, version, applyShared]);

  useEffect(() => {
    if (!activeId) return;
    try { localStorage.setItem(ACTIVE_VIEW_KEY, activeId); } catch {}
  }, [activeId]);

  draftRef.current = draft;
  const savedView = views?.find(v => v.id === activeId) ?? null;
  const view = draft ?? savedView;
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(savedView);

  // Inventory for the visible view's items
  const itemKey = useMemo(
    () => (view ? [...new Set(view.columns.map(c => c.itemId))].sort().join(",") : ""),
    [view],
  );
  const loadData = useCallback(async () => {
    // No columns yet (or views still loading): the table shows its own empty state.
    if (!itemKey) return;
    setLoadingData(true);
    try {
      const res = await getMatrixInventory(itemKey.split(","));
      setData(res.accounts);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingData(false);
    }
  }, [itemKey]);
  useEffect(() => { loadData(); }, [loadData]);


  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(n => (n === msg ? null : n)), 4000);
  };

  const setRow = (id: string, st: RowSync | null) => setRowSync(prev => {
    const n = { ...prev };
    if (st) n[id] = st; else delete n[id];
    return n;
  });

  // Re-read the matrix quietly and swap in only this account's row: no loading state, no flicker.
  const knownSync = useRef(new Map<string, string | null>());
  const refreshAccount = async (id: string) => {
    if (!itemKey) return;
    const res = await getMatrixInventory(itemKey.split(","));
    const fresh = res.accounts.find(a => a.id === id);
    if (fresh) {
      knownSync.current.set(id, fresh.last_sync_at);
      setData(prev => (prev ? prev.map(a => (a.id === id ? fresh : a)) : prev));
    }
  };
  const markDone = (id: string, msg?: string) => {
    setRow(id, { state: "done", msg });
    setTimeout(() => setRowSync(prev => (prev[id]?.state === "done" ? (({ [id]: _, ...rest }) => rest)(prev) : prev)), 6000);
  };

  // Remember each row's last sync so polling can tell which rows changed.
  useEffect(() => {
    for (const a of data ?? []) if (!knownSync.current.has(a.id)) knownSync.current.set(a.id, a.last_sync_at);
  }, [data]);

  // Poll the site-wide sync state: 3 s while anything syncs, 10 s otherwise, only while visible.
  // Rows whose last_sync_at moved (bulk run, another user, a harvester token push) are re-read.
  const refreshRef = useRef(refreshAccount);
  refreshRef.current = refreshAccount;
  const flashRef = useRef<(m: string) => void>(() => {});
  flashRef.current = flash;
  const pollNow = useRef<() => void>(() => {});
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    let wasRunning = false;
    const tick = async () => {
      let busy = false;
      if (document.visibilityState === "visible") {
        try {
          const s = await getMatrixSyncStatus();
          if (cancelled) return;
          setServer(s);
          busy = !!s.bulk?.running || s.accounts.some(a => a.sync_status === "syncing");
          for (const a of s.accounts) {
            const known = knownSync.current.get(a.id);
            if (known !== undefined && a.last_sync_at && a.last_sync_at !== known) {
              knownSync.current.set(a.id, a.last_sync_at);
              void refreshRef.current(a.id).then(() => markDone(a.id, "güncellendi"));
            }
          }
          if (wasRunning && s.bulk && !s.bulk.running) {
            const skipped = s.bulk.skipped?.length ?? 0;
            const ok = s.bulk.done - s.bulk.failed.length - skipped;
            flashRef.current(`${s.bulk.stopped ? "Senkron durduruldu" : "Senkron bitti"} (${s.bulk.started_by}): `
              + `${ok}/${s.bulk.total} başarılı${s.bulk.failed.length ? `, ${s.bulk.failed.length} hata` : ""}`
              + `${skipped ? `, ${skipped} hesap az önce senkronlandığı için atlandı` : ""}`);
          }
          wasRunning = !!s.bulk?.running;
        } catch { /* keep the last known state */ }
      }
      if (!cancelled) timer = setTimeout(tick, busy ? 3000 : 10000);
    };
    pollNow.current = () => { if (timer) clearTimeout(timer); void tick(); };
    void tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Sync one account, refresh its row, and leave a short "done" mark. Returns true on success. */
  const syncOne = async (id: string): Promise<boolean> => {
    setRow(id, { state: "syncing" });
    try {
      const res = await triggerSync(id, true);
      await refreshAccount(id);
      markDone(id, `${res.synced_items} item`);
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) {
        // Synced moments ago: not an error, just wait (grey icon with the server's message).
        setRow(id, { state: "queued", msg: e.message });
        setTimeout(() => setRowSync(prev => (prev[id]?.state === "queued" ? (({ [id]: _, ...rest }) => rest)(prev) : prev)), 5000);
        return false;
      }
      setRow(id, { state: "error", msg: e instanceof Error ? e.message : String(e) });
      return false;
    }
  };

  const syncRow = (id: string) => {
    const st = shownSync[id]?.state;
    if (st === "syncing" || st === "queued") return;
    void syncOne(id);
  };

  // Start the site-wide bulk sync for the accounts shown in this view, top to bottom.
  // It runs on the server: every open matrix sees it, and only one can run at a time.
  const syncAll = async () => {
    if (bulk || !view || !data) return;
    const hiddenIds = new Set(view.hiddenAccounts ?? []);
    const shown = orderedAccounts(view, data, accounts)
      .filter(a => !hiddenIds.has(a.id) && (view.showExpired || a.token_valid));
    if (!shown.some(a => a.token_valid)) { flash("Senkronize edilecek geçerli token yok"); return; }
    try {
      const run = await startMatrixSync(shown.map(a => a.id));
      if (run.skipped) flash(`Token'ı bitmiş ${run.skipped} hesap atlandı`);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    pollNow.current();
  };

  const stopAll = async () => {
    try { await stopMatrixSync(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    pollNow.current();
  };

  // What each row shows: this tab's glow/single-row state first, then the server's view.
  const shownSync = useMemo(() => {
    const out: Record<string, RowSync> = {};
    const queued = new Set(bulk?.queued ?? []);
    for (const a of server?.accounts ?? []) {
      if (bulk?.current === a.id || a.sync_status === "syncing") out[a.id] = { state: "syncing" };
      else if (queued.has(a.id)) out[a.id] = { state: "queued" };
      else if (a.sync_status === "error") out[a.id] = { state: "error", msg: "Son senkron başarısız oldu" };
    }
    for (const [id, st] of Object.entries(rowSync)) {
      if (st.state === "done" || st.state === "syncing" || !out[id]) out[id] = st;
    }
    return out;
  }, [server, bulk, rowSync]);

  // Leaving edit mode with unsaved changes asks first.
  const guard = useCallback((action: () => void) => {
    if (dirty) setLeaveAsk(() => action);
    else action();
  }, [dirty]);

  useEffect(() => {
    if (!cellSel) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("[data-bd-panel],[data-bd-cell]")) return;
      setCellSel(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [cellSel]);

  useEffect(() => {
    if (!draft && !cellSel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (cellSel) setCellSel(null);
      else guard(() => setDraft(null));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draft, cellSel, guard]);

  const persist = async (next: MatrixView[], msg: string) => {
    setSaving(true);
    try {
      const saved = await putMatrixViews(next, version);
      setViews(next);
      setVersion(saved.version);
      setMeta({ by: saved.updated_by, at: saved.updated_at });
      setError(null);
      flash(msg);
      return true;
    } catch (e) {
      if (e instanceof MatrixConflict && catalog) {
        // Someone saved in between: show their version, keep this edit open.
        applyShared(e.current, catalog);
        setError(`${e.current.updated_by ?? "Başka biri"} bu arada görünümleri değiştirdi; son hâl yüklendi. `
          + "Düzenlemen açık, tekrar kaydedersen seninki geçerli olur.");
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
      return false;
    } finally {
      setSaving(false);
    }
  };

  const saveDraft = async () => {
    if (!draft || !views) return;
    const exists = views.some(v => v.id === draft.id);
    const next = exists ? views.map(v => (v.id === draft.id ? draft : v)) : [...views, draft];
    if (await persist(next, `"${draft.name}" görünümü kaydedildi (${draft.columns.length} sütun)`)) {
      setActiveId(draft.id);
      setDraft(null);
    }
  };

  const deleteView = async (id: string) => {
    if (!views) return;
    const target = views.find(v => v.id === id);
    const next = views.filter(v => v.id !== id);
    if (!next.length) return;
    if (await persist(next, `"${target?.name}" görünümü silindi`)) {
      setDraft(null);
      setActiveId(next[0].id);
    }
  };

  const newView = () => {
    const v: MatrixView = {
      id: uid(), name: `Görünüm ${(views?.length ?? 0) + 1}`, columns: [],
      showExpired: true, hideEmpty: false,
    };
    setDraft(v);
  };

  if (error && !views) {
    return <Shell onBack={onBack}><div style={{ color: "#f44336", fontFamily: "var(--font-mono)" }}>{error}</div></Shell>;
  }
  if (!catalog || !views || !view) {
    return <Shell onBack={onBack}><div style={{ color: "var(--fg-4)", fontFamily: "var(--font-mono)", fontSize: 13 }}>Yükleniyor...</div></Shell>;
  }

  const editingNew = !!draft && !views.some(v => v.id === draft.id);

  return (
    <Shell onBack={() => guard(() => { setDraft(null); onBack(); })}>
      {/* How durability is read (mirrors FULL_DURABILITY_FROM / HALF_DURABILITY_CUT in sync_service). */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8, marginBottom: 12, padding: "7px 12px",
        background: "rgba(0,210,255,0.05)", border: "1px solid rgba(0,210,255,0.18)", borderRadius: "var(--radius)",
        fontFamily: "var(--font-ui)", fontSize: 12.5, color: "var(--fg-3)", lineHeight: 1.4,
      }}>
        <Icon name="info" size={15} style={{ color: "#00d2ff", flexShrink: 0 }} />
        <span>
          Dayanıklılık arctracker&apos;dan küsuratı kesilmiş yüzde olarak geliyor (ör. 129,6/130 → %99).
          Oyunla aynı görünsün diye <b style={{ color: "var(--fg-1)" }}>%99 ve üstü 130</b>,{" "}
          <b style={{ color: "var(--fg-1)" }}>%49 ise 65</b> sayılır.
        </span>
      </div>

      {/* Tabs + actions */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", flex: 1 }}>
          {views.map(v => {
            const on = v.id === view.id && !editingNew;
            return (
              <button key={v.id} onClick={() => guard(() => { setDraft(null); setActiveId(v.id); })} style={{
                padding: "8px 14px", borderRadius: "var(--radius)", cursor: "pointer",
                fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 13.5,
                background: on ? "rgba(123,47,247,0.16)" : "transparent",
                border: `1px solid ${on ? "rgba(123,47,247,0.5)" : "var(--border)"}`,
                color: on ? "var(--fg-1)" : "var(--fg-3)",
              }}>{v.id === draft?.id ? draft.name : v.name}</button>
            );
          })}
          {editingNew && (
            <span style={{
              padding: "8px 14px", borderRadius: "var(--radius)", fontFamily: "var(--font-ui)", fontWeight: 600,
              fontSize: 13.5, background: "rgba(123,47,247,0.16)", border: "1px dashed rgba(123,47,247,0.5)", color: "var(--fg-1)",
            }}>{draft!.name}</span>
          )}
          {!draft && (
            <button onClick={newView} style={{ ...ghostBtn, padding: "8px 10px" }} title="Yeni görünüm">
              <Icon name="plus" size={14} />
            </button>
          )}
        </div>
        {notice && <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "#4caf50" }}>{notice}</span>}
        {!notice && meta.by && (
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-5)" }}
            title="Görünümler herkes için ortak">
            son düzenleyen: {meta.by}{meta.at ? `, ${timeSince(meta.at)}` : ""}
          </span>
        )}
        {bulk && (
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "#00d2ff" }}
            title={`Başlatan: ${bulk.started_by}`}>
            Senkron {bulk.done}/{bulk.total}{bulk.failed.length ? ` · ${bulk.failed.length} hata` : ""} · {bulk.started_by}
          </span>
        )}
        {loadingData && <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-5)" }}>yükleniyor...</span>}
        {bulk ? (
          <button onClick={stopAll} style={{ ...ghostBtn, color: "#ff9800", borderColor: "rgba(255,152,0,0.35)" }}
            title="Sıradaki hesaplara geçme; şu an senkronize edilen hesap bitince durur">
            <Icon name="x" size={14} /> Durdur
          </button>
        ) : (
          <button onClick={syncAll} style={ghostBtn}
            title="Bu görünümdeki, token'ı geçerli hesapları sırayla senkronize et">
            <Icon name="recycle" size={14} /> Senkronize et
          </button>
        )}
        {!draft && (
          <button onClick={() => setDraft(structuredClone(savedView!))} style={primaryBtn}>
            <Icon name="edit-2" size={14} /> Düzenle
          </button>
        )}
      </div>

      {error && (
        <div style={{
          padding: "8px 12px", marginBottom: 12, borderRadius: "var(--radius)", fontFamily: "var(--font-mono)", fontSize: 12,
          background: "rgba(244,67,54,0.08)", border: "1px solid rgba(244,67,54,0.25)", color: "#f44336",
        }}>{error}</div>
      )}

      {leaveAsk && (
        <div style={{
          ...panel, padding: "10px 14px", marginBottom: 12, display: "flex", alignItems: "center", gap: 10,
          borderColor: "rgba(255,152,0,0.4)", background: "rgba(255,152,0,0.06)",
        }}>
          <Icon name="triangle-alert" size={16} style={{ color: "#ff9800" }} />
          <span style={{ flex: 1, fontFamily: "var(--font-ui)", fontSize: 14, color: "var(--fg-2)" }}>
            Kaydedilmemiş değişiklikler var. Çıkarsan kaybolacak.
          </span>
          <button style={ghostBtn} onClick={() => setLeaveAsk(null)}>Düzenlemeye dön</button>
          <button style={{ ...ghostBtn, color: "#f44336", borderColor: "rgba(244,67,54,0.35)" }}
            onClick={() => { const a = leaveAsk; setLeaveAsk(null); a(); }}>Kaydetmeden çık</button>
        </div>
      )}

      {draft && (
        <Editor
          draft={draft}
          setDraft={setDraft}
          catalog={catalog}
          data={data}
          accounts={accounts}
          isNew={editingNew}
          canDelete={views.length > 1 && !editingNew}
          saving={saving}
          dirty={dirty || editingNew}
          onSave={saveDraft}
          onCancel={() => guard(() => setDraft(null))}
          onDelete={() => deleteView(draft.id)}
        />
      )}

      <MatrixTable
        view={view}
        catalog={catalog}
        data={data}
        accounts={accounts}
        rowSync={shownSync}
        onSyncRow={syncRow}
        selected={cellSel}
        onCellClick={setCellSel}
        onSelectAccount={id => guard(() => { setDraft(null); onSelectAccount(id); })}
      />
      {cellSel && (catalog.get(cellSel.col.itemId)?.isMod ? (
        <MountedPanel
          sel={cellSel}
          entry={catalog.get(cellSel.col.itemId)}
          catalog={catalog}
          itemsRef={itemsRef}
          onClose={() => setCellSel(null)}
        />
      ) : (
        <BreakdownPanel
          sel={cellSel}
          entry={catalog.get(cellSel.col.itemId)}
          itemsRef={itemsRef}
          onClose={() => setCellSel(null)}
        />
      ))}
    </Shell>
  );
}

function Shell({ onBack, children }: { onBack: () => void; children: React.ReactNode }) {
  return (
    <div style={{
      minHeight: "100vh", padding: "28px 32px",
      background: "radial-gradient(circle at 80% 0%, rgba(123,47,247,0.10), transparent 50%), var(--bg-1)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
        <a href={hrefFor(routes.home)} onClick={onPlainClick(onBack)} style={{ ...ghostBtn, padding: "7px 10px", textDecoration: "none" }} title="Hesaplara dön">
          <Icon name="chevron-right" size={16} style={{ transform: "rotate(180deg)" }} />
        </a>
        <Wordmark size={18} />
        <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 18, color: "var(--fg-1)" }}>
          Hesap Matrisi
        </span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-5)" }}>
          tüm hesaplar, seçtiğin item'lar
        </span>
      </div>
      {children}
    </div>
  );
}

// ─── Steam copy ──────────────────────────────────────────────────────────────

// Decrypted logins fetched on hover/click, kept for this page session only.
const steamCache = new Map<string, Promise<SteamCredentials>>();
const loadSteam = (id: string) => {
  if (!steamCache.has(id)) {
    const p = getSteamCredentials(id);
    p.catch(() => steamCache.delete(id));
    steamCache.set(id, p);
  }
  return steamCache.get(id)!;
};

/** "ID" and "Şifre" copy buttons at the right end of an account's name cell. */
function SteamCopyButtons({ acc }: { acc: MatrixAccount }) {
  const [state, setState] = useState<Record<string, "ok" | "err">>({});

  const copy = async (field: "id" | "pass") => {
    try {
      const c = await loadSteam(acc.id);
      const value = field === "id" ? c.steam_username : c.steam_password;
      if (!value) throw new Error("empty");
      await navigator.clipboard.writeText(value);
      setState(s => ({ ...s, [field]: "ok" }));
    } catch {
      setState(s => ({ ...s, [field]: "err" }));
    }
    setTimeout(() => setState(s => { const n = { ...s }; delete n[field]; return n; }), 1500);
  };

  const btn = (field: "id" | "pass", label: string, color: string, has: boolean | undefined) => {
    const st = state[field];
    return (
      <button
        disabled={!has}
        onMouseEnter={() => { if (has) void loadSteam(acc.id); }}
        onClick={e => { e.stopPropagation(); void copy(field); }}
        title={!has ? `${label} girilmemiş (hesabın Ayarlar sayfasından eklenir)`
          : st === "ok" ? `${label} kopyalandı` : st === "err" ? "Kopyalanamadı" : `Steam ${label} kopyala`}
        style={{
          height: 18, minWidth: label === "ID" ? 26 : 38, padding: "0 6px", borderRadius: 5,
          border: "1px solid rgba(255,255,255,0.18)", cursor: has ? "pointer" : "default",
          fontFamily: "var(--font-ui)", fontWeight: 700, fontSize: 10.5, lineHeight: "16px", color: "#fff",
          background: st === "ok" ? "#2e7d32" : st === "err" ? "#c62828" : color,
          opacity: has ? 1 : 0.25,
        }}
      >{st === "ok" ? "✓" : label}</button>
    );
  };

  return (
    <span style={{ marginLeft: "auto", display: "flex", gap: 3, paddingLeft: 8 }}>
      {btn("id", "ID", "#1a73e8", acc.has_steam_username)}
      {btn("pass", "Şifre", "#7b2ff7", acc.has_steam_password)}
    </span>
  );
}

// ─── Table ───────────────────────────────────────────────────────────────────

interface Row {
  acc: MatrixAccount;
  cells: Counts[];
  total: number;
}

function sumRows(rows: Row[], n: number): { cells: Counts[]; total: number } {
  const cells = Array.from({ length: n }, emptyCounts);
  let total = 0;
  for (const r of rows) {
    r.cells.forEach((c, i) => BUCKETS.forEach(b => { cells[i][b] += c[b]; }));
    total += r.total;
  }
  return { cells, total };
}

const tint = (color: string, alpha: number) => `${color}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`;

function SyncButton({ expired, state, onClick }: {
  expired: boolean;
  state?: RowSync;
  onClick: () => void;
}) {
  const syncing = state?.state === "syncing";
  const queued = state?.state === "queued";
  const done = state?.state === "done";
  const failed = state?.state === "error";
  const color = syncing ? "#00d2ff" : done ? "#4caf50" : queued ? "#8888a4" : failed || expired ? "#ff5a52" : "#4caf50";
  const icon = failed ? "triangle-alert" : done ? "check" : queued ? "circle-dot" : "refresh-cw";
  return (
    <button
      onClick={e => { e.stopPropagation(); onClick(); }}
      disabled={syncing || queued}
      title={failed ? `Senkron başarısız: ${state?.msg ?? ""}` : syncing ? "Senkronize ediliyor" : queued ? (state?.msg ?? "Sırada")
        : done ? `Senkronize edildi (${state?.msg ?? ""})` : expired
        ? "Token süresi doldu. Yine de son veriyi çekmeyi dene" : "Bu hesabı senkronize et"}
      className="av-matrix-sync"
      style={{
        width: 22, height: 22, flexShrink: 0, padding: 0, borderRadius: "50%", cursor: syncing ? "default" : "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "transparent", border: "none", color: tint(color, syncing || failed || expired || done ? 1 : 0.75),
      }}
    >
      <Icon name={icon} size={13} stroke={2}
        style={syncing ? { animation: "av-spin 1s linear infinite" } : undefined} />
    </button>
  );
}

function MatrixTable({ view, catalog, data, accounts, rowSync, onSyncRow, selected, onCellClick, onSelectAccount }: {
  view: MatrixView;
  catalog: Map<string, CatalogEntry>;
  data: MatrixAccount[] | null;
  accounts: AccountResponse[];
  rowSync: Record<string, RowSync>;
  onSyncRow: (id: string) => void;
  selected: CellSelection | null;
  onCellClick: (sel: CellSelection) => void;
  onSelectAccount: (id: string) => void;
}) {
  const cols = view.columns;
  const hasTotal = cols.some(c => c.inTotal);

  const rows = useMemo<Row[]>(() => {
    if (!data) return [];
    const hidden = new Set(view.hiddenAccounts ?? []);
    return orderedAccounts(view, data, accounts)
      .filter(a => !hidden.has(a.id) && (view.showExpired || a.token_valid))
      .map(acc => {
        const cells = cols.map(c => countColumn(acc, c, catalog.get(c.itemId)));
        const total = cells.reduce((sum, c, i) => sum + (cols[i].inTotal ? c.total : 0), 0);
        return { acc, cells, total };
      })
      .filter(r => !view.hideEmpty || r.cells.some(c => c.total > 0));
  }, [data, accounts, view, cols, catalog]);

  // Heat scale per column, from the largest single-account value.
  const colMax = useMemo(() => cols.map((c, i) => {
    let m = 0;
    for (const r of rows) for (const b of c.buckets) m = Math.max(m, r.cells[i][b]);
    return m || 1;
  }), [rows, cols]);

  if (!cols.length) {
    return (
      <div style={{ ...panel, padding: 40, textAlign: "center", color: "var(--fg-4)", fontFamily: "var(--font-ui)", fontSize: 14 }}>
        Bu görünümde henüz sütun yok. Düzenle ile item ekleyebilirsin.
      </div>
    );
  }
  if (!data) {
    return <div style={{ color: "var(--fg-4)", fontFamily: "var(--font-mono)", fontSize: 13 }}>Veri okunuyor...</div>;
  }

  const sums = sumRows(rows, cols.length);
  const bucketCount = cols.reduce((n, c) => n + c.buckets.length, 0);

  const RED = "#f44336";
  const cellBase: React.CSSProperties = {
    padding: "6px 6px", textAlign: "center", fontFamily: "var(--font-mono)", fontSize: 13.5,
    whiteSpace: "nowrap", minWidth: 44, borderBottom: "1px solid rgba(255,255,255,0.035)",
  };
  // Account column: a clear rule and soft shadow so it stays apart from the data, also while scrolling.
  const stickyLeft: React.CSSProperties = {
    position: "sticky", left: 0, zIndex: 2,
    borderRight: "2px solid rgba(255,255,255,0.16)",
    filter: "drop-shadow(4px 0 6px rgba(0,0,0,0.35))",
  };
  // One quiet divider between items; none between an item's buckets.
  const itemEdge = (i: number, j: number): React.CSSProperties =>
    j === 0 && i > 0 ? { borderLeft: "2px solid rgba(255,255,255,0.14)" } : {};
  // Each item column carries a faint band of its color so zeros still read as "this item".
  const band = (i: number, expired: boolean): string =>
    expired ? "rgba(244,67,54,0.09)" : tint(cols[i].color, 0.05);

  const canBreakdown = (c: MatrixColumn, v: number) => {
    const e = catalog.get(c.itemId);
    return v > 0 && !!(e?.isWeapon || e?.isMod);
  };

  const value = (v: number, i: number, expired: boolean) => {
    const color = expired ? RED : cols[i].color;
    if (!v) return <span style={{ color: tint(color, 0.4) }}>0</span>;
    const a = 0.35 + 0.45 * Math.min(1, v / colMax[i]);
    return (
      <span style={{
        display: "inline-block", minWidth: 28, padding: "2px 7px", borderRadius: 6,
        background: tint(color, a), color: "#fff", fontWeight: 600,
      }}>{v}</span>
    );
  };

  return (
    <div style={{ ...panel, overflow: "auto", maxHeight: "calc(100vh - 170px)" }}>
      <table style={{ borderCollapse: "separate", borderSpacing: 0, width: "max-content", minWidth: "100%" }}>
        <thead style={{ position: "sticky", top: 0, zIndex: 3, background: "var(--bg-2)" }}>
          <tr>
            <th rowSpan={2} style={{
              ...cellBase, ...stickyLeft, zIndex: 4, background: "var(--bg-2)", textAlign: "left", padding: "6px 14px",
              fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 12, color: "var(--fg-4)",
              textTransform: "uppercase", letterSpacing: "0.08em", minWidth: 210,
              borderBottom: "1px solid rgba(255,255,255,0.1)",
            }}>Hesap · {rows.length}</th>
            {cols.map((c, i) => {
              const e = catalog.get(c.itemId);
              return (
                <th key={c.id} colSpan={c.buckets.length} style={{
                  ...cellBase, ...itemEdge(i, 0), background: "var(--bg-2)", padding: "10px 6px 4px",
                  borderTop: `3px solid ${c.color}`, borderBottom: "none",
                }} title={`${e?.name ?? c.itemId}${c.tier ? ` · Tier ${c.tier}` : ""}${c.fullOnly ? " · yalnız tam dayanıklılık" : ""}${c.includeMounted ? " · silahlara takılı olanlar dahil" : ""}`}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                    <ItemIcon entry={e} size={30} />
                    <span style={{
                      fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 13, color: "var(--fg-1)",
                      maxWidth: Math.max(80, c.buckets.length * 52), overflow: "hidden", textOverflow: "ellipsis",
                    }}>{c.label || columnName(c, e)}</span>
                    {c.includeMounted && (
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, color: "#00d2ff", letterSpacing: "0.04em" }}>
                        + takılı
                      </span>
                    )}
                  </div>
                </th>
              );
            })}
            {hasTotal && (
              <th rowSpan={2} style={{
                ...cellBase, background: "var(--bg-2)", padding: "6px 14px", borderLeft: "1px solid rgba(255,255,255,0.07)",
                fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 12, color: "var(--fg-3)",
                textTransform: "uppercase", letterSpacing: "0.08em", borderTop: "3px solid #7b2ff7",
                borderBottom: "1px solid rgba(255,255,255,0.1)",
              }} title="Toplama dahil sütunların toplamı">Toplam</th>
            )}
          </tr>
          <tr>
            {cols.map((c, i) => c.buckets.map((b, j) => (
              <th key={`${c.id}-${b}`} style={{
                ...cellBase, ...itemEdge(i, j), background: "var(--bg-2)", padding: "2px 6px 7px",
                fontSize: 11, fontWeight: 500, color: "var(--fg-4)", borderBottom: "1px solid rgba(255,255,255,0.1)",
              }}>{bucketLabel(c, b, catalog.get(c.itemId))}</th>
            )))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const expired = !r.acc.token_valid;
            return (
              <tr key={r.acc.id} className={`av-matrix-row${rowSync[r.acc.id]?.state === "done" ? " av-matrix-row-fresh" : ""}`}>
                <td style={{
                  ...cellBase, ...stickyLeft, textAlign: "left", padding: "6px 14px 6px 8px",
                  background: expired ? "#221318" : "var(--bg-2)",
                  boxShadow: expired ? `inset 3px 0 0 ${RED}` : undefined,
                  fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 14,
                }} title={`${expired ? "Token süresi doldu. " : ""}Son senkron: ${timeSince(r.acc.last_sync_at)}`}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, width: "100%" }}>
                    <SyncButton expired={expired} state={rowSync[r.acc.id]} onClick={() => onSyncRow(r.acc.id)} />
                    <a href={hrefFor(routes.account(r.acc.id))} onClick={onPlainClick(() => onSelectAccount(r.acc.id))} style={{
                      textDecoration: "none", cursor: "pointer", textAlign: "left",
                      font: "inherit", color: expired ? "#ff7a72" : "var(--fg-1)",
                    }}>
                      {r.acc.display_name || r.acc.id.slice(0, 8)}
                      <span style={{ color: expired ? "#a85a5a" : "var(--fg-5)", fontWeight: 400, fontSize: 12 }}>#{r.acc.discriminator}</span>
                    </a>
                    <SteamCopyButtons acc={r.acc} />
                  </div>
                </td>
                {cols.map((c, i) => c.buckets.map((b, j) => (
                  <td key={`${c.id}-${b}`}
                    data-bd-cell={canBreakdown(c, r.cells[i][b]) ? "" : undefined}
                    onClick={canBreakdown(c, r.cells[i][b]) ? () => onCellClick({ acc: r.acc, col: c, bucket: b }) : undefined}
                    title={canBreakdown(c, r.cells[i][b])
                      ? (catalog.get(c.itemId)?.isMod ? "Hangi silahların üzerinde" : "Eklentilere göre döküm") : undefined}
                    style={{
                      ...cellBase, ...itemEdge(i, j), background: band(i, expired),
                      cursor: canBreakdown(c, r.cells[i][b]) ? "pointer" : undefined,
                      ...(selected && selected.acc.id === r.acc.id && selected.col.id === c.id && selected.bucket === b
                        ? { outline: "2px solid #00d2ff", outlineOffset: -2 } : {}),
                    }}>
                    {value(r.cells[i][b], i, expired)}
                  </td>
                )))}
                {hasTotal && (
                  <td style={{
                    ...cellBase, padding: "6px 14px", borderLeft: "1px solid rgba(255,255,255,0.07)",
                    background: expired ? "rgba(244,67,54,0.09)" : "rgba(123,47,247,0.07)",
                    color: expired ? "#ff7a72" : r.total ? "var(--fg-1)" : "var(--fg-5)", fontWeight: 600,
                  }}>{r.total}</td>
                )}
              </tr>
            );
          })}
          {!rows.length && (
            <tr><td colSpan={bucketCount + 2} style={{ padding: 30, textAlign: "center", color: "var(--fg-4)", fontFamily: "var(--font-ui)" }}>
              Gösterilecek hesap yok. Düzenle ile hesap seçebilirsin.
            </td></tr>
          )}

          {/* Bucket subtotals, then per-item totals, separated from the account rows by a rule. */}
          {rows.length > 0 && (
            <>
              <tr>
                <td style={{
                  ...cellBase, ...stickyLeft, background: "#15152a", textAlign: "left", padding: "9px 14px",
                  borderTop: "1px solid rgba(255,255,255,0.18)", borderBottom: "none",
                  fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 12, color: "var(--fg-4)",
                  textTransform: "uppercase", letterSpacing: "0.08em",
                }}>Ara toplam</td>
                {cols.map((c, i) => c.buckets.map((b, j) => (
                  <td key={`${c.id}-${b}`} style={{
                    ...cellBase, ...itemEdge(i, j), background: "#15152a", padding: "9px 6px",
                    borderTop: "1px solid rgba(255,255,255,0.18)", borderBottom: "none",
                    color: sums.cells[i][b] ? "var(--fg-2)" : "var(--fg-5)",
                  }}>{sums.cells[i][b]}</td>
                )))}
                {hasTotal && (
                  <td style={{
                    ...cellBase, background: "#15152a", padding: "9px 14px",
                    borderTop: "1px solid rgba(255,255,255,0.18)", borderLeft: "1px solid rgba(255,255,255,0.07)", borderBottom: "none",
                  }} />
                )}
              </tr>
              <tr>
                <td style={{
                  ...cellBase, ...stickyLeft, background: "#1d1638", textAlign: "left", padding: "12px 14px",
                  borderTop: "2px solid rgba(123,47,247,0.6)", borderBottom: "none",
                  fontFamily: "var(--font-ui)", fontWeight: 700, fontSize: 13, color: "#fff",
                  textTransform: "uppercase", letterSpacing: "0.08em",
                }}>Toplam</td>
                {cols.map((c, i) => (
                  <td key={c.id} colSpan={c.buckets.length} style={{
                    ...cellBase, ...itemEdge(i, 0), background: "#1d1638", padding: "12px 6px",
                    borderTop: "2px solid rgba(123,47,247,0.6)", borderBottom: "none",
                    color: sums.cells[i].total ? c.color : tint(c.color, 0.4), fontWeight: 700, fontSize: 18,
                  }} title="Sütun toplamı (gösterilmeyen dayanıklılık dilimleri dahil)">
                    {sums.cells[i].total}
                  </td>
                ))}
                {hasTotal && (
                  <td style={{
                    ...cellBase, background: "rgba(123,47,247,0.28)", padding: "12px 14px",
                    borderTop: "2px solid rgba(123,47,247,0.6)", borderLeft: "1px solid rgba(255,255,255,0.07)", borderBottom: "none",
                    color: "#e0ccff", fontWeight: 700, fontSize: 20,
                  }}>{sums.total}</td>
                )}
              </tr>
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ─── Breakdown ───────────────────────────────────────────────────────────────

interface CellSelection {
  acc: MatrixAccount;
  col: MatrixColumn;
  bucket: MatrixBucket;
}

const SPLIT_BUCKETS: MatrixBucket[] = ["full", "half", "low"];

/** Side panel: one account's copies of a weapon, grouped by fitted attachments. */
function BreakdownPanel({ sel, entry, itemsRef, onClose }: {
  sel: CellSelection;
  entry: CatalogEntry | undefined;
  itemsRef: Record<string, ItemReference>;
  onClose: () => void;
}) {
  const [data, setData] = useState<MatrixBreakdown | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { acc, col, bucket } = sel;

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    getMatrixBreakdown(acc.id, col.itemId, col.tier)
      .then(d => { if (!cancelled) setData(d); })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [acc.id, col.itemId, col.tier]);

  // Only the clicked durability bucket is listed; a "total" cell lists every bucket.
  const focus = bucket === "total" ? null : bucket;

  // Same counting rules as the table cell: skip broken copies, honour "yalnız tam".
  const groups = useMemo(() => (data?.groups ?? []).map(g => {
    const counts: Record<string, number> = { full: 0, half: 0, low: 0 };
    const copies: { tier: string | null; pct: number; bucket: MatrixBucket }[] = [];
    for (const st of g.stacks) {
      const b = stackBucket(st, !!entry?.isWeapon);
      if (!b || (col.fullOnly && b !== "full")) continue;
      if (focus && b !== focus) continue;
      counts[b] += st.qty;
      for (let k = 0; k < st.qty; k++) copies.push({ tier: st.tier, pct: st.durability ?? 100, bucket: b });
    }
    return { mods: g.mods, unknown: !!g.unknown, counts, total: counts.full + counts.half + counts.low, copies };
  }).filter(g => g.total > 0), [data, entry, col.fullOnly, focus]);

  const totals = groups.reduce((t, g) => {
    SPLIT_BUCKETS.forEach(b => { t[b] += g.counts[b]; });
    return t;
  }, { full: 0, half: 0, low: 0 } as Record<string, number>);

  const modName = (id: string) => itemsRef[id]?.name_en || itemsRef[id]?.name_tr || id;
  const toMod = (id: string): DisplayItemMod => ({
    slot_type: "",
    mod_id: id,
    name: modName(id),
    rarity: ((itemsRef[id]?.rarity || "common").toLowerCase() as Rarity),
    image: proxyCdnUrl(itemsRef[id]?.image),
  });
  // Weapon art and rarity of the exact tier shown in the column.
  const weaponKey = col.tier ? `${col.itemId}_${col.tier.toLowerCase()}` : col.itemId;
  const weaponRef = itemsRef[weaponKey];
  const rarity = RARITY[((weaponRef?.rarity || entry?.rarity || "common").toLowerCase() as Rarity)] ?? RARITY.common;
  const weaponImage = proxyCdnUrl(weaponRef?.image) ?? entry?.image;
  const lbl = (b: MatrixBucket) => bucketLabel(col, b, entry);

  const chip = (b: MatrixBucket, n: number) => (
    <span key={b} style={{
      display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 7px", borderRadius: 6,
      fontFamily: "var(--font-mono)", fontSize: 11.5,
      background: focus === b ? tint(col.color, 0.45) : "var(--bg-4)",
      color: n ? "var(--fg-1)" : "var(--fg-5)",
      outline: focus === b ? `1px solid ${col.color}` : undefined,
    }}>
      <span style={{ color: focus === b ? "#fff" : "var(--fg-4)" }}>{lbl(b)}</span>{n}
    </span>
  );

  return (
    <div data-bd-panel="" style={{
      position: "fixed", top: 0, right: 0, bottom: 0, width: 440, zIndex: 50,
      background: "var(--bg-2)", borderLeft: "1px solid var(--border-strong)",
      boxShadow: "-12px 0 32px rgba(0,0,0,0.5)", display: "flex", flexDirection: "column",
    }}>
      <div style={{ padding: "16px 18px 12px", borderBottom: "1px solid var(--border)", borderTop: `3px solid ${col.color}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <ItemIcon entry={entry} size={34} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 16, color: "var(--fg-1)" }}>
              {entry?.name ?? col.itemId}{col.tier ? ` ${col.tier}` : ""}
            </div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: acc.token_valid ? "var(--fg-4)" : "#ff7a72" }}>
              {acc.display_name}#{acc.discriminator}{col.fullOnly ? " · yalnız tam" : ""}
            </div>
          </div>
          <button onClick={onClose} title="Kapat (Esc)" style={{
            width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", padding: 0,
            background: "var(--bg-3)", border: "1px solid var(--border)", borderRadius: "var(--radius)",
            color: "var(--fg-3)", cursor: "pointer",
          }}><Icon name="x" size={15} /></button>
        </div>
        {data && (
          <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
            <span style={{ fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 13, color: "var(--fg-2)", marginRight: 4 }}>
              {groups.reduce((n, g) => n + g.total, 0)} adet · {groups.length} farklı dizilim
            </span>
            {focus ? chip(focus, totals[focus]) : SPLIT_BUCKETS.map(b => chip(b, totals[b]))}
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "10px 12px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
        {error && <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "#f44336" }}>{error}</div>}
        {!data && !error && <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--fg-5)" }}>yükleniyor...</div>}
        {data && !groups.length && (
          <div style={{ fontFamily: "var(--font-ui)", fontSize: 13, color: "var(--fg-4)" }}>
            {focus ? `Bu hesapta ${lbl(focus)} diliminde kopya yok.` : "Bu hesapta sayılan kopya yok."}
          </div>
        )}
        {groups.map(g => {
          return (
            <div key={g.unknown ? "unknown" : g.mods.join("|") || "none"} style={{
              background: "var(--bg-3)", borderRadius: "var(--radius-md)", padding: 12,
              border: "1px solid var(--border)",
              display: "flex", gap: 12,
            }}>
              <WeaponTileBox image={weaponImage} rarity={rarity} tier={col.tier} count={g.total} />

              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                {g.unknown ? (
                  <div style={{
                    padding: "8px 10px", borderRadius: "var(--radius)", border: "1px dashed rgba(255,183,77,0.45)",
                    background: "rgba(255,183,77,0.06)", fontFamily: "var(--font-ui)", fontSize: 12.5, color: "#ffb74d", lineHeight: 1.35,
                  }}>
                    Eklenti bilgisi yok
                    <div style={{ fontSize: 11.5, color: "var(--fg-4)" }}>
                      Çantadaki silahlar; arctracker bunların eklentilerini göndermiyor.
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Mod slots, as in the inventory tooltip */}
                    <WeaponSlots baseId={col.itemId} mods={g.mods.map(toMod)} slotSize={52} tooltipBelow />
                    <div style={{ fontFamily: "var(--font-ui)", fontSize: 12.5, color: g.mods.length ? "var(--fg-2)" : "var(--fg-4)", lineHeight: 1.35 }}>
                      {g.mods.length ? g.mods.map(modName).join(" · ") : "Eklentisiz"}
                    </div>
                  </>
                )}

                {/* Durability bars, one per distinct value (×n) */}
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {Object.values(g.copies.reduce((acc, cp) => {
                    const max = entry?.isWeapon && cp.tier ? WEAPON_MAX_DURABILITY[cp.tier] ?? 100 : 100;
                    const abs = Math.round((max * cp.pct) / 100);
                    const key = `${abs}/${max}`;
                    (acc[key] ??= { abs, max, pct: cp.pct, bucket: cp.bucket, n: 0 }).n += 1;
                    return acc;
                  }, {} as Record<string, { abs: number; max: number; pct: number; bucket: MatrixBucket; n: number }>))
                    .sort((a, b) => b.pct - a.pct)
                    .map(bar => {
                      const color = bar.pct > 50 ? "#4caf50" : bar.pct > 20 ? "#ff9800" : "#f44336";
                      return (
                        <div key={`${bar.abs}/${bar.max}`} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ flex: 1, height: 5, borderRadius: 3, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                            <div style={{ width: `${Math.min(bar.pct, 100)}%`, height: "100%", background: color, borderRadius: 3 }} />
                          </div>
                          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color, minWidth: 58, textAlign: "right" }}>
                            {bar.abs}/{bar.max}
                          </span>
                          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-2)", minWidth: 26 }}>
                            {bar.n > 1 ? `×${bar.n}` : ""}
                          </span>
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type RarityStyle = { color: string; border: string; glow: string };

/** Inventory-style weapon tile: art on a rarity glow, tier top-left, count bottom-right. */
function WeaponTileBox({ image, rarity, tier, count }: {
  image?: string; rarity: RarityStyle; tier: string | null; count: number;
}) {
  return (
    <div style={{
      width: 88, flexShrink: 0, alignSelf: "flex-start", padding: 6,
      background: "var(--bg-2)", border: `1px solid ${rarity.border}`, borderRadius: "var(--radius)",
    }}>
      <div style={{
        aspectRatio: "1", borderRadius: "var(--radius-sm)", position: "relative", overflow: "hidden",
        background: `radial-gradient(circle at 50% 45%, ${rarity.glow}, transparent 70%), #0a0a0f`,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {image
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={image} alt="" style={{ maxWidth: "80%", maxHeight: "80%", objectFit: "contain" }} />
          : <span style={{ color: "var(--fg-4)" }}>?</span>}
        {tier && (
          <span style={{
            position: "absolute", top: 3, left: 5, fontFamily: "var(--font-mono)", fontSize: 10,
            fontWeight: 700, color: rarity.color, textShadow: "0 1px 2px #000",
          }}>{tier}</span>
        )}
        <span style={{
          position: "absolute", bottom: 3, right: 5, fontFamily: "var(--font-mono)", fontSize: 13,
          fontWeight: 700, color: "var(--fg-1)", textShadow: "0 1px 2px #000",
        }}>×{count}</span>
      </div>
    </div>
  );
}

const refFor = (itemsRef: Record<string, ItemReference>, itemId: string, tier: string | null) =>
  itemsRef[tier ? `${itemId}_${tier.toLowerCase()}` : itemId] ?? itemsRef[itemId];
const rarityOf = (r: string | undefined): RarityStyle =>
  RARITY[((r || "common").toLowerCase() as Rarity)] ?? RARITY.common;

/** Side panel for an attachment: how many sit loose, and which weapons carry the rest. */
function MountedPanel({ sel, entry, catalog, itemsRef, onClose }: {
  sel: CellSelection;
  entry: CatalogEntry | undefined;
  catalog: Map<string, CatalogEntry>;
  itemsRef: Record<string, ItemReference>;
  onClose: () => void;
}) {
  const [data, setData] = useState<MatrixMounted | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { acc, col } = sel;

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    getMatrixMounted(acc.id, col.itemId, col.tier)
      .then(d => { if (!cancelled) setData(d); })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [acc.id, col.itemId, col.tier]);

  const modRef = (id: string) => itemsRef[id];
  const toMod = (id: string): DisplayItemMod => ({
    slot_type: "", mod_id: id,
    name: modRef(id)?.name_en || modRef(id)?.name_tr || id,
    rarity: ((modRef(id)?.rarity || "common").toLowerCase() as Rarity),
    image: proxyCdnUrl(modRef(id)?.image),
  });
  const self = refFor(itemsRef, col.itemId, col.tier);
  const fitted = data ? data.weapons.reduce((n, w) => n + w.fitted, 0) : 0;
  // The searched-for attachment as a fitted slug, e.g. "angled_grip_iii".
  const isTarget = (modId: string) => {
    const m = modId.match(/^(.*?)_(iv|iii|ii|i)$/);
    const base = m ? m[1] : modId;
    const tier = m ? m[2].toUpperCase() : null;
    return base === col.itemId && (!col.tier || tier === col.tier);
  };

  return (
    <div data-bd-panel="" style={{
      position: "fixed", top: 0, right: 0, bottom: 0, width: 440, zIndex: 50,
      background: "var(--bg-2)", borderLeft: "1px solid var(--border-strong)",
      boxShadow: "-12px 0 32px rgba(0,0,0,0.5)", display: "flex", flexDirection: "column",
    }}>
      <div style={{ padding: "16px 18px 12px", borderBottom: "1px solid var(--border)", borderTop: `3px solid ${col.color}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <ItemIcon entry={entry} size={34} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 16, color: "var(--fg-1)" }}>
              {self?.name_en || entry?.name || col.itemId}
            </div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: acc.token_valid ? "var(--fg-4)" : "#ff7a72" }}>
              {acc.display_name}#{acc.discriminator}
            </div>
          </div>
          <button onClick={onClose} title="Kapat (Esc)" style={{
            width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", padding: 0,
            background: "var(--bg-3)", border: "1px solid var(--border)", borderRadius: "var(--radius)",
            color: "var(--fg-3)", cursor: "pointer",
          }}><Icon name="x" size={15} /></button>
        </div>
        {data && (
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", fontFamily: "var(--font-ui)", fontSize: 13 }}>
            <span style={{ padding: "3px 9px", borderRadius: 6, background: "var(--bg-4)", color: "var(--fg-2)" }}>
              Depoda <b style={{ color: "var(--fg-1)" }}>{data.loose}</b>
            </span>
            <span style={{ padding: "3px 9px", borderRadius: 6, background: tint(col.color, 0.3), color: "var(--fg-1)" }}>
              Silahlarda <b>{fitted}</b> · {data.weapons.reduce((n, w) => n + w.qty, 0)} silah
            </span>
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "10px 12px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
        {error && <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "#f44336" }}>{error}</div>}
        {!data && !error && <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--fg-5)" }}>yükleniyor...</div>}
        {data && !data.weapons.length && (
          <div style={{ fontFamily: "var(--font-ui)", fontSize: 13, color: "var(--fg-4)" }}>
            Bu hesapta hiçbir silahın üzerinde takılı değil.
          </div>
        )}
        {data?.weapons.map(w => {
          const wRef = refFor(itemsRef, w.item_id, w.tier);
          const wEntry = catalog.get(w.item_id);
          return (
            <div key={`${w.item_id}|${w.tier}|${w.mods.join("+")}`} style={{
              background: "var(--bg-3)", borderRadius: "var(--radius-md)", padding: 12,
              border: "1px solid var(--border)", display: "flex", gap: 12,
            }}>
              <WeaponTileBox image={proxyCdnUrl(wRef?.image) ?? wEntry?.image} rarity={rarityOf(wRef?.rarity)} tier={w.tier} count={w.qty} />
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 14, color: "var(--fg-1)" }}>
                  {wEntry?.name ?? w.item_id}{w.tier ? ` ${w.tier}` : ""}
                </div>
                <WeaponSlots baseId={w.item_id} mods={w.mods.map(toMod)} slotSize={52} tooltipBelow />
                <div style={{ fontFamily: "var(--font-ui)", fontSize: 12.5, color: "var(--fg-3)", lineHeight: 1.35 }}>
                  {w.mods.map(m => (
                    <span key={m} style={isTarget(m) ? { color: col.color, fontWeight: 700 } : undefined}>
                      {toMod(m).name}
                    </span>
                  )).reduce<React.ReactNode[]>((acc, el, k) => (k ? [...acc, " · ", el] : [el]), [])}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Editor ──────────────────────────────────────────────────────────────────

/**
 * Drag-and-drop reordering for a vertical list. dropAt is the insertion slot
 * (0..n) under the pointer; the container handles the drop so gaps between
 * rows still count. With handleOnly, a row only becomes draggable while its
 * handle is pressed, so inputs inside the row keep normal text selection.
 */
function useDragReorder(ids: string[], onReorder: (ids: string[]) => void, handleOnly = false) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const end = () => { setDragId(null); setDropAt(null); setArmed(null); };

  const commit = () => {
    if (dragId === null || dropAt === null) return;
    const next = [...ids];
    const from = next.indexOf(dragId);
    if (from === -1) return;
    next.splice(from, 1);
    next.splice(from < dropAt ? dropAt - 1 : dropAt, 0, dragId);
    onReorder(next);
  };

  const container = {
    onDragOver: (e: React.DragEvent<HTMLDivElement>) => { if (dragId) e.preventDefault(); },
    onDragLeave: (e: React.DragEvent<HTMLDivElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropAt(null);
    },
    onDrop: (e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); commit(); end(); },
  };

  const item = (id: string, idx: number) => ({
    draggable: handleOnly ? armed === id : true,
    onDragStart: (e: React.DragEvent<HTMLDivElement>) => {
      setDragId(id);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", id);
    },
    onDragOver: (e: React.DragEvent<HTMLDivElement>) => {
      if (!dragId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const r = e.currentTarget.getBoundingClientRect();
      setDropAt(e.clientY < r.top + r.height / 2 ? idx : idx + 1);
    },
    onDragEnd: end,
  });

  const handle = (id: string) => ({
    onMouseDown: () => setArmed(id),
    onMouseUp: () => setArmed(null),
    style: { cursor: "grab", display: "flex", alignItems: "center", alignSelf: "stretch", padding: "0 2px" } as React.CSSProperties,
    title: "Sürükleyerek taşı",
  });

  // Only set keys that apply, so spreading this never clears a row's own opacity.
  const look = (id: string, idx: number): React.CSSProperties => {
    const st: React.CSSProperties = {};
    if (dragId === id) st.opacity = 0.4;
    if (dragId !== null && dropAt === idx) st.boxShadow = "0 -2px 0 #00d2ff";
    else if (dragId !== null && dropAt === ids.length && idx === ids.length - 1) st.boxShadow = "0 2px 0 #00d2ff";
    return st;
  };

  return { dragId, container, item, handle, look };
}

function Editor({ draft, setDraft, catalog, data, accounts, isNew, canDelete, saving, dirty, onSave, onCancel, onDelete }: {
  draft: MatrixView;
  setDraft: (v: MatrixView) => void;
  catalog: Map<string, CatalogEntry>;
  data: MatrixAccount[] | null;
  accounts: AccountResponse[];
  isNew: boolean;
  canDelete: boolean;
  saving: boolean;
  dirty: boolean;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const [query, setQuery] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const patch = (p: Partial<MatrixView>) => setDraft({ ...draft, ...p });
  const patchCol = (id: string, p: Partial<MatrixColumn>) =>
    patch({ columns: draft.columns.map(c => (c.id === id ? { ...c, ...p } : c)) });
  const colDrag = useDragReorder(
    draft.columns.map(c => c.id),
    ids => patch({ columns: ids.map(id => draft.columns.find(c => c.id === id)!) }),
    true,
  );

  const results = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("tr");
    if (q.length < 2) return [];
    return [...catalog.values()]
      .filter(e =>
        e.name.toLocaleLowerCase("tr").includes(q)
        || e.altName.toLocaleLowerCase("tr").includes(q)
        || e.id.includes(q.replace(/\s+/g, "_")))
      .sort((a, b) => Number(b.isWeapon) - Number(a.isWeapon) || a.name.localeCompare(b.name, "tr"))
      .flatMap(e => (e.hasTiers && !e.isWeapon
        ? e.tiers.slice().reverse().map(t => ({ e, tier: t as string | null }))
        : [{ e, tier: undefined as string | null | undefined }]))
      .slice(0, 16);
  }, [query, catalog]);

  const ordered = useMemo(() => orderedAccounts(draft, data ?? [], accounts), [draft, data, accounts]);
  const hidden = new Set(draft.hiddenAccounts ?? []);

  const accDrag = useDragReorder(ordered.map(a => a.id), ids => patch({ accountOrder: ids }));
  const toggleAccount = (id: string) => patch({
    hiddenAccounts: hidden.has(id) ? [...hidden].filter(x => x !== id) : [...hidden, id],
  });

  const label: React.CSSProperties = {
    fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-4)", textTransform: "uppercase", letterSpacing: "0.08em",
  };

  return (
    <div style={{ ...panel, padding: 16, marginBottom: 14, borderColor: "rgba(123,47,247,0.35)" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <span style={label}>Görünüm adı</span>
        <input value={draft.name} onChange={e => patch({ name: e.target.value })} style={{ ...input, width: 200 }} maxLength={40} />
        <div style={{ flex: 1 }} />
        {canDelete && (confirmDelete ? (
          <>
            <span style={{ fontFamily: "var(--font-ui)", fontSize: 13, color: "#f44336" }}>Bu görünüm silinsin mi?</span>
            <button style={ghostBtn} onClick={() => setConfirmDelete(false)}>Hayır</button>
            <button style={{ ...ghostBtn, color: "#f44336", borderColor: "rgba(244,67,54,0.35)" }} onClick={onDelete}>Evet, sil</button>
          </>
        ) : (
          <button style={{ ...ghostBtn, color: "var(--fg-4)" }} onClick={() => setConfirmDelete(true)}>
            <Icon name="trash-2" size={14} /> Görünümü sil
          </button>
        ))}
        <button style={ghostBtn} onClick={onCancel}>Vazgeç</button>
        <button style={{ ...primaryBtn, opacity: saving || !draft.name.trim() || !dirty ? 0.5 : 1 }}
          disabled={saving || !draft.name.trim() || !dirty} onClick={onSave}>
          <Icon name="check" size={14} /> {saving ? "Kaydediliyor" : isNew ? "Oluştur" : "Kaydet"}
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 280px", gap: 16 }}>
        {/* Columns: the list fills the height set by the rows panel and scrolls inside it. */}
        <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <span style={label}>Sütunlar · {draft.columns.length}</span>
            {draft.columns.some(c => catalog.get(c.itemId)?.isMod) && (
              <div style={{ display: "flex", alignItems: "center", gap: 4 }} title="Eklenti sütunlarında silahlara takılı olanları say">
                <span style={{ ...label, textTransform: "none", letterSpacing: 0 }}>takılı:</span>
                <Toggle on={false} onClick={() => patch({
                  columns: draft.columns.map(c => (catalog.get(c.itemId)?.isMod ? { ...c, includeMounted: true } : c)),
                })}>hepsi</Toggle>
                <Toggle on={false} onClick={() => patch({
                  columns: draft.columns.map(c => (catalog.get(c.itemId)?.isMod ? { ...c, includeMounted: false } : c)),
                })}>hiçbiri</Toggle>
              </div>
            )}
            <div style={{ position: "relative", flex: 1, maxWidth: 360 }}>
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Item ekle: ara (ör. bobcat, anahtar)"
                style={{ ...input, width: "100%" }} />
              {results.length > 0 && (
                <div style={{
                  position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 20,
                  ...panel, background: "var(--bg-3)", maxHeight: 320, overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
                }}>
                  {results.map(({ e, tier }) => {
                    const already = draft.columns.some(c => c.itemId === e.id && (tier === undefined || c.tier === tier));
                    return (
                      <button key={`${e.id}|${tier ?? ""}`} onClick={() => {
                        patch({ columns: [...draft.columns, makeColumn(e.id, e, draft.columns.length, tier)] });
                        setQuery("");
                      }} style={{
                        display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "6px 10px",
                        background: "transparent", border: "none", borderBottom: "1px solid var(--border)",
                        cursor: "pointer", textAlign: "left", color: "var(--fg-1)", fontFamily: "var(--font-ui)", fontSize: 13.5,
                      }}>
                        <ItemIcon entry={e} size={24} />
                        <span style={{ flex: 1 }}>
                          {e.name}{tier ? ` ${tier}` : ""}
                          {e.altName && e.altName !== e.name && (
                            <span style={{ color: "var(--fg-5)", fontSize: 12 }}> · {e.altName}</span>
                          )}
                        </span>
                        {already && <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-5)" }}>ekli</span>}
                        {e.isWeapon && <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "#ff9800" }}>silah</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div style={{ flex: 1, position: "relative", minHeight: 240 }}>
          <div {...colDrag.container}
            style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", gap: 4, overflowY: "auto", paddingRight: 4 }}>
            {draft.columns.map((c, idx) => {
              const e = catalog.get(c.itemId);
              return (
                <div key={c.id} {...colDrag.item(c.id, idx)} style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", flexWrap: "wrap",
                  background: "var(--bg-3)", borderRadius: "var(--radius)", borderLeft: `3px solid ${c.color}`,
                  ...colDrag.look(c.id, idx),
                }}>
                  <span {...colDrag.handle(c.id)}>
                    <Icon name="grip-vertical" size={15} style={{ color: "var(--fg-4)" }} />
                  </span>
                  <ItemIcon entry={e} size={26} />
                  <span style={{ fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 13.5, color: "var(--fg-1)", minWidth: 110 }}>
                    {e?.name ?? c.itemId}
                  </span>
                  <input value={c.label ?? ""} onChange={ev => patchCol(c.id, { label: ev.target.value || undefined })}
                    placeholder="başlık" title="Tabloda görünecek kısa başlık (boşsa item adı)"
                    style={{ ...input, width: 80, padding: "3px 6px", fontSize: 12 }} maxLength={20} />
                  {e?.hasTiers && (
                    <select value={c.tier ?? ""} onChange={ev => patchCol(c.id, { tier: ev.target.value || null })}
                      style={{ ...input, padding: "3px 6px", fontSize: 12 }} title="Hangi tier sayılsın">
                      <option value="">Tüm tier</option>
                      {TIERS.map(t => <option key={t} value={t}>Tier {t}</option>)}
                    </select>
                  )}
                  <div style={{ display: "flex", gap: 3 }} title="Gösterilecek dayanıklılık dilimleri">
                    {BUCKETS.map(b => (
                      <Toggle key={b} on={c.buckets.includes(b)} onClick={() => {
                        const has = c.buckets.includes(b);
                        if (has && c.buckets.length === 1) return;
                        const next = has ? c.buckets.filter(x => x !== b) : BUCKETS.filter(x => x === b || c.buckets.includes(x));
                        patchCol(c.id, { buckets: next });
                      }}>{bucketLabel(c, b, e)}</Toggle>
                    ))}
                  </div>
                  <Toggle on={c.fullOnly} onClick={() => patchCol(c.id, { fullOnly: !c.fullOnly })}>yalnız tam</Toggle>
                  {e?.isMod && (
                    <Toggle on={!!c.includeMounted} onClick={() => patchCol(c.id, { includeMounted: !c.includeMounted })}>
                      takılı dahil
                    </Toggle>
                  )}
                  <Toggle on={c.inTotal} onClick={() => patchCol(c.id, { inTotal: !c.inTotal })}>toplama dahil</Toggle>
                  <div style={{ display: "flex", gap: 2, marginLeft: "auto" }}>
                    {PALETTE.slice(0, 12).map(p => (
                      <button key={p} onClick={() => patchCol(c.id, { color: p })} title={p} style={{
                        width: 12, height: 12, borderRadius: 3, padding: 0, cursor: "pointer", background: p,
                        border: c.color === p ? "2px solid #fff" : "1px solid rgba(0,0,0,0.3)",
                      }} />
                    ))}
                  </div>
                  <button style={tinyBtn} title="Sütunu kaldır"
                    onClick={() => patch({ columns: draft.columns.filter(x => x.id !== c.id) })}>
                    <Icon name="x" size={13} />
                  </button>
                </div>
              );
            })}
            {!draft.columns.length && (
              <div style={{ padding: 16, color: "var(--fg-4)", fontFamily: "var(--font-ui)", fontSize: 13 }}>
                Yukarıdan item arayıp ekle.
              </div>
            )}
          </div>
          </div>
        </div>

        {/* Rows */}
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <span style={{ ...label, flex: 1 }}>Hesaplar · {ordered.length - ordered.filter(a => hidden.has(a.id)).length}/{ordered.length}</span>
            <Toggle on={false} onClick={() => patch({ hiddenAccounts: [] })}>tümü</Toggle>
            <Toggle on={false} onClick={() => patch({ hiddenAccounts: ordered.map(a => a.id) })}>hiçbiri</Toggle>
          </div>
          <div {...accDrag.container}
            style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 480, overflowY: "auto", marginBottom: 12, paddingRight: 4 }}
          >
            {ordered.map((a, idx) => {
              const off = hidden.has(a.id);
              return (
                <div
                  key={a.id}
                  {...accDrag.item(a.id, idx)}
                  style={{
                    display: "flex", alignItems: "center", gap: 6, padding: "4px 6px", cursor: "grab",
                    background: accDrag.dragId === a.id ? "rgba(0,210,255,0.08)" : "var(--bg-3)", borderRadius: "var(--radius-sm)",
                    opacity: off ? 0.45 : 1,
                    ...accDrag.look(a.id, idx),
                  }}
                >
                  <Icon name="grip-vertical" size={14} style={{ color: "var(--fg-4)", flexShrink: 0 }} />
                  <input type="checkbox" checked={!off} onChange={() => toggleAccount(a.id)} title="Tabloda göster" />
                  <span onClick={() => toggleAccount(a.id)} style={{
                    flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer",
                    fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 13, color: a.token_valid ? "var(--fg-2)" : "#ff6b6b",
                  }}>{a.display_name || a.id.slice(0, 8)}<span style={{ color: "var(--fg-5)", fontWeight: 400 }}>#{a.discriminator}</span></span>
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <Toggle on={draft.showExpired} onClick={() => patch({ showExpired: !draft.showExpired })}>
              token'ı bitmiş hesapları göster
            </Toggle>
            <Toggle on={draft.hideEmpty} onClick={() => patch({ hideEmpty: !draft.hideEmpty })}>
              hiç item'ı olmayan satırları gizle
            </Toggle>
          </div>
        </div>
      </div>
    </div>
  );
}

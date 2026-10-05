"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Icon, Wordmark } from "@/components/ui";
import { getItemsReference, getMatrixInventory, getMatrixViews, putMatrixViews } from "@/lib/api";
import type {
  AccountResponse, ItemReference, MatrixAccount, MatrixBucket, MatrixColumn, MatrixSection, MatrixStack, MatrixView,
} from "@/lib/types";

// ─── Constants ───────────────────────────────────────────────────────────────

const ACTIVE_VIEW_KEY = "arc_vault_matrix_view";
const UNGROUPED = "";
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
  hasTiers: boolean;
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
      hasTiers: tiered,
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
    if (col.tier && s.tier !== col.tier) continue;
    const b = stackBucket(s, !!entry?.isWeapon);
    if (!b) continue;
    if (col.fullOnly && b !== "full") continue;
    c[b] += s.qty;
    c.total += s.qty;
  }
  return c;
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

function makeColumn(itemId: string, entry: CatalogEntry | undefined, index: number): MatrixColumn {
  const weapon = !!entry?.isWeapon;
  return {
    id: uid(),
    itemId,
    tier: weapon ? "IV" : null,
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
  const base = { groupOrder: [], hiddenGroups: [], showExpired: true, hideEmpty: false };
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

// ─── Screen ──────────────────────────────────────────────────────────────────

interface MatrixScreenProps {
  accounts: AccountResponse[];
  onBack: () => void;
  onSelectAccount: (id: string) => void;
  onSyncAll?: () => void;
  bulkSyncing?: boolean;
  bulkStatus?: string | null;
}

export function MatrixScreen({ accounts, onBack, onSelectAccount, onSyncAll, bulkSyncing, bulkStatus }: MatrixScreenProps) {
  const [catalog, setCatalog] = useState<Map<string, CatalogEntry> | null>(null);
  const [views, setViews] = useState<MatrixView[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState<MatrixView | null>(null);
  const [data, setData] = useState<MatrixAccount[] | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [leaveAsk, setLeaveAsk] = useState<null | (() => void)>(null);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);

  // Catalog + saved views
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [ref, saved] = await Promise.all([getItemsReference(), getMatrixViews()]);
        if (cancelled) return;
        const cat = buildCatalog(ref);
        setCatalog(cat);
        const list = saved.views && saved.views.length ? saved.views : defaultViews(cat);
        setViews(list);
        let stored: string | null = null;
        try { stored = localStorage.getItem(ACTIVE_VIEW_KEY); } catch {}
        setActiveId(list.some(v => v.id === stored) ? stored : list[0].id);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!activeId) return;
    try { localStorage.setItem(ACTIVE_VIEW_KEY, activeId); } catch {}
  }, [activeId]);

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
      setFetchedAt(new Date());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingData(false);
    }
  }, [itemKey]);
  useEffect(() => { loadData(); }, [loadData]);

  // Reload once a bulk sync started from this screen finishes.
  const wasSyncing = useRef(false);
  useEffect(() => {
    if (wasSyncing.current && !bulkSyncing) loadData();
    wasSyncing.current = !!bulkSyncing;
  }, [bulkSyncing, loadData]);

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(n => (n === msg ? null : n)), 4000);
  };

  // Leaving edit mode with unsaved changes asks first.
  const guard = useCallback((action: () => void) => {
    if (dirty) setLeaveAsk(() => action);
    else action();
  }, [dirty]);

  useEffect(() => {
    if (!draft) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") guard(() => setDraft(null));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draft, guard]);

  const persist = async (next: MatrixView[], msg: string) => {
    setSaving(true);
    try {
      await putMatrixViews(next);
      setViews(next);
      flash(msg);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
      groupOrder: [], hiddenGroups: [], showExpired: true, hideEmpty: false,
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
        {bulkStatus && <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "#00d2ff" }}>{bulkStatus}</span>}
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-5)" }}>
          {loadingData ? "yükleniyor..." : fetchedAt ? `veri ${fetchedAt.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}` : ""}
        </span>
        <button onClick={loadData} style={ghostBtn} title="Veriyi yeniden oku">
          <Icon name="refresh-cw" size={14} /> Yenile
        </button>
        {onSyncAll && (
          <button onClick={onSyncAll} disabled={bulkSyncing} style={{ ...ghostBtn, opacity: bulkSyncing ? 0.6 : 1 }}
            title="Token'ı geçerli hesapları arctracker'dan senkronize et">
            <Icon name="recycle" size={14} style={bulkSyncing ? { animation: "av-spin 1s linear infinite" } : undefined} />
            {bulkSyncing ? "Senkronize ediliyor" : "Senkronize et"}
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
        onSelectAccount={id => guard(() => { setDraft(null); onSelectAccount(id); })}
      />
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
        <button onClick={onBack} style={{ ...ghostBtn, padding: "7px 10px" }} title="Hesaplara dön">
          <Icon name="chevron-right" size={16} style={{ transform: "rotate(180deg)" }} />
        </button>
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

function MatrixTable({ view, catalog, data, accounts, onSelectAccount }: {
  view: MatrixView;
  catalog: Map<string, CatalogEntry>;
  data: MatrixAccount[] | null;
  accounts: AccountResponse[];
  onSelectAccount: (id: string) => void;
}) {
  const cols = view.columns;
  const hasTotal = cols.some(c => c.inTotal);

  const groups = useMemo(() => {
    if (!data) return [];
    const order = new Map(accounts.map((a, i) => [a.id, i]));
    const rows: Row[] = data
      .filter(a => view.showExpired || a.token_valid)
      .map(acc => {
        const cells = cols.map(c => countColumn(acc, c, catalog.get(c.itemId)));
        const total = cells.reduce((s, c, i) => s + (cols[i].inTotal ? c.total : 0), 0);
        return { acc, cells, total };
      })
      .filter(r => !view.hideEmpty || r.cells.some(c => c.total > 0))
      .sort((a, b) => (order.get(a.acc.id) ?? 999) - (order.get(b.acc.id) ?? 999));
    const keyOf = rowKeyOf(view);
    const byGroup = new Map<string, Row[]>();
    for (const r of rows) {
      const g = keyOf(r.acc);
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g)!.push(r);
    }
    return orderedRowGroups(view, new Set(byGroup.keys()))
      .filter(g => !view.hiddenGroups.includes(g.key) && byGroup.has(g.key))
      .map(g => ({ ...g, rows: byGroup.get(g.key)! }));
  }, [data, accounts, view, cols, catalog]);

  // Heat scale per column, from the largest single-account value.
  const colMax = useMemo(() => cols.map((_, i) => {
    let m = 0;
    for (const g of groups) for (const r of g.rows) m = Math.max(m, ...view.columns[i].buckets.map(b => r.cells[i][b]));
    return m || 1;
  }), [groups, cols, view.columns]);

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

  const allRows = groups.flatMap(g => g.rows);
  const grand = sumRows(allRows, cols.length);

  const cellBase: React.CSSProperties = {
    padding: "7px 10px", textAlign: "center", fontFamily: "var(--font-mono)", fontSize: 14,
    borderBottom: "1px solid rgba(255,255,255,0.08)", whiteSpace: "nowrap", minWidth: 46,
  };
  const stickyLeft: React.CSSProperties = { position: "sticky", left: 0, zIndex: 2 };
  // Thick divider between items, thin one between an item's buckets.
  const groupEdge = (i: number, j: number): React.CSSProperties =>
    j === 0
      ? (i > 0 ? { borderLeft: "2px solid rgba(255,255,255,0.22)" } : {})
      : { borderLeft: "1px solid rgba(255,255,255,0.06)" };
  const tint = (color: string, alpha: number) => `${color}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`;

  const heat = (v: number, i: number): React.CSSProperties => {
    if (!v) return { color: "var(--fg-4)" };
    const a = 0.3 + 0.55 * Math.min(1, v / colMax[i]);
    return {
      background: tint(cols[i].color, a), color: "#fff", fontWeight: 700,
      textShadow: "0 1px 2px rgba(0,0,0,0.7)",
    };
  };

  const summaryRows = (key: string, label: string, s: { cells: Counts[]; total: number }, strong: boolean) => {
    const bg = strong ? "#24244a" : "#1a1a36";
    const edge = strong ? "3px solid rgba(123,47,247,0.7)" : "2px solid rgba(255,255,255,0.18)";
    return [
      <tr key={`${key}-b`}>
        <td style={{
          ...cellBase, ...stickyLeft, background: bg, textAlign: "left", color: strong ? "#fff" : "var(--fg-1)",
          fontFamily: "var(--font-ui)", fontWeight: 700, fontSize: 13.5, borderTop: edge,
        }}>
          {label}
        </td>
        {cols.map((c, i) => c.buckets.map((b, j) => (
          <td key={`${c.id}-${b}`} style={{
            ...cellBase, ...groupEdge(i, j), background: bg, borderTop: edge,
            color: s.cells[i][b] ? "#fff" : "var(--fg-4)", fontWeight: 700,
          }}>
            {s.cells[i][b]}
          </td>
        )))}
        {hasTotal && (
          <td rowSpan={2} style={{
            ...cellBase, background: strong ? "#7b2ff7" : "rgba(123,47,247,0.55)", color: "#fff",
            fontWeight: 700, fontSize: strong ? 18 : 16, borderTop: edge, borderBottom: "2px solid rgba(255,255,255,0.18)",
          }}>{s.total}</td>
        )}
      </tr>,
      <tr key={`${key}-t`}>
        <td style={{ ...cellBase, ...stickyLeft, background: bg, borderBottom: "2px solid rgba(255,255,255,0.18)" }} />
        {cols.map((c, i) => (
          <td key={c.id} colSpan={c.buckets.length} style={{
            ...cellBase, ...groupEdge(i, 0), background: tint(c.color, strong ? 0.4 : 0.22),
            borderBottom: "2px solid rgba(255,255,255,0.18)",
            color: "#fff", fontWeight: 700, fontSize: 15, textShadow: "0 1px 2px rgba(0,0,0,0.7)",
          }} title="Sütun toplamı (gösterilmeyen dayanıklılık dilimleri dahil)">
            {s.cells[i].total}
          </td>
        ))}
      </tr>,
    ];
  };

  return (
    <div style={{ ...panel, overflow: "auto", maxHeight: "calc(100vh - 170px)" }}>
      <table style={{ borderCollapse: "separate", borderSpacing: 0, width: "max-content", minWidth: "100%" }}>
        <thead style={{ position: "sticky", top: 0, zIndex: 3, background: "var(--bg-2)", boxShadow: "0 4px 12px rgba(0,0,0,0.5)" }}>
          <tr>
            <th rowSpan={2} style={{
              ...cellBase, ...stickyLeft, zIndex: 4, background: "var(--bg-2)", textAlign: "left",
              fontFamily: "var(--font-ui)", fontSize: 13, color: "var(--fg-2)", textTransform: "uppercase", letterSpacing: "0.08em",
              minWidth: 200, borderBottom: "2px solid rgba(255,255,255,0.25)",
            }}>Hesap</th>
            {cols.map((c, i) => {
              const e = catalog.get(c.itemId);
              return (
                <th key={c.id} colSpan={c.buckets.length} style={{
                  ...cellBase, ...groupEdge(i, 0), background: `linear-gradient(180deg, ${tint(c.color, 0.28)}, ${tint(c.color, 0.1)}), var(--bg-2)`,
                  padding: "8px 6px 6px", borderTop: `5px solid ${c.color}`, borderBottom: "none",
                }} title={`${e?.name ?? c.itemId}${c.tier ? ` · Tier ${c.tier}` : ""}${c.fullOnly ? " · yalnız tam dayanıklılık" : ""}`}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                    <ItemIcon entry={e} size={40} />
                    <span style={{
                      fontFamily: "var(--font-ui)", fontWeight: 700, fontSize: 14.5, color: "#fff",
                      maxWidth: Math.max(80, c.buckets.length * 56), overflow: "hidden", textOverflow: "ellipsis",
                    }}>{c.label || e?.name || c.itemId}</span>
                  </div>
                </th>
              );
            })}
            {hasTotal && (
              <th rowSpan={2} style={{
                ...cellBase, background: "#5a1fd0", fontFamily: "var(--font-ui)", fontWeight: 700,
                fontSize: 15, color: "#fff", borderBottom: "2px solid rgba(255,255,255,0.25)", borderTop: "5px solid #7b2ff7",
              }} title="Toplama dahil sütunların toplamı">Toplam</th>
            )}
          </tr>
          <tr>
            {cols.map((c, i) => c.buckets.map((b, j) => (
              <th key={`${c.id}-${b}`} style={{
                ...cellBase, ...groupEdge(i, j), background: `${tint(c.color, 0.16)}`, fontSize: 12, color: c.color,
                fontWeight: 700, borderBottom: "2px solid rgba(255,255,255,0.25)", padding: "5px 10px",
              }}>{bucketLabel(c, b, catalog.get(c.itemId))}</th>
            )))}
          </tr>
        </thead>
        <tbody>
          {groups.map(g => [
            <tr key={`g-${g.key}`}>
              <td colSpan={1} style={{
                ...stickyLeft, padding: "9px 10px", background: "#1c1238",
                borderLeft: "4px solid #b06bff", borderTop: "8px solid var(--bg-2)",
                fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 14, color: "#d2a8ff",
                textTransform: "uppercase", letterSpacing: "0.1em", whiteSpace: "nowrap",
              }}>
                {g.name} <span style={{ color: "var(--fg-3)", fontFamily: "var(--font-mono)", fontSize: 12 }}>· {g.rows.length} hesap</span>
              </td>
              <td colSpan={cols.reduce((s, c) => s + c.buckets.length, 0) + (hasTotal ? 1 : 0)}
                style={{ background: "#1c1238", borderTop: "8px solid var(--bg-2)" }} />
            </tr>,
            ...g.rows.map((r, ri) => {
              const expired = !r.acc.token_valid;
              const zebra = ri % 2 === 1;
              return (
                <tr key={r.acc.id} className="av-matrix-row" style={{ background: zebra ? "rgba(255,255,255,0.035)" : undefined }}>
                  <td style={{
                    ...cellBase, ...stickyLeft, textAlign: "left",
                    background: expired ? "#2c1219" : zebra ? "#141426" : "var(--bg-2)",
                    borderLeft: expired ? "4px solid #f44336" : "4px solid transparent",
                    fontFamily: "var(--font-ui)", fontWeight: 700, fontSize: 15,
                  }} title={`${expired ? "Token süresi doldu. " : ""}Son senkron: ${timeSince(r.acc.last_sync_at)}`}>
                    <button onClick={() => onSelectAccount(r.acc.id)} style={{
                      background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left",
                      font: "inherit", color: expired ? "#ff6b6b" : "var(--fg-1)",
                      display: "flex", alignItems: "center", gap: 6,
                    }}>
                      <span style={{
                        width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                        background: expired ? "#f44336" : "#4caf50",
                      }} />
                      {r.acc.display_name || r.acc.id.slice(0, 8)}
                      <span style={{ color: expired ? "#c06060" : "var(--fg-4)", fontWeight: 500, fontSize: 12.5 }}>#{r.acc.discriminator}</span>
                    </button>
                  </td>
                  {cols.map((c, i) => c.buckets.map((b, j) => {
                    const v = r.cells[i][b];
                    return (
                      <td key={`${c.id}-${b}`} style={{ ...cellBase, ...groupEdge(i, j), ...heat(v, i) }}>{v}</td>
                    );
                  }))}
                  {hasTotal && (
                    <td style={{
                      ...cellBase, background: "rgba(123,47,247,0.32)", color: "#fff", fontWeight: 700, fontSize: 15,
                      borderLeft: "2px solid rgba(123,47,247,0.7)",
                    }}>{r.total}</td>
                  )}
                </tr>
              );
            }),
            ...summaryRows(`s-${g.key}`, "Ara toplam", sumRows(g.rows, cols.length), false),
          ])}
          {groups.length > 1 && summaryRows("grand", "Genel toplam", grand, true)}
          {!groups.length && (
            <tr><td colSpan={99} style={{ padding: 30, textAlign: "center", color: "var(--fg-4)", fontFamily: "var(--font-ui)" }}>
              Gösterilecek hesap yok.
            </td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Maps an account to its row group: a custom section when the view has any, else its account group. */
function rowKeyOf(view: MatrixView): (acc: MatrixAccount) => string {
  if (view.sections?.length) {
    const owner = new Map<string, string>();
    for (const s of view.sections) for (const id of s.accountIds) owner.set(id, s.id);
    return acc => owner.get(acc.id) ?? OTHER_SECTION;
  }
  return acc => acc.group_name || UNGROUPED;
}

function orderedRowGroups(view: MatrixView, present: Set<string>): { key: string; name: string }[] {
  if (view.sections?.length) {
    const list = view.sections.map(s => ({ key: s.id, name: s.name || "Adsız bölüm" }));
    if (present.has(OTHER_SECTION)) list.push({ key: OTHER_SECTION, name: "Diğer" });
    return list;
  }
  return orderGroups([...present], view.groupOrder).map(g => ({ key: g, name: g || "Grupsuz" }));
}

function orderGroups(present: string[], preferred: string[]): string[] {
  const known = preferred.filter(g => present.includes(g));
  const rest = present.filter(g => !known.includes(g)).sort((a, b) => {
    if (a === UNGROUPED) return 1;
    if (b === UNGROUPED) return -1;
    return a.localeCompare(b, "tr");
  });
  return [...known, ...rest];
}

// ─── Editor ──────────────────────────────────────────────────────────────────

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
  const moveCol = (idx: number, dir: -1 | 1) => {
    const cols = [...draft.columns];
    const t = idx + dir;
    if (t < 0 || t >= cols.length) return;
    [cols[idx], cols[t]] = [cols[t], cols[idx]];
    patch({ columns: cols });
  };

  const results = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("tr");
    if (q.length < 2) return [];
    return [...catalog.values()]
      .filter(e =>
        e.name.toLocaleLowerCase("tr").includes(q)
        || e.altName.toLocaleLowerCase("tr").includes(q)
        || e.id.includes(q.replace(/\s+/g, "_")))
      .sort((a, b) => Number(b.isWeapon) - Number(a.isWeapon) || a.name.localeCompare(b.name, "tr"))
      .slice(0, 12);
  }, [query, catalog]);

  const custom = !!draft.sections?.length;
  const rowGroups = useMemo(() => {
    const keyOf = rowKeyOf(draft);
    return orderedRowGroups(draft, new Set((data ?? []).map(keyOf)));
  }, [data, draft]);

  const moveGroup = (idx: number, dir: -1 | 1) => {
    const t = idx + dir;
    if (custom) {
      const list = [...draft.sections!];
      if (t < 0 || t >= list.length || idx >= list.length) return;
      [list[idx], list[t]] = [list[t], list[idx]];
      patch({ sections: list });
      return;
    }
    const list = rowGroups.map(g => g.key);
    if (t < 0 || t >= list.length) return;
    [list[idx], list[t]] = [list[t], list[idx]];
    patch({ groupOrder: list });
  };

  // Switching to custom sections seeds them from the current account groups.
  const startCustomSections = () => {
    const accs = data ?? [];
    const groups = orderGroups([...new Set(accs.map(a => a.group_name || UNGROUPED))], draft.groupOrder);
    const sections: MatrixSection[] = groups.map(g => ({
      id: uid(),
      name: g || "Grupsuz",
      accountIds: accs.filter(a => (a.group_name || UNGROUPED) === g).map(a => a.id),
    }));
    patch({ sections: sections.length ? sections : [{ id: uid(), name: "Bölüm 1", accountIds: [] }], hiddenGroups: [] });
  };

  const assign = (accountId: string, sectionId: string) => patch({
    sections: draft.sections!.map(sec => ({
      ...sec,
      accountIds: sec.id === sectionId
        ? [...sec.accountIds.filter(x => x !== accountId), accountId]
        : sec.accountIds.filter(x => x !== accountId),
    })),
  });

  const accountRows = useMemo(() => {
    const order = new Map(accounts.map((a, i) => [a.id, i]));
    return [...(data ?? [])].sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));
  }, [data, accounts]);

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
        {/* Columns */}
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <span style={label}>Sütunlar · {draft.columns.length}</span>
            <div style={{ position: "relative", flex: 1, maxWidth: 360 }}>
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Item ekle: ara (ör. bobcat, anahtar)"
                style={{ ...input, width: "100%" }} />
              {results.length > 0 && (
                <div style={{
                  position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 20,
                  ...panel, background: "var(--bg-3)", maxHeight: 320, overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
                }}>
                  {results.map(e => {
                    const already = draft.columns.some(c => c.itemId === e.id);
                    return (
                      <button key={e.id} onClick={() => {
                        patch({ columns: [...draft.columns, makeColumn(e.id, e, draft.columns.length)] });
                        setQuery("");
                      }} style={{
                        display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "6px 10px",
                        background: "transparent", border: "none", borderBottom: "1px solid var(--border)",
                        cursor: "pointer", textAlign: "left", color: "var(--fg-1)", fontFamily: "var(--font-ui)", fontSize: 13.5,
                      }}>
                        <ItemIcon entry={e} size={24} />
                        <span style={{ flex: 1 }}>
                          {e.name}
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

          <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 360, overflowY: "auto", paddingRight: 4 }}>
            {draft.columns.map((c, idx) => {
              const e = catalog.get(c.itemId);
              return (
                <div key={c.id} style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", flexWrap: "wrap",
                  background: "var(--bg-3)", borderRadius: "var(--radius)", borderLeft: `3px solid ${c.color}`,
                }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <button style={{ ...tinyBtn, height: 16 }} onClick={() => moveCol(idx, -1)} title="Sola taşı"><Icon name="chevron-up" size={12} /></button>
                    <button style={{ ...tinyBtn, height: 16 }} onClick={() => moveCol(idx, 1)} title="Sağa taşı"><Icon name="chevron-down" size={12} /></button>
                  </div>
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

        {/* Rows */}
        <div>
          <div style={{ ...label, marginBottom: 8 }}>Satırlar</div>
          <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
            <Toggle on={!custom} onClick={() => custom && patch({ sections: undefined, hiddenGroups: [] })}>hesap grupları</Toggle>
            <Toggle on={custom} onClick={() => !custom && startCustomSections()}>kendi bölümlerim</Toggle>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 }}>
            {rowGroups.map((g, idx) => {
              const hidden = draft.hiddenGroups.includes(g.key);
              const editable = custom && g.key !== OTHER_SECTION;
              return (
                <div key={g.key || "_"} style={{
                  display: "flex", alignItems: "center", gap: 6, padding: "5px 8px",
                  background: "var(--bg-3)", borderRadius: "var(--radius)", opacity: hidden ? 0.5 : 1,
                }}>
                  <input type="checkbox" checked={!hidden} title="Tabloda göster" onChange={() => patch({
                    hiddenGroups: hidden ? draft.hiddenGroups.filter(x => x !== g.key) : [...draft.hiddenGroups, g.key],
                  })} />
                  {editable ? (
                    <input value={draft.sections!.find(sec => sec.id === g.key)?.name ?? ""} maxLength={30}
                      onChange={ev => patch({
                        sections: draft.sections!.map(sec => (sec.id === g.key ? { ...sec, name: ev.target.value } : sec)),
                      })}
                      style={{ ...input, flex: 1, minWidth: 0, padding: "3px 6px", fontSize: 12.5 }} />
                  ) : (
                    <span style={{ flex: 1, fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 13, color: "var(--fg-2)" }}>
                      {g.name}
                    </span>
                  )}
                  {g.key !== OTHER_SECTION && <>
                    <button style={tinyBtn} onClick={() => moveGroup(idx, -1)} title="Yukarı"><Icon name="chevron-up" size={12} /></button>
                    <button style={tinyBtn} onClick={() => moveGroup(idx, 1)} title="Aşağı"><Icon name="chevron-down" size={12} /></button>
                  </>}
                  {editable && (
                    <button style={tinyBtn} title="Bölümü kaldır (hesapları Diğer'e geçer)" onClick={() => {
                      const rest = draft.sections!.filter(sec => sec.id !== g.key);
                      patch({ sections: rest.length ? rest : undefined });
                    }}><Icon name="x" size={12} /></button>
                  )}
                </div>
              );
            })}
            {custom && (
              <button style={{ ...ghostBtn, justifyContent: "center", padding: "5px 8px" }} onClick={() => patch({
                sections: [...draft.sections!, { id: uid(), name: `Bölüm ${draft.sections!.length + 1}`, accountIds: [] }],
              })}><Icon name="plus" size={13} /> Bölüm ekle</button>
            )}
          </div>
          {custom && (
            <>
              <div style={{ ...label, marginBottom: 6 }}>Hesap, bölüm</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 220, overflowY: "auto", marginBottom: 12, paddingRight: 4 }}>
                {accountRows.map(a => {
                  const current = draft.sections!.find(sec => sec.accountIds.includes(a.id))?.id ?? OTHER_SECTION;
                  return (
                    <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{
                        flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        fontFamily: "var(--font-ui)", fontSize: 12.5, color: a.token_valid ? "var(--fg-2)" : "#ff6b6b",
                      }}>{a.display_name || a.id.slice(0, 8)}<span style={{ color: "var(--fg-5)" }}>#{a.discriminator}</span></span>
                      <select value={current} onChange={ev => {
                        const v = ev.target.value;
                        if (v === OTHER_SECTION) {
                          patch({ sections: draft.sections!.map(sec => ({ ...sec, accountIds: sec.accountIds.filter(x => x !== a.id) })) });
                        } else assign(a.id, v);
                      }} style={{ ...input, padding: "2px 4px", fontSize: 12, maxWidth: 120 }}>
                        {draft.sections!.map(sec => <option key={sec.id} value={sec.id}>{sec.name || "Adsız bölüm"}</option>)}
                        <option value={OTHER_SECTION}>Diğer</option>
                      </select>
                    </div>
                  );
                })}
              </div>
            </>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <Toggle on={draft.showExpired} onClick={() => patch({ showExpired: !draft.showExpired })}>
              token'ı bitmiş hesapları göster
            </Toggle>
            <Toggle on={draft.hideEmpty} onClick={() => patch({ hideEmpty: !draft.hideEmpty })}>
              hiç item'ı olmayan satırları gizle
            </Toggle>
          </div>
          <div style={{ marginTop: 14, fontFamily: "var(--font-ui)", fontSize: 12, color: "var(--fg-4)", lineHeight: 1.45 }}>
            Toplam sütunu, "toplama dahil" işaretli sütunlardaki bütün sağlam adetleri sayar; tabloda gösterilmeyen
            dayanıklılık dilimleri de buna girer. Hesap sırası ana ekrandaki sürükle-bırak sırasıyla aynıdır.
          </div>
        </div>
      </div>
    </div>
  );
}

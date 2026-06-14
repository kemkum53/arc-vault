import type {
  AccountResponse,
  SyncDataResponse,
  ItemReference,
  QuestReference,
  HideoutReference,
  ModReference,
  DisplayItem,
  DisplayItemMod,
  DisplayQuest,
  DisplayBlueprint,
  DisplayHideoutModule,
  DisplayProject,
  DisplayLoadout,
  DisplayLoadoutSlot,
  DisplayAccount,
  DisplayEconomy,
  DisplaySyncSummary,
  DashboardData,
  Rarity,
  TraderKey,
} from "./types";

import type { Lang } from "./i18n";

// ─── Helpers ───

function proxyCdnUrl(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  return url.replace("https://cdn.arctracker.io/", "/cdn/");
}

function normalizeRarity(r: string | null | undefined): Rarity {
  if (!r) return "common";
  const lower = r.toLowerCase();
  if (["common", "uncommon", "rare", "epic", "legendary"].includes(lower)) {
    return lower as Rarity;
  }
  return "common";
}

function pickName(tr: string | null | undefined, en: string | null | undefined, fallback: string, lang: Lang): string {
  if (lang === "en") return en || tr || fallback;
  return tr || en || fallback;
}

const TIER_MAP: Record<string, string> = { "I": "i", "II": "ii", "III": "iii", "IV": "iv", "V": "v" };

function resolveItemRef(
  itemId: string,
  tier: string | null | undefined,
  itemsRef: Record<string, ItemReference>
): ItemReference | undefined {
  if (tier) {
    const suffix = TIER_MAP[tier.toUpperCase()];
    if (suffix) {
      const tieredKey = `${itemId}_${suffix}`;
      if (itemsRef[tieredKey]) return itemsRef[tieredKey];
    }
  }
  if (itemsRef[itemId]) return itemsRef[itemId];
  const prefix = itemId + "_";
  for (const key of Object.keys(itemsRef)) {
    if (key.startsWith(prefix)) return itemsRef[key];
  }
  const stripped = itemId.replace(/_(iv|iii|ii|i)(?=_|$)/, "");
  if (stripped !== itemId && itemsRef[stripped]) return itemsRef[stripped];
  return undefined;
}

function makeGlyph(name: string): string {
  const words = name.replace(/[^a-zA-Z0-9 ]/g, "").trim().split(/\s+/);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
}

const TRADER_MAP: Record<string, TraderKey> = {
  "shani": "shani",
  "celeste": "celeste",
  "apollo": "apollo",
  "lance": "lance",
  "tian wen": "tian",
  "tian": "tian",
};

function resolveTrader(traderName: string): TraderKey {
  return TRADER_MAP[traderName.toLowerCase()] || "shani";
}

const CATEGORY_MAP: Record<string, string> = {
  "augment": "augments",
  "shield": "shields",
  "assault rifle": "weapons",
  "smg": "weapons",
  "pistol": "weapons",
  "shotgun": "weapons",
  "battle rifle": "weapons",
  "lmg": "weapons",
  "sniper rifle": "weapons",
  "hand cannon": "weapons",
  "ammunition": "ammunitions",
  "modification": "weapon_mods",
  "quick use": "quick_use",
  "key": "keys",
  "recyclable": "crafting_materials",
  "topside material": "crafting_materials",
  "refined material": "crafting_materials",
  "basic material": "crafting_materials",
  "nature": "crafting_materials",
  "special": "weapons",
  "trinket": "misc",
  "blueprint": "misc",
  "misc": "misc",
};

function resolveCategory(type: string): string {
  return CATEGORY_MAP[type.toLowerCase()] || "misc";
}

const HAS_DURABILITY = new Set([
  "weapons", "shields", "augments", "weapon_mods", "quick_use",
]);

const WEAPON_MAX_DURABILITY: Record<string, number> = {
  "I": 100, "II": 110, "III": 120, "IV": 130,
};

const HIDEOUT_ICONS: Record<string, string> = {
  equipment_bench: "wrench",
  gear_bench: "wrench",
  weapon_bench: "swords",
  recycler: "recycle",
  storage: "boxes",
  med_bench: "heart-pulse",
  augment_bench: "cpu",
  shield_bench: "shield",
  garden: "sprout",
  intel_table: "map",
};

// ─── Transform Functions ───

export function transformAccount(acc: AccountResponse): DisplayAccount {
  return {
    displayName: acc.display_name || "?",
    discriminator: acc.display_name_discriminator || "0000",
    provider: acc.provider || "unknown",
    isLinked: acc.is_linked ?? false,
    isTokenExpired: acc.is_token_expired ?? false,
    tokenExpiresAt: acc.token_expires_at || "",
    linkedAt: acc.embark_linked_at || "",
    lastSyncAt: acc.last_sync_at || "",
  };
}

export function transformEconomy(acc: AccountResponse): DisplayEconomy {
  return {
    credits: acc.credits ?? 0,
    cred: acc.cred ?? 0,
    raiderTokens: acc.raider_tokens ?? 0,
    xp: acc.xp ?? 0,
    usedSlots: acc.used_slots ?? 0,
    maxSlots: acc.max_slots ?? 0,
    totalValue: acc.total_value ?? 0,
  };
}

function durabilityBand(dur: number | null | undefined): string {
  if (dur == null) return "";
  if (dur >= 100) return "full";
  if (dur >= 65) return "mid";
  return "low";
}

function stackKey(
  raw: { item_id: string; tier: string | null; durability: number | null; mods: { slot_type: string; mod_id: string }[] },
  isWeapon: boolean,
): string {
  const modsPart = [...raw.mods].sort((a, b) => a.slot_type.localeCompare(b.slot_type) || a.mod_id.localeCompare(b.mod_id))
    .map(m => `${m.slot_type}:${m.mod_id}`).join("|");
  const durPart = isWeapon ? durabilityBand(raw.durability) : String(raw.durability ?? "");
  return `${raw.item_id}__${raw.tier ?? ""}__${durPart}__${modsPart}`;
}

function resolveModRef(modId: string, modsRef: Record<string, ModReference>): ModReference | undefined {
  if (modsRef[modId]) return modsRef[modId];
  const stripped = modId.replace(/_(iv|iii|ii|i)(?=_|$)/, "");
  if (stripped !== modId && modsRef[stripped]) return modsRef[stripped];
  return undefined;
}

function resolveModData(
  mod: { slot_type: string; mod_id: string },
  modsRef: Record<string, ModReference>,
  lang: Lang,
): DisplayItemMod {
  const ref = resolveModRef(mod.mod_id, modsRef);
  return {
    slot_type: mod.slot_type,
    mod_id: mod.mod_id,
    name: ref ? pickName(ref.name_tr, ref.name_en, mod.mod_id.replace(/_/g, " "), lang) : mod.mod_id.replace(/_/g, " "),
    rarity: normalizeRarity(ref?.rarity),
    image: proxyCdnUrl(ref?.image),
  };
}

export function transformInventory(
  data: SyncDataResponse,
  itemsRef: Record<string, ItemReference>,
  modsRef: Record<string, ModReference>,
  lang: Lang
): DisplayItem[] {
  const all = data.inventory.map(raw => {
    const ref = resolveItemRef(raw.item_id, raw.tier, itemsRef);
    const name = pickName(ref?.name_tr, ref?.name_en, raw.item_id.replace(/_/g, " "), lang);
    const rarity = normalizeRarity(ref?.rarity);
    const typeRaw = ref?.type || "";
    const category = resolveCategory(typeRaw);
    const hasDur = HAS_DURABILITY.has(category);
    const isWeapon = category === "weapons";
    const durPercent = hasDur ? (raw.durability ?? undefined) : undefined;
    const tier = raw.tier ?? undefined;

    let d = durPercent;
    let dMax: number | undefined;
    if (isWeapon && durPercent !== undefined && tier) {
      dMax = WEAPON_MAX_DURABILITY[tier] || 100;
      d = Math.round(dMax * durPercent / 100);
    }

    return {
      _stackKey: stackKey(raw, isWeapon),
      _isWeapon: isWeapon,
      _durTotal: d ?? 0,
      _durCount: d != null ? 1 : 0,
      i: raw.id,
      baseId: raw.item_id,
      n: name,
      q: raw.quantity,
      d,
      dMax: isWeapon ? dMax : undefined,
      t: tier,
      r: rarity,
      type: typeRaw.toLowerCase().replace(/\s+/g, "_") || "resource",
      category,
      glyph: makeGlyph(ref?.name_en || raw.item_id),
      subtitle: typeRaw,
      image: proxyCdnUrl(ref?.image),
      mods: raw.mods.map(m => resolveModData(m, modsRef, lang)),
    };
  });

  const stacks = new Map<string, typeof all[number]>();
  for (const item of all) {
    const existing = stacks.get(item._stackKey);
    if (existing) {
      existing.q += item.q;
      if (item._isWeapon && item.d != null) {
        existing._durTotal += item.d;
        existing._durCount += 1;
      }
    } else {
      stacks.set(item._stackKey, { ...item });
    }
  }

  for (const item of stacks.values()) {
    if (item._isWeapon && item._durCount > 1) {
      item.d = Math.round(item._durTotal / item._durCount);
    }
  }

  return [...stacks.values()].map(({ _stackKey, _isWeapon, _durTotal, _durCount, ...item }) => item);
}

export function transformBlueprints(data: SyncDataResponse, lang: Lang): DisplayBlueprint[] {
  return data.blueprints.map(bp => ({
    id: bp.blueprint_id,
    n: pickName(bp.name_tr, bp.name_en, bp.blueprint_id.replace(/_/g, " "), lang),
    learned: bp.learned,
    rarity: normalizeRarity(bp.rarity),
    image: proxyCdnUrl(bp.image),
  }));
}

export function transformQuests(
  data: SyncDataResponse,
  questsRef: Record<string, QuestReference>,
  itemsRef: Record<string, ItemReference>,
  lang: Lang
): DisplayQuest[] {
  const completedIds = new Set(data.quests.map(q => q.quest_id));

  const depths: Record<string, number> = {};
  const roots = Object.keys(questsRef).filter(qId => {
    const prev = questsRef[qId]?.previous_quests || [];
    return prev.length === 0;
  });
  const queue = roots.map(id => ({ id, depth: 0 }));
  const visited = new Set<string>();
  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    depths[id] = depth;
    for (const nxt of questsRef[id]?.next_quests || []) {
      if (!visited.has(nxt)) queue.push({ id: nxt, depth: depth + 1 });
    }
  }

  const quests: DisplayQuest[] = [];

  for (const [qId, ref] of Object.entries(questsRef)) {
    if (!ref.trader) continue;
    const traderKey = resolveTrader(ref.trader);
    const totalObjectives = ref.objectives_tr?.length || ref.objectives_en?.length || 1;
    const isCompleted = completedIds.has(qId);

    quests.push({
      id: qId,
      trader: traderKey,
      traderName: ref.trader,
      map: (ref.map?.[0] || "unknown").replace(/_/g, " "),
      name: pickName(ref.name_tr, ref.name_en, qId, lang),
      objective: pickName(ref.description_tr, ref.description_en, "", lang),
      xp: ref.xp || 0,
      progress: isCompleted ? totalObjectives : 0,
      target: totalObjectives,
      completed: isCompleted,
      reward: (ref.reward_items || []).map(r => ({
        item: pickName(itemsRef[r.itemId]?.name_tr, itemsRef[r.itemId]?.name_en, r.itemId.replace(/_/g, " "), lang),
        qty: r.quantity > 1 ? r.quantity : undefined,
      })),
      prevQuests: ref.previous_quests || [],
      nextQuests: ref.next_quests || [],
      depth: depths[qId] ?? 0,
    });
  }

  return quests.sort((a, b) => a.depth - b.depth);
}

export function transformHideout(
  data: SyncDataResponse,
  hideoutRef: Record<string, HideoutReference>,
  lang: Lang
): DisplayHideoutModule[] {
  const synced = new Map(data.hideout.map(h => [h.module_id, h.level]));

  return Object.entries(hideoutRef).map(([moduleId, ref]) => {
    const level = synced.get(moduleId) ?? 0;
    const maxLevel = ref.max_level || 3;
    return {
      id: moduleId,
      name: pickName(ref.name_tr, ref.name_en, moduleId.replace(/_/g, " "), lang),
      level,
      max: maxLevel,
      icon: HIDEOUT_ICONS[moduleId] || "warehouse",
      locked: level === 0 && !synced.has(moduleId),
    };
  });
}

export function transformProjects(data: SyncDataResponse, lang: Lang): DisplayProject[] {
  return data.projects.map(p => {
    const phases = Array.isArray(p.phases) ? p.phases : [];
    const phaseCount = phases.length || 1;

    let currentPhase = phaseCount;
    const goals: { name: string; have: number; need: number }[] = [];

    if (phases.length > 0) {
      for (let i = 0; i < phases.length; i++) {
        const phase = phases[i] as Record<string, unknown>;
        if (phase && typeof phase === "object") {
          const requirements = (phase.requirementItemIds || phase.requirements || []) as { itemId?: string; quantity?: number; have?: number }[];
          if (requirements.length > 0 && i === 0) {
            for (const req of requirements) {
              goals.push({
                name: (req.itemId || "unknown").replace(/_/g, " "),
                have: req.have ?? 0,
                need: req.quantity ?? 1,
              });
            }
          }
          const allMet = requirements.every(r => (r.have ?? 0) >= (r.quantity ?? 1));
          if (!allMet && currentPhase === phaseCount) {
            currentPhase = i + 1;
          }
        }
      }
    }

    const fallbackGoal = lang === "en"
      ? { name: "Waiting for data", have: 0, need: 1 }
      : { name: "Veri bekleniyor", have: 0, need: 1 };

    return {
      id: p.embark_project_id,
      name: p.project_name.replace(/_/g, " "),
      description: "",
      phase: Math.min(currentPhase, phaseCount),
      phaseCount,
      goals: goals.length > 0 ? goals : [fallbackGoal],
    };
  });
}

export function transformLoadout(
  rawLoadout: Record<string, unknown> | null,
  itemsRef: Record<string, ItemReference>,
  modsRef: Record<string, ModReference>,
  lang: Lang,
): DisplayLoadout | null {
  if (!rawLoadout) return null;

  function resolveSlotItem(raw: unknown, slotKey: string): DisplayLoadoutSlot | null {
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;
    const itemId = ((r.itemId || r.i) as string | undefined);
    if (!itemId) return null;

    const ref = resolveItemRef(itemId, null, itemsRef);
    const name = pickName(ref?.name_tr, ref?.name_en, itemId.replace(/_/g, " "), lang);
    const rarity = normalizeRarity(ref?.rarity);
    const qty = (((r.quantity ?? r.q ?? 1) as number) || 1);
    const durPercent = (r.durabilityPercent ?? r.d) as number | null | undefined;

    const tierMatch = itemId.match(/_(iv|iii|ii|i)$/i);
    const tier = tierMatch ? tierMatch[1].toUpperCase() : undefined;

    let durability: number | undefined;
    let durMax: number | undefined;
    if (durPercent != null) {
      if (tier) {
        durMax = WEAPON_MAX_DURABILITY[tier] || 100;
        durability = Math.round(durMax * (durPercent / 100));
      } else {
        durability = Math.round(durPercent as number);
      }
    }

    const attachmentsRaw = ((r.attachments ?? r.a ?? []) as unknown[]);
    const mods: DisplayItemMod[] = attachmentsRaw
      .map(att => {
        if (!att || typeof att !== "object") return null;
        const a = att as Record<string, unknown>;
        const modId = ((a.itemId ?? a.i) as string | undefined);
        if (!modId) return null;
        const modRef = resolveModRef(modId, modsRef);
        return {
          slot_type: String(a.slot ?? a.s ?? "barrel"),
          mod_id: modId,
          name: modRef
            ? pickName(modRef.name_tr, modRef.name_en, modId.replace(/_/g, " "), lang)
            : modId.replace(/_/g, " "),
          rarity: normalizeRarity(modRef?.rarity),
          image: proxyCdnUrl(modRef?.image),
        } as DisplayItemMod;
      })
      .filter((m): m is DisplayItemMod => m !== null);

    return {
      slotKey,
      itemId,
      name,
      rarity,
      image: proxyCdnUrl(ref?.image),
      glyph: makeGlyph(ref?.name_en || itemId),
      tier,
      durability,
      durMax,
      quantity: qty,
      mods,
    };
  }

  function resolveList(arr: unknown[], listKey: string): DisplayLoadoutSlot[] {
    if (!Array.isArray(arr)) return [];
    const result: DisplayLoadoutSlot[] = [];
    for (const item of arr) {
      if (!item || typeof item !== "object") continue;
      const slot = resolveSlotItem(item as Record<string, unknown>, listKey);
      if (slot) result.push(slot);
    }
    return result;
  }

  return {
    weapon1: resolveSlotItem(rawLoadout.weapon1, "weapon1") ?? undefined,
    weapon2: resolveSlotItem(rawLoadout.weapon2, "weapon2") ?? undefined,
    augment: resolveSlotItem(rawLoadout.augment, "augment") ?? undefined,
    shield: resolveSlotItem(rawLoadout.shield, "shield") ?? undefined,
    augmentedSlots: resolveList((rawLoadout.augmentedSlots ?? []) as unknown[], "augmentedSlots"),
    backpack: resolveList((rawLoadout.backpack ?? []) as unknown[], "backpack"),
    quickItems: resolveList((rawLoadout.quickItems ?? []) as unknown[], "quickItems"),
    safePocket: resolveList((rawLoadout.safePocket ?? []) as unknown[], "safePocket"),
  };
}

export function transformSyncSummary(data: SyncDataResponse): DisplaySyncSummary {
  return {
    syncedItems: data.inventory.length,
    syncedBlueprints: data.blueprints.filter(b => b.learned).length,
    syncedQuests: data.quests.length,
    syncedHideout: data.hideout.length,
    syncedProjects: data.projects.length,
    unmappedCount: 0,
  };
}

export function buildDashboardData(
  account: AccountResponse,
  syncData: SyncDataResponse,
  itemsRef: Record<string, ItemReference>,
  questsRef: Record<string, QuestReference>,
  hideoutRef: Record<string, HideoutReference>,
  modsRef: Record<string, ModReference>,
  lang: Lang,
): DashboardData {
  return {
    account: transformAccount(account),
    economy: transformEconomy(account),
    syncSummary: transformSyncSummary(syncData),
    inventory: transformInventory(syncData, itemsRef, modsRef, lang),
    quests: transformQuests(syncData, questsRef, itemsRef, lang),
    blueprints: transformBlueprints(syncData, lang),
    hideoutModules: transformHideout(syncData, hideoutRef, lang),
    projects: transformProjects(syncData, lang),
    loadout: transformLoadout(syncData.loadout, itemsRef, modsRef, lang),
  };
}

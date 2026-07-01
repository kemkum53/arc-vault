// ─── API Response Types ───

export interface AccountResponse {
  id: string;
  display_name: string | null;
  display_name_discriminator: string | null;
  embark_user_id: string | null;
  embark_account_id: string | null;
  provider: string | null;
  is_linked: boolean | null;
  is_token_expired: boolean | null;
  token_expires_at: string | null;
  embark_linked_at: string | null;
  credits: number | null;
  cred: number | null;
  raider_tokens: number | null;
  xp: number | null;
  used_slots: number | null;
  max_slots: number | null;
  total_value: number | null;
  profile_data: Record<string, unknown> | null;
  last_sync_at: string | null;
  sync_status: string | null;
  xbox_email: string | null;
  has_xbox_credentials: boolean;
  created_at: string;
}

export interface InventoryItemMod {
  slot_type: string;
  mod_id: string;
}

export interface ModReference {
  name_en: string;
  name_tr: string;
  rarity: string;
  type: string;
  value: number;
  weight: number;
  stack_size: number;
  image: string;
}

export interface InventoryItemRaw {
  id: string;
  item_id: string;
  quantity: number;
  tier: string | null;
  durability: number | null;
  mods: InventoryItemMod[];
}

export interface BlueprintRaw {
  blueprint_id: string;
  learned: boolean;
  name_tr: string | null;
  name_en: string | null;
  rarity: string | null;
  image: string | null;
}

export interface QuestRaw {
  quest_id: string;
}

export interface HideoutModuleRaw {
  module_id: string;
  level: number;
}

export interface ProjectRaw {
  embark_project_id: string;
  project_name: string;
  phases: Record<string, unknown> | unknown[];
}

export interface SyncDataResponse {
  credits: number | null;
  last_sync_at: string | null;
  inventory: InventoryItemRaw[];
  blueprints: BlueprintRaw[];
  quests: QuestRaw[];
  hideout: HideoutModuleRaw[];
  projects: ProjectRaw[];
  loadout: Record<string, unknown> | null;
}

export interface SyncResponse {
  ok: boolean;
  synced_items: number;
  synced_blueprints: number;
  synced_quests: number;
  synced_hideout: number;
  synced_projects: number;
  unmapped_count: number;
  credits: number | null;
  source: string;
  message: string | null;
}

// ─── Reference Data Types ───

export interface ItemReference {
  name_en: string;
  name_tr: string;
  rarity: string;
  type: string;
  value: number;
  weight: number;
  stack_size: number;
  image: string;
}

export interface QuestReference {
  name_en: string;
  name_tr: string;
  description_en: string;
  description_tr: string;
  objectives_en: string[];
  objectives_tr: string[];
  trader: string;
  map: string[];
  xp: number;
  required_items: { itemId: string; quantity: number }[];
  reward_items: { itemId: string; quantity: number }[];
  granted_items: { itemId: string; quantity: number }[];
  previous_quests: string[];
  next_quests: string[];
}

export interface HideoutReference {
  name_en: string;
  name_tr: string;
  max_level: number;
  levels: {
    level: number;
    requirementItemIds: { itemId: string; quantity: number }[];
  }[];
}

// ─── Display Types (Frontend) ───

export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";
export type TraderKey = "shani" | "celeste" | "apollo" | "lance" | "tian";

export interface DisplayItemMod {
  slot_type: string;
  mod_id: string;
  name: string;
  rarity: Rarity;
  image?: string;
}

export interface DisplayItem {
  i: string;
  baseId: string;
  n: string;
  q: number;
  d?: number;
  dMax?: number;
  t?: string;
  r: Rarity;
  type: string;
  category: string;
  glyph: string;
  subtitle: string;
  image?: string;
  mods: DisplayItemMod[];
}

export interface DisplayQuest {
  id: string;
  trader: TraderKey;
  traderName: string;
  map: string;
  name: string;
  objective: string;
  xp: number;
  progress: number;
  target: number;
  completed: boolean;
  reward: { item: string; qty?: number }[];
  prevQuests: string[];
  nextQuests: string[];
  depth: number;
}

export interface DisplayBlueprint {
  id: string;
  n: string;
  learned: boolean;
  rarity: Rarity;
  image?: string;
}

export interface DisplayHideoutModule {
  id: string;
  name: string;
  level: number;
  max: number;
  icon: string;
  locked?: boolean;
  upgrading?: boolean;
  eta?: string;
}

export interface DisplayProject {
  id: string;
  name: string;
  description: string;
  phase: number;
  phaseCount: number;
  goals: { name: string; have: number; need: number }[];
}

export interface DisplayAccount {
  displayName: string;
  discriminator: string;
  provider: string;
  isLinked: boolean;
  isTokenExpired: boolean;
  tokenExpiresAt: string;
  linkedAt: string;
  lastSyncAt: string;
}

export interface DisplayEconomy {
  credits: number;
  cred: number;
  raiderTokens: number;
  xp: number;
  usedSlots: number;
  maxSlots: number;
  totalValue: number;
}

export interface DisplaySyncSummary {
  syncedItems: number;
  syncedBlueprints: number;
  syncedQuests: number;
  syncedHideout: number;
  syncedProjects: number;
  unmappedCount: number;
}

export interface DisplayLoadoutSlot {
  slotKey: string;
  itemId: string;
  name: string;
  rarity: Rarity;
  image?: string;
  glyph: string;
  tier?: string;
  durability?: number;
  durMax?: number;
  quantity: number;
  mods: DisplayItemMod[];
}

export interface DisplayLoadout {
  weapon1?: DisplayLoadoutSlot;
  weapon2?: DisplayLoadoutSlot;
  augment?: DisplayLoadoutSlot;
  shield?: DisplayLoadoutSlot;
  augmentedSlots: DisplayLoadoutSlot[];
  backpack: DisplayLoadoutSlot[];
  quickItems: DisplayLoadoutSlot[];
  safePocket: DisplayLoadoutSlot[];
}

// ─── Workshop Types ───

export interface WorkshopItem {
  item_id: string;
  name: string;
  required_per_account: number;
  required_total: number;
  have: number;
  need: number;
  complete: boolean;
}

export interface WorkshopLevel {
  complete: boolean;
  items: WorkshopItem[];
}

export interface WorkshopEntry {
  levels: Record<string, WorkshopLevel>;
}

export interface WorkshopAccountInfo {
  id: string;
  display_name: string | null;
  discriminator: string | null;
  inventory: Record<string, number>;
}

export interface WorkshopProgressResponse {
  account_count: number;
  accounts: WorkshopAccountInfo[];
  aggregate: Record<string, number>;
  workshops: Record<string, WorkshopEntry>;
}

// ─── Expedition Types ───

export interface ExpeditionItem {
  item_id: string;
  name: string;
  required_per_account: number;
  // have is computed frontend-side from selected account's inventory
}

export interface ExpeditionSupplyCat {
  name: string;
  required_per_run: number;
}

export interface ExpeditionPhase {
  name: string;
  type?: "supply";
  items?: ExpeditionItem[];
  supply?: Record<string, ExpeditionSupplyCat>;
}

export interface ExpeditionEntry {
  key: string;
  phases: Record<string, ExpeditionPhase>;
}

export interface ItemInfo {
  name: string;
  value: number;
  category: string | null;
}

export interface ExpeditionProgressResponse {
  accounts: WorkshopAccountInfo[];
  item_info: Record<string, ItemInfo>;
  expeditions: Record<string, ExpeditionEntry>;
}

export interface DashboardData {
  account: DisplayAccount;
  economy: DisplayEconomy;
  syncSummary: DisplaySyncSummary;
  inventory: DisplayItem[];
  quests: DisplayQuest[];
  blueprints: DisplayBlueprint[];
  hideoutModules: DisplayHideoutModule[];
  projects: DisplayProject[];
  loadout: DisplayLoadout | null;
}

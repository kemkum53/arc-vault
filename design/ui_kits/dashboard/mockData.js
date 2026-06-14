// ARC Vault — mock data shaped like the real arctracker API.
// Source: api/app/data/*.json + docs/ARCTRACKER_API.md
// All ids/names taken from GAME_DATA_REFERENCE.md (real ARC Raiders items).

window.MOCK = {
  account: {
    displayName: "Kemkum",
    discriminator: "2811",
    provider: "xbox",
    isLinked: true,
    isTokenExpired: false,
    tokenExpiresAt: "2026-05-20T13:07:17Z",
    linkedAt: "2026-05-17T23:20:25Z",
    lastSyncAt: "2026-05-20T12:54:11Z",
  },

  economy: {
    credits: 172511,
    cred: 787,
    raiderTokens: 620,
    xp: 2427210,
    usedSlots: 302,
    maxSlots: 304,
    totalValue: 1675296,
  },

  syncSummary: {
    syncedItems: 302,
    syncedBlueprints: 12,
    syncedQuests: 8,
    syncedHideout: 7,
    syncedProjects: 2,
    unmappedCount: 3,
  },

  // Recent inventory — rarity tiers via `r`, mirrors compact API
  // i = id, n = display name, q = qty, d = durability%, t = tier (I-IV), r = rarity
  inventory: [
    { i: "anvil_iv",        n: "Anvil",         q: 1, d: 55, t: "IV",  r: "legendary", type: "weapon", glyph: "AN", subtitle: "Marksman Rifle" },
    { i: "ak74_ii",         n: "AK-74",         q: 1, d: 87, t: "II",  r: "epic",      type: "weapon", glyph: "AK", subtitle: "Assault" },
    { i: "bobcat_iii",      n: "Bobcat",        q: 1, d: 92, t: "III", r: "rare",      type: "weapon", glyph: "BC", subtitle: "Shotgun" },
    { i: "longshot_ii",     n: "Longshot",      q: 1, d: 65, t: "II",  r: "rare",      type: "weapon", glyph: "LS", subtitle: "Sniper" },
    { i: "scrapper_i",      n: "Scrapper",      q: 1, d: 30, t: "I",   r: "uncommon",  type: "weapon", glyph: "SC", subtitle: "SMG" },
    { i: "bandage",         n: "Bandage",       q: 12,           r: "common",    type: "consumable", glyph: "BD", subtitle: "Heal" },
    { i: "med_kit",         n: "Med Kit",       q: 4,            r: "uncommon",  type: "consumable", glyph: "MK", subtitle: "Heal" },
    { i: "shield_charge",   n: "Shield Charge", q: 7,            r: "rare",      type: "consumable", glyph: "SH", subtitle: "Shield" },
    { i: "circuit_board",   n: "Circuit Board", q: 18,           r: "uncommon",  type: "resource", glyph: "CB", subtitle: "Component" },
    { i: "tungsten",        n: "Tungsten",      q: 23,           r: "rare",      type: "resource", glyph: "TG", subtitle: "Metal" },
    { i: "polymer",         n: "Polymer",       q: 41,           r: "common",    type: "resource", glyph: "PL", subtitle: "Material" },
    { i: "fiber_optic",     n: "Fiber Optic",   q: 9,            r: "epic",      type: "resource", glyph: "FO", subtitle: "Rare component" },
    { i: "blueprint_anvil", n: "BP: Anvil",     q: 1,            r: "legendary", type: "blueprint", glyph: "AN", subtitle: "Learned" },
    { i: "key_storm",       n: "Storm Key",     q: 2,            r: "epic",      type: "key", glyph: "SK", subtitle: "Stella Montis" },
    { i: "stim",            n: "Combat Stim",   q: 5,            r: "rare",      type: "consumable", glyph: "ST", subtitle: "Adrenaline" },
    { i: "battery_aa",      n: "Battery AA",    q: 33,           r: "common",    type: "resource", glyph: "BT", subtitle: "Power cell" },
    { i: "rusted_iron",     n: "Rusted Iron",   q: 64,           r: "common",    type: "resource", glyph: "RI", subtitle: "Salvage" },
    { i: "neuro_chip",      n: "Neuro Chip",    q: 2,            r: "legendary", type: "resource", glyph: "NC", subtitle: "Quest item" },
  ],

  quests: [
    {
      id: "ss10o", trader: "shani", traderName: "Shani", map: "the_blue_gate",
      name: "Söndürülmüş Sinyal",
      objective: "Mavi Kapı'da 3 adet Sinyal Vericisi'ni etkisiz hale getir.",
      xp: 4800, progress: 2, target: 3,
      reward: [{ item: "Med Kit", qty: 3 }, { item: "5,000 Credits" }],
    },
    {
      id: "shoring_up_defenses", trader: "celeste", traderName: "Celeste", map: "stella_montis",
      name: "Shoring Up Defenses",
      objective: "20x Shield Charge teslim et + Augment Bench Lv2 inşa et.",
      xp: 7200, progress: 1, target: 2,
      reward: [{ item: "BP: Shield Mod" }, { item: "10,000 Credits" }],
    },
    {
      id: "apollo_001", trader: "apollo", traderName: "Apollo", map: "the_blue_gate",
      name: "Para mı Kan mı?",
      objective: "Tek raidde 50,000 değerinde loot çıkar.",
      xp: 6000, progress: 32450, target: 50000,
      reward: [{ item: "Raider Tokens × 120" }],
    },
    {
      id: "lance_003", trader: "lance", traderName: "Lance", map: "stella_montis",
      name: "Quiet Steps",
      objective: "Stella Montis'te 5 düşmanı tespit edilmeden geç.",
      xp: 5400, progress: 5, target: 5, completed: true,
      reward: [{ item: "BP: Stealth Plating" }],
    },
    {
      id: "tian_004", trader: "tian", traderName: "Tian Wen", map: "the_blue_gate",
      name: "Hasat Vakti",
      objective: "Garden'da 4 farklı bitki yetiştir + 12 Tungsten teslim et.",
      xp: 5100, progress: 0, target: 2,
      reward: [{ item: "8,000 Credits" }, { item: "Augment × 2" }],
    },
  ],

  hideoutModules: [
    { id: "equipment_bench", name: "Equipment Bench", level: 2, max: 3, icon: "wrench" },
    { id: "weapon_bench",    name: "Weapon Bench",    level: 3, max: 3, icon: "swords" },
    { id: "recycler",        name: "Recycler",        level: 1, max: 3, icon: "recycle" },
    { id: "storage",         name: "Storage",         level: 2, max: 3, icon: "boxes" },
    { id: "med_bench",       name: "Med Bench",       level: 1, max: 3, icon: "heart-pulse", upgrading: true, eta: "2d 14h" },
    { id: "augment_bench",   name: "Augment Bench",   level: 0, max: 3, icon: "cpu", locked: true },
    { id: "shield_bench",    name: "Shield Bench",    level: 2, max: 3, icon: "shield" },
    { id: "garden",          name: "Garden",          level: 1, max: 3, icon: "sprout" },
    { id: "intel_table",     name: "Intel Table",     level: 0, max: 3, icon: "map", locked: true },
  ],

  projects: [
    {
      id: "trophy_display",
      name: "Trophy Display",
      description: "Hideout duvarına raidlerden topladığın trofeleri yerleştir.",
      phase: 2, phaseCount: 3,
      goals: [
        { name: "Tungsten",   have: 14, need: 20 },
        { name: "Fiber Optic", have: 9,  need: 12 },
        { name: "Neuro Chip", have: 1,  need: 4 },
      ],
    },
    {
      id: "augment_research",
      name: "Augment Research",
      description: "Augment Bench için araştırma fazını tamamla.",
      phase: 1, phaseCount: 4,
      goals: [
        { name: "Circuit Board", have: 18, need: 30 },
        { name: "Battery AA",    have: 33, need: 50 },
        { name: "Raids ran",     have: 7,  need: 24 },
      ],
    },
  ],
};

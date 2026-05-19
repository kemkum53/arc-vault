# Arctracker.io API Dokümantasyonu

> Bu dosya arctracker.io'nun public ve authenticated API endpoint'lerini belgelemektedir.
> Son güncelleme: 2026-05-19

## Kimlik Doğrulama

```
POST https://arctracker.io/api/auth/sign-in/email
Content-Type: application/json

{ "email": "...", "password": "..." }
```

Yanıt `Set-Cookie` header'ı ile `better-auth.session_token` döndürür. Bu cookie tüm authenticated endpoint'lerde `Cookie` header'ı olarak gönderilmelidir.

---

## Public API Endpoint'leri (Auth gerekli ama Embark bağlantısı gerekmez)

### GET /api/items
Tüm oyun item'larını döndürür.

**Yanıt:**
```json
{
  "version": "1779205909241",
  "generatedAt": "2026-05-19T15:51:49.241Z",
  "items": [ ... ],
  "itemCount": 565
}
```

**Item alanları:**
| Alan | Tip | Açıklama |
|------|-----|----------|
| `id` | string | Benzersiz slug (ör: `anvil_iii`) |
| `name` | object | 21 dilde isim (`tr`, `en`, `de`, ...) |
| `description` | object | 21 dilde açıklama |
| `type` | string | `"Weapon"`, `"Resource"`, `"Consumable"`, `"Equipment"`, `"Mod"`, `"Blueprint"`, `"Key"`, `"Ammo"` vb. |
| `rarity` | string | `"Common"`, `"Uncommon"`, `"Rare"`, `"Epic"`, `"Legendary"` |
| `value` | int | Satış değeri (credits) |
| `weightKg` | float | Ağırlık (kg) |
| `stackSize` | int | Maksimum yığın boyutu |
| `durability` | int | Maksimum dayanıklılık |
| `imageFilename` | string | CDN görsel adı |
| `isWeapon` | bool | Silah mı? |
| `modSlots` | array | Silah mod slot'ları |
| `damage` | int | Hasar |
| `fireRate` | int | Ateş hızı |
| `range` | int | Menzil |
| `stability` | int | Stabilite |
| `agility` | int | Çeviklik |
| `stealth` | int | Gizlilik |
| `damageMitigation` | int | Hasar azaltma (shield) |
| `shieldCharge` | int | Shield şarjı |
| `movementSpeedModifier` | float | Hareket hızı etkisi |
| `recipe` | array | Craft tarifi `[{ itemId, quantity }]` |
| `craftBench` | string | Craft tezgahı (ör: `weapon_bench`) |
| `craftQuantity` | int | Craft sonucu miktar |
| `stationLevelRequired` | int | Gerekli tezgah seviyesi |
| `repairCost` | array | Tamir maliyeti |
| `repairMaterials` | array | Tamir malzemeleri |
| `repairDurability` | int | Tamir ile geri kazanılan dayanıklılık |
| `recyclesInto` | array | Geri dönüşüm çıktıları |
| `salvagesInto` | array | Parçalama çıktıları |
| `upgradesTo` | string | Yükseltme hedef item'ı |
| `upgradeCost` | array | Yükseltme maliyeti |
| `blueprintLocked` | bool | Blueprint gerekli mi? |
| `questItem` | bool | Quest item'ı mı? |
| `foundIn` | array | Bulunabilecek yerler |
| `vendors` | array | Satıcı bilgileri |
| `compatibleWith` | array | Uyumlu silahlar (mod'lar için) |
| `effects` | array | Mod etkileri |
| `addedIn` | string | Hangi güncelleme ile eklendi |
| `updatedAt` | string | Son güncelleme tarihi |

**Görsel CDN:** `https://cdn.arctracker.io/items/v2/{id}.png`

---

### GET /api/quests
Tüm quest'leri döndürür.

**Yanıt:**
```json
{
  "version": "...",
  "generatedAt": "...",
  "lastUpdated": "...",
  "quests": { "quest_id": { ... }, ... },
  "totalQuests": 100
}
```

**Quest alanları:**
| Alan | Tip | Açıklama |
|------|-----|----------|
| `id` | string | Benzersiz quest ID |
| `name` | object | 21 dilde isim |
| `description` | object | 21 dilde açıklama |
| `objectives` | array[object] | Görev hedefleri (21 dilde) |
| `trader` | string | `"Shani"`, `"Celeste"`, `"Apollo"`, `"Lance"`, `"Tian Wen"` |
| `map` | array | Harita(lar): `"the_blue_gate"`, `"stella_montis"` |
| `xp` | int | XP ödülü |
| `requiredItemIds` | array | Gerekli item'lar `[{ itemId, quantity }]` |
| `rewardItemIds` | array | Ödül item'ları `[{ itemId, quantity }]` |
| `grantedItemIds` | array | Verilen item'lar (quest başlangıcında) |
| `previousQuestIds` | array | Önceki quest'ler (zincir) |
| `nextQuestIds` | array | Sonraki quest'ler (zincir) |
| `otherRequirements` | array | Ek gereksinimler (ör: `"24x Raids"`) |
| `objectivesOneRound` | bool | Tek seferde tamamlanmalı mı? |
| `videoUrl` | string | Quest rehber videosu |
| `slug` | string | URL-friendly slug |
| `updatedAt` | string | Son güncelleme tarihi |

---

### GET /api/hideout
Hideout modül bilgilerini döndürür.

**Yanıt:**
```json
{
  "version": "...",
  "hideoutModules": { "module_id": { ... }, ... },
  "totalModules": 9
}
```

**Modül alanları:**
| Alan | Tip | Açıklama |
|------|-----|----------|
| `id` | string | Modül ID (ör: `equipment_bench`) |
| `name` | object | 21 dilde isim |
| `maxLevel` | int | Maksimum seviye |
| `levels` | array | Seviye detayları |

Her seviye: `{ level: int, requirementItemIds: [{ itemId, quantity }] }`

**Modüller:** `equipment_bench`, `weapon_bench`, `recycler`, `storage`, `med_bench`, `augment_bench`, `shield_bench`, `garden`, `intel_table`

---

### GET /api/projects
Proje bilgilerini döndürür.

**Yanıt:**
```json
{
  "version": "...",
  "projects": { "project_id": { ... }, ... },
  "totalProjects": 6
}
```

**Proje alanları:**
| Alan | Tip | Açıklama |
|------|-----|----------|
| `id` | string | Proje ID |
| `name` | object | 21 dilde isim |
| `description` | object | 21 dilde açıklama |
| `disabled` | bool | Devre dışı mı? |
| `startDate` | string | Başlangıç tarihi |
| `endDate` | string | Bitiş tarihi |
| `phases` | array | Proje fazları |

---

## Embark Sync Endpoint'leri (Embark hesap bağlantısı gerekli)

### GET /api/embark/status
Embark hesap durumunu döndürür.

```json
{
  "isLinked": true,
  "embarkUserId": "4159475767003566701",
  "provider": "xbox",
  "displayName": "Kemkum",
  "displayNameDiscriminator": "2811",
  "embarkAccountId": "1341072600719930000",
  "isTokenExpired": false,
  "tokenExpiresAt": "2026-05-20T13:07:17.000Z",
  "linkedAt": "2026-05-17T23:20:25.001Z",
  "updatedAt": "2026-05-19T13:07:23.938Z"
}
```

### GET /api/embark/inventory/latest
Son envanter snapshot'ını döndürür.

```json
{
  "snapshot": {
    "items": [
      { "i": "anvil_iv", "q": 1, "d": 55.5, "s": 1, "p": "...", "a": [...] },
      { "i": "bandage", "q": 4, "d": 100, "s": 0, "p": "..." }
    ],
    "credits": 172511,
    "cred": 787,
    "raiderTokens": 620,
    "xp": 2427210,
    "usedSlots": 302,
    "maxSlots": 304,
    "totalValue": 1675296,
    "loadout": { ... }
  }
}
```

**Item compact format:**
| Alan | Açıklama |
|------|----------|
| `i` | Item slug |
| `q` | Miktar |
| `d` | Dayanıklılık (%) |
| `s` | Slot index |
| `p` | Unique item ID |
| `a` | Attachment'lar (silahlar için) |

### POST /api/embark/sync/blueprints
```json
{
  "current": { ... },
  "embark": { "anvil_blueprint": true, "bobcat_blueprint": true, ... },
  "diff": [ ... ]
}
```
`embark` dict'inde key = blueprint_id, value = `true` (öğrenilmiş). Sadece öğrenilmiş olanlar listelenir.

### POST /api/embark/sync/quests
```json
{
  "current": { ... },
  "embark": { "ss10o": true, "shoring_up_defenses": false, ... },
  "diff": [ { "id": "...", "action": "complete" }, ... ]
}
```
`embark` dict'inde key = quest_id, value = `true/false` (tamamlandı/tamamlanmadı).

### POST /api/embark/sync/hideout
```json
{
  "current": { ... },
  "embark": { "equipment_bench": 3, "weapon_bench": 2, ... },
  "diff": [ ... ]
}
```
`embark` dict'inde key = module_id, value = seviye (int).

### POST /api/embark/sync/projects
```json
{
  "projects": [
    {
      "embarkProjectId": "...",
      "projectName": "Trophy Display",
      "phases": [ ... ]
    }
  ]
}
```

---

## Embark OAuth Token Yenileme

Token süresi dolduğunda (`isTokenExpired: true`), Xbox OAuth PKCE akışı ile yenilenmesi gerekir.

### Akış:
1. `GET /api/embark/auth-url` → Xbox OAuth URL'i döndürür
2. Kullanıcı Xbox'a giriş yapar
3. Callback `http://127.0.0.1:49172?code=...&state=...` adresine yönlendirilir
4. Browser extension callback'i yakalar
5. `POST /api/embark/callback` body: `{ code, state }` → Token yenilenir

---

## Versiyon ve Güncelleme

Tüm API yanıtlarında `version` ve `generatedAt` alanları bulunur. Bu alanlar arctracker.io'nun veritabanının son güncellenme zamanını gösterir. Veri güncellemesi için bu sürümleri karşılaştırabilirsiniz.

**Mevcut versiyonlar (2026-05-19):**
- Items: 565 item
- Quests: 100 quest
- Hideout: 9 modül
- Projects: 6 proje

## Desteklenen Diller (21)
`da`, `de`, `en`, `es`, `fr`, `he`, `hr`, `it`, `ja`, `ko-KR`, `no`, `pl`, `pt`, `pt-BR`, `ru`, `sr`, `tr`, `uk`, `zh-CN`, `zh-TW`

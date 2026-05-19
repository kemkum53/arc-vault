# arctracker.io Veri Çekme ve Kaydetme

## Genel Akış

```
Kullanıcı email+şifre girer
    → arctracker.io'ya giriş yapılır (session cookie alınır)
    → 5 endpoint paralel çağrılır
    → Veriler işlenir / ID'lere eşlenir
    → Veritabanına yazılır
```

---

## 1. Kimlik Doğrulama

**Endpoint:** `POST https://arctracker.io/api/auth/sign-in/email`

**İstek gövdesi:**
```json
{ "email": "kullanici@ornek.com", "password": "sifre" }
```

**Yanıt:** Session cookie veya token döner.

- Önce `Set-Cookie` header'ından cookie çekilmeye çalışılır.
- Node.js ortamında `headers.getSetCookie()` çalışıyorsa tüm cookie'ler alınır; yoksa `get("set-cookie")` ile tek cookie alınır.
- Cookie yoksa body'den `{ token }` aranır ve `better-auth.session_token=<token>` şeklinde cookie string'ine dönüştürülür.
- Sonraki tüm isteklerde `Cookie: <session>` header'ı ile gönderilir.

---

## 2. Veri Çekme Endpoint'leri

Tüm endpoint'ler `POST` ile çağrılır ve `Cookie: <session>` header'ı taşır. Hepsi paralel olarak çalıştırılır (`Promise.all`).

### 2a. Envanter

```
POST /api/embark/sync/inventory
```

Başarısız olursa fallback:
```
GET /api/embark/inventory/latest
```
401/403 → Embark bağlantısı süresi dolmuş, kullanıcının arctracker.io'da "Refresh Account" yapması gerekir.

**Yanıt formatı — Compact (kısa):**
```json
{
  "snapshot": {
    "items": [
      { "i": "ak74", "q": 1, "d": 95.5 }
    ],
    "credits": 12500
  }
}
```
- `i` → item slug
- `q` → miktar
- `d` → durability yüzdesi (opsiyonel)

**Yanıt formatı — Rich (detaylı, silahlar için):**
```json
{
  "snapshot": {
    "items": [
      {
        "itemId": "ak74_ii",
        "quantity": 1,
        "durabilityPercent": 87.3,
        "attachments": [
          { "itemId": "compensator", "slotIndex": 0 }
        ]
      }
    ]
  }
}
```
- `attachments` → silaha takılı modlar; `itemId` burada mod slug'ıdır

### 2b. Blueprintler

```
POST /api/embark/sync/blueprints
```

**Yanıt formatı:**
```json
{
  "embark": {
    "blueprint_ak74": true,
    "blueprint_shotgun": false,
    "blueprint_medkit": true
  }
}
```
`true` olan ID'ler öğrenilmiş blueprint'ler. `false` olanlar yoksayılır.  
Sadece kendi `ALL_BLUEPRINTS` verisinde bulunan ID'ler kabul edilir.

### 2c. Questler

```
POST /api/embark/sync/quests
```

**Yanıt formatı:**
```json
{
  "embark": {
    "quest_apollo_001": true,
    "quest_celeste_003": false,
    "quest_shani_002": true
  }
}
```
`true` olan ID'ler tamamlanmış questler.

### 2d. Hideout

```
POST /api/embark/sync/hideout
```

**Yanıt formatı:**
```json
{
  "embark": {
    "workbench": 2,
    "med_station": 1,
    "stash": 3,
    "weapon_bench": 0
  }
}
```
Değer `> 0` olan modüller alınır; `0` olanlar yoksayılır.

### 2e. Projeler

```
POST /api/embark/sync/projects
```

**Yanıt formatı:**
```json
{
  "projects": [
    {
      "embarkProjectId": "proj_001",
      "projectName": "Survivor Kit",
      "phases": [
        {
          "phaseKey": "phase_1",
          "phaseNumber": 1,
          "phaseName": "Aşama 1",
          "currentComplete": true,
          "action": "unchanged",
          "goals": [
            {
              "uniqueKey": "goal_1",
              "itemId": "medkit",
              "itemName": "Med Kit",
              "required": 5,
              "currentCount": 5,
              "embarkCount": 5
            }
          ],
          "categoryGoals": [
            {
              "uniqueKey": "catgoal_1",
              "category": "Weapons",
              "valueRequired": 3,
              "currentValue": 3,
              "embarkValue": 3
            }
          ]
        }
      ]
    }
  ]
}
```

---

## 3. ID Eşleme

arctracker.io kendi slug formatını kullanır; bunların bizim `itemId`'lerimize çevrilmesi gerekir.

### Item slug → itemId

1. Item adı normalize edilir: küçük harf, noktalama kaldırılır, boşluk → `_`
2. Tier suffix'i ayrıştırılır: `_i` → `"I"`, `_ii` → `"II"`, `_iii` → `"III"`, `_iv` → `"IV"`
3. `arcNameLookup` map'inde 3 farklı varyasyonla aranır:
   - Ham slug
   - Rakam öncesi alt çizgi kaldırılmış (`ak_47` → `ak47`)
   - Tüm alt çizgiler kaldırılmış (`ak_74` → `ak74`)
4. Eşleşme bulunamazsa `unmapped` listesine eklenir, satır atlanır.

### Mod slug → modId

1. Mod adı normalize edilir: küçük harf, nokta kaldırılır, boşluk → `_`
2. `modSlugToId` map'inde aranır.
3. Bulunursa `modIdToSlot` map'inden silah slot tipi (`Muzzle`, `Magazine` vb.) alınır.

### Silah tanımlama

`itemId` `"w-"` prefix'i ile başlıyorsa silahtır.  
Silahlar: her instance ayrı satır tutulur (birleştirilmez), `attachments` işlenir.  
Diğer itemler: aynı `itemId + tier` grubu toplanır, miktarlar birleştirilir.

---

## 4. Veritabanına Yazma

Tüm yazma işlemleri **önce sil, sonra yaz** stratejisiyle çalışır.

### Envanter (`InventoryItem`)

```
DELETE InventoryItem WHERE characterId = ?
```

Modu olmayan itemler → `createMany` (toplu)  
Modu olan silahlar → her biri tek tek `create` + nested `mods: { create: [...] }`

```prisma
model InventoryItem {
  id         String
  itemId     String
  quantity   Int
  tier       String?    // "I" | "II" | "III" | "IV"
  durability Int?       // tam sayı (Math.round(durabilityPercent))
  mods       InventoryItemMod[]
}

model InventoryItemMod {
  slotType  String   // "Muzzle" | "Magazine" | "Stock" vb.
  modId     String
}
```

### Blueprintler (`LearnedBlueprint`)

```
DELETE LearnedBlueprint WHERE characterId = ?
createMany blueprintIds[]
```

### Questler (`CharacterQuest`)

```
DELETE CharacterQuest WHERE characterId = ?
createMany questIds[]
```

### Hideout (`HideoutModule`)

```
DELETE HideoutModule WHERE characterId = ?
createMany [{ moduleId, level }]
```

### Projeler (`CharacterProject`)

```
DELETE CharacterProject WHERE characterId = ?
createMany [{ embarkProjectId, projectName, phases: Json }]
```

`phases` alanı Prisma `Json` tipinde saklanır — ayrı tablo açılmadı.

### Son güncelleme zamanı

```
UPDATE LinkedAccount SET lastSyncAt = now() WHERE id = ?
```

---

## 5. Sync API Yanıtı

`POST /api/embark/sync` başarıyla tamamlandığında:

```json
{
  "ok": true,
  "syncedItems": 47,
  "syncedBlueprints": 12,
  "syncedQuests": 8,
  "syncedHideout": 5,
  "syncedProjects": 2,
  "unmappedCount": 3,
  "credits": 12500,
  "source": "arctracker"
}
```

- `unmappedCount` → bizim datamızda karşılığı bulunamayan arctracker slug sayısı
- `credits` → karakterin in-game kredisi (varsa)

---

## 6. Önemli Notlar

| Konu | Açıklama |
|------|----------|
| Şifre saklama | `arctrackerPassword` veritabanında düz metin saklanır — şifreleme yoktur |
| Session ömrü | Her sync'te yeniden giriş yapılır; token cache yoktur |
| Embark bağlantısı | arctracker.io'nun Embark hesabına bağlı olması gerekir; bağlantı kopunca 401/403 döner |
| Mod slot indexi | arctracker `slotIndex` güvenilir değil; yerine modun kendi `.slot` property'si kullanılır |
| Blueprint filtresi | Sadece `ALL_BLUEPRINTS` listesinde olan ID'ler kabul edilir, bilinmeyenler atılır |
| Paralel çekme | 5 endpoint aynı anda çekilir (`Promise.all`); toplam süre en yavaş endpoint kadardır |

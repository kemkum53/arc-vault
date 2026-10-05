"""arctracker.io'dan veri çekip veritabanına yazan ana sync servisi."""

import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    CharacterProject,
    CharacterQuest,
    HideoutModule,
    InventoryItem,
    InventoryItemMod,
    LearnedBlueprint,
    TrackerAccount,
)
from app.core.crypto import decrypt_value
from app.services import arctracker_client
from app.services.slug_mapper import resolve_item, resolve_mod

logger = logging.getLogger(__name__)


async def run_sync(db: AsyncSession, account: TrackerAccount) -> dict:
    """Tam sync akışı: giriş yap → 5 endpoint çek → DB'ye yaz."""

    # 1) arctracker.io'ya giriş
    cookie = await arctracker_client.authenticate(
        account.arctracker_email,
        decrypt_value(account.arctracker_password),
    )

    # 1b) arctracker'ı oyundan taze veri çekmeye zorla (sitenin "Şimdi
    #     senkronize et" düğmesiyle aynı uç: POST /api/me/embark/sync). Bloklayarak
    #     döndüğü için kısa bir güvenlik beklemesiyle fetch_all taze veriyi görür.
    #     Cooldown (429) ya da hata olursa mevcut veriyle devam edilir.
    if await arctracker_client.force_sync(cookie):
        await asyncio.sleep(1.5)

    # 2) 5 endpoint paralel çek
    raw = await arctracker_client.fetch_all(cookie)

    # 3) Verileri işle ve yaz
    stats = {
        "synced_items": 0,
        "synced_blueprints": 0,
        "synced_quests": 0,
        "synced_hideout": 0,
        "synced_projects": 0,
        "unmapped_count": 0,
        "credits": None,
    }

    aid = account.id

    await _sync_inventory(db, aid, raw.get("inventory"), stats, account)
    await _sync_blueprints(db, aid, raw.get("blueprints"), stats)
    await _sync_quests(db, aid, raw.get("quests"), stats)
    await _sync_hideout(db, aid, raw.get("hideout"), stats)
    await _sync_projects(db, aid, raw.get("projects"), stats)
    _extract_embark_status(account, raw.get("embark_status"))
    _apply_player(account, raw.get("player"))

    # 4) last_sync_at güncelle
    account.last_sync_at = datetime.now(timezone.utc)

    await db.commit()
    return stats


def _extract_embark_status(account: TrackerAccount, status: dict | None):
    """
    /api/embark/status yanıtından oyuncu bilgilerini çıkar ve account'a yaz.

    Örnek yanıt:
    {
      "isLinked": true,
      "embarkUserId": "4159475767003566701",
      "provider": "xbox",
      "displayName": "Kemkum",
      "displayNameDiscriminator": "2811",
      "embarkAccountId": "1341072600719930000",
      "isTokenExpired": false,
      "tokenExpiresAt": "2026-05-19T10:53:12.000Z",
      "linkedAt": "2026-05-17T23:20:25.001Z",
      "updatedAt": "2026-05-18T10:53:19.836Z"
    }
    """
    if not status:
        return

    account.profile_data = status
    account.display_name = status.get("displayName")
    account.display_name_discriminator = status.get("displayNameDiscriminator")
    account.embark_user_id = status.get("embarkUserId")
    account.embark_account_id = status.get("embarkAccountId")
    account.provider = status.get("provider")
    account.is_linked = status.get("isLinked")
    account.is_token_expired = status.get("isTokenExpired")

    # Tarih alanları
    from dateutil.parser import isoparse
    token_exp = status.get("tokenExpiresAt")
    if token_exp:
        try:
            account.token_expires_at = isoparse(token_exp)
        except (ValueError, TypeError):
            pass

    linked_at = status.get("linkedAt")
    if linked_at:
        try:
            account.embark_linked_at = isoparse(linked_at)
        except (ValueError, TypeError):
            pass

    logger.info("Embark profil güncellendi: %s#%s (%s)", account.display_name, account.display_name_discriminator, account.provider)


def _apply_player(account: TrackerAccount, player: dict | None):
    """progress 'player' record → account level/xp (profile_data'ya işlenir)."""
    if not player:
        return
    if player.get("xpCurrent") is not None:
        account.xp = player.get("xpCurrent")
    pd = account.profile_data if isinstance(account.profile_data, dict) else {}
    account.profile_data = {**pd, "level": player.get("level"), "xpCurrent": player.get("xpCurrent")}
    logger.info("Player: level=%s xp=%s", player.get("level"), player.get("xpCurrent"))


# ─── Envanter ───────────────────────────────────────────────

def _durability(raw: dict) -> float | None:
    """Durability percent from a compact or rich item; 0 (broken) must not read as missing."""
    d = raw.get("d")
    return d if d is not None else raw.get("durabilityPercent")


async def _sync_inventory(db: AsyncSession, aid: str, data: dict | None, stats: dict, account: TrackerAccount = None):
    # Veri yoksa mevcut envanteri koru (kısmi/başarısız sync'te silme).
    if not data:
        logger.warning("Inventory verisi yok, mevcut envanter korunuyor")
        return

    await db.execute(delete(InventoryItem).where(InventoryItem.account_id == aid))

    snapshot = data.get("snapshot", data)
    items_raw = snapshot.get("items", [])

    # Ekonomi verileri — yalnızca mevcut olanı yaz, None ile ezme.
    currencies = snapshot.get("currencies", {})

    def _pick(*vals):
        for v in vals:
            if v is not None:
                return v
        return None

    credits = _pick(currencies.get("credits"), snapshot.get("credits"))
    if account:
        if credits is not None:
            account.credits = credits
        cred = _pick(currencies.get("cred"), snapshot.get("cred"))
        if cred is not None:
            account.cred = cred
        raider_tokens = _pick(currencies.get("raiderTokens"), snapshot.get("raiderTokens"))
        if raider_tokens is not None:
            account.raider_tokens = raider_tokens
        xp = _pick(currencies.get("xp"), snapshot.get("xp"))
        if xp is not None:
            account.xp = xp
        used = _pick(snapshot.get("totalItems"), snapshot.get("usedSlots"))
        if used is not None:
            account.used_slots = used
        if snapshot.get("maxSlots") is not None:
            account.max_slots = snapshot.get("maxSlots")
        if snapshot.get("totalValue") is not None:
            account.total_value = snapshot.get("totalValue")
        if snapshot.get("loadout") is not None:
            account.loadout = snapshot.get("loadout")

    stats["credits"] = credits

    logger.info("Inventory: %d item, credits=%s, xp=%s", len(items_raw), account.credits if account else None, account.xp if account else None)

    grouped: dict[tuple[str, str | None], dict] = {}
    weapons: list[dict] = []

    for raw_item in items_raw:
        slug = raw_item.get("i") or raw_item.get("itemId", "")
        if not slug:
            continue
        qty = raw_item.get("q") or raw_item.get("quantity", 1)
        dur = _durability(raw_item)
        attachments = raw_item.get("a") or raw_item.get("attachments", [])

        item_id, tier = resolve_item(slug)
        durability = round(dur) if dur is not None else None

        # Attachment'ı olan item → silah gibi davran (her biri ayrı satır)
        if attachments:
            weapons.append({
                "item_id": item_id,
                "tier": tier,
                "quantity": qty,
                "durability": durability,
                "attachments": attachments,
            })
        else:
            # Durability is part of the key: two attachment-less weapons of the
            # same item+tier but different durability (e.g. one full, one at 52%)
            # must stay separate so each lands in the right durability bucket.
            # Plain stackables (resources, consumables) all carry durability None,
            # so they still merge into one row as before.
            key = (item_id, tier, durability)
            if key in grouped:
                grouped[key]["quantity"] += qty
            else:
                grouped[key] = {"item_id": item_id, "tier": tier, "quantity": qty, "durability": durability}

    bulk_items = []
    for g in grouped.values():
        bulk_items.append(InventoryItem(
            account_id=aid,
            item_id=g["item_id"],
            quantity=g["quantity"],
            tier=g["tier"],
            durability=g["durability"],
        ))
    db.add_all(bulk_items)

    for w in weapons:
        inv_item = InventoryItem(
            account_id=aid,
            item_id=w["item_id"],
            quantity=w.get("quantity", 1),
            tier=w["tier"],
            durability=w["durability"],
        )
        for att in w["attachments"]:
            # Compact format: { "i": "silencer_ii", "s": 0 } — "i" null olabilir (boş slot)
            mod_slug = att.get("i") or att.get("itemId")
            if not mod_slug:
                continue  # boş attachment slot'u, atla
            mod_id, slot_type = resolve_mod(mod_slug)
            inv_item.mods.append(InventoryItemMod(slot_type=slot_type, mod_id=mod_id))
        db.add(inv_item)

    # ─── Loadout slot itemleri envantere ekle ───
    # weapon1/2, augment, shield, augmentedSlots → stash'te YOK, ayrı tutulur
    # backpack/quickItems/safePocket → stash items içinde zaten var, ekleme
    loadout = snapshot.get("loadout") or {}
    loadout_count = 0

    for slot_key in ("augment", "shield", "weapon1", "weapon2"):
        lo_item = loadout.get(slot_key)
        if not isinstance(lo_item, dict):
            continue
        lo_slug = lo_item.get("i") or lo_item.get("itemId")
        if not lo_slug:
            continue
        lo_id, lo_tier = resolve_item(lo_slug)
        lo_qty = lo_item.get("q") or lo_item.get("quantity", 1) or 1
        lo_dur = _durability(lo_item)
        lo_durability = round(lo_dur) if lo_dur is not None else None
        lo_attachments = lo_item.get("a") or lo_item.get("attachments", [])
        inv_item = InventoryItem(
            account_id=aid, item_id=lo_id, quantity=lo_qty,
            tier=lo_tier, durability=lo_durability,
        )
        for att in lo_attachments:
            mod_slug = att.get("i") or att.get("itemId")
            if not mod_slug:
                continue
            mod_id, slot_type = resolve_mod(mod_slug)
            inv_item.mods.append(InventoryItemMod(slot_type=slot_type, mod_id=mod_id))
        db.add(inv_item)
        loadout_count += 1

    # backpack/quickItems/safePocket/augmentedSlots
    # Aynı publicUuid → aynı item tipi farklı slotlarda; miktarları topla.
    uuid_to_item: dict[str, InventoryItem] = {}
    for list_key in ("augmentedSlots", "backpack", "quickItems", "safePocket"):
        lo_list = loadout.get(list_key, [])
        if not isinstance(lo_list, list):
            continue
        for lo_item in lo_list:
            if not isinstance(lo_item, dict):
                continue
            lo_slug = lo_item.get("i") or lo_item.get("itemId")
            if not lo_slug:
                continue
            lo_id, lo_tier = resolve_item(lo_slug)
            lo_qty = lo_item.get("q") or lo_item.get("quantity", 1) or 1
            lo_dur = _durability(lo_item)
            lo_durability = round(lo_dur) if lo_dur is not None else None
            lo_attachments = lo_item.get("a") or lo_item.get("attachments", [])
            uuid = lo_item.get("publicUuid") or lo_item.get("u")
            # Stackables (no attachments) can be quantity-merged by uuid; a
            # modded weapon is a distinct instance and always gets its own row.
            if not lo_attachments and uuid and uuid in uuid_to_item:
                uuid_to_item[uuid].quantity += lo_qty
            else:
                inv_item = InventoryItem(
                    account_id=aid, item_id=lo_id, quantity=lo_qty,
                    tier=lo_tier, durability=lo_durability,
                )
                for att in lo_attachments:
                    mod_slug = att.get("i") or att.get("itemId")
                    if not mod_slug:
                        continue
                    mod_id, slot_type = resolve_mod(mod_slug)
                    inv_item.mods.append(InventoryItemMod(slot_type=slot_type, mod_id=mod_id))
                if not lo_attachments and uuid:
                    uuid_to_item[uuid] = inv_item
                db.add(inv_item)
                loadout_count += 1

    logger.info("Loadout slot: %d item eklendi", loadout_count)
    stats["synced_items"] = len(bulk_items) + len(weapons) + loadout_count


# ─── Blueprintler ──────────────────────────────────────────

async def _sync_blueprints(db: AsyncSession, aid: str, data: dict | None, stats: dict):
    if not data:
        return
    await db.execute(delete(LearnedBlueprint).where(LearnedBlueprint.account_id == aid))

    embark = data.get("embark", {})
    blueprints = [
        LearnedBlueprint(account_id=aid, blueprint_id=bp_id)
        for bp_id, learned in embark.items()
        if learned is True
    ]
    db.add_all(blueprints)
    stats["synced_blueprints"] = len(blueprints)


# ─── Questler ──────────────────────────────────────────────

async def _sync_quests(db: AsyncSession, aid: str, data: dict | None, stats: dict):
    if not data:
        return
    await db.execute(delete(CharacterQuest).where(CharacterQuest.account_id == aid))

    embark = data.get("embark", {})
    quests = [
        CharacterQuest(account_id=aid, quest_id=q_id)
        for q_id, completed in embark.items()
        if completed is True
    ]
    db.add_all(quests)
    stats["synced_quests"] = len(quests)


# ─── Hideout ───────────────────────────────────────────────

async def _sync_hideout(db: AsyncSession, aid: str, data: dict | None, stats: dict):
    if not data:
        return
    await db.execute(delete(HideoutModule).where(HideoutModule.account_id == aid))

    embark = data.get("embark", {})
    modules = [
        HideoutModule(account_id=aid, module_id=mod_id, level=level)
        for mod_id, level in embark.items()
        if isinstance(level, int) and level > 0
    ]
    db.add_all(modules)
    stats["synced_hideout"] = len(modules)


# ─── Projeler ──────────────────────────────────────────────

async def _sync_projects(db: AsyncSession, aid: str, data: dict | None, stats: dict):
    # Link v2 henüz projeleri eşlemiyor (data=None gelir); mevcut satırları koru.
    if not data:
        return
    await db.execute(delete(CharacterProject).where(CharacterProject.account_id == aid))

    projects_raw = data.get("projects", [])
    projects = [
        CharacterProject(
            account_id=aid,
            embark_project_id=p["embarkProjectId"],
            project_name=p["projectName"],
            phases=p.get("phases", []),
        )
        for p in projects_raw
    ]
    db.add_all(projects)
    stats["synced_projects"] = len(projects)

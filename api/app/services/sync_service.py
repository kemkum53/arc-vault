"""arctracker.io'dan veri çekip veritabanına yazan ana sync servisi."""

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
from app.services import arctracker_client
from app.services.slug_mapper import resolve_item, resolve_mod

logger = logging.getLogger(__name__)


async def run_sync(db: AsyncSession, account: TrackerAccount) -> dict:
    """Tam sync akışı: giriş yap → 5 endpoint çek → DB'ye yaz."""

    # 1) arctracker.io'ya giriş
    cookie = await arctracker_client.authenticate(
        account.arctracker_email,
        account.arctracker_password,
    )

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


# ─── Envanter ───────────────────────────────────────────────

async def _sync_inventory(db: AsyncSession, aid: str, data: dict | None, stats: dict, account: TrackerAccount = None):
    await db.execute(delete(InventoryItem).where(InventoryItem.account_id == aid))

    if not data:
        logger.warning("Inventory verisi None geldi")
        return

    # /api/embark/inventory/latest → { snapshot: { items, credits, ... } }
    snapshot = data.get("snapshot", data)
    items_raw = snapshot.get("items", [])

    # Snapshot meta verileri account'a yaz
    if account:
        account.credits = snapshot.get("credits")
        account.cred = snapshot.get("cred")
        account.raider_tokens = snapshot.get("raiderTokens")
        account.xp = snapshot.get("xp")
        account.used_slots = snapshot.get("usedSlots")
        account.max_slots = snapshot.get("maxSlots")
        account.total_value = snapshot.get("totalValue")
        account.loadout = snapshot.get("loadout")

    stats["credits"] = snapshot.get("credits")

    logger.info("Inventory: %d item, %s credits, %s xp", len(items_raw), snapshot.get("credits"), snapshot.get("xp"))

    grouped: dict[tuple[str, str | None], dict] = {}
    weapons: list[dict] = []

    for raw_item in items_raw:
        slug = raw_item.get("i") or raw_item.get("itemId", "")
        if not slug:
            continue
        qty = raw_item.get("q") or raw_item.get("quantity", 1)
        dur = raw_item.get("d") or raw_item.get("durabilityPercent")
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
            key = (item_id, tier)
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

    stats["synced_items"] = len(bulk_items) + len(weapons)


# ─── Blueprintler ──────────────────────────────────────────

async def _sync_blueprints(db: AsyncSession, aid: str, data: dict | None, stats: dict):
    await db.execute(delete(LearnedBlueprint).where(LearnedBlueprint.account_id == aid))

    if not data:
        return

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
    await db.execute(delete(CharacterQuest).where(CharacterQuest.account_id == aid))

    if not data:
        return

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
    await db.execute(delete(HideoutModule).where(HideoutModule.account_id == aid))

    if not data:
        return

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
    await db.execute(delete(CharacterProject).where(CharacterProject.account_id == aid))

    if not data:
        return

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

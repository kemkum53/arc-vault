"""Cross-account item matrix.

Serves raw per-account item stacks (grouped by tier and durability) for the
items a matrix view asks for, plus the shared view layouts every user edits. Bucketing
and totals happen in the browser so a view can be reshaped without a backend
change.
"""

import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.database import get_db
from app.models import InventoryItem, InventoryItemMod, MatrixSetting, TrackerAccount
from app.models.user import User
from app.services.slug_mapper import parse_tier

router = APIRouter(tags=["matrix"])

MAX_ITEMS = 100
MAX_VIEWS_BYTES = 200_000


class MatrixViewsBody(BaseModel):
    views: list[dict]
    # Version the editor started from; a mismatch means someone saved in between.
    version: int


def _views_out(row: MatrixSetting | None) -> dict:
    return {
        "views": json.loads(row.views) if row and row.views else None,
        "version": row.version if row else 0,
        "updated_by": row.updated_by if row else None,
        "updated_at": row.updated_at.isoformat() if row and row.updated_at else None,
    }


@router.get("/matrix/views")
async def get_matrix_views(
    _user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Shared layouts (one set for everyone)."""
    return _views_out(await db.get(MatrixSetting, 1))


@router.put("/matrix/views")
async def put_matrix_views(
    body: MatrixViewsBody,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Save the shared layouts. 409 (with the current state) if body.version is stale."""
    payload = json.dumps(body.views, ensure_ascii=False)
    if len(payload) > MAX_VIEWS_BYTES:
        raise HTTPException(413, "Görünüm ayarları çok büyük")
    # Row lock so two saves cannot both pass the version check.
    row = (
        await db.execute(select(MatrixSetting).where(MatrixSetting.id == 1).with_for_update())
    ).scalar_one_or_none()
    if row is None:
        row = MatrixSetting(id=1, version=0)
        db.add(row)
    if body.version != row.version:
        current = _views_out(row)
        await db.rollback()
        raise HTTPException(409, {"message": "Görünümler bu arada değişti", **current})
    row.views = payload
    row.version = row.version + 1
    row.updated_by = user.username
    await db.commit()
    await db.refresh(row)
    return _views_out(row)


@router.get("/matrix/inventory")
async def get_matrix_inventory(
    items: str = Query("", description="Comma-separated base item ids"),
    _user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Per-account stacks for the requested items.

    Returns {accounts: [{id, display_name, discriminator, group_name,
    token_valid, last_sync_at, items: {<item_id>: [{tier, durability, qty, mounted}]}}]}.
    durability is the stored percent (None means full). Stash and loadout are
    already merged in inventory_items, so each stack is counted once.
    Attachments fitted on weapons live in inventory_item_mods as tiered slugs
    (e.g. "angled_grip_iii"); they come back as mounted=True stacks so the
    browser can choose whether to count them.
    """
    item_ids = sorted({i.strip() for i in items.split(",") if i.strip()})
    if len(item_ids) > MAX_ITEMS:
        raise HTTPException(400, f"En fazla {MAX_ITEMS} item istenebilir")

    now = datetime.now(timezone.utc)
    accounts = (await db.execute(select(TrackerAccount))).scalars().all()
    by_id: dict[str, dict] = {}
    for acc in accounts:
        exp = acc.token_expires_at
        if exp is not None and exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        by_id[acc.id] = {
            "id": acc.id,
            "display_name": acc.display_name,
            "discriminator": acc.display_name_discriminator,
            "group_name": acc.group_name,
            "token_valid": bool(exp and exp > now),
            "last_sync_at": acc.last_sync_at.isoformat() if acc.last_sync_at else None,
            # Only whether Steam login is stored; the values come one account at a time.
            "has_steam_username": acc.has_steam_username,
            "has_steam_password": acc.has_steam_password,
            "items": {},
        }

    if item_ids:
        rows = (
            await db.execute(
                select(
                    InventoryItem.account_id,
                    InventoryItem.item_id,
                    InventoryItem.tier,
                    InventoryItem.durability,
                    InventoryItem.quantity,
                ).where(InventoryItem.item_id.in_(item_ids))
            )
        ).all()
        stacks: dict[tuple, int] = {}
        for account_id, item_id, tier, durability, quantity in rows:
            if account_id not in by_id:
                continue
            key = (account_id, item_id, tier, durability, False)
            stacks[key] = stacks.get(key, 0) + (quantity or 1)

        wanted = set(item_ids)
        mods = (
            await db.execute(
                select(InventoryItem.account_id, InventoryItemMod.mod_id)
                .join(InventoryItem, InventoryItemMod.inventory_item_id == InventoryItem.id)
            )
        ).all()
        for account_id, mod_id in mods:
            if account_id not in by_id or not mod_id:
                continue
            base, tier = parse_tier(mod_id)
            if base not in wanted:
                continue
            key = (account_id, base, tier, None, True)
            stacks[key] = stacks.get(key, 0) + 1

        for (account_id, item_id, tier, durability, mounted), qty in stacks.items():
            by_id[account_id]["items"].setdefault(item_id, []).append(
                {"tier": tier, "durability": durability, "qty": qty, "mounted": mounted}
            )

    return {
        "generated_at": now.isoformat(),
        "accounts": list(by_id.values()),
    }


@router.get("/matrix/breakdown")
async def get_matrix_breakdown(
    account_id: str,
    item_id: str,
    tier: str | None = None,
    _user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """One account's copies of one item, grouped by the set of attachments fitted.

    Returns {groups: [{mods: [mod_id, ...], stacks: [{tier, durability, qty}]}]},
    largest group first. Each inventory row is one weapon (or a merged run of
    identical attachment-less ones), so its mods describe every copy in it.
    """
    query = (
        select(InventoryItem)
        .where(InventoryItem.account_id == account_id, InventoryItem.item_id == item_id)
        .options(selectinload(InventoryItem.mods))
    )
    if tier:
        query = query.where(InventoryItem.tier == tier)
    rows = (await db.execute(query)).scalars().all()

    groups: dict[tuple[str, ...], dict] = {}
    for row in rows:
        mods = tuple(sorted(m.mod_id for m in row.mods if m.mod_id))
        group = groups.setdefault(mods, {"mods": list(mods), "stacks": {}})
        key = (row.tier, row.durability)
        group["stacks"][key] = group["stacks"].get(key, 0) + (row.quantity or 1)

    out = []
    for group in groups.values():
        stacks = [
            {"tier": t, "durability": d, "qty": q}
            for (t, d), q in sorted(group["stacks"].items(), key=lambda kv: -(kv[0][1] if kv[0][1] is not None else 100))
        ]
        out.append({"mods": group["mods"], "stacks": stacks})
    out.sort(key=lambda g: (-sum(st["qty"] for st in g["stacks"]), len(g["mods"])))
    return {"account_id": account_id, "item_id": item_id, "tier": tier, "groups": out}


@router.get("/matrix/mounted")
async def get_matrix_mounted(
    account_id: str,
    item_id: str,
    tier: str | None = None,
    _user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Where one account's copies of an attachment are: loose in the stash, or on which weapons.

    item_id/tier are the stash form ("angled_grip", "III"); fitted mods are
    stored as tiered slugs ("angled_grip_iii") and parsed the same way.
    Returns {loose, weapons: [{item_id, tier, mods, qty, fitted}]}, where
    fitted is how many of the attachment that group carries in total.
    """
    loose_query = select(InventoryItem.quantity).where(
        InventoryItem.account_id == account_id, InventoryItem.item_id == item_id
    )
    if tier:
        loose_query = loose_query.where(InventoryItem.tier == tier)
    loose = sum(q or 1 for q in (await db.execute(loose_query)).scalars().all())

    carriers = (
        await db.execute(
            select(InventoryItem)
            .where(InventoryItem.account_id == account_id, InventoryItem.mods.any())
            .options(selectinload(InventoryItem.mods))
        )
    ).scalars().all()

    groups: dict[tuple, dict] = {}
    for weapon in carriers:
        hits = 0
        for mod in weapon.mods:
            base, mod_tier = parse_tier(mod.mod_id or "")
            if base == item_id and (not tier or mod_tier == tier):
                hits += 1
        if not hits:
            continue
        mods = tuple(sorted(m.mod_id for m in weapon.mods if m.mod_id))
        key = (weapon.item_id, weapon.tier, mods)
        group = groups.setdefault(
            key, {"item_id": weapon.item_id, "tier": weapon.tier, "mods": list(mods), "qty": 0, "fitted": 0}
        )
        qty = weapon.quantity or 1
        group["qty"] += qty
        group["fitted"] += hits * qty

    weapons = sorted(groups.values(), key=lambda g: (-g["fitted"], g["item_id"]))
    return {"account_id": account_id, "item_id": item_id, "tier": tier, "loose": loose, "weapons": weapons}


class MatrixSyncBody(BaseModel):
    account_ids: list[str]


@router.post("/matrix/sync")
async def start_matrix_sync(
    body: MatrixSyncBody,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Start the site-wide bulk sync for these accounts (token-valid ones only), in order."""
    from app.services import bulk_sync

    now = datetime.now(timezone.utc)
    accounts = {
        a.id: a for a in (
            await db.execute(select(TrackerAccount).where(TrackerAccount.id.in_(body.account_ids)))
        ).scalars().all()
    }

    def valid(acc: TrackerAccount) -> bool:
        exp = acc.token_expires_at
        if exp is not None and exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        return bool(exp and exp > now)

    ids = [i for i in body.account_ids if i in accounts and valid(accounts[i])]
    if not ids:
        raise HTTPException(400, "Senkronize edilecek geçerli token yok")
    try:
        run = await bulk_sync.start(ids, user.username)
    except bulk_sync.BulkSyncBusy as busy:
        raise HTTPException(409, f"{busy} tarafından başlatılan senkron devam ediyor")
    return {**run.as_dict(), "skipped": len(body.account_ids) - len(ids)}


@router.post("/matrix/sync/stop")
async def stop_matrix_sync(user: User = Depends(get_current_user)) -> dict:
    """Stop after the account being synced now; anyone may stop a run."""
    from app.services import bulk_sync

    run = bulk_sync.stop(user.username)
    return {"bulk": run.as_dict() if run else None}


@router.get("/matrix/sync-status")
async def get_matrix_sync_status(
    _user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """What every matrix polls: the bulk run (if any) and each account's live sync state.

    last_sync_at lets the client re-read only the rows that changed, including
    syncs started elsewhere (another user, a single-row sync, a harvester token push).
    """
    from app.services import bulk_sync

    run = bulk_sync.current_run()
    now = datetime.now(timezone.utc)
    rows = (
        await db.execute(
            select(
                TrackerAccount.id, TrackerAccount.sync_status,
                TrackerAccount.last_sync_at, TrackerAccount.token_expires_at,
            )
        )
    ).all()
    accounts = []
    for acc_id, status, last_sync_at, exp in rows:
        if exp is not None and exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        accounts.append({
            "id": acc_id,
            "sync_status": status,
            "last_sync_at": last_sync_at.isoformat() if last_sync_at else None,
            "token_valid": bool(exp and exp > now),
        })
    return {"bulk": run.as_dict() if run else None, "accounts": accounts}

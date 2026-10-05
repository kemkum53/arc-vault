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

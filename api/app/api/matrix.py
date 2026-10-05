"""Cross-account item matrix.

Serves raw per-account item stacks (grouped by tier and durability) for the
items a matrix view asks for, plus the user's saved view layouts. Bucketing
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
from app.models import InventoryItem, TrackerAccount
from app.models.user import User

router = APIRouter(tags=["matrix"])

MAX_ITEMS = 100
MAX_VIEWS_BYTES = 200_000


class MatrixViewsBody(BaseModel):
    views: list[dict]


@router.get("/matrix/views")
async def get_matrix_views(user: User = Depends(get_current_user)) -> dict:
    raw = user.matrix_views
    return {"views": json.loads(raw) if raw else None}


@router.put("/matrix/views")
async def put_matrix_views(
    body: MatrixViewsBody,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    payload = json.dumps(body.views, ensure_ascii=False)
    if len(payload) > MAX_VIEWS_BYTES:
        raise HTTPException(413, "Görünüm ayarları çok büyük")
    db_user = await db.get(User, user.id)
    if not db_user:
        raise HTTPException(404, "Kullanıcı bulunamadı")
    db_user.matrix_views = payload
    await db.commit()
    return {"ok": True}


@router.get("/matrix/inventory")
async def get_matrix_inventory(
    items: str = Query("", description="Comma-separated base item ids"),
    _user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Per-account stacks for the requested items.

    Returns {accounts: [{id, display_name, discriminator, group_name,
    token_valid, last_sync_at, items: {<item_id>: [{tier, durability, qty}]}}]}.
    durability is the stored percent (None means full). Stash and loadout are
    already merged in inventory_items, so each stack is counted once.
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
            key = (account_id, item_id, tier, durability)
            stacks[key] = stacks.get(key, 0) + (quantity or 1)
        for (account_id, item_id, tier, durability), qty in stacks.items():
            by_id[account_id]["items"].setdefault(item_id, []).append(
                {"tier": tier, "durability": durability, "qty": qty}
            )

    return {
        "generated_at": now.isoformat(),
        "accounts": list(by_id.values()),
    }

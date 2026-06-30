"""Workshop progress endpoint'leri."""

import json
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.database import get_db
from app.models.account import TrackerAccount
from app.models.inventory import InventoryItem

router = APIRouter(tags=["workshop"])

_DATA_DIR = Path(__file__).parent.parent / "data"


@lru_cache(maxsize=1)
def _load_workshop_data() -> dict:
    p = _DATA_DIR / "workshop_data.json"
    with open(p, encoding="utf-8") as f:
        return json.load(f)


@router.get("/reference/workshop")
async def get_workshop_reference(_user=Depends(get_current_user)):
    return _load_workshop_data()


@router.get("/workshop/progress")
async def get_workshop_progress(
    _user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    workshop_data = _load_workshop_data()
    workshops_def = workshop_data.get("workshops", {})

    acc_result = await db.execute(select(TrackerAccount))
    accounts = acc_result.scalars().all()

    items_result = await db.execute(select(InventoryItem))
    all_items = items_result.scalars().all()

    # Per-account inventory: sum quantities for same item_id within one account
    account_inventories: dict[str, dict[str, int]] = {str(a.id): {} for a in accounts}
    for item in all_items:
        acc_id = str(item.account_id)
        if acc_id not in account_inventories:
            continue
        inv = account_inventories[acc_id]
        inv[item.item_id] = inv.get(item.item_id, 0) + item.quantity

    # Aggregate across all accounts
    aggregate: dict[str, int] = {}
    for inv in account_inventories.values():
        for item_id, qty in inv.items():
            aggregate[item_id] = aggregate.get(item_id, 0) + qty

    account_count = len(accounts)

    # Compute progress per workshop/level
    workshop_progress: dict = {}
    for ws_name, ws_def in workshops_def.items():
        levels_progress: dict = {}
        for level_str, items_def in ws_def.get("levels", {}).items():
            level_items = []
            level_complete = True
            for item_id, item_name, req_per_account in items_def:
                required_total = req_per_account * account_count
                have_total = aggregate.get(item_id, 0)
                need_total = max(0, required_total - have_total)
                item_complete = have_total >= required_total
                if not item_complete:
                    level_complete = False
                level_items.append({
                    "item_id": item_id,
                    "name": item_name,
                    "required_per_account": req_per_account,
                    "required_total": required_total,
                    "have": have_total,
                    "need": need_total,
                    "complete": item_complete,
                })
            levels_progress[level_str] = {
                "complete": level_complete,
                "items": level_items,
            }
        workshop_progress[ws_name] = {"levels": levels_progress}

    accounts_out = [
        {
            "id": str(acc.id),
            "display_name": acc.display_name,
            "discriminator": acc.display_name_discriminator,
            "inventory": account_inventories.get(str(acc.id), {}),
        }
        for acc in accounts
    ]

    return {
        "account_count": account_count,
        "accounts": accounts_out,
        "aggregate": aggregate,
        "workshops": workshop_progress,
    }

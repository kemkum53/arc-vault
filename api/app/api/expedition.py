"""Expedition progress endpoint'leri."""

import json
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.database import get_db
from app.models.account import TrackerAccount
from app.models.inventory import InventoryItem
from app.models.user import User

router = APIRouter(tags=["expedition"])


class SupplySelectionBody(BaseModel):
    included: list[str]


@router.get("/expedition/supply-selection")
async def get_supply_selection(user: User = Depends(get_current_user)):
    raw = user.expedition_supply_included
    return {"included": json.loads(raw) if raw else []}


@router.put("/expedition/supply-selection")
async def put_supply_selection(
    body: SupplySelectionBody,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    db_user = await db.get(User, user.id)
    if not db_user:
        raise HTTPException(404, "Kullanıcı bulunamadı")
    db_user.expedition_supply_included = json.dumps(body.included)
    await db.commit()
    return {"ok": True}

_DATA_DIR = Path(__file__).parent.parent / "data"

# ─── Kategori eşlemesi ───────────────────────────────────────────────────────

_TYPE_TO_CATEGORY: dict[str, str | None] = {
    # Combat — yalnızca tüketilen malzemeler
    "Ammunition": "combat", "Modification": "combat",
    # Materials
    "Recyclable": "materials", "Topside Material": "materials",
    "Refined Material": "materials", "Basic Material": "materials",
    "Trinket": "materials",
    # Provisions
    "Nature": "provisions",
    # Not counted — silahlar/ekipman sarf malzemesi değil
    "Assault Rifle": None, "SMG": None, "Pistol": None,
    "Battle Rifle": None, "LMG": None, "Sniper Rifle": None,
    "Hand Cannon": None, "Shotgun": None, "Special": None,
    "Augment": None, "Shield": None,
    "Blueprint": None, "Key": None, "Misc": None,
}

_QU_COMBAT = frozenset({
    "blaze_grenade", "blaze_grenade_trap", "explosive_mine",
    "gas_grenade", "gas_grenade_trap", "gas_mine",
    "heavy_fuze_grenade", "jolt_mine", "light_impact_grenade",
    "lil_smoke_grenade", "lure_grenade", "lure_grenade_trap",
    "pulse_mine", "seeker_grenade", "shrapnel_grenade",
    "smoke_grenade", "smoke_grenade_trap", "snap_blast_grenade",
    "tagging_grenade", "trigger_nade", "wolfpack",
    "firecracker", "flame_spray", "remote_raider_flare",
    "noisemaker", "surge_coil", "showstopper", "trailblazer", "deadline",
})

_QU_PROVISIONS = frozenset({"agave_juice", "fruit_mix", "shaker"})


def _get_category(item_id: str, item_type: str) -> str | None:
    if item_type == "Quick Use":
        if item_id in _QU_COMBAT:
            return "combat"
        if item_id in _QU_PROVISIONS:
            return "provisions"
        return "survival"
    return _TYPE_TO_CATEGORY.get(item_type)


# ─── Veri yükleme ────────────────────────────────────────────────────────────

@lru_cache(maxsize=1)
def _load_expedition_data() -> dict:
    with open(_DATA_DIR / "expedition_data.json", encoding="utf-8") as f:
        return json.load(f)


@lru_cache(maxsize=1)
def _load_items_ref() -> dict:
    with open(_DATA_DIR / "items_reference.json", encoding="utf-8") as f:
        return json.load(f)


# ─── Endpoint ────────────────────────────────────────────────────────────────

@router.get("/expedition/progress")
async def get_expedition_progress(
    _user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    exp_data = _load_expedition_data()
    items_ref = _load_items_ref()

    # Per-account inventories
    acc_result = await db.execute(select(TrackerAccount))
    accounts_db = acc_result.scalars().all()

    items_result = await db.execute(select(InventoryItem))
    all_items = items_result.scalars().all()

    account_inventories: dict[str, dict[str, int]] = {str(a.id): {} for a in accounts_db}
    for item in all_items:
        acc_id = str(item.account_id)
        if acc_id not in account_inventories:
            continue
        inv = account_inventories[acc_id]
        inv[item.item_id] = inv.get(item.item_id, 0) + item.quantity

    # item_info: kategorisi olan TÜM itemler — envanterde olmasa da listelenir
    item_info: dict[str, dict] = {}
    for item_id, ref in items_ref.items():
        cat = _get_category(item_id, ref.get("type", ""))
        if cat is not None:
            item_info[item_id] = {
                "name": ref.get("name_en", item_id),
                "value": ref.get("value", 0),
                "category": cat,
            }

    # Expeditions — have yok, frontend seçilen hesaptan hesaplar
    expeditions_out: dict = {}
    for exp_name, exp_def in exp_data["expeditions"].items():
        phases_out: dict = {}
        for phase_str, phase_def in exp_def["phases"].items():
            if phase_def.get("type") == "supply":
                phases_out[phase_str] = {
                    "name": phase_def["name"],
                    "type": "supply",
                    "supply": phase_def["supply"],
                }
            else:
                phase_items = [
                    {
                        "item_id": item_id,
                        "name": item_name,
                        "required_per_account": req_per_account,
                    }
                    for item_id, item_name, req_per_account in phase_def["items"]
                ]
                phases_out[phase_str] = {
                    "name": phase_def["name"],
                    "items": phase_items,
                }
        expeditions_out[exp_name] = {
            "key": exp_def["key"],
            "phases": phases_out,
        }

    accounts_out = [
        {
            "id": str(acc.id),
            "display_name": acc.display_name,
            "discriminator": acc.display_name_discriminator,
            "inventory": account_inventories.get(str(acc.id), {}),
        }
        for acc in accounts_db
    ]

    return {
        "accounts": accounts_out,
        "item_info": item_info,
        "expeditions": expeditions_out,
    }

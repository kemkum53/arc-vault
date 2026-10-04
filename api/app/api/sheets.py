"""Google Sheets export endpoint.

Serves a per-account weapon matrix (tier-IV weapons bucketed by durability)
for the spreadsheet sync button. Read-only, guarded by the internal API key.
"""

import json
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.models import InventoryItem, TrackerAccount

router = APIRouter(tags=["sheets"])

_DATA_DIR = Path(__file__).parent.parent / "data"

# Reference "type" values that count as weapons (mirrors the web resolveCategory).
WEAPON_TYPES = {
    "assault rifle", "smg", "pistol", "shotgun", "battle rifle",
    "lmg", "sniper rifle", "hand cannon", "special",
}

# Absolute durability at full charge, per tier (mirrors WEAPON_MAX_DURABILITY).
TIER_MAX_DURABILITY = {"I": 100, "II": 110, "III": 120, "IV": 130}

# Non-weapon items the sheet can also track (counted as a plain total, any
# tier). Extend this set to expose more items to the spreadsheet dropdown.
EXTRA_ITEMS = {
    "raider_hatch_key",
    "looting_mk3_survivor",
    "herbal_bandage",
    "trigger_nade",
    "showstopper",
    "wolfpack",
    "medium_shield",
    "buried_city_town_hall_key",
    "deadline",
    "vita_spray",
    "surge_shield_recharger",
    "snap_hook",
}


async def _require_internal_key(x_api_key: str = Header(None)) -> None:
    key = settings.internal_api_key
    if not key:
        raise HTTPException(503, "Internal API key yapılandırılmamış")
    if x_api_key != key:
        raise HTTPException(401, "Geçersiz API key")


@lru_cache(maxsize=1)
def _weapon_base_ids() -> frozenset[str]:
    """Base ids (tier stripped) whose tier-IV variant is a weapon."""
    p = _DATA_DIR / "items_reference.json"
    if not p.exists():
        return frozenset()
    with open(p, encoding="utf-8") as f:
        ref = json.load(f)
    bases: set[str] = set()
    for key, meta in ref.items():
        if not isinstance(meta, dict):
            continue
        if str(meta.get("type", "")).lower() not in WEAPON_TYPES:
            continue
        # keys look like "bobcat_iv"; strip a trailing tier suffix
        base = key
        for suffix in ("_iv", "_iii", "_ii", "_i"):
            if key.endswith(suffix):
                base = key[: -len(suffix)]
                break
        bases.add(base)
    return frozenset(bases)


def _durability_bucket(durability_pct: int | None, tier_max: int) -> str | None:
    """Bucket a tier-IV weapon by absolute durability (full -> "130")."""
    # arctracker omits durability at full charge, so a missing value means 100%.
    pct = durability_pct if durability_pct is not None else 100
    d_abs = round(tier_max * pct / 100)
    if d_abs >= tier_max:
        return str(tier_max)   # "130"
    if d_abs >= tier_max // 2:
        return "65"            # tier_max // 2 == 65 for tier IV
    if d_abs >= 1:
        return "1-64"
    return None               # fully broken / zero


@router.get("/sheets/weapon-matrix")
async def weapon_matrix(
    db: AsyncSession = Depends(get_db),
    _: None = Depends(_require_internal_key),
) -> dict:
    """Per-account tier-IV weapon counts, bucketed by durability.

    Header: X-Api-Key: <internal_api_key>

    Returns {accounts: [{key, display_name, discriminator,
    weapons: {<baseId>: {"130": n, "65": n, "1-64": n}}}]}. Only tier-IV
    weapons are counted; stash and loadout are already merged in the
    inventory table, so each row is counted once (no duplicates).
    """
    weapon_bases = _weapon_base_ids()
    tier_max = TIER_MAX_DURABILITY["IV"]

    now = datetime.now(timezone.utc)
    accounts = (await db.execute(select(TrackerAccount))).scalars().all()
    by_id: dict[str, dict] = {}
    for acc in accounts:
        disc = acc.display_name_discriminator
        key = f"{acc.display_name}#{disc}" if acc.display_name and disc else None
        exp = acc.token_expires_at
        if exp is not None and exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        token_valid = bool(exp and exp > now)
        by_id[acc.id] = {
            "key": key,
            "display_name": acc.display_name,
            "discriminator": disc,
            "token_valid": token_valid,
            "items": {},
        }

    def _slot(items: dict, item_id: str) -> dict:
        return items.setdefault(
            item_id, {str(tier_max): 0, "65": 0, "1-64": 0, "total": 0}
        )

    rows = (
        await db.execute(
            select(
                InventoryItem.account_id,
                InventoryItem.item_id,
                InventoryItem.quantity,
                InventoryItem.tier,
                InventoryItem.durability,
            ).where(
                or_(InventoryItem.tier == "IV", InventoryItem.item_id.in_(EXTRA_ITEMS))
            )
        )
    ).all()

    for account_id, item_id, quantity, tier, durability in rows:
        entry = by_id.get(account_id)
        if entry is None:
            continue
        qty = quantity or 1
        if item_id in EXTRA_ITEMS:
            # Non-weapon: a plain total across all tiers.
            _slot(entry["items"], item_id)["total"] += qty
            continue
        if tier != "IV" or item_id not in weapon_bases:
            continue
        bucket = _durability_bucket(durability, tier_max)
        if bucket is None:
            continue
        slot = _slot(entry["items"], item_id)
        slot[bucket] += qty
        slot["total"] += qty

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "tier": "IV",
        "buckets": [str(tier_max), "65", "1-64", "total"],
        "accounts": [v for v in by_id.values() if v["key"]],
    }

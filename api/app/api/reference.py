"""Reference veri endpoint'leri — item/quest/hideout/mod isimlendirme icin."""

import json
from pathlib import Path
from functools import lru_cache

from fastapi import APIRouter, Depends

from app.core.auth import get_current_user

router = APIRouter(tags=["reference"])

_DATA_DIR = Path(__file__).parent.parent / "data"


@lru_cache(maxsize=1)
def _load(name: str) -> dict:
    p = _DATA_DIR / name
    if not p.exists():
        return {}
    with open(p, encoding="utf-8") as f:
        return json.load(f)


@router.get("/reference/items")
async def get_items_reference(_user=Depends(get_current_user)):
    return _load("items_reference.json")


@router.get("/reference/quests")
async def get_quests_reference(_user=Depends(get_current_user)):
    return _load("quests_reference.json")


@router.get("/reference/hideout")
async def get_hideout_reference(_user=Depends(get_current_user)):
    return _load("hideout_reference.json")


@router.get("/reference/blueprints")
async def get_blueprints_reference(_user=Depends(get_current_user)):
    return _load("blueprints_reference.json")


@router.get("/reference/mods")
async def get_mods_reference(_user=Depends(get_current_user)):
    return _load("mods_reference.json")


@router.get("/reference/projects")
async def get_projects_reference(_user=Depends(get_current_user)):
    return _load("projects_reference.json")

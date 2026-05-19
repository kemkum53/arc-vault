#!/usr/bin/env python3
"""
arctracker.io API'den güncel verileri çekip reference JSON dosyalarını günceller.

Kullanım:
    source .venv/bin/activate
    python scripts/update_reference.py

Gereksinimler: httpx, hesap bilgileri DB'de kayıtlı olmalı.
"""

import asyncio
import json
import sys
from pathlib import Path

# Proje kökünü sys.path'e ekle
ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

import httpx

BASE = "https://arctracker.io"
OUT = ROOT / "app" / "static" / "data"
RAW = ROOT.parent / "data"


async def main():
    # DB'den kimlik bilgilerini al
    from app.core.database import async_session
    from app.models.account import TrackerAccount
    from sqlalchemy import select

    async with async_session() as db:
        result = await db.execute(select(TrackerAccount).limit(1))
        acc = result.scalar_one_or_none()
        if not acc:
            print("DB'de hesap bulunamadı!")
            return

    # Giriş yap
    from app.services.arctracker_client import authenticate
    cookie = await authenticate(acc.arctracker_email, acc.arctracker_password)
    print(f"Login OK: {acc.arctracker_email}")

    # API'leri çek
    async with httpx.AsyncClient(timeout=30) as client:
        headers = {"Cookie": cookie}
        endpoints = {
            "items": "/api/items",
            "quests": "/api/quests",
            "hideout": "/api/hideout",
            "projects": "/api/projects",
        }

        raw_data = {}
        for name, path in endpoints.items():
            resp = await client.get(f"{BASE}{path}", headers=headers)
            print(f"  {name}: {resp.status_code}")
            if resp.status_code == 200:
                raw_data[name] = resp.json()
                # Ham veriyi kaydet
                RAW.mkdir(exist_ok=True)
                with open(RAW / f"arctracker_api_{name}.json", "w", encoding="utf-8") as f:
                    json.dump(raw_data[name], f, ensure_ascii=False, indent=2)

    # Items reference
    items_ref = {}
    mods_ref = {}
    bps_ref = {}
    for item in raw_data.get("items", {}).get("items", []):
        iid = item["id"]
        entry = {
            "name_en": item.get("name", {}).get("en", ""),
            "name_tr": item.get("name", {}).get("tr", ""),
            "rarity": item.get("rarity", "Common"),
            "type": item.get("type", ""),
            "value": item.get("value", 0),
            "weight": item.get("weightKg", 0),
            "stack_size": item.get("stackSize", 1),
            "image": f"https://cdn.arctracker.io/items/v2/{iid}.png",
        }
        itype = item.get("type", "")
        if itype == "Mod" or item.get("compatibleWith"):
            entry["effects"] = item.get("effects", [])
            entry["compatible_with"] = item.get("compatibleWith", [])
            mods_ref[iid] = entry
        elif itype == "Blueprint" or iid.endswith("_blueprint"):
            bps_ref[iid] = entry
        items_ref[iid] = entry

    # Quests reference
    quests_ref = {}
    for qid, q in raw_data.get("quests", {}).get("quests", {}).items():
        quests_ref[qid] = {
            "name_en": q.get("name", {}).get("en", ""),
            "name_tr": q.get("name", {}).get("tr", ""),
            "description_en": q.get("description", {}).get("en", ""),
            "description_tr": q.get("description", {}).get("tr", ""),
            "objectives_en": [o.get("en", "") for o in q.get("objectives", [])],
            "objectives_tr": [o.get("tr", "") for o in q.get("objectives", [])],
            "trader": q.get("trader", ""),
            "map": q.get("map", []),
            "xp": q.get("xp", 0),
            "required_items": q.get("requiredItemIds", []),
            "reward_items": q.get("rewardItemIds", []),
            "granted_items": q.get("grantedItemIds", []),
            "previous_quests": q.get("previousQuestIds", []),
            "next_quests": q.get("nextQuestIds", []),
            "other_requirements": q.get("otherRequirements", []),
        }

    # Hideout reference
    hideout_ref = {}
    for mid, m in raw_data.get("hideout", {}).get("hideoutModules", {}).items():
        hideout_ref[mid] = {
            "name_en": m.get("name", {}).get("en", ""),
            "name_tr": m.get("name", {}).get("tr", ""),
            "max_level": m.get("maxLevel", 1),
            "levels": m.get("levels", []),
        }

    # Projects reference
    projects_ref = {}
    for pid, p in raw_data.get("projects", {}).get("projects", {}).items():
        projects_ref[pid] = {
            "name_en": p.get("name", {}).get("en", ""),
            "name_tr": p.get("name", {}).get("tr", ""),
            "description_en": p.get("description", {}).get("en", ""),
            "description_tr": p.get("description", {}).get("tr", ""),
            "disabled": p.get("disabled", False),
            "phases": p.get("phases", []),
        }

    # Kaydet
    OUT.mkdir(parents=True, exist_ok=True)
    files = {
        "items_reference.json": items_ref,
        "mods_reference.json": mods_ref,
        "blueprints_reference.json": bps_ref,
        "quests_reference.json": quests_ref,
        "hideout_reference.json": hideout_ref,
        "projects_reference.json": projects_ref,
    }
    print("\nReference dosyaları güncellendi:")
    for name, data in files.items():
        with open(OUT / name, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"  {name}: {len(data)} kayıt")

    print("\nTamamlandı!")


if __name__ == "__main__":
    asyncio.run(main())

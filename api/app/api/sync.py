"""Sync ve envanter okuma endpoint'leri."""

import json
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.models import (
    CharacterProject,
    CharacterQuest,
    HideoutModule,
    InventoryItem,
    LearnedBlueprint,
    TrackerAccount,
)
from app.schemas.sync import (
    BlueprintResponse,
    FullSyncDataResponse,
    SyncRequest,
    SyncResponse,
)
from app.services.sync_service import run_sync

# Blueprint reference verisini bir kez yükle
_BLUEPRINTS_REF: dict = {}
_bp_ref_path = Path(__file__).parent.parent / "data" / "blueprints_reference.json"
if _bp_ref_path.exists():
    with open(_bp_ref_path, encoding="utf-8") as f:
        _BLUEPRINTS_REF = json.load(f)

router = APIRouter(tags=["sync"])


async def _get_account(db: AsyncSession, account_id: str) -> TrackerAccount:
    acc = await db.get(TrackerAccount, account_id)
    if not acc:
        raise HTTPException(404, "Hesap bulunamadı")
    return acc


# ─── Sync tetikleme ───────────────────────────────────────

@router.post("/accounts/{account_id}/sync", response_model=SyncResponse)
async def trigger_sync(
    account_id: str,
    payload: SyncRequest | None = None,
    db: AsyncSession = Depends(get_db),
):
    acc = await _get_account(db, account_id)

    # Son sync'ten bu yana 5 dakika geçmemişse atla (force olmadıkça)
    if not (payload and payload.force) and acc.last_sync_at:
        from datetime import datetime, timezone
        diff = (datetime.now(timezone.utc) - acc.last_sync_at).total_seconds()
        if diff < 300:
            return SyncResponse(
                ok=True,
                message=f"Son sync {int(diff)} saniye önce yapıldı, tekrar sync için force=true gönderin",
            )

    try:
        stats = await run_sync(db, acc)
    except Exception as exc:
        raise HTTPException(502, f"Sync başarısız: {exc}")

    return SyncResponse(
        ok=True,
        synced_items=stats["synced_items"],
        synced_blueprints=stats["synced_blueprints"],
        synced_quests=stats["synced_quests"],
        synced_hideout=stats["synced_hideout"],
        synced_projects=stats["synced_projects"],
        unmapped_count=stats["unmapped_count"],
        credits=stats["credits"],
    )


# ─── Kayıtlı verileri okuma ──────────────────────────────

@router.get("/accounts/{account_id}/data", response_model=FullSyncDataResponse)
async def get_synced_data(account_id: str, db: AsyncSession = Depends(get_db)):
    """Son sync edilen tüm verileri veritabanından döner (arctracker'a istek atmaz)."""
    acc = await _get_account(db, account_id)

    inv_result = await db.execute(
        select(InventoryItem)
        .where(InventoryItem.account_id == account_id)
        .options(selectinload(InventoryItem.mods))
    )
    inventory = inv_result.scalars().all()

    bp_result = await db.execute(
        select(LearnedBlueprint).where(LearnedBlueprint.account_id == account_id)
    )
    learned_bps = {bp.blueprint_id for bp in bp_result.scalars().all()}

    # Tüm blueprint'leri learned/unlearned olarak döndür
    blueprints = []
    for bp_id, ref in _BLUEPRINTS_REF.items():
        blueprints.append(BlueprintResponse(
            blueprint_id=bp_id,
            learned=bp_id in learned_bps,
            name_tr=ref.get("name_tr"),
            name_en=ref.get("name_en"),
            rarity=ref.get("rarity"),
            image=ref.get("image"),
        ))
    # Reference'da olmayan ama öğrenilmiş olanları da ekle
    for bp_id in learned_bps - set(_BLUEPRINTS_REF.keys()):
        blueprints.append(BlueprintResponse(
            blueprint_id=bp_id,
            learned=True,
        ))

    q_result = await db.execute(
        select(CharacterQuest).where(CharacterQuest.account_id == account_id)
    )
    quests = q_result.scalars().all()

    h_result = await db.execute(
        select(HideoutModule).where(HideoutModule.account_id == account_id)
    )
    hideout = h_result.scalars().all()

    p_result = await db.execute(
        select(CharacterProject).where(CharacterProject.account_id == account_id)
    )
    projects = p_result.scalars().all()

    return FullSyncDataResponse(
        credits=acc.credits,
        last_sync_at=acc.last_sync_at.isoformat() if acc.last_sync_at else None,
        inventory=inventory,
        blueprints=blueprints,
        quests=quests,
        hideout=hideout,
        projects=projects,
    )

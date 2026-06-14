"""Token refresh API endpoint'leri."""

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user, require_admin
from app.core.database import get_db
from app.models import TrackerAccount
from app.services.token_refresh import (
    auto_refresh,
    cancel_refresh,
    complete_refresh,
    get_refresh_status,
    handle_callback,
    start_refresh,
)

router = APIRouter(tags=["token-refresh"])


class CallbackPayload(BaseModel):
    code: str
    state: str


async def _get_account(db: AsyncSession, account_id: str) -> TrackerAccount:
    acc = await db.get(TrackerAccount, account_id)
    if not acc:
        raise HTTPException(404, "Hesap bulunamadı")
    return acc


@router.post("/accounts/{account_id}/refresh-token/start")
async def start_token_refresh(
    account_id: str,
    manual: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_admin),
):
    """
    Token refresh akışını başlatır.

    Xbox kimlik bilgileri varsa tam otomatik (auto_refresh) çalışır.
    Yoksa manuel akış: auth URL döndürür, kullanıcı tarayıcıda açar.
    """
    acc = await _get_account(db, account_id)

    # Xbox credentials varsa tam otomatik refresh
    if acc.xbox_email and acc.xbox_password and not manual:
        try:
            result = await auto_refresh(acc, db=db)
        except Exception as exc:
            raise HTTPException(502, f"Otomatik token refresh başarısız: {exc}")

        # Başarılıysa DB'yi de güncelle
        if result.get("status") == "success":
            try:
                await complete_refresh(db, acc)
            except Exception:
                pass  # DB update opsiyonel

        return result

    # Manuel akış
    try:
        result = await start_refresh(acc)
    except Exception as exc:
        raise HTTPException(502, f"Token refresh başlatılamadı: {exc}")

    return result


@router.post("/refresh-token/callback")
async def receive_callback(payload: CallbackPayload, _user=Depends(get_current_user)):
    try:
        result = await handle_callback(payload.code, payload.state)
    except Exception as exc:
        raise HTTPException(502, f"Callback işlenemedi: {exc}")

    if result.get("status") == "error":
        raise HTTPException(400, result.get("message", "Callback hatası"))

    return result


@router.get("/accounts/{account_id}/refresh-token/status")
async def check_refresh_status(account_id: str, db: AsyncSession = Depends(get_db), _user=Depends(get_current_user)):
    """
    Token yenilenmiş mi kontrol eder.
    status: waiting | success | error | no_session
    """
    await _get_account(db, account_id)
    return await get_refresh_status(account_id)


@router.post("/accounts/{account_id}/refresh-token/complete")
async def complete_token_refresh(account_id: str, db: AsyncSession = Depends(get_db), _user=Depends(require_admin)):
    """
    Token refresh tamamlandıysa DB'yi günceller.
    """
    acc = await _get_account(db, account_id)

    try:
        result = await complete_refresh(db, acc)
    except Exception as exc:
        raise HTTPException(502, f"Token refresh tamamlanamadı: {exc}")

    return result


@router.delete("/accounts/{account_id}/refresh-token")
async def cancel_token_refresh(account_id: str, db: AsyncSession = Depends(get_db), _user=Depends(require_admin)):
    """Aktif refresh oturumunu iptal eder."""
    await _get_account(db, account_id)
    cancel_refresh(account_id)
    return {"status": "cancelled"}

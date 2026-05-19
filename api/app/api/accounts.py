"""Hesap yönetimi endpoint'leri."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.account import TrackerAccount
from app.schemas.account import AccountCreate, AccountResponse

router = APIRouter(prefix="/accounts", tags=["accounts"])


@router.post("", response_model=AccountResponse, status_code=201)
async def create_account(payload: AccountCreate, db: AsyncSession = Depends(get_db)):
    # Email tekrarı kontrolü
    existing = await db.execute(
        select(TrackerAccount).where(TrackerAccount.arctracker_email == payload.arctracker_email)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(400, "Bu arctracker hesabı zaten kayıtlı")

    account = TrackerAccount(
        arctracker_email=payload.arctracker_email,
        arctracker_password=payload.arctracker_password,
    )
    db.add(account)
    await db.commit()
    await db.refresh(account)
    return account


@router.get("", response_model=list[AccountResponse])
async def list_accounts(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(TrackerAccount).order_by(TrackerAccount.created_at.desc()))
    return result.scalars().all()


@router.get("/{account_id}", response_model=AccountResponse)
async def get_account(account_id: str, db: AsyncSession = Depends(get_db)):
    account = await db.get(TrackerAccount, account_id)
    if not account:
        raise HTTPException(404, "Hesap bulunamadı")
    return account


@router.delete("/{account_id}", status_code=204)
async def delete_account(account_id: str, db: AsyncSession = Depends(get_db)):
    account = await db.get(TrackerAccount, account_id)
    if not account:
        raise HTTPException(404, "Hesap bulunamadı")
    await db.delete(account)
    await db.commit()

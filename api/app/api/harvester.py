"""Harvester download info and its API key.

The harvester key only opens token-push. It is stored encrypted in
app_settings, shown to every signed-in user so they can paste it into the
app, and can be replaced by an admin.
"""

import hmac
import secrets

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user, require_admin
from app.core.config import settings
from app.core.crypto import decrypt_value, encrypt_value
from app.core.database import get_db
from app.models import AppSetting, User

router = APIRouter(tags=["harvester"])

# Update these when a new harvester release is published.
LATEST_VERSION = "2.1.0"
_RELEASE = f"https://github.com/kemkum53/arc-vault/releases/download/v{LATEST_VERSION}"
# GitHub stores asset names with spaces replaced by dots.
DOWNLOAD_URL = f"{_RELEASE}/ARC.Vault.Harvester.exe"
SETUP_URL = f"{_RELEASE}/ARC-Vault-Harvester-Setup.exe"

KEY_NAME = "harvester_api_key"


def _new_key() -> str:
    return "avh_" + secrets.token_urlsafe(32)


async def get_harvester_key(db: AsyncSession) -> str:
    """The current harvester key; created on first use."""
    row = await db.get(AppSetting, KEY_NAME)
    if row is None:
        await db.execute(
            insert(AppSetting)
            .values(key=KEY_NAME, value=encrypt_value(_new_key()), updated_by="system")
            .on_conflict_do_nothing(index_elements=["key"])
        )
        await db.commit()
        row = await db.get(AppSetting, KEY_NAME)
    return decrypt_value(row.value)


async def require_harvester_key(
    x_api_key: str = Header(None), db: AsyncSession = Depends(get_db),
) -> None:
    """Accept the harvester key, or the older internal key that existing installs still carry."""
    if not x_api_key:
        raise HTTPException(401, "Geçersiz API key")
    candidates = [await get_harvester_key(db)]
    if settings.internal_api_key:
        candidates.append(settings.internal_api_key)
    if not any(hmac.compare_digest(x_api_key, c) for c in candidates):
        raise HTTPException(401, "Geçersiz API key")


@router.get("/harvester/version")
async def get_harvester_version():
    """Used by the harvester's update check; no auth."""
    return {"version": LATEST_VERSION, "url": DOWNLOAD_URL}


async def _info(db: AsyncSession) -> dict:
    key = await get_harvester_key(db)
    row = await db.get(AppSetting, KEY_NAME)
    return {
        "version": LATEST_VERSION,
        "setup_url": SETUP_URL,
        "portable_url": DOWNLOAD_URL,
        "api_key": key,
        "key_updated_at": row.updated_at.isoformat() if row.updated_at else None,
        "key_updated_by": row.updated_by,
    }


@router.get("/harvester/info")
async def get_harvester_info(db: AsyncSession = Depends(get_db), _user: User = Depends(get_current_user)):
    return await _info(db)


@router.post("/harvester/key/rotate")
async def rotate_harvester_key(db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    """Replace the key. Installs using the old one stop pushing until updated."""
    await get_harvester_key(db)
    row = await db.get(AppSetting, KEY_NAME)
    row.value = encrypt_value(_new_key())
    row.updated_by = admin.username
    await db.commit()
    await db.refresh(row)
    return await _info(db)

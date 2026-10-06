"""Harvester download info and its API key.

The harvester key only opens token-push. It is stored encrypted in
app_settings, shown to every signed-in user so they can paste it into the
app, and can be replaced by an admin.
"""

import hmac
import logging
import secrets
import time

import httpx

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user, require_admin
from app.core.config import settings
from app.core.crypto import decrypt_value, encrypt_value
from app.core.database import get_db
from app.models import AppSetting, User

router = APIRouter(tags=["harvester"])

# Fallback when GitHub cannot be reached. The live values come from the
# latest GitHub release, so publishing a release needs no API change.
FALLBACK_VERSION = "2.1.0"
GITHUB_REPO = "kemkum53/arc-vault"
# GitHub stores asset names with spaces replaced by dots.
PORTABLE_ASSET = "ARC.Vault.Harvester.exe"
SETUP_ASSET = "ARC-Vault-Harvester-Setup.exe"
RELEASE_CACHE_SECONDS = 600

logger = logging.getLogger(__name__)


def _release_urls(version: str) -> dict:
    base = f"https://github.com/{GITHUB_REPO}/releases/download/v{version}"
    return {"version": version, "portable_url": f"{base}/{PORTABLE_ASSET}", "setup_url": f"{base}/{SETUP_ASSET}"}


_release: dict = _release_urls(FALLBACK_VERSION)
_release_checked_at = 0.0


async def latest_release() -> dict:
    """Newest GitHub release that already has both downloads, cached for 10 minutes.

    A release whose assets are still uploading is ignored, so the update
    check never points installs at a file that is not there yet. On any
    error the last known release (or the fallback) is kept.
    """
    global _release, _release_checked_at
    if time.monotonic() - _release_checked_at < RELEASE_CACHE_SECONDS:
        return _release
    _release_checked_at = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest",
                headers={"Accept": "application/vnd.github+json"},
            )
        resp.raise_for_status()
        data = resp.json()
        version = str(data.get("tag_name", "")).lstrip("v")
        tuple(int(x) for x in version.split("."))  # reject tags that are not plain versions
        assets = {a.get("name") for a in data.get("assets", [])}
        if {PORTABLE_ASSET, SETUP_ASSET} <= assets:
            _release = _release_urls(version)
        else:
            logger.info("Harvester release v%s has no downloads yet, keeping v%s", version, _release["version"])
    except Exception as exc:
        logger.warning("Harvester release check failed, keeping v%s: %s", _release["version"], exc)
    return _release


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
    rel = await latest_release()
    return {"version": rel["version"], "url": rel["portable_url"]}


async def _info(db: AsyncSession) -> dict:
    key = await get_harvester_key(db)
    row = await db.get(AppSetting, KEY_NAME)
    rel = await latest_release()
    return {
        "version": rel["version"],
        "setup_url": rel["setup_url"],
        "portable_url": rel["portable_url"],
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

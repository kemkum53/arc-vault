"""Reusable arctracker web sessions.

Signing in on every sync or token push is wasteful and, during an arctracker
auth outage, hammers their sign-in endpoint. The session cookie is stored per
account (encrypted) and reused until arctracker rejects it; only then do we
sign in again, once.
"""

import logging
from collections.abc import Awaitable, Callable
from datetime import datetime, timezone
from typing import TypeVar

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crypto import decrypt_value, encrypt_value
from app.models import TrackerAccount
from app.services import arctracker_client
from app.services.arctracker_client import SessionExpired

logger = logging.getLogger(__name__)

T = TypeVar("T")


async def _sign_in(db: AsyncSession, account: TrackerAccount) -> str:
    cookie = await arctracker_client.authenticate(
        account.arctracker_email,
        decrypt_value(account.arctracker_password),
    )
    account.arctracker_session = encrypt_value(cookie)
    account.arctracker_session_at = datetime.now(timezone.utc)
    # Keep the new session even if the work that follows fails.
    await db.commit()
    logger.info("arctracker oturumu yenilendi: %s", account.display_name or account.arctracker_email)
    return cookie


async def _forget(db: AsyncSession, account: TrackerAccount) -> None:
    account.arctracker_session = None
    account.arctracker_session_at = None
    await db.commit()


async def with_session(
    db: AsyncSession,
    account: TrackerAccount,
    action: Callable[[str], Awaitable[T]],
) -> T:
    """Run action(cookie) with the stored session; sign in again once if it is rejected."""
    if account.arctracker_session:
        cookie = decrypt_value(account.arctracker_session)
        try:
            return await action(cookie)
        except SessionExpired:
            logger.info("arctracker oturumu geçersiz, yeniden giriş: %s", account.display_name or account.arctracker_email)
            await _forget(db, account)
    cookie = await _sign_in(db, account)
    try:
        return await action(cookie)
    except SessionExpired as exc:
        await _forget(db, account)
        raise ValueError(f"arctracker yeni oturumu da kabul etmedi ({exc})") from exc

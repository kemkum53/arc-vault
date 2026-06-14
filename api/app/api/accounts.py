"""Hesap yönetimi endpoint'leri."""

import base64
import json
import logging
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user, require_admin
from app.core.config import settings
from app.core.crypto import encrypt_value, decrypt_value
from app.core.database import get_db
from app.models.account import TrackerAccount
from app.models.pending_token import PendingEmbarkToken
from app.models.user import User
from app.schemas.account import AccountCreate, AccountResponse, AccountUpdate, PendingTokenAssign, PendingTokenResponse
from app.services.token_refresh import _build_cookie_string

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/accounts", tags=["accounts"])


@router.post("", response_model=AccountResponse, status_code=201)
async def create_account(payload: AccountCreate, db: AsyncSession = Depends(get_db), _user: User = Depends(get_current_user)):
    existing = await db.execute(
        select(TrackerAccount).where(TrackerAccount.arctracker_email == payload.arctracker_email)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(400, "Bu arctracker hesabı zaten kayıtlı")

    account = TrackerAccount(
        arctracker_email=payload.arctracker_email,
        arctracker_password=encrypt_value(payload.arctracker_password),
        xbox_email=payload.xbox_email,
        xbox_password=encrypt_value(payload.xbox_password) if payload.xbox_password else None,
    )
    db.add(account)
    await db.commit()
    await db.refresh(account)
    return account


@router.get("", response_model=list[AccountResponse])
async def list_accounts(db: AsyncSession = Depends(get_db), _user: User = Depends(get_current_user)):
    result = await db.execute(select(TrackerAccount).order_by(TrackerAccount.created_at.desc()))
    return result.scalars().all()


@router.get("/admin-options")
async def list_account_options(db: AsyncSession = Depends(get_db), _user: User = Depends(require_admin)):
    result = await db.execute(select(TrackerAccount).order_by(TrackerAccount.created_at.desc()))
    accounts = result.scalars().all()
    return [
        {
            "id": account.id,
            "label": (
                f"{account.display_name}#{account.display_name_discriminator or '0000'}"
                if account.display_name else account.arctracker_email
            ),
            "arctracker_email": account.arctracker_email,
            "display_name": account.display_name,
            "display_name_discriminator": account.display_name_discriminator,
            "embark_user_id": account.embark_user_id,
        }
        for account in accounts
    ]


@router.get("/{account_id}", response_model=AccountResponse)
async def get_account(account_id: str, db: AsyncSession = Depends(get_db), _user: User = Depends(get_current_user)):
    account = await db.get(TrackerAccount, account_id)
    if not account:
        raise HTTPException(404, "Hesap bulunamadı")
    return account


@router.patch("/{account_id}", response_model=AccountResponse)
async def update_account(account_id: str, payload: AccountUpdate, db: AsyncSession = Depends(get_db), _user: User = Depends(require_admin)):
    account = await db.get(TrackerAccount, account_id)
    if not account:
        raise HTTPException(404, "Hesap bulunamadı")
    if payload.xbox_email is not None:
        account.xbox_email = payload.xbox_email
    if payload.xbox_password is not None:
        account.xbox_password = encrypt_value(payload.xbox_password)
    await db.commit()
    await db.refresh(account)
    return account


@router.get("/{account_id}/credentials")
async def get_credentials(account_id: str, db: AsyncSession = Depends(get_db), _user: User = Depends(require_admin)):
    """Şifresi çözülmüş kimlik bilgilerini döndürür (sadece admin, Pi scheduler için)."""
    account = await db.get(TrackerAccount, account_id)
    if not account:
        raise HTTPException(404, "Hesap bulunamadı")
    if not account.xbox_email or not account.xbox_password:
        raise HTTPException(400, "Xbox kimlik bilgileri eksik")
    return {
        "arctracker_email": account.arctracker_email,
        "arctracker_password": decrypt_value(account.arctracker_password),
        "xbox_email": account.xbox_email,
        "xbox_password": decrypt_value(account.xbox_password),
    }


class EmbarkStatusPayload(dict):
    pass


@router.post("/{account_id}/embark-status")
async def update_embark_status(account_id: str, payload: dict, db: AsyncSession = Depends(get_db), _user: User = Depends(require_admin)):
    """Pi scheduler'dan gelen embark status sonucunu DB'ye yazar."""
    account = await db.get(TrackerAccount, account_id)
    if not account:
        raise HTTPException(404, "Hesap bulunamadı")
    from app.services.sync_service import _extract_embark_status
    _extract_embark_status(account, payload)
    await db.commit()
    return {"ok": True}


@router.delete("/{account_id}", status_code=204)
async def delete_account(account_id: str, db: AsyncSession = Depends(get_db), _user: User = Depends(require_admin)):
    account = await db.get(TrackerAccount, account_id)
    if not account:
        raise HTTPException(404, "Hesap bulunamadı")

    try:
        await _unlink_embark_from_arctracker(
            account.arctracker_email,
            decrypt_value(account.arctracker_password),
        )
    except Exception:
        logger.warning("[Accounts] Unlink basarisiz (devam ediliyor)")

    await db.delete(account)
    await db.commit()


def _decode_embark_payload(token: str) -> dict:
    try:
        p = token.split(".")[1]
        p += "=" * (4 - len(p) % 4)
        return json.loads(base64.urlsafe_b64decode(p))
    except Exception:
        return {}


def _token_expiry(payload: dict) -> datetime | None:
    exp = payload.get("exp")
    if not exp:
        return None
    try:
        return datetime.fromtimestamp(int(exp), tz=timezone.utc)
    except Exception:
        return None


def _as_aware_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _as_str(value) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _mask_identifier(value: str | None, visible: int = 8) -> str:
    if not value:
        return "-"
    text = str(value)
    if len(text) <= visible:
        return "..." + text
    return "..." + text[-visible:]


def _token_identity_values(payload: dict) -> list[tuple[str, str]]:
    ext = payload.get("ext") if isinstance(payload.get("ext"), dict) else {}
    values = [
        ("embark_user_id", _as_str(ext.get("embark_user_id"))),
        ("sub", _as_str(payload.get("sub"))),
    ]
    seen = set()
    unique = []
    for label, value in values:
        if value and value not in seen:
            unique.append((label, value))
            seen.add(value)
    return unique


def _is_safe_precision_match(incoming: str, stored: str) -> bool:
    """Match IDs that likely lost precision as JS numbers, e.g. ...3222 -> ...3000."""
    if not incoming.isdigit() or not stored.isdigit():
        return False
    if len(incoming) != len(stored) or len(incoming) < 16:
        return False
    return incoming[:16] == stored[:16]


async def _find_token_push_account(db: AsyncSession, payload: dict) -> tuple[TrackerAccount | None, str | None, str | None]:
    identities = _token_identity_values(payload)
    columns = [
        ("embark_user_id", TrackerAccount.embark_user_id),
        ("embark_account_id", TrackerAccount.embark_account_id),
    ]

    for source_label, value in identities:
        for column_label, column in columns:
            result = await db.execute(select(TrackerAccount).where(column == value))
            account = result.scalar_one_or_none()
            if account:
                return account, f"exact:{source_label}->{column_label}", value

    for source_label, value in identities:
        if not value.isdigit() or len(value) < 16:
            continue
        prefix = value[:16]
        candidates: dict[str, tuple[TrackerAccount, str]] = {}
        for column_label, column in columns:
            result = await db.execute(select(TrackerAccount).where(column.like(f"{prefix}%")))
            for account in result.scalars().all():
                stored = getattr(account, column_label)
                if stored and _is_safe_precision_match(value, stored):
                    candidates[account.id] = (account, column_label)

        if len(candidates) == 1:
            account, column_label = next(iter(candidates.values()))
            stored = getattr(account, column_label)
            if stored != value:
                setattr(account, column_label, value)
            return account, f"precision:{source_label}->{column_label}", value
        if len(candidates) > 1:
            logger.warning(
                "[TokenPush] precision fallback ambiguous for %s=%s (%d candidates)",
                source_label,
                _mask_identifier(value),
                len(candidates),
            )

    return None, None, identities[0][1] if identities else None


def _compact_payload(payload: dict) -> dict:
    ext = payload.get("ext") if isinstance(payload.get("ext"), dict) else {}
    return {
        "sub": payload.get("sub"),
        "ext": {
            "embark_user_id": ext.get("embark_user_id"),
            "provider": ext.get("provider"),
            "name": ext.get("name"),
        },
        "exp": payload.get("exp"),
        "iat": payload.get("iat"),
        "iss": payload.get("iss"),
        "aud": payload.get("aud"),
    }


async def _save_pending_token(db: AsyncSession, embark_jwt: str, payload: dict) -> PendingEmbarkToken:
    identities = dict(_token_identity_values(payload))
    embark_user_id = identities.get("embark_user_id")
    sub = identities.get("sub")
    conditions = []
    if embark_user_id:
        conditions.append(PendingEmbarkToken.embark_user_id == embark_user_id)
    if sub:
        conditions.append(PendingEmbarkToken.sub == sub)

    pending = None
    if conditions:
        result = await db.execute(
            select(PendingEmbarkToken)
            .where(PendingEmbarkToken.status == "pending")
            .where(or_(*conditions))
            .order_by(PendingEmbarkToken.last_seen_at.desc())
        )
        pending = result.scalars().first()

    if pending:
        pending.encrypted_embark_jwt = encrypt_value(embark_jwt)
        pending.token_payload = _compact_payload(payload)
        pending.token_expires_at = _token_expiry(payload)
        pending.seen_count = (pending.seen_count or 0) + 1
        pending.last_seen_at = datetime.now(timezone.utc)
    else:
        pending = PendingEmbarkToken(
            embark_user_id=embark_user_id,
            sub=sub,
            token_expires_at=_token_expiry(payload),
            encrypted_embark_jwt=encrypt_value(embark_jwt),
            token_payload=_compact_payload(payload),
            source="harvester",
            status="pending",
            seen_count=1,
        )
        db.add(pending)

    await db.commit()
    await db.refresh(pending)
    return pending


async def _submit_token_for_account(
    db: AsyncSession,
    account: TrackerAccount,
    embark_jwt: str,
    emb: dict,
    matched_id: str | None,
    match_strategy: str,
) -> dict:
    from app.services.arctracker_bridge import ensure_bridge_jwt, submit_embark_token

    incoming_expires_at = _token_expiry(emb)
    current_expires_at = _as_aware_utc(account.token_expires_at)
    if incoming_expires_at and current_expires_at and incoming_expires_at <= current_expires_at:
        logger.info(
            "[TokenPush] eski/aynı token atlandı: account=%s incoming=%s current=%s",
            account.id,
            incoming_expires_at.isoformat(),
            current_expires_at.isoformat(),
        )
        if account.is_token_expired:
            account.is_token_expired = current_expires_at <= datetime.now(timezone.utc)
            await db.commit()
        return {
            "ok": True,
            "displayName": account.display_name,
            "discriminator": account.display_name_discriminator,
            "syncEnabled": False,
            "embark_user_id": matched_id,
            "match_strategy": match_strategy,
            "skipped": "already_current",
            "token_expires_at": current_expires_at.isoformat(),
        }

    try:
        bridge_jwt = await ensure_bridge_jwt(account, db)
    except Exception as exc:
        logger.error("[TokenPush] Bridge JWT alınamadı (%s): %s", account.arctracker_email, exc)
        raise HTTPException(502, f"arctracker.io girişi başarısız: {exc}")

    try:
        resp = await submit_embark_token(bridge_jwt, embark_jwt)
    except Exception as exc:
        logger.error("[TokenPush] Embark token gönderilemedi: %s", exc)
        raise HTTPException(502, f"arctracker.io token submit başarısız: {exc}")

    if not resp.get("success"):
        raise HTTPException(502, f"arctracker.io hata döndürdü: {resp}")

    if incoming_expires_at:
        account.token_expires_at = incoming_expires_at
    account.is_token_expired = False

    name = f"{resp.get('displayName', '?')}#{resp.get('displayNameDiscriminator', '?')}"
    logger.info("[TokenPush] ✓ %s | embark_id=%s", name, _mask_identifier(matched_id))

    await db.commit()
    return {
        "ok": True,
        "displayName": resp.get("displayName"),
        "discriminator": resp.get("displayNameDiscriminator"),
        "syncEnabled": resp.get("syncEnabled"),
        "embark_user_id": matched_id,
        "match_strategy": match_strategy,
    }


async def _require_internal_key(x_api_key: str = Header(None)) -> None:
    key = settings.internal_api_key
    if not key:
        raise HTTPException(503, "Internal API key yapılandırılmamış")
    if x_api_key != key:
        raise HTTPException(401, "Geçersiz API key")


@router.post("/token-push")
async def token_push(
    payload: dict,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(_require_internal_key),
):
    """Harvester'dan gelen Embark JWT'yi arctracker.io bridge API'ye iletir.

    Body: {"embark_jwt": "eyJ..."}
    Header: X-Api-Key: <internal_api_key>
    """
    embark_jwt = payload.get("embark_jwt", "")
    if not embark_jwt:
        raise HTTPException(400, "embark_jwt gerekli")

    emb = _decode_embark_payload(embark_jwt)
    identities = _token_identity_values(emb)
    if not identities:
        raise HTTPException(400, "Embark JWT payload okunamadı")

    account, match_strategy, matched_id = await _find_token_push_account(db, emb)

    if not account:
        pending = await _save_pending_token(db, embark_jwt, emb)
        masked_identities = [(label, _mask_identifier(value)) for label, value in identities]
        logger.warning(
            "[TokenPush] identities=%s için kayıtlı hesap bulunamadı (pending=%s)",
            masked_identities,
            pending.id,
        )
        raise HTTPException(
            404,
            f"embark_id={_mask_identifier(matched_id)} için hesap bulunamadı. "
            "Admin panelinden pending token'ı hesaba bağlayın.",
        )
    logger.info(
        "[TokenPush] hesap eşleşti: %s#%s (%s)",
        account.display_name or "?",
        account.display_name_discriminator or "?",
        match_strategy,
    )

    return await _submit_token_for_account(db, account, embark_jwt, emb, matched_id, match_strategy)


@router.get("/token-push/pending", response_model=list[PendingTokenResponse])
async def list_pending_tokens(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin),
):
    result = await db.execute(
        select(PendingEmbarkToken)
        .where(PendingEmbarkToken.status == "pending")
        .order_by(PendingEmbarkToken.last_seen_at.desc())
    )
    return result.scalars().all()


@router.post("/token-push/pending/{pending_id}/assign")
async def assign_pending_token(
    pending_id: str,
    payload: PendingTokenAssign,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin),
):
    pending = await db.get(PendingEmbarkToken, pending_id)
    if not pending or pending.status != "pending":
        raise HTTPException(404, "Pending token bulunamadı")

    account = await db.get(TrackerAccount, payload.account_id)
    if not account:
        raise HTTPException(404, "Hesap bulunamadı")

    if pending.embark_user_id:
        account.embark_user_id = pending.embark_user_id
    if pending.sub and pending.sub != pending.embark_user_id:
        account.embark_account_id = pending.sub

    embark_jwt = decrypt_value(pending.encrypted_embark_jwt)
    emb = _decode_embark_payload(embark_jwt)
    result = await _submit_token_for_account(
        db,
        account,
        embark_jwt,
        emb,
        pending.embark_user_id or pending.sub,
        "manual-pending",
    )

    pending.status = "resolved"
    pending.resolved_account_id = account.id
    pending.resolved_at = datetime.now(timezone.utc)
    await db.commit()

    return {"ok": True, "account_id": account.id, "result": result}


async def _unlink_embark_from_arctracker(email: str, password: str) -> None:
    BASE = settings.arctracker_base_url
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            f"{BASE}/api/auth/sign-in/email",
            json={"email": email, "password": password},
        )
        if resp.status_code != 200:
            return

        cookie = _build_cookie_string(resp)
        if not cookie:
            return

        headers = {"Cookie": cookie}
        status_resp = await client.get(f"{BASE}/api/embark/status", headers=headers)
        if status_resp.status_code == 200:
            status = status_resp.json()
            if status.get("isLinked"):
                await client.delete(f"{BASE}/api/embark/status", headers=headers)

"""JWT auth: kısa ömürlü access token + DB'de saklanan rotasyonlu refresh token."""

import hashlib
import secrets
from datetime import datetime, timezone, timedelta

import jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, Header
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.models.refresh_token import RefreshToken
from app.models.user import User

pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")

ALGORITHM = "HS256"
ACCESS_TOKEN_TTL = timedelta(minutes=30)
REFRESH_TOKEN_TTL = timedelta(days=30)
# Rotasyondan hemen sonra gelen tekrar istekleri (paralel sekmeler, retry) hırsızlık
# sayılmasın diye kısa bir tolerans penceresi.
REFRESH_REUSE_LEEWAY = timedelta(seconds=30)


def hash_password(plain: str) -> str:
    return pwd.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd.verify(plain, hashed)


def create_access_token(user_id: str, username: str, role: str, token_version: int = 0) -> str:
    exp = datetime.now(timezone.utc) + ACCESS_TOKEN_TTL
    return jwt.encode(
        {
            "sub": user_id,
            "username": username,
            "role": role,
            "ver": token_version,
            "typ": "access",
            "exp": exp,
        },
        settings.jwt_secret,
        algorithm=ALGORITHM,
    )


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[ALGORITHM])
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Geçersiz token")


async def get_current_user(
    authorization: str = Header(None),
    db: AsyncSession = Depends(get_db),
) -> User:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Yetkilendirme gerekli")
    payload = decode_token(authorization[7:])
    if payload.get("typ", "access") != "access":
        raise HTTPException(401, "Geçersiz token türü")
    user = await db.get(User, payload["sub"])
    if not user:
        raise HTTPException(401, "Kullanıcı bulunamadı")
    if payload.get("ver", 0) != user.token_version:
        raise HTTPException(401, "Token iptal edilmiş")
    return user


async def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(403, "Admin yetkisi gerekli")
    return user


# ─── Refresh token ───


def _as_utc(value: datetime) -> datetime:
    """SQLite tz bilgisini saklamaz; naive değerleri UTC kabul et."""
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _hash_refresh_token(raw: str) -> str:
    """Refresh token'lar yüksek entropili rastgele değerler; sha256 yeterli ve sabit maliyetli."""
    return hashlib.sha256(raw.encode()).hexdigest()


async def _create_refresh_token(
    db: AsyncSession, user: User, user_agent: str | None
) -> tuple[RefreshToken, str]:
    raw = secrets.token_urlsafe(48)
    record = RefreshToken(
        user_id=user.id,
        token_hash=_hash_refresh_token(raw),
        expires_at=datetime.now(timezone.utc) + REFRESH_TOKEN_TTL,
        user_agent=user_agent[:255] if user_agent else None,
    )
    db.add(record)
    await db.flush()
    return record, raw


async def issue_refresh_token(db: AsyncSession, user: User, user_agent: str | None = None) -> str:
    """Yeni refresh token üretir, hash'ini kaydeder ve ham değeri döner (bir daha görülemez)."""
    _, raw = await _create_refresh_token(db, user, user_agent)
    return raw


async def revoke_refresh_token(db: AsyncSession, raw: str) -> None:
    """Tek bir refresh token'ı iptal eder (logout). Bilinmeyen token sessizce yok sayılır."""
    result = await db.execute(
        select(RefreshToken).where(RefreshToken.token_hash == _hash_refresh_token(raw))
    )
    record = result.scalar_one_or_none()
    if record and record.revoked_at is None:
        record.revoked_at = datetime.now(timezone.utc)


async def revoke_all_refresh_tokens(db: AsyncSession, user_id: str) -> None:
    """Kullanıcının tüm aktif refresh token'larını iptal eder."""
    await db.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=datetime.now(timezone.utc))
    )


async def rotate_refresh_token(
    db: AsyncSession, raw: str, user_agent: str | None = None
) -> tuple[User, str, str]:
    """Refresh token'ı doğrular, döndürür ve yeni (access, refresh) çifti üretir.

    Zaten iptal edilmiş bir token yeniden kullanılırsa çalınmış sayılır: kullanıcının
    token_version'ı artırılır ve tüm oturumları düşürülür.
    """
    result = await db.execute(
        select(RefreshToken).where(RefreshToken.token_hash == _hash_refresh_token(raw))
    )
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(401, "Geçersiz refresh token")

    now = datetime.now(timezone.utc)

    if record.revoked_at is not None:
        if record.replaced_by is None:
            # Logout ya da admin iptali — kasıtlı, tolerans yok.
            raise HTTPException(401, "Refresh token iptal edilmiş")
        if now - _as_utc(record.revoked_at) > REFRESH_REUSE_LEEWAY:
            # Reuse tespiti — bu zincir ele geçmiş olabilir, kullanıcının her yerdeki oturumunu düşür.
            user = await db.get(User, record.user_id)
            if user:
                user.token_version += 1
            await revoke_all_refresh_tokens(db, record.user_id)
            await db.commit()
            raise HTTPException(401, "Refresh token yeniden kullanıldı, oturumlar iptal edildi")
        # Tolerans penceresi içinde rotasyon tekrarı: yeni bir çift ver, alarm verme.

    if _as_utc(record.expires_at) <= now:
        record.revoked_at = record.revoked_at or now
        await db.commit()
        raise HTTPException(401, "Refresh token süresi dolmuş")

    user = await db.get(User, record.user_id)
    if not user:
        raise HTTPException(401, "Kullanıcı bulunamadı")

    new_record, new_raw = await _create_refresh_token(db, user, user_agent)
    # Tolerans penceresinden geldiyse ilk rotasyonun zincir bilgisini koru.
    if record.revoked_at is None:
        record.revoked_at = now
        record.replaced_by = new_record.id

    access = create_access_token(user.id, user.username, user.role, user.token_version)
    return user, access, new_raw


async def purge_expired_refresh_tokens(db: AsyncSession) -> None:
    """Süresi dolmuş kayıtları siler; tablo sınırsız büyümesin diye rotasyonda çağrılır."""
    await db.execute(
        delete(RefreshToken).where(RefreshToken.expires_at < datetime.now(timezone.utc))
    )

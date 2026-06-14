"""JWT auth: 7 günlük token, admin/user rolleri, token versiyonlama."""

from datetime import datetime, timezone, timedelta

import jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, Header
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.models.user import User

pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")

ALGORITHM = "HS256"
TOKEN_TTL = timedelta(days=7)


def hash_password(plain: str) -> str:
    return pwd.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd.verify(plain, hashed)


def create_token(user_id: str, username: str, role: str, token_version: int = 0) -> str:
    exp = datetime.now(timezone.utc) + TOKEN_TTL
    return jwt.encode(
        {"sub": user_id, "username": username, "role": role, "ver": token_version, "exp": exp},
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

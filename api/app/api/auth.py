"""Login ve kullanıcı yönetimi endpoint'leri."""

import time
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import delete, select, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import (
    hash_password,
    verify_password,
    create_access_token,
    get_current_user,
    require_admin,
    issue_refresh_token,
    rotate_refresh_token,
    revoke_refresh_token,
    revoke_all_refresh_tokens,
    purge_expired_refresh_tokens,
)
from app.core.database import get_db
from app.models.refresh_token import RefreshToken
from app.models.user import User

router = APIRouter(tags=["auth"])

MAX_LOGIN_ATTEMPTS = 5
RATE_LIMIT_WINDOW = 60
_CLEANUP_INTERVAL = 3600  # eski IP kayıtlarını saatte bir temizle

_login_attempts: dict[str, list[float]] = defaultdict(list)
_last_cleanup: float = time.time()


def _check_rate_limit(ip: str) -> None:
    global _last_cleanup
    now = time.time()

    # Saatte bir tüm eski IP kayıtlarını sil (bellek sızıntısı önlemi)
    if now - _last_cleanup > _CLEANUP_INTERVAL:
        cutoff = now - RATE_LIMIT_WINDOW
        stale = [k for k, v in _login_attempts.items() if not v or max(v) < cutoff]
        for k in stale:
            del _login_attempts[k]
        _last_cleanup = now

    window_start = now - RATE_LIMIT_WINDOW
    _login_attempts[ip] = [t for t in _login_attempts[ip] if t > window_start]
    if len(_login_attempts[ip]) >= MAX_LOGIN_ATTEMPTS:
        raise HTTPException(429, "Çok fazla deneme. Lütfen bekleyin.")


def _record_attempt(ip: str) -> None:
    _login_attempts[ip].append(time.time())


class LoginRequest(BaseModel):
    username: str
    password: str


class CreateUserRequest(BaseModel):
    username: str
    password: str
    role: str = "user"


class RefreshRequest(BaseModel):
    refresh_token: str


def _user_agent(request: Request) -> str | None:
    return request.headers.get("user-agent")


@router.post("/auth/login")
async def login(body: LoginRequest, request: Request, db: AsyncSession = Depends(get_db)):
    client_ip = request.client.host if request.client else "unknown"
    _check_rate_limit(client_ip)
    _record_attempt(client_ip)

    result = await db.execute(select(User).where(User.username == body.username))
    user = result.scalar_one_or_none()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "Kullanıcı adı veya şifre hatalı")
    token = create_access_token(user.id, user.username, user.role, user.token_version)
    refresh = await issue_refresh_token(db, user, _user_agent(request))
    await db.commit()
    return {
        "token": token,
        "refresh_token": refresh,
        "user": {"id": user.id, "username": user.username, "role": user.role},
    }


@router.post("/auth/refresh")
async def refresh(body: RefreshRequest, request: Request, db: AsyncSession = Depends(get_db)):
    user, token, new_refresh = await rotate_refresh_token(db, body.refresh_token, _user_agent(request))
    await purge_expired_refresh_tokens(db)
    await db.commit()
    return {
        "token": token,
        "refresh_token": new_refresh,
        "user": {"id": user.id, "username": user.username, "role": user.role},
    }


@router.post("/auth/logout", status_code=204)
async def logout(body: RefreshRequest, db: AsyncSession = Depends(get_db)):
    """Refresh token'ı iptal eder. Access token'ı olmayan (süresi dolmuş) istemciler de çağırabilir."""
    await revoke_refresh_token(db, body.refresh_token)
    await db.commit()


@router.get("/auth/me")
async def me(user: User = Depends(get_current_user)):
    return {"id": user.id, "username": user.username, "role": user.role}


class UpdateUserRequest(BaseModel):
    username: str | None = None
    password: str | None = None
    role: str | None = None


@router.get("/auth/users")
async def list_users(db: AsyncSession = Depends(get_db), _admin: User = Depends(require_admin)):
    result = await db.execute(select(User).order_by(User.created_at))
    users = result.scalars().all()
    return [{"id": u.id, "username": u.username, "role": u.role, "created_at": u.created_at.isoformat()} for u in users]


@router.post("/auth/users")
async def create_user(body: CreateUserRequest, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    existing = await db.execute(select(User).where(User.username == body.username))
    if existing.scalar_one_or_none():
        raise HTTPException(409, "Bu kullanıcı adı zaten mevcut")
    user = User(username=body.username, password_hash=hash_password(body.password), role=body.role)
    db.add(user)
    await db.commit()
    return {"id": user.id, "username": user.username, "role": user.role}


@router.patch("/auth/users/{user_id}")
async def update_user(user_id: str, body: UpdateUserRequest, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "Kullanıcı bulunamadı")
    if body.username is not None:
        existing = await db.execute(select(User).where(User.username == body.username, User.id != user_id))
        if existing.scalar_one_or_none():
            raise HTTPException(409, "Bu kullanıcı adı zaten mevcut")
        user.username = body.username
    revoke_sessions = False
    if body.password is not None:
        user.password_hash = hash_password(body.password)
        user.token_version += 1
        revoke_sessions = True
    if body.role is not None:
        admin_count = await db.scalar(select(func.count()).select_from(User).where(User.role == "admin"))
        if user.role == "admin" and body.role != "admin" and admin_count <= 1:
            raise HTTPException(400, "Son admin kullanıcının rolü değiştirilemez")
        user.role = body.role
        user.token_version += 1
        revoke_sessions = True
    if revoke_sessions:
        await revoke_all_refresh_tokens(db, user.id)
    await db.commit()
    return {"id": user.id, "username": user.username, "role": user.role}


@router.delete("/auth/users/{user_id}", status_code=204)
async def delete_user(user_id: str, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "Kullanıcı bulunamadı")
    if user.id == admin.id:
        raise HTTPException(400, "Kendinizi silemezsiniz")
    admin_count = await db.scalar(select(func.count()).select_from(User).where(User.role == "admin"))
    if user.role == "admin" and admin_count <= 1:
        raise HTTPException(400, "Son admin kullanıcı silinemez")
    # SQLite'ta FK cascade varsayılan olarak kapalı — kayıtları açıkça sil.
    await db.execute(delete(RefreshToken).where(RefreshToken.user_id == user.id))
    await db.delete(user)
    await db.commit()


@router.post("/auth/users/{user_id}/revoke-token")
async def revoke_user_token(user_id: str, db: AsyncSession = Depends(get_db), _admin: User = Depends(require_admin)):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "Kullanıcı bulunamadı")
    user.token_version += 1
    await revoke_all_refresh_tokens(db, user.id)
    await db.commit()
    return {"status": "revoked", "username": user.username}


@router.get("/auth/setup-status")
async def setup_status(db: AsyncSession = Depends(get_db)):
    count = await db.scalar(select(func.count()).select_from(User))
    return {"needs_setup": count == 0}


@router.post("/auth/setup")
async def initial_setup(body: LoginRequest, request: Request, db: AsyncSession = Depends(get_db)):
    client_ip = request.client.host if request.client else "unknown"
    _check_rate_limit(client_ip)
    _record_attempt(client_ip)

    count = await db.scalar(select(func.count()).select_from(User))
    if count > 0:
        raise HTTPException(403, "Kurulum zaten tamamlanmış")
    user = User(username=body.username, password_hash=hash_password(body.password), role="admin")
    db.add(user)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(403, "Kurulum zaten tamamlanmış")
    token = create_access_token(user.id, user.username, user.role, user.token_version)
    refresh = await issue_refresh_token(db, user, _user_agent(request))
    await db.commit()
    return {
        "token": token,
        "refresh_token": refresh,
        "user": {"id": user.id, "username": user.username, "role": user.role},
    }

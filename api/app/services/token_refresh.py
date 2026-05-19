"""Embark token refresh servisi.

Akış (Chrome eklentisi ile):
1. arctracker.io'ya giriş → session cookie al
2. GET /api/embark/auth/xbox → 307 redirect → auth.embark.net OAuth URL
3. Kullanıcı auth URL'i tarayıcıda açar → Xbox login
4. Xbox → 127.0.0.1:49172?code=...&state=... redirect eder
5. Chrome eklentisi bu URL'i yakalar, code+state'i bizim API'ye POST eder
6. API state ile session'ı eşleştirir, arctracker'a iletir → token yenilenir
"""

import logging
from urllib.parse import parse_qs, urlparse

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models import TrackerAccount

logger = logging.getLogger(__name__)

BASE = settings.arctracker_base_url

# Aktif refresh oturumları
# account_id → session dict
_sessions_by_account: dict[str, dict] = {}
# state → session dict (aynı obje, eklentiden gelen callback için state ile lookup)
_sessions_by_state: dict[str, dict] = {}


async def start_refresh(account: TrackerAccount) -> dict:
    """Token refresh akışını başlatır, auth URL döndürür."""
    aid = account.id

    # Zaten aktif bir oturum var mı?
    existing = _sessions_by_account.get(aid)
    if existing and existing.get("status") == "waiting":
        return {
            "auth_url": existing["auth_url"],
            "status": "already_waiting",
            "current_token_expires": existing.get("before_token_expires"),
        }

    # Önceki oturumu temizle
    _cleanup_session(aid)

    # 1) arctracker.io'ya giriş
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            f"{BASE}/api/auth/sign-in/email",
            json={"email": account.arctracker_email, "password": account.arctracker_password},
        )
        resp.raise_for_status()
        cookie = resp.headers.get("set-cookie", "")
        if not cookie:
            body = resp.json()
            token = body.get("token")
            if token:
                cookie = f"better-auth.session_token={token}"
        if not cookie:
            raise ValueError("arctracker.io'dan session alınamadı")

        # Mevcut token durumunu kontrol et
        status_resp = await client.get(
            f"{BASE}/api/embark/status",
            headers={"Cookie": cookie},
        )
        before_status = status_resp.json() if status_resp.status_code == 200 else {}

        # 2) Auth URL al
        auth_resp = await client.get(
            f"{BASE}/api/embark/auth/xbox",
            headers={"Cookie": cookie},
            follow_redirects=False,
        )
        if auth_resp.status_code not in (301, 302, 307, 308):
            raise ValueError(f"Auth redirect beklendi, {auth_resp.status_code} geldi")

        auth_url = auth_resp.headers.get("location", "")
        if not auth_url:
            raise ValueError("Auth URL alınamadı")

        # State parametresini çıkar
        parsed = urlparse(auth_url)
        state = parse_qs(parsed.query).get("state", [""])[0]

    # 3) Session kaydet (hem account_id hem state ile erişilebilir)
    session = {
        "account_id": aid,
        "cookie": cookie,
        "auth_url": auth_url,
        "state": state,
        "status": "waiting",
        "before_token_expires": before_status.get("tokenExpiresAt"),
        "is_token_expired": before_status.get("isTokenExpired"),
        "result": None,
    }
    _sessions_by_account[aid] = session
    _sessions_by_state[state] = session

    logger.info("Token refresh başlatıldı: account=%s, state=%s", aid, state[:20])

    return {
        "auth_url": auth_url,
        "status": "waiting",
        "current_token_expires": before_status.get("tokenExpiresAt"),
        "is_token_expired": before_status.get("isTokenExpired"),
    }


async def handle_callback(code: str, state: str) -> dict:
    """
    Eklentiden gelen callback'i işler.
    State ile session'ı bulur, code+state'i arctracker'a iletir.
    """
    session = _sessions_by_state.get(state)
    if not session:
        logger.warning("Bilinmeyen state ile callback geldi: %s", state[:20])
        return {"status": "error", "message": "Geçersiz veya süresi dolmuş state"}

    if session["status"] != "waiting":
        return {"status": session["status"], "message": "Bu oturum zaten işlendi"}

    cookie = session["cookie"]
    headers = {"Cookie": cookie}
    old_expires = session.get("before_token_expires")

    # code+state'i arctracker callback'ine gönder
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(
                f"{BASE}/api/embark/callback",
                headers=headers,
                params={"code": code, "state": state},
                follow_redirects=True,
            )
            logger.info("Arctracker callback: status=%d", r.status_code)

            # Yeni token durumunu kontrol et
            status_r = await client.get(
                f"{BASE}/api/embark/status",
                headers=headers,
            )
            after_status = status_r.json() if status_r.status_code == 200 else {}

    except Exception as e:
        logger.error("Arctracker callback hatası: %s", e)
        session["status"] = "error"
        session["result"] = {"error": str(e)}
        return {"status": "error", "message": str(e)}

    new_expires = after_status.get("tokenExpiresAt")

    session["status"] = "success"
    session["result"] = {
        "message": "Token başarıyla yenilendi!",
        "old_expires": old_expires,
        "new_expires": new_expires,
        "is_token_expired": after_status.get("isTokenExpired"),
        "embark_status": after_status,
    }
    logger.info("Token refresh başarılı! %s → %s", old_expires, new_expires)

    return {
        "status": "success",
        "message": "Token başarıyla yenilendi!",
        "old_expires": old_expires,
        "new_expires": new_expires,
    }


async def get_refresh_status(account_id: str) -> dict:
    """Aktif refresh oturumunun durumunu döndürür."""
    session = _sessions_by_account.get(account_id)
    if not session:
        return {"status": "no_session"}

    return {
        "status": session["status"],
        "result": session.get("result"),
    }


async def complete_refresh(db: AsyncSession, account: TrackerAccount) -> dict:
    """Refresh tamamlandıysa DB'yi günceller ve session'ı temizler."""
    aid = account.id
    session = _sessions_by_account.get(aid)
    if not session:
        return {"status": "no_session", "message": "Aktif refresh oturumu yok"}

    status = session.get("status", "waiting")
    result = session.get("result") or {}

    if status == "success":
        # Embark status bilgilerini DB'ye yaz
        embark_status = result.get("embark_status", {})
        if embark_status:
            from app.services.sync_service import _extract_embark_status
            _extract_embark_status(account, embark_status)
            await db.commit()

        _cleanup_session(aid)

        return {
            "status": "success",
            "message": result.get("message", "Token yenilendi"),
            "old_expires": result.get("old_expires"),
            "new_expires": result.get("new_expires"),
        }

    if status in ("error", "timeout"):
        _cleanup_session(aid)
        return {
            "status": status,
            "message": result.get("error", "Bilinmeyen hata"),
        }

    return {"status": "waiting", "message": "Xbox login bekleniyor..."}


def cancel_refresh(account_id: str):
    """Aktif refresh oturumunu iptal eder."""
    _cleanup_session(account_id)


def _cleanup_session(account_id: str):
    """Session'ı her iki dict'ten de temizler."""
    session = _sessions_by_account.pop(account_id, None)
    if session and session.get("state"):
        _sessions_by_state.pop(session["state"], None)

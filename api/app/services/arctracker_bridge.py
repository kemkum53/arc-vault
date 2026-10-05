"""arctracker.io bridge JWT yönetimi.

Akış:
  1. arctracker e-posta/şifre ile programatik oturum aç (sign-in/email)
  2. session cookie ile /api/auth/bridge/authorize çağır
  3. redirect URL'inden ?token=JWT yakala
  4. 30 günlük bridge JWT sakla, 7 günden az kaldığında yenile
"""

import base64
import json
import logging
import secrets
import uuid
from datetime import datetime, timezone
from urllib.parse import parse_qs, urljoin, urlparse

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)
BASE = settings.arctracker_base_url
REFRESH_DAYS = 7
CALLBACK_MARKERS = ("127.0.0.1:39876", "localhost:39876")


# ── Yardımcılar ──────────────────────────────────────────────────────────────

def _decode_jwt_payload(token: str) -> dict:
    try:
        p = token.split(".")[1]
        p += "=" * (4 - len(p) % 4)
        return json.loads(base64.urlsafe_b64decode(p))
    except Exception:
        return {}


def bridge_jwt_days_remaining(bridge_jwt: str) -> float:
    exp = _decode_jwt_payload(bridge_jwt).get("exp", 0)
    return max(0.0, (exp - datetime.now(timezone.utc).timestamp()) / 86400)


def _extract_cookie(response: httpx.Response) -> str:
    cookies = {}
    for header_val in response.headers.get_list("set-cookie"):
        part = header_val.split(";")[0]
        name, _, value = part.partition("=")
        name = name.strip()
        value = value.strip()
        if name and value:
            cookies[name] = value
    if cookies:
        return "; ".join(f"{k}={v}" for k, v in cookies.items())
    try:
        token = response.json().get("token")
        if token:
            return f"better-auth.session_token={token}"
    except Exception:
        pass
    return ""


# ── Bridge JWT edinme ─────────────────────────────────────────────────────────

async def acquire_bridge_jwt(email: str, password: str) -> str:
    """arctracker.io bridge JWT'sini programatik olarak alır (tarayıcı gerekmez)."""
    async with httpx.AsyncClient(follow_redirects=False, timeout=20) as client:
        # 1. Oturum aç → session cookie
        sign_in = await client.post(
            f"{BASE}/api/auth/sign-in/email",
            json={"email": email, "password": password},
        )
        if sign_in.status_code not in (200, 201):
            raise ValueError(
                f"arctracker.io girişi başarısız: HTTP {sign_in.status_code}"
            )

        cookie_str = _extract_cookie(sign_in)
        if not cookie_str:
            raise ValueError("arctracker.io session cookie alınamadı")

        logger.debug("[BridgeJWT] Oturum açıldı: %s", email)

        # 2. Bridge authorize — redirect zincirini takip et
        state = secrets.token_hex(16)
        callback_url = "http://127.0.0.1:39876/auth/callback"
        current_url = f"{BASE}/api/auth/bridge/authorize"
        first_params = {
            "app": "arctracker-sync",
            "returnTo": callback_url,
            "state": state,
        }
        req_headers = {"Cookie": cookie_str}

        for step in range(10):
            resp = await client.get(
                current_url,
                params=first_params if step == 0 else None,
                headers=req_headers,
            )
            location = resp.headers.get("location", "")

            if any(marker in location for marker in CALLBACK_MARKERS):
                # Callback URL'ine geldi → token'ı yakala
                params = parse_qs(urlparse(location).query)
                token = (params.get("token") or [None])[0]
                if not token:
                    raise ValueError(
                        f"Bridge callback'te token bulunamadı: {location[:200]}"
                    )
                logger.info("[BridgeJWT] Başarıyla alındı: %s", email)
                return token

            if not resp.is_redirect:
                raise ValueError(
                    f"Redirect beklendi ama HTTP {resp.status_code} döndü "
                    f"(step={step}, url={current_url})"
                )

            # Bir sonraki adıma geç
            if location.startswith("http"):
                current_url = location
            else:
                current_url = urljoin(current_url, location)

        raise ValueError("Bridge authorize: redirect zinciri 10 adımı aştı")


async def refresh_bridge_jwt(bridge_jwt: str) -> str | None:
    """Mevcut bridge JWT'yi yeniler (/api/auth/bridge/refresh)."""
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                f"{BASE}/api/auth/bridge/refresh",
                headers={
                    "Authorization": f"Bearer {bridge_jwt}",
                    "Content-Type": "application/json",
                },
            )
            if resp.status_code == 200:
                return resp.json().get("token")
    except Exception as exc:
        logger.warning("[BridgeJWT] Yenileme başarısız: %s", exc)
    return None


async def ensure_bridge_jwt(account, db=None) -> str:
    """Account için geçerli bridge JWT sağlar. Gerekirse yeniler veya yenisini alır."""
    from app.core.crypto import decrypt_value

    current = account.arctracker_bridge_jwt

    if current:
        days = bridge_jwt_days_remaining(current)
        if days > REFRESH_DAYS:
            return current

        if days > 0:
            logger.info(
                "[BridgeJWT] %s için yenileniyor (%.1f gün kalmış)",
                account.arctracker_email,
                days,
            )
            new_jwt = await refresh_bridge_jwt(current)
            if new_jwt:
                _update_account_bridge_jwt(account, new_jwt)
                if db:
                    await db.commit()
                return new_jwt

    # Yeni JWT al (tam login gerekli)
    logger.info(
        "[BridgeJWT] %s için yeni JWT alınıyor...", account.arctracker_email
    )
    password = decrypt_value(account.arctracker_password)
    new_jwt = await acquire_bridge_jwt(account.arctracker_email, password)
    _update_account_bridge_jwt(account, new_jwt)
    if db:
        await db.commit()
    return new_jwt


def _update_account_bridge_jwt(account, jwt_str: str) -> None:
    account.arctracker_bridge_jwt = jwt_str
    payload = _decode_jwt_payload(jwt_str)
    exp = payload.get("exp")
    if exp:
        account.arctracker_bridge_jwt_exp = datetime.fromtimestamp(
            exp, tz=timezone.utc
        )


# ── Embark token gönderme (retired) ───────────────────────────────────────────

async def submit_embark_token(bridge_jwt: str, embark_jwt: str) -> dict:
    """Deprecated: arctracker retired /api/desktop/embark-token (503). Kept for
    reference; use link_embark_token() for the v2 device-pairing flow."""
    body = {
        "accessToken": embark_jwt,
        "observedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00"),
        "host": "api-gateway.europe.es-pio.net",
        "path": "/v1/shared/manifest",
        "source": "arctracker-sync",
    }
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.post(
            f"{BASE}/api/desktop/embark-token",
            headers={
                "Authorization": f"Bearer {bridge_jwt}",
                "Content-Type": "application/json",
            },
            json=body,
        )
        resp.raise_for_status()
        return resp.json()


# ── Link v2: device-pairing token push ────────────────────────────────────────
# See ARCTRACKER_LINK_V2.md for the full flow and why each client header differs.

LINK_APP_VERSION = "2.0.3"
LINK_CLIENT_PAIR = f"ARCTrackerLink/{LINK_APP_VERSION}"   # accepted by link-token
LINK_CLIENT_PUSH = f"arctracker-link/{LINK_APP_VERSION}"  # required by embark/token
WEB_CLIENT = "web/3.0.0"
DEVICE_NAMESPACE = uuid.uuid5(uuid.NAMESPACE_URL, "arc-vault/link-device")


def _provider_for(account) -> str:
    """arctracker link enum is steam|epic. Xbox tokens are accepted as steam."""
    return account.provider if account.provider in ("steam", "epic") else "steam"


def _device_id_for(account) -> str:
    """Stable per-account device id so we reuse one device row across pushes."""
    return str(uuid.uuid5(DEVICE_NAMESPACE, str(account.id)))


async def link_embark_token(account, embark_jwt: str, cookie: str) -> dict:
    """Link v2 device-pairing push. Returns arctracker's embark/token `data`.

    Steps: (stored) web session -> create pairing code -> exchange for a device
    token (posing as the Link desktop app) -> push the Embark JWT as that device.
    Raises SessionExpired if the web session is rejected, so the caller can
    sign in again (see arctracker_session.with_session).
    """
    from app.services.arctracker_client import SessionExpired

    provider = _provider_for(account)

    async with httpx.AsyncClient(timeout=30, follow_redirects=False) as client:
        web_headers = {
            "Cookie": cookie,
            "X-ArcTracker-Client": WEB_CLIENT,
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Origin": BASE,
            "Referer": f"{BASE}/app",
        }

        # 1) pairing code
        resp = await client.post(
            f"{BASE}/api/me/embark/link-requests",
            headers=web_headers,
            json={"provider": provider},
        )
        if resp.status_code in (401, 403):
            raise SessionExpired(f"link-requests {resp.status_code}")
        if resp.status_code >= 300:
            raise ValueError(f"link-request başarısız: HTTP {resp.status_code} {resp.text[:200]}")
        deep_link = resp.json()["data"]["deepLink"]
        code = (parse_qs(urlparse(deep_link).query).get("code") or [None])[0]
        if not code:
            raise ValueError(f"pairing code bulunamadı: {deep_link[:120]}")

        # 2) device token (pose as the Link app)
        resp = await client.post(
            f"{BASE}/api/auth/bridge/link-token",
            headers={
                "X-ArcTracker-Client": LINK_CLIENT_PAIR,
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
            json={
                "code": code,
                "deviceId": _device_id_for(account),
                "appVersion": LINK_APP_VERSION,
                "platform": "windows",
            },
        )
        if resp.status_code >= 300:
            raise ValueError(f"link-token başarısız: HTTP {resp.status_code} {resp.text[:200]}")
        device_token = resp.json().get("data", {}).get("token")
        if not device_token:
            raise ValueError("link-token cevabında device token yok")

        # 3) push the Embark token as the device
        resp = await client.post(
            f"{BASE}/api/me/embark/token",
            headers={
                "Authorization": f"Bearer {device_token}",
                "X-ArcTracker-Client": LINK_CLIENT_PUSH,
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
            json={"accessToken": embark_jwt, "provider": provider, "reason": "link"},
        )
        if resp.status_code >= 300:
            raise ValueError(f"embark/token başarısız: HTTP {resp.status_code} {resp.text[:200]}")
        return resp.json().get("data", {})

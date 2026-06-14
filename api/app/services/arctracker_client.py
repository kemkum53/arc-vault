"""arctracker.io ile iletişim kuran HTTP istemcisi."""

import asyncio
import logging

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

BASE = settings.arctracker_base_url


async def authenticate(email: str, password: str) -> str:
    """arctracker.io'ya giriş yapar, session cookie döndürür."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{BASE}/api/auth/sign-in/email",
            json={"email": email, "password": password},
        )
        resp.raise_for_status()

        # 1) Set-Cookie header'ından cookie al
        cookie_header = resp.headers.get("set-cookie", "")
        if cookie_header:
            return cookie_header

        # 2) Body'den token al
        body = resp.json()
        token = body.get("token")
        if token:
            return f"better-auth.session_token={token}"

        raise ValueError("arctracker.io'dan session alınamadı — cookie ve token bulunamadı")


async def _fetch(client: httpx.AsyncClient, method: str, path: str, cookie: str) -> dict | None:
    """Tek bir endpoint'i çağırır."""
    headers = {"Cookie": cookie}
    try:
        if method == "POST":
            resp = await client.post(f"{BASE}{path}", headers=headers)
        else:
            resp = await client.get(f"{BASE}{path}", headers=headers)
        if resp.status_code in (401, 403):
            logger.warning("Embark bağlantısı süresi dolmuş olabilir: %s → %d", path, resp.status_code)
            return None
        resp.raise_for_status()
        return resp.json()
    except httpx.HTTPStatusError as exc:
        logger.error("arctracker %s hatası: %s", path, exc)
        return None


async def fetch_all(cookie: str) -> dict:
    """6 endpoint'i paralel çeker (5 sync + embark status), sonuçları dict olarak döndürür."""
    async with httpx.AsyncClient(timeout=30) as client:
        inventory_task = _fetch_inventory(client, cookie)
        blueprints_task = _fetch(client, "POST", "/api/embark/sync/blueprints", cookie)
        quests_task = _fetch(client, "POST", "/api/embark/sync/quests", cookie)
        hideout_task = _fetch(client, "POST", "/api/embark/sync/hideout", cookie)
        projects_task = _fetch(client, "POST", "/api/embark/sync/projects", cookie)
        status_task = _fetch(client, "GET", "/api/embark/status", cookie)

        results = await asyncio.gather(
            inventory_task, blueprints_task, quests_task,
            hideout_task, projects_task, status_task,
            return_exceptions=True,
        )

    def _safe(r):
        return r if isinstance(r, dict) else None

    inv = _safe(results[0])
    if inv:
        snapshot = inv.get("snapshot", inv)
        items = snapshot.get("items", [])
        logger.info("Inventory: %d item geldi", len(items))
    else:
        logger.warning("Inventory boş döndü")

    return {
        "inventory": inv,
        "blueprints": _safe(results[1]),
        "quests": _safe(results[2]),
        "hideout": _safe(results[3]),
        "projects": _safe(results[4]),
        "embark_status": _safe(results[5]),
    }


async def _fetch_inventory(client: httpx.AsyncClient, cookie: str) -> dict | None:
    """Envanter çeker; POST /sync/inventory ile taze veri çek, fallback olarak GET /latest."""
    result = await _fetch(client, "POST", "/api/embark/sync/inventory", cookie)
    if result is not None:
        logger.info("sync/inventory yanıt anahtarları: %s", list(result.keys()) if isinstance(result, dict) else type(result))
        return result
    logger.info("sync/inventory başarısız, GET inventory/latest deneniyor")
    result = await _fetch(client, "GET", "/api/embark/inventory/latest", cookie)
    if result is not None:
        logger.info("inventory/latest yanıt anahtarları: %s", list(result.keys()) if isinstance(result, dict) else type(result))
    return result

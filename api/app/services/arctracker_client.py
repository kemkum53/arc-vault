"""arctracker.io ile iletişim kuran HTTP istemcisi (Link v2 okuma uçları).

arctracker retired /api/embark/sync/* on 2026-10-01. We now read the account's
synced data from the session endpoints /api/me/stash and /api/me/progress and
adapt their new shapes into the structure sync_service already expects. See
ARCTRACKER_LINK_V2.md.
"""

import logging

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

BASE = settings.arctracker_base_url
WEB_CLIENT = "web/3.0.0"


def _extract_cookie(response: httpx.Response) -> str:
    cookies = {}
    for header_val in response.headers.get_list("set-cookie"):
        part = header_val.split(";")[0]
        name, _, value = part.partition("=")
        name, value = name.strip(), value.strip()
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


async def authenticate(email: str, password: str) -> str:
    """arctracker.io'ya giriş yapar, session cookie döndürür."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{BASE}/api/auth/sign-in/email",
            json={"email": email, "password": password},
        )
        resp.raise_for_status()
        cookie = _extract_cookie(resp)
        if not cookie:
            raise ValueError("arctracker.io'dan session alınamadı — cookie bulunamadı")
        return cookie


async def _get_json(client: httpx.AsyncClient, path: str, cookie: str) -> dict | None:
    headers = {"Cookie": cookie, "X-ArcTracker-Client": WEB_CLIENT, "Accept": "application/json"}
    try:
        resp = await client.get(f"{BASE}{path}", headers=headers)
        if resp.status_code in (401, 403):
            logger.warning("arctracker yetki hatası: %s → %d", path, resp.status_code)
            return None
        resp.raise_for_status()
        return resp.json()
    except httpx.HTTPStatusError as exc:
        logger.error("arctracker %s hatası: %s", path, exc)
        return None


def _block_items(block: dict) -> list[dict]:
    """One stash category / overflow block -> [{i,q,d,a}] (details keyed by index)."""
    out: list[dict] = []
    items_raw = block.get("items") or []
    details = block.get("details") or {}
    for idx, pair in enumerate(items_raw):
        if not isinstance(pair, (list, tuple)) or len(pair) < 2:
            continue
        slug, qty = pair[0], pair[1]
        det = details.get(str(idx)) or {}
        attachments = [{"i": mod} for mod in (det.get("a") or []) if mod]
        out.append({"i": slug, "q": qty, "d": det.get("d"), "a": attachments})
    return out


def _transform_stash(stash: dict | None) -> dict | None:
    """/api/me/stash -> old inventory snapshot shape.

    category 0 holds the whole stash; categories 1..N are the same items
    re-partitioned by type, so summing all of them double-counts. Use only
    category 0 (which matches /api/me/stash/owned exactly) plus overflow.
    Loadout is a separate equipped set and is not merged here.
    """
    if not stash:
        return None
    cats = stash.get("categories") or []
    main = next((c for c in cats if c.get("category") == 0), cats[0] if cats else None)
    items: list[dict] = []
    total_value = total_capacity = total_stacks = 0
    if main:
        items.extend(_block_items(main))
        total_value += main.get("value") or 0
        total_capacity += main.get("capacity") or 0
        total_stacks += main.get("stacks") or 0
    overflow = stash.get("overflow")
    if isinstance(overflow, dict):
        items.extend(_block_items(overflow))
    return {
        "snapshot": {
            "items": items,
            "totalValue": total_value or None,
            "maxSlots": total_capacity or None,
            "usedSlots": total_stacks or None,
        }
    }


def _transform_progress(progress: dict | None) -> dict:
    """/api/me/progress records -> old per-domain shapes + player info."""
    out = {
        "blueprints": None,
        "quests": None,
        "hideout": None,
        "player": None,
    }
    if not progress:
        return out
    records = progress.get("records") or []
    blueprints: dict[str, bool] = {}
    quests: dict[str, bool] = {}
    hideout: dict[str, int] = {}
    player = None
    for rec in records:
        if rec.get("source") != "embark":
            continue
        kind, key, value = rec.get("kind"), rec.get("key"), rec.get("value")
        if kind == "blueprint" and value is True:
            blueprints[key] = True
        elif kind == "quest" and isinstance(value, dict) and value.get("state") == "completed":
            quests[key] = True
        elif kind == "hideout" and isinstance(value, int) and value > 0:
            hideout[key] = value
        elif kind == "player" and isinstance(value, dict):
            player = value
    # Only surface a domain when embark actually returned records for it, so a
    # partial/empty sync never wipes existing rows downstream.
    if blueprints:
        out["blueprints"] = {"embark": blueprints}
    if quests:
        out["quests"] = {"embark": quests}
    if hideout:
        out["hideout"] = {"embark": hideout}
    out["player"] = player
    return out


def _transform_embark_status(embark: dict | None) -> dict | None:
    """/api/me/embark -> old embark_status shape consumed by sync_service."""
    if not embark:
        return None
    data = embark.get("data", embark)
    account = data.get("account")
    if not account:
        return None
    display = account.get("displayName") or ""
    name_part, _, disc_part = display.partition("#")
    token = data.get("token") or {}
    status = {
        "isLinked": True,
        "embarkUserId": account.get("id"),
        "embarkAccountId": account.get("id"),
        "provider": account.get("provider"),
        "displayName": name_part or display,
        "displayNameDiscriminator": disc_part or None,
        "isTokenExpired": not token.get("fresh", False),
    }
    exp_ms = token.get("expiresAt")
    if exp_ms:
        from datetime import datetime, timezone
        status["tokenExpiresAt"] = datetime.fromtimestamp(exp_ms / 1000, tz=timezone.utc).strftime(
            "%Y-%m-%dT%H:%M:%S.000Z"
        )
    return status


async def fetch_all(cookie: str) -> dict:
    """Read stash + progress + embark state, adapted to the old sync shape.

    Calls run sequentially: issuing them concurrently can stall behind
    Cloudflare on slower links, and the read is a background job anyway.
    """
    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=15.0)) as client:
        stash_r = await _get_json(client, "/api/me/stash", cookie)
        progress_r = await _get_json(client, "/api/me/progress", cookie)
        embark_r = await _get_json(client, "/api/me/embark", cookie)

    def _safe(r):
        return r.get("data") if isinstance(r, dict) and "data" in r else (r if isinstance(r, dict) else None)

    stash = _safe(stash_r)
    progress = _safe(progress_r)
    embark = embark_r if isinstance(embark_r, dict) else None

    inventory = _transform_stash(stash)
    prog = _transform_progress(progress)
    status = _transform_embark_status(embark)

    if inventory:
        logger.info("Inventory: %d item geldi", len(inventory["snapshot"]["items"]))
    else:
        logger.warning("Inventory boş döndü")

    return {
        "inventory": inventory,
        "blueprints": prog["blueprints"],
        "quests": prog["quests"],
        "hideout": prog["hideout"],
        "projects": None,  # TODO: map project_phase/category_goal/needed_count
        "player": prog["player"],
        "embark_status": status,
    }

"""arctracker.io ile iletişim kuran HTTP istemcisi (Link v2 okuma uçları).

arctracker retired /api/embark/sync/* on 2026-10-01. We now read the account's
synced data from the session endpoints /api/me/stash and /api/me/progress and
adapt their new shapes into the structure sync_service already expects. See
ARCTRACKER_LINK_V2.md.
"""

import logging
import math
import time

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

BASE = settings.arctracker_base_url
WEB_CLIENT = "web/3.0.0"

# After arctracker's sign-in answers 5xx, stop trying for a while instead of
# signing in again on every sync and every 30 s harvester push.
LOGIN_COOLDOWN_SECONDS = 300
_login_blocked_until = 0.0


class ArctrackerUnavailable(Exception):
    """arctracker's auth service is failing (5xx/unreachable) or failed moments ago."""


class SessionExpired(Exception):
    """arctracker rejected the session cookie (401/403); sign in again."""


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
    """Sign in to arctracker.io and return the session cookie.

    Raises ArctrackerUnavailable on 5xx/network failure (and for the next
    LOGIN_COOLDOWN_SECONDS without calling arctracker), ValueError when the
    credentials are refused.
    """
    global _login_blocked_until
    wait = _login_blocked_until - time.monotonic()
    if wait > 0:
        raise ArctrackerUnavailable(
            "arctracker'ın giriş servisi az önce hata verdi; "
            f"yaklaşık {math.ceil(wait / 60)} dk sonra tekrar denenecek"
        )
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=15.0)) as client:
            resp = await client.post(
                f"{BASE}/api/auth/sign-in/email",
                json={"email": email, "password": password},
            )
    except httpx.TransportError as exc:
        raise ArctrackerUnavailable(f"arctracker'a bağlanılamadı ({type(exc).__name__})") from exc
    if resp.status_code >= 500:
        _login_blocked_until = time.monotonic() + LOGIN_COOLDOWN_SECONDS
        logger.warning("arctracker sign-in HTTP %d; girişler %ds durduruldu", resp.status_code, LOGIN_COOLDOWN_SECONDS)
        raise ArctrackerUnavailable(
            f"arctracker'ın giriş servisi şu an hata veriyor (HTTP {resp.status_code}); "
            "birkaç dakika sonra tekrar dene"
        )
    if resp.status_code in (400, 401, 403):
        raise ValueError(f"arctracker e-posta/şifreyi kabul etmedi (HTTP {resp.status_code})")
    resp.raise_for_status()
    cookie = _extract_cookie(resp)
    if not cookie:
        raise ValueError("arctracker.io'dan session alınamadı, cookie bulunamadı")
    return cookie


async def force_sync(cookie: str) -> bool:
    """Tell arctracker to re-pull fresh game data before we read it.

    Mirrors the site's "Şimdi senkronize et" button: POST /api/me/embark/sync
    with the session cookie and no body. arctracker runs the Embark pull before
    returning 200, so a following fetch_all sees the fresh snapshot. A 429 means
    the per-account cooldown is still active (data is already recent); any other
    outcome is logged and treated as non-fatal so the read still proceeds.
    """
    # Origin/Referer are required: arctracker's auth layer (better-auth) rejects
    # state-changing POSTs without a trusted Origin (403). GET reads don't need it.
    headers = {
        "Cookie": cookie,
        "X-ArcTracker-Client": WEB_CLIENT,
        "Accept": "application/json",
        "Origin": BASE,
        "Referer": f"{BASE}/",
    }
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(90.0, connect=15.0)) as client:
            resp = await client.post(f"{BASE}/api/me/embark/sync", headers=headers)
    except Exception as exc:
        logger.warning("force_sync isteği başarısız: %s", exc)
        return False
    if resp.status_code == 200:
        logger.info("arctracker force-sync tetiklendi (200)")
        return True
    if resp.status_code == 429:
        logger.info("arctracker force-sync cooldown (429), mevcut veri okunacak")
        return False
    if resp.status_code in (401, 403):
        raise SessionExpired(f"embark/sync {resp.status_code}")
    logger.warning("arctracker force-sync beklenmeyen durum: %d", resp.status_code)
    return False


async def _get_json(client: httpx.AsyncClient, path: str, cookie: str) -> dict | None:
    headers = {"Cookie": cookie, "X-ArcTracker-Client": WEB_CLIENT, "Accept": "application/json"}
    try:
        resp = await client.get(f"{BASE}{path}", headers=headers)
        if resp.status_code in (401, 403):
            # Stale stored session: let the caller sign in again instead of
            # treating it as "no data".
            raise SessionExpired(f"{path} {resp.status_code}")
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


def _transform_loadout(loadout: dict | None) -> dict | None:
    """/api/me/stash loadout.items ([[slot, slug, qty]]) -> old account.loadout shape
    consumed by the web transform (weapon1/2, augment, shield, backpack, ...)."""
    if not isinstance(loadout, dict):
        return None
    out: dict = {
        "weapon1": None, "weapon2": None, "augment": None, "shield": None,
        "backpack": [], "quickItems": [], "safePocket": [], "augmentedSlots": [],
    }
    weapons: list[dict] = []
    equipment: list[tuple[str, dict]] = []
    details = loadout.get("details") or {}
    for idx, entry in enumerate(loadout.get("items") or []):
        if not isinstance(entry, (list, tuple)) or len(entry) < 3:
            continue
        slot, slug, qty = entry[0], entry[1], entry[2]
        det = details.get(str(idx)) or {}
        attachments = [{"i": mod} for mod in (det.get("a") or []) if mod]
        obj = {"i": slug, "q": qty, "d": det.get("d"), "a": attachments}
        if slot == "weapons":
            weapons.append(obj)
        elif slot == "equipment":
            equipment.append((str(slug), obj))
        elif slot == "quick_use":
            out["quickItems"].append(obj)
        elif slot in ("safe_pocket", "safepocket"):
            out["safePocket"].append(obj)
        else:  # backpack and anything unexpected
            out["backpack"].append(obj)
    if weapons:
        out["weapon1"] = weapons[0]
        if len(weapons) > 1:
            out["weapon2"] = weapons[1]
    for slug, obj in equipment:
        if "shield" in slug and out["shield"] is None:
            out["shield"] = obj
        elif out["augment"] is None:
            out["augment"] = obj
        else:
            out["augmentedSlots"].append(obj)
    has_any = any([out["weapon1"], out["weapon2"], out["augment"], out["shield"],
                   out["backpack"], out["quickItems"], out["safePocket"]])
    return out if has_any else None


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
            "loadout": _transform_loadout(stash.get("loadout")),
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
    if not isinstance(embark, dict):
        return None
    data = embark.get("data")
    if not isinstance(data, dict):
        data = embark
    account = data.get("account")
    if not isinstance(account, dict):
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

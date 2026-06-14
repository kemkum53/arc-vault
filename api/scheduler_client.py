"""
Pi üzerinde çalışan token refresh scheduler.

Akış:
  1. Production API'den hesap listesini çek
  2. Token süresi 2 saate düşmüş hesapları bul
  3. Credentials'ı API'den al (şifreli değil, çözülmüş)
  4. Tüm refresh işini Pi'de yap (arctracker + Xbox login)
  5. Sonucu production API'ye gönder → DB'ye yazılır
"""

import asyncio
import json as json_mod
import logging
import os
import re
from datetime import datetime, timezone, timedelta
from urllib.parse import parse_qs, urlparse, urljoin

import httpx

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("scheduler")

API_BASE            = os.environ["API_BASE_URL"].rstrip("/")
ADMIN_USERNAME      = os.environ["ADMIN_USERNAME"]
ADMIN_PASSWORD      = os.environ["ADMIN_PASSWORD"]
ARCTRACKER_BASE     = os.getenv("ARCTRACKER_BASE_URL", "https://arctracker.io")
CHECK_INTERVAL      = int(os.getenv("CHECK_INTERVAL_SECONDS", str(30 * 60)))
REFRESH_BEFORE_HOURS = int(os.getenv("REFRESH_BEFORE_HOURS", "2"))
BETWEEN_ACCOUNTS_DELAY = int(os.getenv("BETWEEN_ACCOUNTS_DELAY", "60"))


# ─── API helpers ────────────────────────────────────────────────────────────

async def _api_login(client: httpx.AsyncClient) -> str:
    resp = await client.post(f"{API_BASE}/api/auth/login", json={
        "username": ADMIN_USERNAME,
        "password": ADMIN_PASSWORD,
    })
    resp.raise_for_status()
    token = resp.json().get("token")
    if not token:
        raise ValueError("API girişi başarısız")
    return token


async def _get_accounts(client: httpx.AsyncClient, headers: dict) -> list:
    resp = await client.get(f"{API_BASE}/api/accounts", headers=headers, follow_redirects=True)
    resp.raise_for_status()
    return resp.json()


async def _get_credentials(client: httpx.AsyncClient, headers: dict, account_id: str) -> dict:
    resp = await client.get(f"{API_BASE}/api/accounts/{account_id}/credentials", headers=headers)
    resp.raise_for_status()
    return resp.json()


async def _post_embark_status(client: httpx.AsyncClient, headers: dict, account_id: str, status: dict):
    resp = await client.post(
        f"{API_BASE}/api/accounts/{account_id}/embark-status",
        headers=headers,
        json=status,
    )
    resp.raise_for_status()


# ─── arctracker helpers ─────────────────────────────────────────────────────

def _build_cookie_string(response: httpx.Response) -> str:
    cookies = {}
    for header_val in response.headers.get_list("set-cookie"):
        part = header_val.split(";")[0]
        name, _, value = part.partition("=")
        name, value = name.strip(), value.strip()
        if name and value:
            cookies[name] = value
    return "; ".join(f"{k}={v}" for k, v in cookies.items())


async def _arctracker_login(client: httpx.AsyncClient, email: str, password: str) -> str:
    resp = await client.post(
        f"{ARCTRACKER_BASE}/api/auth/sign-in/email",
        json={"email": email, "password": password},
    )
    resp.raise_for_status()
    cookie = _build_cookie_string(resp)
    if not cookie:
        token = resp.json().get("token")
        if token:
            cookie = f"better-auth.session_token={token}"
    if not cookie:
        raise ValueError("arctracker.io'dan session alınamadı")
    return cookie


# ─── Xbox login ─────────────────────────────────────────────────────────────

def _abs(url: str, base: str) -> str:
    if not url or url.startswith("http"):
        return url
    return urljoin(base, url)


def _parse_server_data(html: str) -> dict | None:
    for pattern in [r"\$Config\s*=\s*(\{.*?\});\s*//", r"var ServerData\s*=\s*(\{.*?\});"]:
        m = re.search(pattern, html, re.DOTALL)
        if m:
            try:
                return json_mod.loads(m.group(1))
            except json_mod.JSONDecodeError:
                sft = re.search(r'"sFTTag"\s*:\s*"(.*?)"', m.group(1))
                url = re.search(r'"urlPost"\s*:\s*"(.*?)"', m.group(1))
                if sft or url:
                    return {"sFTTag": sft.group(1) if sft else "", "urlPost": url.group(1) if url else ""}
    return None


def _extract_form(html: str) -> tuple[str | None, dict]:
    action_m = re.search(r'action=["\']([^"\']+)["\']', html)
    if not action_m:
        return None, {}
    inputs = re.findall(r'<input[^>]+name=["\']([^"\']+)["\'][^>]+value=["\']([^"\']*)["\']', html)
    if not inputs:
        inputs = re.findall(r'name=["\']([^"\']+)["\'][^>]*value=["\']([^"\']*)["\']', html)
    return action_m.group(1), {n: v for n, v in inputs}


def _try_extract_callback(url: str) -> tuple[str, str] | None:
    if "127.0.0.1" not in url:
        return None
    params = parse_qs(urlparse(url).query)
    code = params.get("code", [""])[0]
    state = params.get("state", [""])[0]
    return (code, state) if code and state else None


async def _xbox_auto_login(xbox_email: str, xbox_password: str, xbox_oauth_url: str) -> tuple[str, str]:
    UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
          "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36")

    async with httpx.AsyncClient(timeout=30, headers={
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
    }) as client:
        r = await client.get(xbox_oauth_url, follow_redirects=True)
        body = r.text
        final_url = str(r.url)

        sd = _parse_server_data(body)
        if not sd:
            raise ValueError("Xbox login sayfası ayrıştırılamadı")

        sft_tag = sd.get("sFTTag", "")
        ppft_match = re.search(r'value="([^"]+)"', sft_tag)
        if not ppft_match:
            raise ValueError("Xbox PPFT token bulunamadı")
        ppft = ppft_match.group(1)
        post_url = sd.get("urlPost", "")
        if not post_url:
            raise ValueError("Xbox POST URL bulunamadı")

        login_data = {
            "login": xbox_email, "loginfmt": xbox_email, "passwd": xbox_password,
            "PPFT": ppft, "type": "11", "LoginOptions": "1", "PPSX": "PassportRN",
            "i13": "0", "CookieDisclosure": "0", "IsFidoSupported": "0",
            "isSignupPost": "0", "isRecoveryAttemptPost": "0", "i19": "16399",
        }

        r2 = await client.post(post_url, data=login_data, follow_redirects=False,
                               headers={"Content-Type": "application/x-www-form-urlencoded",
                                        "Referer": final_url, "Origin": "https://login.live.com"})

        current_url = r2.headers.get("location", "")

        if r2.status_code == 200:
            body2 = r2.text
            if "sErrTxt" in body2:
                err_match = re.search(r'"sErrTxt"\s*:\s*"([^"]+)"', body2)
                raise ValueError(f"Xbox login başarısız: {err_match.group(1) if err_match else 'Bilinmeyen hata'}")
            hr_match = re.search(r"HR=(0x[0-9A-Fa-f]+)", body2)
            if hr_match and len(body2) < 5000:
                raise ValueError(f"Microsoft login hatası: {hr_match.group(1)}")

            sft_direct = re.search(r'"sFT"\s*:\s*"([^"]+)"', body2)
            sfttag2 = re.search(r'"sFTTag"\s*:\s*"([^"]*)"', body2)
            urlpost2 = re.search(r'"urlPost"\s*:\s*"([^"]+)"', body2)
            ppft2 = None
            if sft_direct:
                ppft2 = sft_direct.group(1)
            elif sfttag2:
                ppft2_m = re.search(r'value="([^"]+)"', sfttag2.group(1))
                if ppft2_m:
                    ppft2 = ppft2_m.group(1)

            if ppft2 and urlpost2:
                post_url2 = urlpost2.group(1).replace("\\/", "/")
                login_data["PPFT"] = ppft2
                r2b = await client.post(post_url2, data=login_data, follow_redirects=False,
                                        headers={"Content-Type": "application/x-www-form-urlencoded",
                                                 "Referer": post_url, "Origin": "https://login.live.com"})
                current_url = r2b.headers.get("location", "")
                body2 = r2b.text if r2b.status_code == 200 else ""

            if not current_url and body2:
                action, form_data = _extract_form(body2)
                if action:
                    action = _abs(action, post_url)
                    r3 = await client.post(action, data=form_data, follow_redirects=False)
                    if r3.status_code == 429:
                        raise ValueError("Microsoft rate limit — lütfen bekleyin")
                    current_url = _abs(r3.headers.get("location", ""), action)
                    if r3.status_code == 200 and not current_url:
                        config = _parse_server_data(r3.text)
                        if config and config.get("urlPost"):
                            interrupt_url = _abs(config["urlPost"], action)
                            r_int = await client.get(interrupt_url, follow_redirects=False)
                            if r_int.status_code in (301, 302, 303, 307, 308):
                                current_url = _abs(r_int.headers.get("location", ""), interrupt_url)
                            elif r_int.status_code == 200:
                                r_int2 = await client.post(interrupt_url, data={"type": "28", "i19": "1000"}, follow_redirects=False)
                                if r_int2.status_code == 429:
                                    raise ValueError("Microsoft rate limit — lütfen bekleyin")
                                current_url = _abs(r_int2.headers.get("location", ""), interrupt_url)

        visited: set[str] = set()
        for i in range(30):
            if not current_url:
                break
            cb = _try_extract_callback(current_url)
            if cb:
                return cb
            url_key = current_url.split("?")[0]
            if url_key in visited:
                break
            visited.add(url_key)
            try:
                r_next = await client.get(current_url, follow_redirects=False)
            except httpx.ConnectError:
                cb = _try_extract_callback(current_url)
                if cb:
                    return cb
                raise ValueError("Callback URL'e bağlanılamadı")
            if r_next.status_code == 429:
                raise ValueError("Microsoft rate limit — lütfen bekleyin")
            if r_next.status_code in (301, 302, 303, 307, 308):
                current_url = _abs(r_next.headers.get("location", ""), current_url)
                continue
            if r_next.status_code == 200:
                action, form_data = _extract_form(r_next.text)
                if action:
                    action = _abs(action, current_url)
                    r_form = await client.post(action, data=form_data, follow_redirects=False)
                    if r_form.status_code == 429:
                        raise ValueError("Microsoft rate limit — lütfen bekleyin")
                    next_loc = _abs(r_form.headers.get("location", ""), action)
                    if not next_loc and r_form.status_code == 200:
                        action2, form_data2 = _extract_form(r_form.text)
                        if action2:
                            action2 = _abs(action2, action)
                            r_form2 = await client.post(action2, data=form_data2, follow_redirects=False)
                            if r_form2.status_code == 429:
                                raise ValueError("Microsoft rate limit — lütfen bekleyin")
                            next_loc = _abs(r_form2.headers.get("location", ""), action2)
                    current_url = next_loc if next_loc else ""
                    continue
            current_url = ""

        raise ValueError("Xbox OAuth redirect chain tamamlanamadı")


# ─── Ana refresh akışı ───────────────────────────────────────────────────────

async def _do_refresh(creds: dict) -> dict:
    """Tüm refresh işini Pi'de yapar, yeni embark status'u döndürür."""
    arc_email    = creds["arctracker_email"]
    arc_password = creds["arctracker_password"]
    xbox_email   = creds["xbox_email"]
    xbox_password = creds["xbox_password"]

    async with httpx.AsyncClient(timeout=30) as arc_client:
        # 1) arctracker login
        cookie = await _arctracker_login(arc_client, arc_email, arc_password)
        headers = {"Cookie": cookie}

        # 2) Auth URL zinciri: arctracker → Embark → Xbox
        auth_resp = await arc_client.get(
            f"{ARCTRACKER_BASE}/api/embark/auth/xbox", headers=headers, follow_redirects=False,
        )
        if auth_resp.status_code not in (301, 302, 307, 308):
            raise ValueError(f"Auth redirect beklendi, {auth_resp.status_code} geldi")

        auth_extra = _build_cookie_string(auth_resp)
        if auth_extra:
            cookie = cookie + "; " + auth_extra
            headers = {"Cookie": cookie}

        embark_url = auth_resp.headers.get("location", "")
        xbox_resp = await arc_client.get(embark_url, follow_redirects=False)
        xbox_url = xbox_resp.headers.get("location", "")
        if not xbox_url or "login.live.com" not in xbox_url:
            raise ValueError("Xbox OAuth URL alınamadı")

        # 3) Xbox login — Pi ev IP'siyle yapıyor
        logger.info("Xbox login başlıyor...")
        code, state = await _xbox_auto_login(xbox_email, xbox_password, xbox_url)

        # 4) Callback arctracker'a gönder
        cb_resp = await arc_client.get(
            f"{ARCTRACKER_BASE}/api/embark/callback",
            headers=headers,
            params={"code": code, "state": state},
            follow_redirects=False,
        )

        redirect_url = cb_resp.headers.get("location", "")
        if "embark_error" in redirect_url:
            params = parse_qs(urlparse(redirect_url).query)
            error_type = params.get("embark_error", ["unknown"])[0]
            if error_type == "already_linked":
                raise ValueError("Bu Xbox hesabı başka bir arctracker hesabına bağlı")
            raise ValueError(params.get("message", [error_type])[0])

        cb_extra = _build_cookie_string(cb_resp)
        if cb_extra:
            cookie = cookie + "; " + cb_extra
            headers = {"Cookie": cookie}

        # 5) Yeni embark status'u al
        after_resp = await arc_client.get(f"{ARCTRACKER_BASE}/api/embark/status", headers=headers)
        after_status = after_resp.json() if after_resp.status_code == 200 else {}

    return after_status


# ─── Scheduler döngüsü ───────────────────────────────────────────────────────

async def _check_and_refresh():
    async with httpx.AsyncClient(timeout=60) as client:
        try:
            token = await _api_login(client)
        except Exception as e:
            logger.error("API girişi başarısız: %s", e)
            return

        headers = {"Authorization": f"Bearer {token}"}

        try:
            accounts = await _get_accounts(client, headers)
        except Exception as e:
            logger.error("Hesaplar alınamadı: %s", e)
            return

        now = datetime.now(timezone.utc)
        threshold = timedelta(hours=REFRESH_BEFORE_HOURS)
        refreshed = 0

        for acc in accounts:
            if not acc.get("has_xbox_credentials"):
                continue

            expires_str = acc.get("token_expires_at")
            if not expires_str:
                continue

            try:
                expires = datetime.fromisoformat(expires_str.replace("Z", "+00:00"))
                if expires.tzinfo is None:
                    expires = expires.replace(tzinfo=timezone.utc)
            except ValueError:
                continue

            remaining = expires - now
            if remaining > threshold:
                continue

            name = acc.get("display_name") or acc["id"][:8]
            disc = acc.get("display_name_discriminator") or ""
            logger.info("%s#%s — token %s sonra doluyor, Pi'den yenileniyor...", name, disc, remaining)

            try:
                creds = await _get_credentials(client, headers, acc["id"])
            except Exception as e:
                logger.error("%s#%s — credentials alınamadı: %s", name, disc, e)
                await asyncio.sleep(BETWEEN_ACCOUNTS_DELAY)
                continue

            try:
                embark_status = await _do_refresh(creds)
                await _post_embark_status(client, headers, acc["id"], embark_status)
                new_expires = embark_status.get("tokenExpiresAt", "?")
                logger.info("%s#%s — token yenilendi! Yeni süre: %s", name, disc, new_expires)
                refreshed += 1
            except Exception as e:
                logger.error("%s#%s — refresh hatası: %s", name, disc, e)

            await asyncio.sleep(BETWEEN_ACCOUNTS_DELAY)

        if refreshed:
            logger.info("%d hesap yenilendi.", refreshed)
        else:
            logger.info("Yenilenecek hesap yok.")


async def main():
    logger.info(
        "Token Scheduler başlatıldı — API: %s, her %d dk kontrol, bitime %d saat kala yenile",
        API_BASE, CHECK_INTERVAL // 60, REFRESH_BEFORE_HOURS,
    )
    await asyncio.sleep(10)
    while True:
        try:
            await _check_and_refresh()
        except Exception as e:
            logger.error("Döngü hatası: %s", e)
        logger.info("Sonraki kontrol %d dakika sonra.", CHECK_INTERVAL // 60)
        await asyncio.sleep(CHECK_INTERVAL)


if __name__ == "__main__":
    asyncio.run(main())

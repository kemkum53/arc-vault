"""Embark token refresh servisi.

Akış (otomatik — Xbox kimlik bilgileri varsa):
1. arctracker.io'ya giriş → cookie'leri al
2. GET /api/embark/auth/xbox → Embark → Xbox OAuth URL
3. Xbox login sayfasına programatik olarak email/şifre gönder
4. Redirect chain'i takip et → code+state yakala
5. code+state'i arctracker callback'ine gönder → token yenilenir

Akış (manuel — Xbox kimlik bilgileri yoksa):
1-2. Aynı
3. Auth URL kullanıcıya döndürülür → tarayıcıda Xbox login
4. Eklenti callback'i yakalar → API'ye gönderir
5. Aynı
"""

import json as json_mod
import logging
import re
from urllib.parse import parse_qs, urlparse, urljoin

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.crypto import decrypt_value
from app.models import TrackerAccount

logger = logging.getLogger(__name__)

BASE = settings.arctracker_base_url

# Aktif refresh oturumları
_sessions_by_account: dict[str, dict] = {}
_sessions_by_state: dict[str, dict] = {}


def _build_cookie_string(response: httpx.Response) -> str:
    """Response'daki tüm Set-Cookie header'larından cookie string oluşturur.

    httpx headers.get_list kullanarak çoklu Set-Cookie header'larını düzgün okur.
    partition("=") ile ilk '=' üzerinden böler — base64 değerlerdeki '=' korunur.
    """
    cookies = {}
    for header_val in response.headers.get_list("set-cookie"):
        part = header_val.split(";")[0]  # name=value kısmını al
        name, _, value = part.partition("=")
        name = name.strip()
        value = value.strip()
        if name and value:
            cookies[name] = value
    return "; ".join(f"{k}={v}" for k, v in cookies.items())


async def start_refresh(account: TrackerAccount) -> dict:
    """Token refresh akışını başlatır, auth URL döndürür."""
    aid = account.id

    # ── Her zaman eski session'ı temizle ve yeniden login yap ──
    _cleanup_session(aid)

    # 1) arctracker.io'ya giriş — TÜM cookie'leri yakala
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            f"{BASE}/api/auth/sign-in/email",
            json={"email": account.arctracker_email, "password": decrypt_value(account.arctracker_password)},
        )
        resp.raise_for_status()

        cookie = _build_cookie_string(resp)

        if not cookie:
            body = resp.json()
            token = body.get("token")
            if token:
                cookie = f"better-auth.session_token={token}"

        if not cookie:
            raise ValueError("arctracker.io'dan session alınamadı")

        headers = {"Cookie": cookie}

        status_resp = await client.get(f"{BASE}/api/embark/status", headers=headers)
        before_status = status_resp.json() if status_resp.status_code == 200 else {}
        logger.info("[TokenRefresh] Embark status: expired=%s", before_status.get("isTokenExpired"))

        # 2) Auth URL al (arctracker kendi PKCE session'ını oluşturur)
        # NOT: Unlink yapmıyoruz! Aynı kullanıcı tekrar bağlandığında
        # arctracker token'ı günceller, "already_linked" vermez.
        auth_resp = await client.get(
            f"{BASE}/api/embark/auth/xbox",
            headers=headers,
            follow_redirects=False,
        )
        if auth_resp.status_code not in (301, 302, 307, 308):
            raise ValueError(f"Auth redirect beklendi, {auth_resp.status_code} geldi")

        # Auth response'dan ek cookie'ler varsa ekle
        auth_extra = _build_cookie_string(auth_resp)
        if auth_extra:
            cookie = cookie + "; " + auth_extra

        embark_auth_url = auth_resp.headers.get("location", "")
        if not embark_auth_url:
            raise ValueError("Auth URL alınamadı")

        # State parametresini çıkar (Embark URL'inden)
        parsed = urlparse(embark_auth_url)
        state = parse_qs(parsed.query).get("state", [""])[0]

        # 3) Embark → Xbox redirect'ini takip et, hesap seçici ekle
        # Xbox OAuth'a prompt=select_account ekleyerek kullanıcının
        # doğru hesabı seçmesini sağlıyoruz (otomatik giriş yerine)
        auth_url = embark_auth_url  # fallback
        try:
            xbox_resp = await client.get(embark_auth_url, follow_redirects=False)
            if xbox_resp.status_code in (301, 302, 307, 308):
                xbox_url = xbox_resp.headers.get("location", "")
                if "login.live.com" in xbox_url or "login.microsoftonline.com" in xbox_url:
                    sep = "&" if "?" in xbox_url else "?"
                    auth_url = xbox_url + sep + "prompt=select_account"
                    pass
                else:
                    auth_url = xbox_url
        except Exception as e:
            logger.info("[TokenRefresh] Xbox redirect takip edilemedi")

    # 3) Session kaydet
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

    logger.info("[TokenRefresh] Refresh başlatıldı: account=%s", aid)

    return {
        "auth_url": auth_url,
        "status": "waiting",
        "current_token_expires": before_status.get("tokenExpiresAt"),
        "is_token_expired": before_status.get("isTokenExpired"),
    }


async def handle_callback(code: str, state: str) -> dict:
    """
    Eklentiden gelen callback'i işler.
    Code+state'i arctracker callback'ine server-side olarak iletir.
    """
    session = _sessions_by_state.get(state)
    if not session:
        logger.info("[TokenRefresh] Bilinmeyen state")
        return {"status": "error", "message": "Geçersiz veya süresi dolmuş state"}

    if session["status"] != "waiting":
        return {"status": session["status"], "message": "Bu oturum zaten işlendi"}

    cookie = session["cookie"]
    old_expires = session.get("before_token_expires")


    try:
        async with httpx.AsyncClient(timeout=30) as client:
            # Arctracker callback'ine GET ile gönder (tüm cookie'ler ile)
            r = await client.get(
                f"{BASE}/api/embark/callback",
                headers={"Cookie": cookie},
                params={"code": code, "state": state},
                follow_redirects=False,
            )

            redirect_url = r.headers.get("location", "")
            logger.info("[TokenRefresh] Callback response: status=%d", r.status_code)

            # Redirect URL'i kontrol et — başarı/hata durumu burada belli olur
            if "embark_error" in redirect_url:
                parsed = urlparse(redirect_url)
                params = parse_qs(parsed.query)
                error_type = params.get("embark_error", ["unknown"])[0]
                error_msg = params.get("message", [error_type])[0]
                logger.error("[TokenRefresh] Callback HATA: %s", error_type)

                # Kullanıcı dostu hata mesajları
                if error_type == "already_linked":
                    error_msg = ("Bu Xbox/Embark hesabi baska bir arctracker hesabina bagli. "
                                 "Once o hesaptan baglantiyi kaldirin.")

                session["status"] = "error"
                session["result"] = {"error": error_msg}
                return {"status": "error", "message": error_msg}

            # Başarılı! Callback'den gelen cookie'leri ekle
            cb_extra = _build_cookie_string(r)
            updated_cookie = (cookie + "; " + cb_extra) if cb_extra else cookie

            # Yeni token durumunu kontrol et
            status_r = await client.get(
                f"{BASE}/api/embark/status",
                headers={"Cookie": updated_cookie},
            )
            after_status = status_r.json() if status_r.status_code == 200 else {}
            logger.info("[TokenRefresh] After callback: expired=%s", after_status.get("isTokenExpired"))

    except Exception as e:
        logger.error("[TokenRefresh] Callback exception")
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
    logger.info("[TokenRefresh] Başarılı!")

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


# ─── Otomatik Xbox Login ───


async def _xbox_auto_login(xbox_email: str, xbox_password: str, xbox_oauth_url: str) -> tuple[str, str]:
    """Xbox OAuth'u programatik olarak tamamlar.

    Microsoft login sayfasına email/şifre göndererek code+state alır.
    Redirect chain'i takip ederek callback URL'indeki code+state'i yakalar.

    Returns: (code, state) tuple
    Raises: ValueError on failure
    """
    UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
          "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36")

    # Tek bir client kullan — cookie jar otomatik paylaşılsın
    async with httpx.AsyncClient(
        timeout=30,
        headers={
            "User-Agent": UA,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
        },
    ) as client:

        # ── 1) Login sayfasını al (redirect'leri takip et) ──
        r = await client.get(xbox_oauth_url, follow_redirects=True)
        body = r.text
        final_url = str(r.url)
        logger.info("[XboxLogin] Login page: %d, body: %d bytes", r.status_code, len(body))

        # ── ServerData / $Config parse ──
        sd = _parse_server_data(body)
        if not sd:
            raise ValueError("Xbox login sayfası ayrıştırılamadı (ServerData yok)")

        sft_tag = sd.get("sFTTag", "")
        ppft_match = re.search(r'value="([^"]+)"', sft_tag)
        if not ppft_match:
            raise ValueError("Xbox PPFT token bulunamadı")
        ppft = ppft_match.group(1)

        post_url = sd.get("urlPost", "")
        if not post_url:
            raise ValueError("Xbox POST URL bulunamadı")

        logger.info("[XboxLogin] urlPost alındı")

        # ── 2) Credentials POST ──
        login_data = {
            "login": xbox_email,
            "loginfmt": xbox_email,
            "passwd": xbox_password,
            "PPFT": ppft,
            "type": "11",
            "LoginOptions": "1",
            "PPSX": "PassportRN",
            "i13": "0",
            "CookieDisclosure": "0",
            "IsFidoSupported": "0",
            "isSignupPost": "0",
            "isRecoveryAttemptPost": "0",
            "i19": "16399",
        }

        r2 = await client.post(
            post_url, data=login_data, follow_redirects=False,
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "Referer": final_url,
                "Origin": "https://login.live.com",
            },
        )
        logger.info("[XboxLogin] POST: %d", r2.status_code)

        current_url = r2.headers.get("location", "")

        # ── 200 Response: hata / 2. aşama / form ──
        if r2.status_code == 200:
            body2 = r2.text
            logger.info("[XboxLogin] POST body: %d bytes", len(body2))

            # Login hatası kontrolü
            if "sErrTxt" in body2:
                err_match = re.search(r'"sErrTxt"\s*:\s*"([^"]+)"', body2)
                err_msg = err_match.group(1) if err_match else "Xbox login hatası"
                raise ValueError(f"Xbox login başarısız: {err_msg}")

            # MS error page (HR=0x...)
            hr_match = re.search(r"HR=(0x[0-9A-Fa-f]+)", body2)
            if hr_match and len(body2) < 5000:
                raise ValueError(f"Microsoft login hatası: {hr_match.group(1)}")

            # İki aşamalı login — şifre sayfası
            # Modern MS login: sFT (doğrudan token) veya sFTTag (<input> tag)
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
                logger.info("[XboxLogin] 2. aşama (şifre) tespit edildi → %s", post_url2[:80])
                login_data["PPFT"] = ppft2
                r2b = await client.post(
                    post_url2, data=login_data, follow_redirects=False,
                    headers={
                        "Content-Type": "application/x-www-form-urlencoded",
                        "Referer": post_url,
                        "Origin": "https://login.live.com",
                    },
                )
                logger.info("[XboxLogin] 2. POST: %d", r2b.status_code)
                current_url = r2b.headers.get("location", "")
                if r2b.status_code == 200:
                    body2 = r2b.text
                else:
                    body2 = ""

            # Form submit (KMSI / consent sayfası)
            if not current_url and body2:
                current_url = _submit_form_if_present(body2)
                if current_url == "__POST__":
                    action, form_data = _extract_form(body2)
                    if not action:
                        current_url = ""
                    elif "identity/confirm" in action:
                        # identity/confirm akışı: POST → "Verify your account" tetikliyor.
                        # Bunun yerine interrupt/credentialaction ile dene (aynı id= parametresi)
                        action = _abs(action, post_url)
                        ic_parsed = urlparse(action)
                        ic_qs = ic_parsed.query
                        cred_url = f"https://account.live.com/interrupt/credentialaction?{ic_qs}"
                        logger.info("[XboxLogin] identity/confirm → credentialaction dene: %s", cred_url[:80])
                        r_cred = await client.post(cred_url, data=form_data, follow_redirects=False)
                        logger.info("[XboxLogin] credentialaction POST: %d loc=%s body=%d",
                                    r_cred.status_code, r_cred.headers.get("location","")[:80], len(r_cred.text))
                        if r_cred.status_code == 429:
                            raise ValueError("Microsoft rate limit — lütfen birkaç dakika bekleyin")
                        current_url = _abs(r_cred.headers.get("location", ""), cred_url)
                        if r_cred.status_code == 200 and not current_url:
                            config = _parse_server_data(r_cred.text)
                            if config and config.get("urlPost"):
                                interrupt_url = _abs(config["urlPost"], cred_url)
                                logger.info("[XboxLogin] credentialaction $Config urlPost → %s", interrupt_url[:80])
                                r_int = await client.get(interrupt_url, follow_redirects=False)
                                logger.info("[XboxLogin] interrupt GET: %d loc=%s", r_int.status_code, r_int.headers.get("location","")[:80])
                                if r_int.status_code in (301, 302, 303, 307, 308):
                                    current_url = _abs(r_int.headers.get("location", ""), interrupt_url)
                                elif r_int.status_code == 200:
                                    r_int2 = await client.post(
                                        interrupt_url,
                                        data={"type": "28", "i19": "1000"},
                                        follow_redirects=False,
                                    )
                                    logger.info("[XboxLogin] interrupt POST: %d loc=%s", r_int2.status_code, r_int2.headers.get("location","")[:80])
                                    if r_int2.status_code == 429:
                                        raise ValueError("Microsoft rate limit — lütfen birkaç dakika bekleyin")
                                    current_url = _abs(r_int2.headers.get("location", ""), interrupt_url)
                        if not current_url:
                            parsed_ic = urlparse(action)
                            ru_vals = parse_qs(parsed_ic.query).get("ru", [])
                            if ru_vals:
                                current_url = ru_vals[0]
                                logger.info("[XboxLogin] identity/confirm: ru fallback → %s", current_url[:80])
                    else:
                        action = _abs(action, post_url)
                        r3 = await client.post(action, data=form_data, follow_redirects=False)
                        logger.info("[XboxLogin] Form submit: %d url=%s body=%d loc=%s",
                                    r3.status_code, action[:80], len(r3.text),
                                    r3.headers.get("location", "")[:80])
                        if r3.status_code == 429:
                            raise ValueError("Microsoft rate limit — lütfen birkaç dakika bekleyin")
                        current_url = _abs(r3.headers.get("location", ""), action)
                        # KMSI / interrupt sayfası (200 döndü, redirect yok)
                        if r3.status_code == 200 and not current_url:
                            config = _parse_server_data(r3.text)
                            if config and config.get("urlPost"):
                                interrupt_url = _abs(config["urlPost"], action)
                                logger.info("[XboxLogin] interrupt $Config urlPost → %s", interrupt_url[:80])
                                r_int = await client.get(interrupt_url, follow_redirects=False)
                                logger.info("[XboxLogin] interrupt GET: %d loc=%s", r_int.status_code, r_int.headers.get("location","")[:80])
                                if r_int.status_code in (301, 302, 303, 307, 308):
                                    current_url = _abs(r_int.headers.get("location", ""), interrupt_url)
                                elif r_int.status_code == 200:
                                    r_int2 = await client.post(
                                        interrupt_url,
                                        data={"type": "28", "i19": "1000"},
                                        follow_redirects=False,
                                    )
                                    logger.info("[XboxLogin] interrupt POST: %d loc=%s", r_int2.status_code, r_int2.headers.get("location","")[:80])
                                    if r_int2.status_code == 429:
                                        raise ValueError("Microsoft rate limit — lütfen birkaç dakika bekleyin")
                                    current_url = _abs(r_int2.headers.get("location", ""), interrupt_url)
                            if not current_url:
                                action2, form_data2 = _extract_form(r3.text)
                                if action2 and action2 != "#":
                                    action2 = _abs(action2, action)
                                    if not form_data2.get("PPFT") and config:
                                        sft_raw = config.get("sFT") or ""
                                        sft_tag = config.get("sFTTag") or ""
                                        ppft_m = re.search(r'value="([^"]+)"', sft_tag) if sft_tag else None
                                        form_data2["PPFT"] = ppft_m.group(1) if ppft_m else sft_raw
                                    form_data2.update({"type": "28", "i19": "1000"})
                                    logger.info("[XboxLogin] KMSI form submit → %s", action2[:80])
                                    r3b = await client.post(action2, data=form_data2, follow_redirects=False)
                                    if r3b.status_code == 429:
                                        raise ValueError("Microsoft rate limit — lütfen birkaç dakika bekleyin")
                                    logger.info("[XboxLogin] KMSI result: %d loc=%s", r3b.status_code, r3b.headers.get("location","")[:80])
                                    current_url = _abs(r3b.headers.get("location", ""), action2)
                            if not current_url:
                                parsed_action = urlparse(action)
                                ru_vals = parse_qs(parsed_action.query).get("ru", [])
                                if ru_vals:
                                    current_url = ru_vals[0]
                                    logger.info("[XboxLogin] interrupt: ru fallback → %s", current_url[:80])

        # ── 3) Redirect chain takip et ──
        visited: set[str] = set()
        for i in range(30):
            if not current_url:
                logger.info("[XboxLogin] Chain durdu (step %d)", i)
                break

            # Callback URL yakalandı!
            cb_result = _try_extract_callback(current_url)
            if cb_result:
                logger.info("[XboxLogin] Callback yakalandı! step=%d", i)
                return cb_result

            # Loop tespiti
            url_key = current_url.split("?")[0]
            if url_key in visited:
                logger.warning("[XboxLogin] Loop tespit edildi step=%d url=%s", i, url_key)
                break
            visited.add(url_key)

            logger.info("[XboxLogin] Redirect step %d: %s", i, current_url[:80])

            try:
                r_next = await client.get(current_url, follow_redirects=False)
            except httpx.ConnectError:
                # 127.0.0.1'e bağlanılamadı — URL'den code/state parse et
                cb_result = _try_extract_callback(current_url)
                if cb_result:
                    return cb_result
                raise ValueError("Callback URL'e bağlanılamadı")

            next_loc = r_next.headers.get("location", "")

            if r_next.status_code == 429:
                raise ValueError("Microsoft rate limit — lütfen birkaç dakika bekleyin")

            # 3xx redirect
            if r_next.status_code in (301, 302, 303, 307, 308) and next_loc:
                current_url = _abs(next_loc, current_url)
                continue

            # 200 — form submit gerekebilir
            if r_next.status_code == 200:
                action, form_data = _extract_form(r_next.text)
                if action:
                    action = _abs(action, current_url)
                    logger.info("[XboxLogin] Chain form submit → %s", action[:80])
                    r_form = await client.post(action, data=form_data, follow_redirects=False)
                    if r_form.status_code == 429:
                        raise ValueError("Microsoft rate limit — lütfen birkaç dakika bekleyin")
                    next_loc = _abs(r_form.headers.get("location", ""), action)
                    if not next_loc and r_form.status_code == 200:
                        action2, form_data2 = _extract_form(r_form.text)
                        if action2:
                            action2 = _abs(action2, action)
                            r_form2 = await client.post(action2, data=form_data2, follow_redirects=False)
                            if r_form2.status_code == 429:
                                raise ValueError("Microsoft rate limit — lütfen birkaç dakika bekleyin")
                            next_loc = _abs(r_form2.headers.get("location", ""), action2)

            current_url = _abs(next_loc, current_url) if next_loc else ""

        raise ValueError("Xbox OAuth redirect chain tamamlanamadı")


def _abs(url: str, base: str) -> str:
    """Relative URL'i base URL'e göre absolute yapar."""
    if not url or url.startswith("http"):
        return url
    return urljoin(base, url)


def _parse_server_data(html: str) -> dict | None:
    """HTML'den Microsoft ServerData / $Config objesini parse eder."""
    for pattern in [
        r"\$Config\s*=\s*(\{.*?\});\s*//",
        r"var ServerData\s*=\s*(\{.*?\});",
    ]:
        m = re.search(pattern, html, re.DOTALL)
        if m:
            try:
                return json_mod.loads(m.group(1))
            except json_mod.JSONDecodeError:
                # Fallback: sFTTag ve urlPost regex ile çıkar
                sft = re.search(r'"sFTTag"\s*:\s*"(.*?)"', m.group(1))
                url = re.search(r'"urlPost"\s*:\s*"(.*?)"', m.group(1))
                if sft or url:
                    return {
                        "sFTTag": sft.group(1) if sft else "",
                        "urlPost": url.group(1) if url else "",
                    }
    return None


def _extract_form(html: str) -> tuple[str | None, dict]:
    """HTML'den ilk form action ve hidden input'ları çıkarır."""
    action_m = re.search(r'action=["\']([^"\']+)["\']', html)
    if not action_m:
        return None, {}
    inputs = re.findall(r'<input[^>]+name=["\']([^"\']+)["\'][^>]+value=["\']([^"\']*)["\']', html)
    if not inputs:
        inputs = re.findall(r'name=["\']([^"\']+)["\'][^>]*value=["\']([^"\']*)["\']', html)
    return action_m.group(1), {n: v for n, v in inputs}


def _submit_form_if_present(html: str) -> str:
    """Form varsa '__POST__' sentinel döner, yoksa ''."""
    if re.search(r'action="([^"]+)"', html):
        return "__POST__"
    return ""


def _try_extract_callback(url: str) -> tuple[str, str] | None:
    """URL callback URL'iyse (code, state) tuple döner."""
    if "127.0.0.1" not in url:
        return None
    parsed = urlparse(url)
    params = parse_qs(parsed.query)
    code = params.get("code", [""])[0]
    state = params.get("state", [""])[0]
    if code and state:
        return code, state
    return None


async def auto_refresh(account: TrackerAccount, **_kwargs) -> dict:
    """Xbox kimlik bilgileri ile tam otomatik token yenileme.

    Tarayıcı veya eklenti gerektirmez. Tüm akış server-side yapılır.
    Bağlı hesap varsa önce unlink yapılır (already_linked önlemi).
    """
    if not account.xbox_email or not account.xbox_password:
        raise ValueError("Xbox kimlik bilgileri eksik")

    return await _do_auto_refresh(account)


async def _do_auto_refresh(account: TrackerAccount) -> dict:
    """Auto refresh'in asıl akışı.

    Tüm arctracker cookie'leri tek bir client üzerinden yönetilir.
    handle_callback'i bypass eder — callback direkt aynı session'da yapılır.
    """
    aid = account.id
    _cleanup_session(aid)

    # Tek bir client — cookie jar otomatik paylaşılsın
    async with httpx.AsyncClient(timeout=30) as arc_client:
        # 1) Arctracker login
        resp = await arc_client.post(
            f"{BASE}/api/auth/sign-in/email",
            json={"email": account.arctracker_email, "password": decrypt_value(account.arctracker_password)},
        )
        resp.raise_for_status()
        cookie = _build_cookie_string(resp)
        if not cookie:
            raise ValueError("arctracker.io'dan session alınamadı")

        headers = {"Cookie": cookie}

        # 2) Mevcut durum
        status_resp = await arc_client.get(f"{BASE}/api/embark/status", headers=headers)
        before_status = status_resp.json() if status_resp.status_code == 200 else {}
        old_expires = before_status.get("tokenExpiresAt")
        logger.info("[AutoRefresh] Mevcut durum alındı")

        # 3) Auth URL zinciri: arctracker → Embark → Xbox
        auth_resp = await arc_client.get(
            f"{BASE}/api/embark/auth/xbox", headers=headers, follow_redirects=False,
        )
        if auth_resp.status_code not in (301, 302, 307, 308):
            raise ValueError(f"Auth redirect beklendi, {auth_resp.status_code} geldi")

        # Auth response'dan ek cookie'ler — PKCE session bilgisi burada olabilir
        auth_extra = _build_cookie_string(auth_resp)
        if auth_extra:
            cookie = cookie + "; " + auth_extra
            headers = {"Cookie": cookie}

        embark_url = auth_resp.headers.get("location", "")

        # Embark → Xbox redirect
        xbox_resp = await arc_client.get(embark_url, follow_redirects=False)
        xbox_url = xbox_resp.headers.get("location", "")
        if not xbox_url or "login.live.com" not in xbox_url:
            raise ValueError("Xbox OAuth URL alınamadı")

        # 4) Xbox otomatik login (ayrı client — farklı domain)
        logger.info("[AutoRefresh] Xbox auto-login başlıyor")
        code, callback_state = await _xbox_auto_login(
            account.xbox_email, decrypt_value(account.xbox_password), xbox_url,
        )

        # 5) Callback'i arctracker'a AYNI CLIENT ile gönder
        #    Bu sayede tüm login + PKCE cookie'leri korunur
        logger.info("[AutoRefresh] Callback gönderiliyor")

        cb_resp = await arc_client.get(
            f"{BASE}/api/embark/callback",
            headers=headers,
            params={"code": code, "state": callback_state},
            follow_redirects=False,
        )

        redirect_url = cb_resp.headers.get("location", "")
        logger.info("[AutoRefresh] Callback response: %d", cb_resp.status_code)

        # Hata kontrolü
        if "embark_error" in redirect_url:
            parsed = urlparse(redirect_url)
            params = parse_qs(parsed.query)
            error_type = params.get("embark_error", ["unknown"])[0]

            if error_type == "already_linked":
                error_msg = ("Bu Xbox/Embark hesabi baska bir arctracker "
                             "hesabina bagli. Once o hesaptan baglantiyi kaldirin.")
            else:
                error_msg = params.get("message", [error_type])[0]

            return {"status": "error", "message": error_msg}

        # Başarılı — yeni cookie'ler varsa ekle
        cb_extra = _build_cookie_string(cb_resp)
        if cb_extra:
            cookie = cookie + "; " + cb_extra
            headers = {"Cookie": cookie}

        # Yeni token durumunu kontrol et
        after_resp = await arc_client.get(f"{BASE}/api/embark/status", headers=headers)
        after_status = after_resp.json() if after_resp.status_code == 200 else {}
        new_expires = after_status.get("tokenExpiresAt")

        logger.info("[AutoRefresh] Başarılı!")

    # Session'ı kaydet (complete_refresh için)
    session = {
        "account_id": aid,
        "cookie": cookie,
        "state": callback_state,
        "status": "success",
        "before_token_expires": old_expires,
        "result": {
            "message": "Token başarıyla yenilendi!",
            "old_expires": old_expires,
            "new_expires": new_expires,
            "is_token_expired": after_status.get("isTokenExpired"),
            "embark_status": after_status,
        },
    }
    _sessions_by_account[aid] = session

    return {
        "status": "success",
        "message": "Token başarıyla yenilendi!",
        "old_expires": old_expires,
        "new_expires": new_expires,
    }





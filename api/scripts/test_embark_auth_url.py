"""
Arctracker.io'nun Embark OAuth URL'ini inceleyen test scripti.

Ne yapar:
1. Arctracker'a giriş yapar
2. /api/embark/auth/xbox'u çağırır (redirect'i takip etmez)
3. Dönen Location header'ını parse eder → auth.embark.net URL'i
4. O URL'i de GET eder (redirect'i takip etmez) → Xbox/Microsoft URL'i
5. Her iki URL'deki tüm parametreleri ekrana basar

Çalıştırma:
    cd api
    python scripts/test_embark_auth_url.py
"""

import asyncio
from urllib.parse import urlparse, parse_qs

import httpx

ARCTRACKER_BASE = "https://arctracker.io"
EMAIL = "arctracker.retorted270@passmail.net"
PASSWORD = "^Unexczn2VAZxGzTPT6D"


def _build_cookie_string(response: httpx.Response) -> str:
    cookies = {}
    for header_val in response.headers.get_list("set-cookie"):
        part = header_val.split(";")[0]
        name, _, value = part.partition("=")
        name = name.strip()
        value = value.strip()
        if name and value:
            cookies[name] = value
    return "; ".join(f"{k}={v}" for k, v in cookies.items())


def _print_url_params(label: str, url: str):
    print(f"\n{'='*60}")
    print(f"  {label}")
    print(f"{'='*60}")
    parsed = urlparse(url)
    print(f"  Scheme : {parsed.scheme}")
    print(f"  Host   : {parsed.netloc}")
    print(f"  Path   : {parsed.path}")
    params = parse_qs(parsed.query)
    if params:
        print("  Params :")
        for k, v in params.items():
            print(f"    {k:30s} = {v[0]}")
    else:
        print("  (parametre yok)")
    print(f"{'='*60}\n")


async def main():
    print("\n[1] Arctracker.io'ya giriş yapılıyor...")
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.post(
            f"{ARCTRACKER_BASE}/api/auth/sign-in/email",
            json={"email": EMAIL, "password": PASSWORD},
        )
        print(f"    Giriş yanıtı: {resp.status_code}")
        if resp.status_code not in (200, 201):
            print(f"    HATA: {resp.text[:300]}")
            return

        cookie = _build_cookie_string(resp)
        if not cookie:
            body = resp.json()
            token = body.get("token", "")
            if token:
                cookie = f"better-auth.session_token={token}"
        if not cookie:
            print("    HATA: Cookie alınamadı")
            return
        print(f"    Cookie alındı: {cookie[:60]}...")

        # ── 2) /api/embark/auth/xbox → redirect URL'i yakala ──
        print("\n[2] /api/embark/auth/xbox çağrılıyor (redirect takip edilmiyor)...")
        auth_resp = await client.get(
            f"{ARCTRACKER_BASE}/api/embark/auth/xbox",
            headers={"Cookie": cookie},
            follow_redirects=False,
        )
        print(f"    Yanıt status: {auth_resp.status_code}")

        embark_url = auth_resp.headers.get("location", "")
        if not embark_url:
            print("    HATA: Location header yok")
            print(f"    Body: {auth_resp.text[:300]}")
            return

        _print_url_params("ARCTRACKER → auth.embark.net URL", embark_url)

        # ── 3) auth.embark.net → Xbox redirect URL'ini yakala ──
        print("[3] auth.embark.net URL'i GET ediliyor (redirect takip edilmiyor)...")
        embark_resp = await client.get(embark_url, follow_redirects=False)
        print(f"    Yanıt status: {embark_resp.status_code}")

        xbox_url = embark_resp.headers.get("location", "")
        if xbox_url:
            _print_url_params("auth.embark.net → Xbox/Microsoft URL", xbox_url)
        else:
            print(f"    Xbox redirect yok. Body: {embark_resp.text[:200]}")

        # ── Özet ──
        print("\n[ÖZET] Kritik parametreler:")
        embark_params = parse_qs(urlparse(embark_url).query)
        for key in ("client_id", "scope", "audience", "redirect_uri", "external_provider_name"):
            val = embark_params.get(key, ["?"])[0]
            print(f"  {key:30s} = {val}")

        if xbox_url:
            xbox_params = parse_qs(urlparse(xbox_url).query)
            print("\n[Xbox URL] Kritik parametreler:")
            for key in ("client_id", "scope", "redirect_uri", "response_type"):
                val = xbox_params.get(key, ["?"])[0]
                print(f"  {key:30s} = {val}")


if __name__ == "__main__":
    asyncio.run(main())

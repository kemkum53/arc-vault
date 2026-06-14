"""
embark-launcher client ile PKCE OAuth testi.

Hipotez: embark-launcher public bir client, client_secret gerekmez.
         pioneer scope ile ARC Raiders game API'sine erişilebilir.

Akış:
  1. PKCE parametreleri oluştur
  2. Tarayıcıda auth.embark.net → Xbox login aç
  3. Loopback server'da callback'i yakala (port 49171)
  4. client_secret OLMADAN token exchange dene
  5. Token ile /v1/pioneer/inventory'yi çağır
  6. Sonucu bas

Çalıştırma:
    cd api
    python3 scripts/test_embark_launcher_pkce.py

Ana projeye hiç dokunmaz.
"""

import asyncio
import base64
import hashlib
import json
import os
import secrets
import sys
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlencode, urlparse

import httpx

# ── OAuth parametreleri ──────────────────────────────────────────────────────
CLIENT_ID    = "embark-launcher"
AUTH_URL     = "https://auth.embark.net/oauth2/authorize"
TOKEN_URL    = "https://auth.embark.net/oauth2/token"
SCOPE        = "pioneer openid offline"
AUDIENCE     = "https://pioneer.embark.net"
REDIRECT_URI = "http://127.0.0.1:49171"
PROVIDER     = "xbox"

# ── Game API ─────────────────────────────────────────────────────────────────
GAME_API     = "https://api-gateway.europe.es-pio.net"
GAME_HEADERS = {
    "User-Agent": "PioneerGame/pioneer_1.27.x-CL-1177678 (http-legacy) WinGDK/10.0.26200.1.256.64bit",
    "x-embark-manifest-id": "3444604227300176323",
    "x-embark-telemetry-client-platform": "12",
}

# ── Callback sunucusu ─────────────────────────────────────────────────────────
_callback_result: dict | None = None
_callback_event = threading.Event()


class _CallbackHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        global _callback_result
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        code  = params.get("code",  [""])[0]
        state = params.get("state", [""])[0]
        error = params.get("error", [""])[0]

        if error:
            _callback_result = {"error": error, "description": params.get("error_description", [""])[0]}
        elif code:
            _callback_result = {"code": code, "state": state}
        else:
            _callback_result = {"error": "no_code", "description": "Callback'te code yok"}

        body = b"<h2>Tamam! Bu sekmeyi kapatabilirsin.</h2>" if code else b"<h2>Hata olustu.</h2>"
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(body)
        _callback_event.set()

    def log_message(self, *_):
        pass  # httpserver loglarini bastir


def _start_callback_server() -> HTTPServer:
    port = int(REDIRECT_URI.split(":")[-1])
    server = HTTPServer(("127.0.0.1", port), _CallbackHandler)
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    return server


# ── PKCE ─────────────────────────────────────────────────────────────────────
def _pkce_pair() -> tuple[str, str]:
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode()
    digest   = hashlib.sha256(verifier.encode()).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
    return verifier, challenge


# ── Ana akış ─────────────────────────────────────────────────────────────────
async def main():
    print("\n" + "="*60)
    print("  embark-launcher PKCE Testi")
    print("="*60)

    # 1) PKCE
    verifier, challenge = _pkce_pair()
    state = secrets.token_urlsafe(16)
    print(f"\n[1] PKCE oluşturuldu")
    print(f"    verifier  : {verifier[:20]}...")
    print(f"    challenge : {challenge[:20]}...")

    # 2) Auth URL
    params = {
        "client_id":             CLIENT_ID,
        "response_type":         "code",
        "scope":                 SCOPE,
        "audience":              AUDIENCE,
        "redirect_uri":          REDIRECT_URI,
        "code_challenge":        challenge,
        "code_challenge_method": "S256",
        "state":                 state,
        "external_provider_name": PROVIDER,
    }
    auth_url = f"{AUTH_URL}?{urlencode(params)}"
    print(f"\n[2] Auth URL oluşturuldu")
    print(f"    {auth_url[:100]}...")

    # 3) Callback sunucusunu başlat
    server = _start_callback_server()
    print(f"\n[3] Callback sunucusu başlatıldı → {REDIRECT_URI}")

    # 4) Tarayıcıda aç
    print(f"\n[4] Tarayıcı açılıyor... Xbox ile giriş yap.")
    webbrowser.open(auth_url)

    # 5) Callback bekle (120 saniye)
    print("    Bekleniyor (120s)...")
    got_callback = _callback_event.wait(timeout=120)
    server.shutdown()

    if not got_callback or _callback_result is None:
        print("\n[HATA] Zaman aşımı — 120 saniyede callback gelmedi.")
        sys.exit(1)

    if "error" in _callback_result:
        print(f"\n[HATA] Callback hatası: {_callback_result}")
        sys.exit(1)

    code = _callback_result["code"]
    cb_state = _callback_result["state"]
    print(f"\n[5] Callback alındı!")
    print(f"    code  : {code[:20]}...")
    print(f"    state : {cb_state}")

    if cb_state != state:
        print(f"\n[UYARI] State uyuşmuyor! Beklenen={state} Gelen={cb_state}")

    # 6) Token exchange — client_secret YOK
    print(f"\n[6] Token exchange deneniyor (client_secret OLMADAN)...")
    print(f"    POST {TOKEN_URL}")

    async with httpx.AsyncClient(timeout=20) as client:
        token_resp = await client.post(
            TOKEN_URL,
            data={
                "grant_type":    "authorization_code",
                "client_id":     CLIENT_ID,
                "code":          code,
                "code_verifier": verifier,
                "redirect_uri":  REDIRECT_URI,
            },
        )

    print(f"    Yanıt status : {token_resp.status_code}")

    if token_resp.status_code != 200:
        print(f"\n[SONUÇ] Token exchange BAŞARISIZ")
        print(f"    Yanıt body : {token_resp.text[:500]}")
        _analyze_failure(token_resp)
        sys.exit(1)

    token_data = token_resp.json()
    access_token  = token_data.get("access_token",  "")
    refresh_token = token_data.get("refresh_token", "")
    token_type    = token_data.get("token_type",    "")
    expires_in    = token_data.get("expires_in",    "")

    print(f"\n[BAŞARI] Token alındı!")
    print(f"    token_type    : {token_type}")
    print(f"    expires_in    : {expires_in}s")
    print(f"    access_token  : {access_token[:40]}...")
    print(f"    refresh_token : {'var' if refresh_token else 'YOK'}")

    # JWT payload'ını decode et (imza doğrulamadan)
    _decode_jwt(access_token)

    # 7) Game API testi
    print(f"\n[7] Game API testi → GET /v1/shared/profile")
    async with httpx.AsyncClient(timeout=15) as client:
        api_resp = await client.get(
            f"{GAME_API}/v1/shared/profile",
            headers={**GAME_HEADERS, "Authorization": f"Bearer {access_token}"},
        )
    print(f"    Yanıt status : {api_resp.status_code}")

    if api_resp.status_code == 200:
        profile = api_resp.json()
        dn = profile.get("displayName", {})
        print(f"    displayName  : {dn.get('name')}#{dn.get('discriminator')}")
        print(f"    accountId    : {profile.get('accountId', '?')}")
        print(f"\n[SONUÇ] embark-launcher ile GAME API ERİŞİMİ BAŞARILI!")
        print("         arctracker.io aracısına gerek YOK!")
    else:
        print(f"    Yanıt body : {api_resp.text[:300]}")
        print(f"\n[SONUÇ] Token alındı ama game API erişimi başarısız.")
        print("         Muhtemelen scope veya audience yanlış.")

    # 8) Inventory testi
    if api_resp.status_code == 200:
        print(f"\n[8] Inventory testi → GET /v1/pioneer/inventory")
        async with httpx.AsyncClient(timeout=15) as client:
            inv_resp = await client.get(
                f"{GAME_API}/v1/pioneer/inventory",
                headers={**GAME_HEADERS, "Authorization": f"Bearer {access_token}"},
            )
        print(f"    Yanıt status : {inv_resp.status_code}")
        if inv_resp.status_code == 200:
            inv = inv_resp.json()
            items = inv.get("snapshot", inv).get("items", [])
            print(f"    Item sayısı  : {len(items)}")
        else:
            print(f"    Yanıt body   : {inv_resp.text[:200]}")


def _analyze_failure(resp: httpx.Response):
    """Token exchange hatasını yorumlar."""
    try:
        body = resp.json()
        err  = body.get("error", "")
        desc = body.get("error_description", "")
        print(f"\n  Hata kodu   : {err}")
        print(f"  Açıklama    : {desc}")
        if err == "invalid_client":
            print("\n  → embark-launcher CONFIDENTIAL bir client.")
            print("    Token exchange için client_secret gerekiyor.")
            print("    Bu client ile PKCE akışı ÇALIŞMIYOR.")
        elif err == "invalid_grant":
            print("\n  → Code geçersiz veya süresi dolmuş.")
        elif err == "unauthorized_client":
            print("\n  → Bu client bu grant_type'ı kullanamıyor.")
    except Exception:
        pass


def _decode_jwt(token: str):
    """JWT payload'ını base64 decode eder (imza doğrulamadan)."""
    try:
        parts = token.split(".")
        if len(parts) < 2:
            return
        padded = parts[1] + "=" * (-len(parts[1]) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded))
        print(f"\n  JWT payload:")
        for k in ("sub", "aud", "iss", "exp", "client_id", "scope", "scp"):
            if k in payload:
                print(f"    {k:12s} : {payload[k]}")
    except Exception:
        pass


if __name__ == "__main__":
    asyncio.run(main())

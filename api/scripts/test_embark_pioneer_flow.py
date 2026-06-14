"""
embark-pioneer client ile OAuth akış testi.

Arctracker'ın kullandığı parametrelerin birebir kopyası:
  client_id   = embark-pioneer
  redirect_uri = http://127.0.0.1:49172  (arctracker ile aynı port)
  tenancy     = pioneer-live
  skip_link   = false

Token exchange'i CLIENT_SECRET olmadan dener.
Sonuç:
  - 200 → embark-pioneer PUBLIC, arctracker.io bypass edilebilir!
  - invalid_client → secret gerekiyor, arctracker.io bunu biliyor
  - Callback gelirse zaten auth akışı tam çalışıyor demektir.

Çalıştırma:
    cd api
    python3 scripts/test_embark_pioneer_flow.py
"""

import asyncio
import base64
import hashlib
import json
import secrets
import sys
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlencode, urlparse

import httpx

# ── Parametreler — arctracker ile birebir aynı ──────────────────────────────
CLIENT_ID    = "embark-pioneer"
AUTH_URL     = "https://auth.embark.net/oauth2/authorize"
TOKEN_URL    = "https://auth.embark.net/oauth2/token"
SCOPE        = "pioneer openid offline"
AUDIENCE     = "https://pioneer.embark.net"
REDIRECT_URI = "http://127.0.0.1:49172"   # arctracker'ın portu
PROVIDER     = "xbox"

GAME_API     = "https://api-gateway.europe.es-pio.net"
GAME_HEADERS = {
    "User-Agent": "PioneerGame/pioneer_1.27.x-CL-1177678 (http-legacy) WinGDK/10.0.26200.1.256.64bit",
    "x-embark-manifest-id": "3444604227300176323",
    "x-embark-telemetry-client-platform": "12",
}

# ── Callback sunucusu ─────────────────────────────────────────────────────────
_callback_result: dict | None = None
_callback_event = threading.Event()


class _Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        global _callback_result
        params = parse_qs(urlparse(self.path).query)
        code  = params.get("code",  [""])[0]
        state = params.get("state", [""])[0]
        error = params.get("error", [""])[0]

        if error:
            _callback_result = {"error": error}
        elif code:
            _callback_result = {"code": code, "state": state}
        else:
            _callback_result = {"error": "no_code"}

        body = b"<h2>Tamam, bu sekmeyi kapatabilirsin.</h2>"
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(body)
        _callback_event.set()

    def log_message(self, *_): pass


def _start_server() -> HTTPServer:
    port = int(REDIRECT_URI.split(":")[-1])
    server = HTTPServer(("127.0.0.1", port), _Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def _pkce() -> tuple[str, str]:
    v = base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode()
    c = base64.urlsafe_b64encode(hashlib.sha256(v.encode()).digest()).rstrip(b"=").decode()
    return v, c


def _decode_jwt(token: str):
    try:
        parts = token.split(".")
        padded = parts[1] + "=" * (-len(parts[1]) % 4)
        p = json.loads(base64.urlsafe_b64decode(padded))
        print("  JWT payload:")
        for k in ("sub", "aud", "iss", "client_id", "scope", "scp"):
            if k in p:
                print(f"    {k:12s} : {p[k]}")
    except Exception:
        pass


async def main():
    print("\n" + "="*60)
    print("  embark-pioneer PKCE Akış Testi")
    print("  (arctracker parametreleri, secret YOK)")
    print("="*60)

    verifier, challenge = _pkce()
    state = secrets.token_urlsafe(16)

    params = {
        "skip_link":             "false",
        "client_id":             CLIENT_ID,
        "response_type":         "code",
        "scope":                 SCOPE,
        "audience":              AUDIENCE,
        "redirect_uri":          REDIRECT_URI,
        "code_challenge":        challenge,
        "code_challenge_method": "S256",
        "state":                 state,
        "external_provider_name": PROVIDER,
        "tenancy":               "pioneer-live",
    }
    auth_url = f"{AUTH_URL}?{urlencode(params)}"

    print(f"\n[1] Auth URL hazır (embark-pioneer, port 49172)")
    print(f"    {auth_url[:120]}...")

    # Port dolu mu kontrol et
    try:
        server = _start_server()
        print(f"[2] Callback sunucusu başladı → {REDIRECT_URI}")
    except OSError as e:
        print(f"[HATA] Port 49172 meşgul: {e}")
        print("       Başka bir uygulama bu portu kullanıyor olabilir.")
        sys.exit(1)

    print(f"[3] Tarayıcı açılıyor... Xbox ile hızlıca giriş yap.")
    webbrowser.open(auth_url)

    print("    Callback bekleniyor (90s)...")
    got = _callback_event.wait(timeout=90)
    server.shutdown()

    if not got or _callback_result is None:
        print("\n[HATA] 90 saniyede callback gelmedi.")
        print("       → auth.embark.net 127.0.0.1:49172'ye redirect etmedi.")
        print("       → embark-pioneer bu redirect_uri'yi kabul etmiyor olabilir.")
        sys.exit(1)

    if "error" in _callback_result:
        print(f"\n[HATA] Callback error: {_callback_result['error']}")
        sys.exit(1)

    code = _callback_result["code"]
    print(f"\n[4] Callback geldi!")
    print(f"    code  : {code[:30]}...")
    print(f"    state : {_callback_result['state']}")

    # Token exchange — SECRET YOK
    print(f"\n[5] Token exchange deneniyor (client_secret YOK)...")
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(
            TOKEN_URL,
            data={
                "grant_type":    "authorization_code",
                "client_id":     CLIENT_ID,
                "code":          code,
                "code_verifier": verifier,
                "redirect_uri":  REDIRECT_URI,
            },
        )

    print(f"    Status: {r.status_code}")

    if r.status_code == 200:
        td = r.json()
        access_token = td.get("access_token", "")
        print(f"\n[BEKLENMEDIK BAŞARI] Token alındı!")
        print(f"    expires_in  : {td.get('expires_in')}s")
        print(f"    token_type  : {td.get('token_type')}")
        _decode_jwt(access_token)

        # Game API testi
        print(f"\n[6] Game API → /v1/shared/profile")
        async with httpx.AsyncClient(timeout=15) as client:
            ar = await client.get(
                f"{GAME_API}/v1/shared/profile",
                headers={**GAME_HEADERS, "Authorization": f"Bearer {access_token}"},
            )
        print(f"    Status: {ar.status_code}")
        if ar.status_code == 200:
            p = ar.json()
            dn = p.get("displayName", {})
            print(f"    Kullanıcı: {dn.get('name')}#{dn.get('discriminator')}")
            print("\n[SONUÇ] embark-pioneer PKCE (no secret) ÇALIŞIYOR!")
            print("         Direkt game API erişimi mümkün!")
        else:
            print(f"    {ar.text[:200]}")

    else:
        try:
            body = r.json()
        except Exception:
            body = {"raw": r.text[:300]}

        err  = body.get("error", "")
        desc = body.get("error_description", "")

        print(f"\n  Hata : {err}")
        print(f"  Açık : {desc}")

        if err == "invalid_client":
            print("\n[SONUÇ] embark-pioneer CONFIDENTIAL client.")
            print("         client_secret olmadan token exchange ÇALIŞMIYOR.")
            print("         Arctracker.io bu secret'a sahip (nasıl aldığı bilinmiyor).")
            print("         Direkt erişim için Embark ile iletişime geçmek gerekiyor.")
        elif err == "invalid_grant":
            print("\n[SONUÇ] Code geçersiz — tarayıcıda zaman aşımı olmuş olabilir.")
        else:
            print(f"\n[SONUÇ] Beklenmedik hata: {err}")


if __name__ == "__main__":
    asyncio.run(main())

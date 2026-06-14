"""
embark-pioneer client ile Steam provider testi.

Xbox yerine Steam kullanıyor. Steam OpenID herkese açık,
özel hesap gerekmez — sadece Steam hesabı yeter.

ARC Raiders lisansı olmasa da token exchange denenecek.
Sonuç Xbox ile aynı olabilir (401) ama Steam redirect
URL'i ve flow farklı bilgi verebilir.

Çalıştırma:
    cd api
    python3 scripts/test_embark_steam_flow.py
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

CLIENT_ID    = "embark-pioneer"
AUTH_URL     = "https://auth.embark.net/oauth2/authorize"
TOKEN_URL    = "https://auth.embark.net/oauth2/token"
SCOPE        = "pioneer openid offline"
AUDIENCE     = "https://pioneer.embark.net"
REDIRECT_URI = "http://127.0.0.1:49172"
PROVIDER     = "steam"          # Xbox yerine Steam

GAME_API     = "https://api-gateway.europe.es-pio.net"
GAME_HEADERS = {
    "User-Agent": "PioneerGame/pioneer_1.27.x-CL-1177678 (http-legacy) WinGDK/10.0.26200.1.256.64bit",
    "x-embark-manifest-id": "3444604227300176323",
    "x-embark-telemetry-client-platform": "12",
}

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
            _callback_result = {"error": error, "desc": params.get("error_description", [""])[0]}
        elif code:
            _callback_result = {"code": code, "state": state}
        else:
            _callback_result = {"error": "no_code", "raw": self.path}

        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(b"<h2>Tamam, bu sekmeyi kapatabilirsin.</h2>")
        _callback_event.set()

    def log_message(self, *_): pass


def _start_server():
    port = int(REDIRECT_URI.split(":")[-1])
    server = HTTPServer(("127.0.0.1", port), _Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def _pkce():
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
    print("  embark-pioneer + Steam Provider Testi")
    print("="*60)

    verifier, challenge = _pkce()
    state = secrets.token_urlsafe(16)

    params = {
        "skip_link":              "false",
        "client_id":              CLIENT_ID,
        "response_type":          "code",
        "scope":                  SCOPE,
        "audience":               AUDIENCE,
        "redirect_uri":           REDIRECT_URI,
        "code_challenge":         challenge,
        "code_challenge_method":  "S256",
        "state":                  state,
        "external_provider_name": PROVIDER,
        "tenancy":                "pioneer-live",
    }
    auth_url = f"{AUTH_URL}?{urlencode(params)}"
    print(f"\n[1] Auth URL (provider=steam)")
    print(f"    {auth_url[:120]}...")

    try:
        server = _start_server()
        print(f"[2] Callback sunucusu → {REDIRECT_URI}")
    except OSError as e:
        print(f"[HATA] Port 49172 meşgul: {e}")
        sys.exit(1)

    # auth.embark.net'in Steam'e nasıl redirect ettiğini görmek için
    # önce redirect URL'ini logla
    print(f"\n[3] auth.embark.net Steam redirect URL'i kontrol ediliyor...")
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(auth_url, follow_redirects=False)
        steam_url = r.headers.get("location", "")
        print(f"    Status : {r.status_code}")
        if steam_url:
            parsed = urlparse(steam_url)
            print(f"    Host   : {parsed.netloc}")
            print(f"    Path   : {parsed.path}")
            steam_params = parse_qs(parsed.query)
            for k, v in steam_params.items():
                print(f"    {k:30s} = {v[0][:80]}")
        else:
            print(f"    Redirect yok. Body: {r.text[:200]}")

    print(f"\n[4] Tarayıcı açılıyor... Steam ile giriş yap.")
    webbrowser.open(auth_url)
    print("    Callback bekleniyor (90s)...")

    got = _callback_event.wait(timeout=90)
    server.shutdown()

    if not got or _callback_result is None:
        print("\n[HATA] 90s'de callback gelmedi.")
        sys.exit(1)

    if "error" in _callback_result:
        err = _callback_result.get("error", "")
        desc = _callback_result.get("desc", "")
        print(f"\n[Callback Hatası] {err}: {desc}")
        if err == "access_denied":
            print("  → Steam hesabı bu Embark ID'ye bağlanamadı.")
            print("  → Başka bir Embark hesabına already_linked olabilir.")
        sys.exit(1)

    code = _callback_result["code"]
    print(f"\n[5] Callback geldi!")
    print(f"    code  : {code[:30]}...")
    print(f"    state : {_callback_result['state']}")

    # Token exchange — secret YOK
    print(f"\n[6] Token exchange (client_secret YOK)...")
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
        print(f"\n[BAŞARI] Token alındı! (Steam ile secret gerektirmedi!)")
        _decode_jwt(access_token)

        print(f"\n[7] Game API → /v1/shared/profile")
        async with httpx.AsyncClient(timeout=15) as c:
            ar = await c.get(
                f"{GAME_API}/v1/shared/profile",
                headers={**GAME_HEADERS, "Authorization": f"Bearer {access_token}"},
            )
        print(f"    Status: {ar.status_code}")
        if ar.status_code == 200:
            p = ar.json()
            dn = p.get("displayName", {})
            print(f"    Kullanıcı: {dn.get('name')}#{dn.get('discriminator')}")
            print("\n[SONUÇ] Steam flow ile direkt game API erişimi ÇALIŞIYOR!")
        else:
            print(f"    {ar.text[:200]}")
    else:
        try:
            body = r.json()
        except Exception:
            body = {"raw": r.text}
        err  = body.get("error", "")
        desc = body.get("error_description", "")
        print(f"  Hata : {err}")
        print(f"  Açık : {desc}")

        if err == "invalid_client":
            print("\n[SONUÇ] Steam provider da aynı: client_secret gerekiyor.")
            print("         Provider fark etmiyor, sorun embark-pioneer'in")
            print("         confidential olması. Embark'a başvurmak gerekiyor.")
        else:
            print(f"\n[SONUÇ] Beklenmedik hata: {err}")


if __name__ == "__main__":
    asyncio.run(main())

"""
Embark PKCE probe.

Tests whether an Embark public client can obtain a game access token and a
refresh_token without going through arctracker.io.

It intentionally does not print access_token, refresh_token, or authorization
code values.

Usage:
  python tools/embark_pkce_probe.py
  python tools/embark_pkce_probe.py --client embark-pioneer --port 49172
"""

import argparse
import asyncio
import base64
import hashlib
import json
import secrets
import sys
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlencode, urlparse

import httpx


AUTH_URL = "https://auth.embark.net/oauth2/authorize"
TOKEN_URL = "https://auth.embark.net/oauth2/token"
AUDIENCE = "https://pioneer.embark.net"
SCOPE = "pioneer openid offline"
PROVIDER = "xbox"
GAME_API = "https://api-gateway.europe.es-pio.net"
GAME_HEADERS = {
    "User-Agent": "PioneerGame/pioneer_1.27.x-CL-1177678 (http-legacy) WinGDK/10.0.26200.1.256.64bit",
    "x-embark-manifest-id": "3444604227300176323",
    "x-embark-telemetry-client-platform": "12",
}

_callback_result: dict | None = None
_callback_event = threading.Event()


class CallbackHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        global _callback_result
        params = parse_qs(urlparse(self.path).query)
        error = params.get("error", [""])[0]
        if error:
            _callback_result = {
                "error": error,
                "description": params.get("error_description", [""])[0],
            }
        else:
            _callback_result = {
                "code": params.get("code", [""])[0],
                "state": params.get("state", [""])[0],
            }

        ok = bool(_callback_result.get("code")) and not error
        body = (
            "<h2>Callback alindi. Bu sekmeyi kapatabilirsin.</h2>"
            if ok
            else "<h2>Callback hata ile dondu.</h2>"
        )
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(body.encode("utf-8"))
        _callback_event.set()

    def log_message(self, *_):
        pass


def pkce_pair() -> tuple[str, str]:
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode()
    digest = hashlib.sha256(verifier.encode()).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
    return verifier, challenge


def decode_jwt_payload(token: str) -> dict:
    try:
        payload = token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        return json.loads(base64.urlsafe_b64decode(payload.encode()))
    except Exception:
        return {}


def start_callback_server(port: int) -> HTTPServer:
    server = HTTPServer(("127.0.0.1", port), CallbackHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


async def token_exchange(client_id: str, code: str, verifier: str, redirect_uri: str) -> httpx.Response:
    async with httpx.AsyncClient(timeout=30) as client:
        return await client.post(
            TOKEN_URL,
            data={
                "grant_type": "authorization_code",
                "client_id": client_id,
                "code": code,
                "code_verifier": verifier,
                "redirect_uri": redirect_uri,
            },
        )


async def refresh_exchange(client_id: str, refresh_token: str) -> httpx.Response:
    async with httpx.AsyncClient(timeout=30) as client:
        return await client.post(
            TOKEN_URL,
            data={
                "grant_type": "refresh_token",
                "client_id": client_id,
                "refresh_token": refresh_token,
            },
        )


async def game_profile(access_token: str) -> tuple[int, str]:
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.get(
            f"{GAME_API}/v1/shared/profile",
            headers={**GAME_HEADERS, "Authorization": f"Bearer {access_token}"},
        )
    if resp.status_code != 200:
        return resp.status_code, resp.text[:300]
    data = resp.json()
    display = data.get("displayName", {})
    name = f"{display.get('name', '?')}#{display.get('discriminator', '?')}"
    account_id = data.get("accountId", "?")
    return resp.status_code, f"{name} accountId={account_id}"


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--client", default="embark-launcher")
    parser.add_argument("--port", type=int, default=49171)
    parser.add_argument("--timeout", type=int, default=180)
    args = parser.parse_args()

    redirect_uri = f"http://127.0.0.1:{args.port}"
    verifier, challenge = pkce_pair()
    state = secrets.token_urlsafe(16)

    params = {
        "client_id": args.client,
        "response_type": "code",
        "scope": SCOPE,
        "audience": AUDIENCE,
        "redirect_uri": redirect_uri,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "state": state,
        "external_provider_name": PROVIDER,
    }
    auth_url = f"{AUTH_URL}?{urlencode(params)}"

    server = start_callback_server(args.port)
    print(f"client={args.client}")
    print(f"redirect_uri={redirect_uri}")
    print("browser=opening")
    webbrowser.open(auth_url)

    got_callback = _callback_event.wait(timeout=args.timeout)
    server.shutdown()
    if not got_callback or not _callback_result:
        print("callback=timeout")
        sys.exit(1)
    if _callback_result.get("error"):
        print("callback=error")
        print(f"error={_callback_result.get('error')}")
        print(f"description={_callback_result.get('description', '')[:300]}")
        sys.exit(1)

    code = _callback_result.get("code", "")
    callback_state = _callback_result.get("state", "")
    print("callback=ok")
    print(f"state_match={callback_state == state}")
    if not code:
        print("code=missing")
        sys.exit(1)

    token_resp = await token_exchange(args.client, code, verifier, redirect_uri)
    print(f"token_exchange_status={token_resp.status_code}")
    if token_resp.status_code != 200:
        print(f"token_exchange_body={token_resp.text[:500]}")
        sys.exit(1)

    token_data = token_resp.json()
    access_token = token_data.get("access_token", "")
    refresh_token = token_data.get("refresh_token", "")
    payload = decode_jwt_payload(access_token)
    print(f"access_token_present={bool(access_token)}")
    print(f"refresh_token_present={bool(refresh_token)}")
    print(f"expires_in={token_data.get('expires_in')}")
    print(f"jwt_aud={payload.get('aud')}")
    print(f"jwt_client_id={payload.get('client_id')}")
    print(f"jwt_scope={payload.get('scope') or payload.get('scp')}")

    status, profile = await game_profile(access_token)
    print(f"game_profile_status={status}")
    print(f"game_profile={profile}")

    if refresh_token:
        time.sleep(1)
        refresh_resp = await refresh_exchange(args.client, refresh_token)
        print(f"refresh_exchange_status={refresh_resp.status_code}")
        if refresh_resp.status_code == 200:
            refreshed = refresh_resp.json()
            print(f"refresh_access_token_present={bool(refreshed.get('access_token'))}")
            print(f"refresh_refresh_token_present={bool(refreshed.get('refresh_token'))}")
        else:
            print(f"refresh_exchange_body={refresh_resp.text[:500]}")


if __name__ == "__main__":
    asyncio.run(main())

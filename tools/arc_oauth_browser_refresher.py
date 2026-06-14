#!/usr/bin/env python3
"""ARC Vault OAuth browser refresher.

Starts the existing arctracker-backed refresh flow, opens the browser, catches
the local OAuth callback, and forwards code/state to ARC Vault.

This does not print OAuth codes or tokens.
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any


DEFAULT_API_BASE = "https://arc-vault.kemalkondakci.me"
DEFAULT_CALLBACK_HOST = "127.0.0.1"
DEFAULT_CALLBACK_PORT = 49172


class ApiError(RuntimeError):
    pass


class CallbackState:
    code: str | None = None
    state: str | None = None
    error: str | None = None
    raw_path: str | None = None
    event = threading.Event()


def _json_request(
    method: str,
    api_base: str,
    path: str,
    token: str | None = None,
    body: dict[str, Any] | None = None,
) -> dict[str, Any] | list[Any]:
    data = None
    headers = {
        "Content-Type": "application/json",
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/125.0.0.0 Safari/537.36"
        ),
        "Accept": "application/json, text/plain, */*",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if body is not None:
        data = json.dumps(body).encode("utf-8")

    req = urllib.request.Request(
        api_base.rstrip("/") + path,
        data=data,
        headers=headers,
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            payload = resp.read().decode("utf-8")
            return json.loads(payload) if payload else {}
    except urllib.error.HTTPError as exc:
        text = exc.read().decode("utf-8", errors="replace")
        raise ApiError(f"API {exc.code}: {text[:500]}") from exc
    except urllib.error.URLError as exc:
        raise ApiError(f"API bağlantı hatası: {exc}") from exc


def login(api_base: str, username: str, password: str) -> str:
    data = _json_request(
        "POST",
        api_base,
        "/api/auth/login",
        body={"username": username, "password": password},
    )
    token = data.get("token") if isinstance(data, dict) else None
    if not token:
        raise ApiError("Login başarılı ama token dönmedi")
    return token


def find_account(accounts: list[dict[str, Any]], selector: str) -> dict[str, Any]:
    lowered = selector.lower()
    exact_fields = ("id", "arctracker_email")
    for account in accounts:
        if any(str(account.get(field, "")).lower() == lowered for field in exact_fields):
            return account

    matches = []
    for account in accounts:
        label = "#".join(
            part for part in (
                str(account.get("display_name") or ""),
                str(account.get("display_name_discriminator") or ""),
            )
            if part
        )
        haystack = " ".join(
            str(account.get(field) or "")
            for field in ("display_name", "arctracker_email", "embark_user_id", "embark_account_id")
        )
        if lowered in label.lower() or lowered in haystack.lower():
            matches.append(account)

    if len(matches) == 1:
        return matches[0]
    if not matches:
        raise ApiError(f"Hesap bulunamadı: {selector}")
    names = ", ".join(
        f"{a.get('display_name') or '?'}#{a.get('display_name_discriminator') or '?'}"
        for a in matches
    )
    raise ApiError(f"Hesap seçimi belirsiz: {names}")


def make_handler(callback: CallbackState):
    class CallbackHandler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            callback.raw_path = self.path
            parsed = urllib.parse.urlparse(self.path)
            params = urllib.parse.parse_qs(parsed.query)
            callback.code = (params.get("code") or [None])[0]
            callback.state = (params.get("state") or [None])[0]
            callback.error = (params.get("error") or [None])[0]
            callback.event.set()

            ok = callback.code and callback.state and not callback.error
            status = 200 if ok else 400
            title = "ARC Vault callback alindi" if ok else "ARC Vault callback hatasi"
            body = (
                "<html><body><h2>{}</h2>"
                "<p>Bu sekmeyi kapatabilirsiniz. Terminalde devam ediliyor.</p>"
                "</body></html>"
            ).format(title)
            self.send_response(status)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(body.encode("utf-8"))

        def log_message(self, fmt: str, *args: Any) -> None:
            return

    return CallbackHandler


def open_auth_url(url: str, browser_command: str | None) -> None:
    if browser_command:
        if "{url}" in browser_command:
            cmd = browser_command.format(url=url)
        else:
            cmd = f"{browser_command} {url}"
        subprocess.Popen(cmd, shell=True)
        return
    webbrowser.open(url, new=2)


def main() -> int:
    parser = argparse.ArgumentParser(description="ARC Vault OAuth browser refresh tester")
    parser.add_argument("--api-base", default=os.getenv("ARC_VAULT_API_BASE", DEFAULT_API_BASE))
    parser.add_argument("--token", default=os.getenv("ARC_VAULT_TOKEN"))
    parser.add_argument("--username", default=os.getenv("ARC_VAULT_USERNAME", "admin"))
    parser.add_argument("--password", default=os.getenv("ARC_VAULT_PASSWORD"))
    parser.add_argument("--account", default="Stasher", help="id, arctracker email, display name, or partial match")
    parser.add_argument("--callback-host", default=DEFAULT_CALLBACK_HOST)
    parser.add_argument("--callback-port", type=int, default=DEFAULT_CALLBACK_PORT)
    parser.add_argument("--timeout", type=int, default=300)
    parser.add_argument(
        "--browser-command",
        help='Optional command used to open the auth URL. Use "{url}" as placeholder.',
    )
    args = parser.parse_args()

    try:
        token = args.token
        if not token:
            password = args.password or getpass.getpass(f"ARC Vault password for {args.username}: ")
            token = login(args.api_base, args.username, password)
        print("ARC Vault login: ok")

        accounts_data = _json_request("GET", args.api_base, "/api/accounts", token=token)
        if not isinstance(accounts_data, list):
            raise ApiError("Hesap listesi beklenen formatta değil")
        account = find_account(accounts_data, args.account)
        account_id = account["id"]
        account_name = account.get("display_name") or account.get("arctracker_email") or account_id
        discriminator = account.get("display_name_discriminator")
        if discriminator:
            account_name = f"{account_name}#{discriminator}"
        print(f"Account: {account_name}")

        callback = CallbackState()
        server = HTTPServer((args.callback_host, args.callback_port), make_handler(callback))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        print(f"Callback listener: http://{args.callback_host}:{args.callback_port}")

        try:
            start = _json_request(
                "POST",
                args.api_base,
                f"/api/accounts/{account_id}/refresh-token/start?manual=true",
                token=token,
            )
            if not isinstance(start, dict):
                raise ApiError("Refresh start beklenen formatta değil")
            auth_url = start.get("auth_url")
            if not auth_url:
                raise ApiError(f"Refresh start auth_url döndürmedi: {start}")
            print(
                "Refresh start: ok "
                f"expired={start.get('is_token_expired')} "
                f"current={start.get('current_token_expires')}"
            )
            print("Browser: opening auth URL")
            open_auth_url(auth_url, args.browser_command)

            deadline = time.time() + args.timeout
            while time.time() < deadline:
                if callback.event.wait(timeout=0.5):
                    break
            if not callback.event.is_set():
                raise ApiError(f"Callback {args.timeout}s içinde gelmedi")
            if callback.error:
                raise ApiError(f"OAuth callback error={callback.error}")
            if not callback.code or not callback.state:
                raise ApiError("Callback geldi ama code/state eksik")
            print("Callback: ok")

            result = _json_request(
                "POST",
                args.api_base,
                "/api/refresh-token/callback",
                token=token,
                body={"code": callback.code, "state": callback.state},
            )
            print(f"API callback: {result.get('status') if isinstance(result, dict) else 'ok'}")

            complete = _json_request(
                "POST",
                args.api_base,
                f"/api/accounts/{account_id}/refresh-token/complete",
                token=token,
            )
            if isinstance(complete, dict):
                print(
                    "Complete: "
                    f"status={complete.get('status')} "
                    f"old={complete.get('old_expires')} "
                    f"new={complete.get('new_expires')}"
                )
            else:
                print("Complete: ok")
        finally:
            server.shutdown()
            server.server_close()
    except KeyboardInterrupt:
        print("\nIptal edildi")
        return 130
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

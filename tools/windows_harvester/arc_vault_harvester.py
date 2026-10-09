#!/usr/bin/env python
"""ARC Vault Windows tray harvester (Steam mint model).

Background tray app. Watches which Steam account is currently signed in and, when
it changes, mints a fresh Embark access token for that account directly from the
running Steam client (Steamworks web-api ticket -> Embark client_credentials) and
pushes it to ARC Vault. The game no longer writes the token to Credential Manager
(Frozen Trail update), so this replaces the old Credential Manager reader.

Design:
- The tray process (default / --tray) only watches the signed-in Steam account.
- On change (and when the game is not running) it spawns a short-lived child
  (`mint` subcommand) that does one Steamworks init + ticket + Embark exchange +
  push, then exits. Isolating Steamworks per mint avoids pipe stalls and conflicts
  with the running game.

Verbose logging throughout so breakage is easy to diagnose later.
"""

from __future__ import annotations

import argparse
import base64
import binascii
import ctypes
import hashlib
import hmac
import json
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from datetime import datetime
from typing import Any
from urllib.parse import urlencode
import winreg

import requests
import win32cred
import win32crypt

try:
    import pystray
    from PIL import Image, ImageDraw
    TRAY_IMPORT_ERROR = None
except Exception:
    pystray = None
    Image = None
    ImageDraw = None
    TRAY_IMPORT_ERROR = sys.exc_info()[1]


APP_NAME = "ARC Vault Harvester"
APP_ID = "ArcVaultHarvester"
CURRENT_VERSION = "3.0.2"
DEFAULT_API_URL = "https://arc-vault.kemalkondakci.me/api/accounts/token-push"
DEFAULT_UPDATE_CHECK_URL = "https://arc-vault.kemalkondakci.me/api/harvester/version"
DEFAULT_POLL_INTERVAL = 5           # seconds between signed-in-account checks
UPDATE_CHECK_INTERVAL = 6 * 3600
REMINT_AFTER = 20 * 3600            # re-mint same account after ~20h (token ~24h)
CONFIG_VERSION = 2
SECRET_TARGET = "ARC Vault Harvester/API Key"
AUTOSTART_REG_PATH = r"Software\Microsoft\Windows\CurrentVersion\Run"
AUTOSTART_VALUE = "ARC Vault Harvester"

# ── Embark / Steam constants (see memory: arcraiders-token-frozen-trail) ──
STEAM_APP_ID = 1808500
GAME_PROCESS = "PioneerGame.exe"
STEAM_IDENTITY = "embark-auth"
EMBARK_TOKEN_URL = "https://auth.embark.net/oauth2/token?skip_link=false"
EMBARK_CLIENT_ID = "embark-pioneer"
EMBARK_CLIENT_SECRET = "+GoAQg2vzgcohjnW0PKtfiMjLfvSTfcjsyJ8YqH3DuE="
EMBARK_AUDIENCE = "https://pioneer.embark.net"
EMBARK_TENANCY = "pioneer-live"
EMBARK_HMAC_KEY = base64.b64decode(
    "NKmGq9MAuwIfhwN2C+NYQsqnsCoVKtO1dUV4NGnyM20jx9n18MBWnbLWiRJ0v7lmKu5bTRnPSDr0rPeeBq0bbA=="
)
EMBARK_UA = "EmbarkGameBoot/1.0 (Windows; 10.0.19045.1.0.64bit)"
STEAMID64_BASE = 76561197960265728
K_GET_TICKET_FOR_WEBAPI = 100 + 68  # GetTicketForWebApiResponse_t
# Hide console windows for child processes (tasklist/curl/mint) so no cmd flashes.
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)


def app_dir() -> Path:
    base = os.getenv("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
    path = Path(base) / "ARC Vault Harvester"
    path.mkdir(parents=True, exist_ok=True)
    return path


CONFIG_PATH = app_dir() / "config.json"
STATE_PATH = app_dir() / "state.json"
LOG_PATH = app_dir() / "harvester.log"
SECRET_PATH = app_dir() / "api_key.dpapi"


def resource_path(name: str) -> Path:
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
    return base / name


def setup_logging() -> logging.Logger:
    logger = logging.getLogger("arc_vault_harvester")
    logger.setLevel(logging.INFO)
    logger.handlers.clear()
    formatter = logging.Formatter(
        "%(asctime)s [%(levelname)s] [%(role)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    class _RoleFilter(logging.Filter):
        def filter(self, record):
            if not hasattr(record, "role"):
                record.role = ROLE
            return True

    file_handler = RotatingFileHandler(LOG_PATH, maxBytes=2_000_000, backupCount=5, encoding="utf-8")
    file_handler.setFormatter(formatter)
    file_handler.addFilter(_RoleFilter())
    logger.addHandler(file_handler)
    if sys.stdout and sys.stdout.isatty():
        sh = logging.StreamHandler(sys.stdout)
        sh.setFormatter(formatter)
        sh.addFilter(_RoleFilter())
        logger.addHandler(sh)
    return logger


ROLE = "main"
log = setup_logging()


def message_box(title: str, text: str, flags: int = 0x40) -> None:
    try:
        ctypes.windll.user32.MessageBoxW(None, text, title, flags)
    except Exception:
        print(f"{title}: {text}")


# ───────────────────────── config / api key ─────────────────────────

def load_json(path: Path, fallback: dict[str, Any]) -> dict[str, Any]:
    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            return data
    except Exception:
        pass
    return dict(fallback)


def save_json(path: Path, data: dict[str, Any]) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    tmp.replace(path)


def default_config() -> dict[str, Any]:
    return {
        "version": CONFIG_VERSION,
        "api_url": DEFAULT_API_URL,
        "update_check_url": DEFAULT_UPDATE_CHECK_URL,
        "poll_interval": DEFAULT_POLL_INTERVAL,
    }


def load_config() -> dict[str, Any]:
    cfg = load_json(CONFIG_PATH, default_config())
    changed = False
    for key, value in default_config().items():
        if key not in cfg:
            cfg[key] = value
            changed = True
    if changed:
        save_json(CONFIG_PATH, cfg)
    return cfg


def normalize_secret_text(value: Any) -> str:
    if isinstance(value, bytes):
        raw = value
        text = raw.decode("utf-16-le", errors="ignore") if b"\x00" in raw else raw.decode("utf-8", errors="ignore")
    else:
        text = str(value)
    return text.replace("\x00", "").strip()


def write_api_key(api_key: str) -> None:
    api_key = normalize_secret_text(api_key)
    last_error: Exception | None = None
    try:
        win32cred.CredWrite(
            {
                "Type": win32cred.CRED_TYPE_GENERIC,
                "TargetName": SECRET_TARGET,
                "CredentialBlob": api_key,
                "Persist": win32cred.CRED_PERSIST_LOCAL_MACHINE,
                "UserName": APP_ID,
            },
            0,
        )
    except Exception as exc:
        last_error = exc
    try:
        encrypted = win32crypt.CryptProtectData(api_key.encode("utf-8"), APP_ID, None, None, None, 0)
        SECRET_PATH.write_bytes(encrypted)
    except Exception as exc:
        if last_error:
            raise RuntimeError(f"API key saklanamadi. CredMan: {last_error}; DPAPI: {exc}") from exc
        raise


def read_api_key() -> str:
    try:
        cred = win32cred.CredRead(SECRET_TARGET, win32cred.CRED_TYPE_GENERIC)
        key = normalize_secret_text(cred.get("CredentialBlob", b""))
        if key:
            return key
    except Exception:
        pass
    try:
        encrypted = SECRET_PATH.read_bytes()
        return normalize_secret_text(win32crypt.CryptUnprotectData(encrypted, None, None, None, 0)[1])
    except Exception:
        return ""


def prompt_api_key(current_key: str = "") -> str | None:
    import threading
    import tkinter as tk
    from tkinter import messagebox

    result: dict[str, str | None] = {"value": None}
    done = threading.Event()

    def _show() -> None:
        root = tk.Tk()
        root.title(f"{APP_NAME} Kurulum")
        root.resizable(False, False)
        root.geometry("460x200")
        root.attributes("-topmost", True)
        root.lift()
        root.focus_force()
        frame = tk.Frame(root, padx=18, pady=16)
        frame.pack(fill="both", expand=True)
        tk.Label(frame, text="ARC Vault Internal API Key", font=("Segoe UI", 11, "bold"), anchor="w").pack(fill="x")
        value = tk.StringVar(value=current_key)
        entry = tk.Entry(frame, textvariable=value, show="*", width=56)
        entry.pack(fill="x", pady=(10, 6))
        entry.focus_set()
        show_var = tk.BooleanVar(value=False)
        tk.Checkbutton(frame, text="Key'i goster", variable=show_var,
                       command=lambda: entry.config(show="" if show_var.get() else "*"),
                       font=("Segoe UI", 9)).pack(anchor="w")
        buttons = tk.Frame(frame)
        buttons.pack(fill="x", pady=(14, 0))

        def save() -> None:
            key = normalize_secret_text(value.get())
            if not key:
                messagebox.showerror(APP_NAME, "API key bos olamaz.", parent=root)
                return
            result["value"] = key
            root.destroy()

        def cancel() -> None:
            result["value"] = None
            root.destroy()

        tk.Button(buttons, text="Kaydet", command=save, width=12).pack(side="right")
        tk.Button(buttons, text="Iptal", command=cancel, width=10).pack(side="right", padx=(0, 8))
        root.bind("<Return>", lambda _e: save())
        root.protocol("WM_DELETE_WINDOW", cancel)
        root.mainloop()
        done.set()

    t = threading.Thread(target=_show, name="tk-api-key-dialog", daemon=True)
    t.start()
    done.wait()
    return result["value"]


# ───────────────────────── Steam / Embark mint ─────────────────────────

class _CallbackMsg(ctypes.Structure):
    _fields_ = [
        ("m_hSteamUser", ctypes.c_int),
        ("m_iCallback", ctypes.c_int),
        ("m_pubParam", ctypes.POINTER(ctypes.c_ubyte)),
        ("m_cubParam", ctypes.c_int),
    ]


def resolve_steam_dll() -> Path | None:
    """Find steam_api64.dll: bundled next to the exe first, else env override,
    else the installed game copy."""
    candidates = [resource_path("steam_api64.dll")]
    env = os.getenv("ARC_STEAM_DLL")
    if env:
        candidates.append(Path(env))
    for base in (
        r"C:\Program Files (x86)\Steam\steamapps\common\Arc Raiders\steam_api64.dll",
        r"D:\SteamLibrary\steamapps\common\Arc Raiders\steam_api64.dll",
        r"E:\SteamLibrary\steamapps\common\Arc Raiders\steam_api64.dll",
    ):
        candidates.append(Path(base))
    for c in candidates:
        try:
            if c and c.exists():
                return c
        except Exception:
            continue
    return None


class SteamMinter:
    """Thin ctypes wrapper over steam_api64.dll (flat API)."""

    def __init__(self) -> None:
        dll = resolve_steam_dll()
        if not dll:
            raise RuntimeError("steam_api64.dll bulunamadi (bundle/oyun kurulumu yok)")
        os.environ["SteamAppId"] = str(STEAM_APP_ID)
        os.environ["SteamGameId"] = str(STEAM_APP_ID)
        try:
            (Path.cwd() / "steam_appid.txt").write_text(str(STEAM_APP_ID))
        except Exception:
            pass
        self.dll_path = str(dll)
        self.s = ctypes.WinDLL(self.dll_path)
        err = ctypes.create_string_buffer(1024)
        self.s.SteamAPI_InitFlat.restype = ctypes.c_int
        self.s.SteamAPI_InitFlat.argtypes = [ctypes.c_char_p]
        rc = self.s.SteamAPI_InitFlat(err)
        if rc != 0:
            raise RuntimeError(f"SteamAPI_InitFlat rc={rc}: {err.value.decode('utf-8', 'ignore')}")
        self.s.SteamAPI_ManualDispatch_Init()
        self.s.SteamAPI_GetHSteamPipe.restype = ctypes.c_int
        self.pipe = self.s.SteamAPI_GetHSteamPipe()
        self.s.SteamAPI_SteamUser_v023.restype = ctypes.c_void_p
        self.user = self.s.SteamAPI_SteamUser_v023()
        self.s.SteamAPI_ISteamUser_GetAuthTicketForWebApi.restype = ctypes.c_uint
        self.s.SteamAPI_ISteamUser_GetAuthTicketForWebApi.argtypes = [ctypes.c_void_p, ctypes.c_char_p]
        self.s.SteamAPI_ManualDispatch_RunFrame.argtypes = [ctypes.c_int]
        self.s.SteamAPI_ManualDispatch_GetNextCallback.argtypes = [ctypes.c_int, ctypes.POINTER(_CallbackMsg)]
        self.s.SteamAPI_ManualDispatch_GetNextCallback.restype = ctypes.c_bool
        self.s.SteamAPI_ManualDispatch_FreeLastCallback.argtypes = [ctypes.c_int]

    def steamid(self) -> int:
        try:
            self.s.SteamAPI_ISteamUser_GetSteamID.restype = ctypes.c_uint64
            self.s.SteamAPI_ISteamUser_GetSteamID.argtypes = [ctypes.c_void_p]
            return int(self.s.SteamAPI_ISteamUser_GetSteamID(self.user))
        except Exception:
            return 0

    def persona(self) -> str:
        try:
            self.s.SteamAPI_SteamFriends_v017.restype = ctypes.c_void_p
            f = self.s.SteamAPI_SteamFriends_v017()
            self.s.SteamAPI_ISteamFriends_GetPersonaName.restype = ctypes.c_char_p
            self.s.SteamAPI_ISteamFriends_GetPersonaName.argtypes = [ctypes.c_void_p]
            return self.s.SteamAPI_ISteamFriends_GetPersonaName(f).decode("utf-8", "ignore")
        except Exception:
            return "player"

    def ticket(self, identity: str = STEAM_IDENTITY, timeout: float = 12.0) -> str:
        h = self.s.SteamAPI_ISteamUser_GetAuthTicketForWebApi(self.user, identity.encode())
        if h == 0:
            raise RuntimeError("gecersiz ticket handle (k_HAuthTicketInvalid)")
        msg = _CallbackMsg()
        deadline = time.time() + timeout
        while time.time() < deadline:
            self.s.SteamAPI_ManualDispatch_RunFrame(self.pipe)
            while self.s.SteamAPI_ManualDispatch_GetNextCallback(self.pipe, ctypes.byref(msg)):
                if msg.m_iCallback == K_GET_TICKET_FOR_WEBAPI:
                    raw = bytes(ctypes.cast(msg.m_pubParam, ctypes.POINTER(ctypes.c_ubyte * msg.m_cubParam)).contents)
                    eresult = int.from_bytes(raw[4:8], "little")
                    cub = int.from_bytes(raw[8:12], "little")
                    data = raw[12:12 + cub]
                    self.s.SteamAPI_ManualDispatch_FreeLastCallback(self.pipe)
                    if eresult != 1:
                        raise RuntimeError(f"ticket eResult={eresult} (OK degil)")
                    return binascii.hexlify(data).decode()
                self.s.SteamAPI_ManualDispatch_FreeLastCallback(self.pipe)
            time.sleep(0.1)
        raise RuntimeError("ticket callback zaman asimi")


def _jwt_payload(token: str) -> dict[str, Any]:
    try:
        p = token.split(".")[1]
        p += "=" * (-len(p) % 4)
        return json.loads(base64.urlsafe_b64decode(p))
    except Exception:
        return {}


def mint_embark_token() -> dict[str, Any]:
    """Mint a fresh Embark access token for the currently signed-in Steam account.
    Returns {access_token, persona, steamid, sub, exp}."""
    minter = SteamMinter()
    persona = minter.persona()
    steamid = minter.steamid()
    log.info("Steam init ok | dll=%s steamid=%s persona=%s", minter.dll_path, steamid, persona)
    ticket = minter.ticket()
    log.info("Steam WebAPI ticket alindi | hex_len=%d", len(ticket))
    body = urlencode([
        ("grant_type", "client_credentials"),
        ("client_id", EMBARK_CLIENT_ID),
        ("client_secret", EMBARK_CLIENT_SECRET),
        ("audience", EMBARK_AUDIENCE),
        ("external_provider_name", "steam"),
        ("external_provider_token", ticket),
        ("nick_name", persona),
        ("tenancy", EMBARK_TENANCY),
        ("app_id", str(STEAM_APP_ID)),
    ])
    mac = base64.b64encode(hmac.new(EMBARK_HMAC_KEY, body.encode(), hashlib.sha256).digest()).decode()
    log.info("Embark token istegi gonderiliyor | %s", EMBARK_TOKEN_URL)
    resp = requests.post(
        EMBARK_TOKEN_URL,
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded", "User-Agent": EMBARK_UA, "x-embark-hmac": mac},
        timeout=30,
    )
    log.info("Embark token yaniti | HTTP %s", resp.status_code)
    if resp.status_code != 200:
        raise RuntimeError(f"Embark token HTTP {resp.status_code}: {resp.text[:200]}")
    access_token = resp.json().get("access_token", "")
    if not access_token:
        raise RuntimeError("Embark yanitinda access_token yok")
    payload = _jwt_payload(access_token)
    sub = str(payload.get("sub", "?"))
    exp = payload.get("exp")
    log.info("Embark token alindi | sub=...%s exp=%s", sub[-8:], exp)
    return {"access_token": access_token, "persona": persona, "steamid": steamid, "sub": sub, "exp": exp}


# ───────────────────────── push to ARC Vault ─────────────────────────

def push_token(api_url: str, api_key: str, embark_jwt: str) -> tuple[bool, str]:
    last = ""
    for attempt in range(5):  # path to ARC Vault can be flaky (ISP/CF on 443)
        try:
            resp = requests.post(
                api_url,
                headers={"X-Api-Key": api_key, "Content-Type": "application/json"},
                json={"embark_jwt": embark_jwt},
                timeout=30,
            )
        except (requests.exceptions.SSLError, requests.exceptions.ConnectionError) as exc:
            last = f"ag hatasi (deneme {attempt + 1}/5): {type(exc).__name__}"
            log.warning("push ag hatasi: %s", str(exc)[:120])
            time.sleep(0.4)
            continue
        except Exception as exc:
            return False, f"gonderim hatasi: {exc}"

        if resp.status_code == 200:
            try:
                data = resp.json()
            except Exception:
                data = {}
            name = f"{data.get('displayName', '?')}#{data.get('discriminator', '?')}"
            if data.get("skipped") == "already_current":
                return True, f"atlandi: {name} zaten guncel"
            return True, f"gonderildi: {name} (sync={data.get('syncEnabled')})"
        if resp.status_code == 400 and "cloudflare" in resp.text.lower():
            ok, msg = push_token_with_curl(api_url, api_key, embark_jwt)
            if ok:
                return True, msg
            last = f"HTTP 400 cloudflare; curl: {msg}"
            continue
        low = resp.text.lower()
        if resp.status_code == 404 and ("hesap bulunamad" in low or "pending" in low or "admin" in low):
            return True, "eslesme bekliyor: admin panelindeki Token Eslestirme listesine kaydedildi"
        last = f"HTTP {resp.status_code}: {resp.text[:160]}"
        if resp.status_code < 500:
            break
    return False, last or "bilinmeyen push hatasi"


def push_token_with_curl(api_url: str, api_key: str, embark_jwt: str) -> tuple[bool, str]:
    import shutil
    curl = shutil.which("curl.exe") or shutil.which("curl")
    if not curl:
        return False, "curl bulunamadi"
    body = json.dumps({"embark_jwt": embark_jwt}, separators=(",", ":"))
    try:
        proc = subprocess.run(
            [curl, "--silent", "--show-error", "--location", "--max-time", "30", "--request", "POST",
             "--header", f"X-Api-Key: {api_key}", "--header", "Content-Type: application/json",
             "--data-binary", "@-", api_url],
            input=body, text=True, capture_output=True, check=False, creationflags=NO_WINDOW,
        )
    except Exception as exc:
        return False, f"curl calistirilamadi: {exc}"
    out = proc.stdout or proc.stderr
    if proc.returncode != 0:
        return False, f"curl exit={proc.returncode}: {out[:160]}"
    try:
        data = json.loads(out)
    except Exception:
        return False, f"curl parse hata: {out[:160]}"
    if data.get("displayName") or data.get("success"):
        name = f"{data.get('displayName', '?')}#{data.get('discriminator', '?')}"
        return True, f"gonderildi (curl): {name} (sync={data.get('syncEnabled')})"
    return False, f"curl API hata: {str(data.get('detail') or data)[:160]}"


# ───────────────────────── signed-in account detection ─────────────────────────

def active_steam_accountid() -> int:
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Valve\Steam\ActiveProcess") as k:
            v, _ = winreg.QueryValueEx(k, "ActiveUser")
            return int(v)
    except Exception:
        return 0


def game_running() -> bool:
    try:
        out = subprocess.run(["tasklist", "/FI", f"IMAGENAME eq {GAME_PROCESS}"],
                             capture_output=True, text=True, creationflags=NO_WINDOW).stdout
        return GAME_PROCESS.lower() in (out or "").lower()
    except Exception:
        return False


# ───────────────────────── mint subcommand (child) ─────────────────────────

def run_mint() -> int:
    """One-shot: mint for the currently signed-in Steam account and push."""
    global ROLE
    ROLE = "mint"
    cfg = load_config()
    api_key = read_api_key()
    if not api_key:
        log.error("API key yok (CredMan). Once configure calistirin.")
        return 2
    acct = active_steam_accountid()
    log.info("mint basliyor | steam accountid=%s steamid64=%s", acct, (acct + STEAMID64_BASE) if acct else 0)
    try:
        result = mint_embark_token()
    except Exception as exc:
        log.error("mint basarisiz: %s", exc)
        return 3
    ok, msg = push_token(cfg["api_url"], api_key, result["access_token"])
    if ok:
        log.info("PUSH OK | persona=%s | %s", result["persona"], msg)
        return 0
    log.error("PUSH BASARISIZ | persona=%s | %s", result["persona"], msg)
    return 4


# ───────────────────────── autostart / icon ─────────────────────────

def _self_command(extra: str = "") -> str:
    exe = Path(sys.executable).resolve()
    if getattr(sys, "frozen", False):
        return f'"{exe}"{(" " + extra) if extra else ""}'
    script = Path(__file__).resolve()
    if exe.name.lower() == "python.exe":
        pw = exe.with_name("pythonw.exe")
        if pw.exists() and not extra.startswith("mint"):
            exe = pw
    return f'"{exe}" "{script}"{(" " + extra) if extra else ""}'


def spawn_mint() -> subprocess.CompletedProcess | None:
    """Spawn self in `mint` mode (isolated Steamworks init)."""
    exe = Path(sys.executable).resolve()
    if getattr(sys, "frozen", False):
        cmd = [str(exe), "mint"]
    else:
        cmd = [str(exe), "-I", str(Path(__file__).resolve()), "mint"]
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=90,
                              cwd=str(app_dir()), creationflags=NO_WINDOW)
    except subprocess.TimeoutExpired:
        log.error("mint cocuk sureci zaman asimi (90s)")
        return None


def set_autostart(enabled: bool) -> None:
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, AUTOSTART_REG_PATH, 0, winreg.KEY_SET_VALUE) as key:
        if enabled:
            winreg.SetValueEx(key, AUTOSTART_VALUE, 0, winreg.REG_SZ,
                              _self_command("" if getattr(sys, "frozen", False) else "--tray"))
        else:
            try:
                winreg.DeleteValue(key, AUTOSTART_VALUE)
            except OSError:
                pass


def is_autostart_enabled() -> bool:
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, AUTOSTART_REG_PATH, 0, winreg.KEY_READ) as key:
            value, _ = winreg.QueryValueEx(key, AUTOSTART_VALUE)
            return bool(value)
    except OSError:
        return False


def open_path(path: Path) -> None:
    try:
        os.startfile(str(path))  # type: ignore[attr-defined]
    except Exception as exc:
        message_box(APP_NAME, f"Acilamadi: {exc}", 0x10)


def make_icon_image(color: tuple[int, int, int] = (32, 156, 238)):
    if Image is None or ImageDraw is None:
        return None
    icon_path = resource_path("arc_vault.ico")
    if icon_path.exists():
        try:
            return Image.open(icon_path)
        except Exception:
            pass
    image = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((8, 8, 56, 56), radius=12, fill=color)
    draw.polygon((32, 16, 45, 48, 32, 40, 19, 48), fill=(255, 255, 255))
    return image


# ───────────────────────── tray / watcher app ─────────────────────────

class HarvesterApp:
    def __init__(self, no_tray: bool = False) -> None:
        self.cfg = load_config()
        self.api_key = read_api_key()
        self.no_tray = no_tray
        import threading
        self.stop_event = threading.Event()
        self.worker: threading.Thread | None = None
        self.icon = None
        self.status = "Baslatiliyor"
        self.last_account = "-"
        self.last_success = "-"
        self.last_error = ""
        self.last_update_check = 0.0
        self._update_thread = None
        self._last_acct = 0
        self._minted_at: dict[int, float] = {}   # accountid -> last SUCCESSFUL mint time
        self._last_attempt: dict[int, float] = {}  # accountid -> last attempt (backoff)
        self._retry_backoff = 60                   # seconds between retries on defer/fail

    def start(self) -> None:
        if not self.api_key:
            key = prompt_api_key()
            if not key:
                log.error("API key eksik, harvester baslatilmadi.")
                message_box(APP_NAME, "API key kaydedilmedi. Harvester baslatilmadi.", 0x10)
                return
            try:
                write_api_key(key)
                self.api_key = read_api_key()
                log.info("API key kaydedildi")
            except Exception as exc:
                log.error("API key kaydedilemedi: %s", exc)
                message_box(APP_NAME, f"API key kaydedilemedi:\n{exc}", 0x10)
                return
        import threading
        self.worker = threading.Thread(target=self.loop, name="watcher-loop", daemon=True)
        self.worker.start()
        if self.no_tray or pystray is None:
            if pystray is None and not self.no_tray:
                log.error("pystray yuklenemedi: %s", TRAY_IMPORT_ERROR)
            try:
                while not self.stop_event.wait(1):
                    pass
            except KeyboardInterrupt:
                self.stop()
            return
        self.icon = pystray.Icon(APP_NAME, make_icon_image(), APP_NAME, menu=self.make_menu())
        self.icon.run()

    def stop(self) -> None:
        self.stop_event.set()
        if self.icon:
            self.icon.stop()

    def make_menu(self):
        return pystray.Menu(
            pystray.MenuItem(lambda _: f"Surum: {CURRENT_VERSION}", None, enabled=False),
            pystray.MenuItem(lambda _: f"Durum: {self.status}", None, enabled=False),
            pystray.MenuItem(lambda _: f"Son hesap: {self.last_account}", None, enabled=False),
            pystray.MenuItem(lambda _: f"Son basari: {self.last_success}", None, enabled=False),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Simdi Guncelle (girisli hesap)", lambda _: self.mint_now()),
            pystray.MenuItem("Guncelleme Kontrol Et", self._trigger_update_check),
            pystray.MenuItem("API Key Guncelle", self.update_api_key),
            pystray.MenuItem("Log Dosyasini Ac", lambda _: open_path(LOG_PATH)),
            pystray.MenuItem("Ayar Klasorunu Ac", lambda _: open_path(app_dir())),
            pystray.MenuItem("Windows ile Baslat", self.toggle_autostart, checked=lambda _: is_autostart_enabled()),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Cikis", lambda _: self.stop()),
        )

    def toggle_autostart(self, _item=None) -> None:
        try:
            target = not is_autostart_enabled()
            set_autostart(target)
            self.status = "Windows baslangici acik" if target else "Windows baslangici kapali"
            if self.icon:
                self.icon.update_menu()
        except Exception as exc:
            log.error("Autostart ayarlanamadi: %s", exc)

    def update_api_key(self, _item=None) -> None:
        key = prompt_api_key()
        if not key:
            return
        try:
            write_api_key(key)
            self.api_key = read_api_key()
            self.status = "API key guncellendi"
            log.info("API key guncellendi")
        except Exception as exc:
            log.error("API key guncellenemedi: %s", exc)

    def mint_now(self) -> None:
        acct = active_steam_accountid()
        if not acct:
            log.warning("Simdi Guncelle: Steam girisli hesap yok")
            self.status = "Steam girisli hesap yok"
            return
        self._do_mint(acct, forced=True)

    def _do_mint(self, acct: int, forced: bool = False) -> None:
        self.status = f"Mint ediliyor (accountid={acct})"
        log.info("mint tetikleniyor | accountid=%s steamid64=%s oyun_acik=%s forced=%s",
                 acct, acct + STEAMID64_BASE, game_running(), forced)
        proc = spawn_mint()
        if proc is None:
            self.last_error = "mint timeout"
            self.status = "mint zaman asimi"
            return
        for line in (proc.stdout or "").splitlines():
            if line.strip():
                log.info("[mint-cocuk] %s", line.strip())
        if proc.returncode == 0:
            self._minted_at[acct] = time.time()
            self.last_account = str(acct)
            self.last_success = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            self.status = "Guncel"
        else:
            err = ((proc.stderr or "").strip().splitlines() or [""])[-1]
            self.last_error = f"mint rc={proc.returncode} {err[:120]}"
            self.status = f"mint hatasi (rc={proc.returncode})"
            log.error("mint cocuk sureci basarisiz | rc=%s stderr=%s", proc.returncode, err[:200])

    def loop(self) -> None:
        log.info("%s v%s basladi (Steam-mint modeli)", APP_NAME, CURRENT_VERSION)
        log.info("API: %s | poll=%ss", self.cfg["api_url"], self.cfg.get("poll_interval", DEFAULT_POLL_INTERVAL))
        self.status = "Izleniyor"
        interval = max(2, int(self.cfg.get("poll_interval", DEFAULT_POLL_INTERVAL)))
        self._trigger_update_check()
        while not self.stop_event.is_set():
            try:
                acct = active_steam_accountid()
                now = time.time()
                if not acct:
                    if self._last_acct != 0:
                        log.info("Steam girisli hesap yok (kapali ya da cikis)")
                    self.status = "Steam kapali/cikis"
                    self._last_acct = 0
                else:
                    changed = acct != self._last_acct
                    if changed:
                        log.info("girisli Steam hesabi degisti: accountid=%s", acct)
                        self.last_account = str(acct)
                        self._last_acct = acct
                    minted = self._minted_at.get(acct, 0)
                    aged = minted and (now - minted > REMINT_AFTER)
                    never = acct not in self._minted_at
                    backoff_ok = now - self._last_attempt.get(acct, 0) >= self._retry_backoff
                    # Mint when: account just changed, OR never minted this session,
                    # OR token aged. Retries (defer/fail) are throttled by backoff.
                    if (changed or never or aged) and (changed or backoff_ok):
                        if aged:
                            log.info("token yaslandi, yeniden mint | accountid=%s", acct)
                        self._last_attempt[acct] = now
                        self._do_mint(acct)
            except Exception:
                log.exception("watcher dongu hatasi")
            if time.time() - self.last_update_check >= UPDATE_CHECK_INTERVAL:
                self._trigger_update_check()
            self.stop_event.wait(interval)
        log.info("%s durdu", APP_NAME)

    def _trigger_update_check(self, _item=None) -> None:
        import threading
        if self._update_thread and self._update_thread.is_alive():
            return
        self._update_thread = threading.Thread(target=self._check_update, name="update-checker", daemon=True)
        self._update_thread.start()

    def _check_update(self) -> None:
        self.last_update_check = time.time()
        url = self.cfg.get("update_check_url", DEFAULT_UPDATE_CHECK_URL)
        try:
            resp = requests.get(url, timeout=15)
            resp.raise_for_status()
            data = resp.json()
        except Exception as exc:
            log.debug("Guncelleme kontrolu basarisiz: %s", exc)
            return
        latest = str(data.get("version", "")).strip()
        download_url = str(data.get("url", "")).strip()
        if not latest or not download_url:
            return

        def _p(v: str):
            try:
                return tuple(int(x) for x in v.split("."))
            except Exception:
                return (0,)

        if _p(latest) <= _p(CURRENT_VERSION):
            return
        log.info("Yeni surum mevcut: %s -> %s", CURRENT_VERSION, latest)
        self._download_and_apply(latest, download_url)

    def _download_and_apply(self, version: str, url: str) -> None:
        if not getattr(sys, "frozen", False):
            log.info("Script modunda otomatik guncelleme yok. Yeni surum: %s", version)
            return
        log.info("Indiriliyor: %s", url)
        try:
            resp = requests.get(url, timeout=120, stream=True)
            resp.raise_for_status()
            suffix = Path(url).suffix or ".exe"
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix, dir=app_dir()) as tmp:
                tmp_path = Path(tmp.name)
                for chunk in resp.iter_content(chunk_size=65536):
                    if chunk:
                        tmp.write(chunk)
        except Exception as exc:
            log.warning("Guncelleme indirilemedi: %s", exc)
            return
        try:
            with tmp_path.open("rb") as f:
                if f.read(2) != b"MZ":
                    raise ValueError("Gecersiz EXE (MZ header yok)")
        except Exception as exc:
            log.warning("Indirilen dosya gecersiz: %s", exc)
            try:
                tmp_path.unlink()
            except Exception:
                pass
            return
        log.info("Indirme tamam: %s", tmp_path)
        result = ctypes.windll.user32.MessageBoxW(
            None,
            f"ARC Vault Harvester {version} hazir.\n\nSimdi yuklensin mi?\n"
            "(Uygulama kapanip yeni surumle yeniden acilacak.)",
            f"{APP_NAME} - Guncelleme",
            0x24,  # MB_YESNO | MB_ICONQUESTION
        )
        if result != 6:  # IDYES
            log.info("Guncelleme ertelendi.")
            try:
                tmp_path.unlink()
            except Exception:
                pass
            return
        current_exe = Path(sys.executable).resolve()
        bat = app_dir() / "_arc_vault_updater.bat"
        bat.write_text(
            "@echo off\r\n"
            "ping 127.0.0.1 -n 4 > nul\r\n"
            f'move /y "{tmp_path}" "{current_exe}"\r\n'
            f'start "" "{current_exe}"\r\n'
            'del "%~f0"\r\n',
            encoding="ascii",
        )
        log.info("Guncelleme uygulaniyor: %s -> %s", CURRENT_VERSION, version)
        subprocess.Popen(
            ["cmd.exe", "/c", str(bat)],
            close_fds=True,
            creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP | NO_WINDOW,
        )
        self.stop()


# ───────────────────────── cli ─────────────────────────

def configure(args: argparse.Namespace) -> int:
    cfg = load_config()
    changed = False
    if args.api_url:
        cfg["api_url"] = args.api_url
        changed = True
    if args.poll_interval:
        cfg["poll_interval"] = max(2, args.poll_interval)
        changed = True
    if changed:
        save_json(CONFIG_PATH, cfg)
    api_key = args.api_key
    if args.prompt_api_key:
        api_key = prompt_api_key(read_api_key() if args.show_existing else "")
    if api_key:
        write_api_key(api_key)
        log.info("API key yazildi")
    if args.autostart is not None:
        set_autostart(args.autostart)
    msg = (
        "Kurulum tamamlandi.\n\n"
        f"Ayar klasoru: {app_dir()}\nLog: {LOG_PATH}\n"
        f"API key: {'var' if read_api_key() else 'yok'}\n"
        f"Steam DLL: {resolve_steam_dll() or 'BULUNAMADI'}\n"
        f"Windows ile baslat: {'acik' if is_autostart_enabled() else 'kapali'}"
    )
    print(msg)
    if getattr(sys, "frozen", False):
        message_box(APP_NAME, msg)
    return 0


def status() -> int:
    cfg = load_config()
    print(
        "ARC Vault Harvester durumu\n\n"
        f"Surum: {CURRENT_VERSION}\nConfig: {CONFIG_PATH}\nAPI URL: {cfg.get('api_url')}\n"
        f"API key: {'var' if read_api_key() else 'yok'}\n"
        f"Steam DLL: {resolve_steam_dll() or 'BULUNAMADI'}\n"
        f"Girisli Steam accountid: {active_steam_accountid()}\n"
        f"Oyun calisiyor: {game_running()}\n"
        f"Autostart: {'acik' if is_autostart_enabled() else 'kapali'}\nLog: {LOG_PATH}"
    )
    return 0


def acquire_single_instance() -> Any:
    mutex = ctypes.windll.kernel32.CreateMutexW(None, False, "Global\\ARC_Vault_Harvester")
    if ctypes.windll.kernel32.GetLastError() == 183:
        raise RuntimeError("ARC Vault Harvester zaten calisiyor.")
    return mutex


def main() -> int:
    parser = argparse.ArgumentParser(prog="arc_vault_harvester")
    sub = parser.add_subparsers(dest="command")
    cp = sub.add_parser("configure", help="Ayarlari yaz")
    cp.add_argument("--api-url")
    cp.add_argument("--api-key")
    cp.add_argument("--prompt-api-key", action="store_true")
    cp.add_argument("--show-existing", action="store_true")
    cp.add_argument("--poll-interval", type=int)
    cp.add_argument("--autostart", action=argparse.BooleanOptionalAction)
    sub.add_parser("status", help="Durumu goster")
    sub.add_parser("mint", help="Girisli Steam hesabi icin bir kez token mint edip push et")
    parser.add_argument("--tray", action="store_true")
    parser.add_argument("--no-tray", action="store_true")
    args = parser.parse_args()

    if args.command == "configure":
        return configure(args)
    if args.command == "status":
        return status()
    if args.command == "mint":
        return run_mint()

    try:
        acquire_single_instance()
    except RuntimeError as exc:
        log.warning("%s", exc)
        return 0
    HarvesterApp(no_tray=args.no_tray).start()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

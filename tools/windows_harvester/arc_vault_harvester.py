#!/usr/bin/env python
"""ARC Vault Windows tray harvester.

Runs in the background, watches Windows Credential Manager for Embark JWTs, and
pushes new tokens to ARC Vault. API secrets are stored in Windows Credential
Manager, not in a JSON config file.
"""

from __future__ import annotations

import argparse
import base64
import ctypes
import hashlib
import json
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import threading
import time
from datetime import datetime
from typing import Any
import tkinter as tk
from tkinter import messagebox

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
DEFAULT_API_URL = "https://arc-vault.kemalkondakci.me/api/accounts/token-push"
DEFAULT_POLL_INTERVAL = 30
CONFIG_VERSION = 1
SECRET_TARGET = "ARC Vault Harvester/API Key"
AUTOSTART_REG_PATH = r"Software\Microsoft\Windows\CurrentVersion\Run"
AUTOSTART_VALUE = "ARC Vault Harvester"

EMBARK_TARGETS = [
    "EmbarkID/embark-pioneer/",
    "EmbarkID/embark-pioneer/pioneer-live",
]

JWT_RE = re.compile(r"(eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+)")
LONG_NUMBER_RE = re.compile(r"\b\d{10,}\b")


def app_dir() -> Path:
    base = os.getenv("LOCALAPPDATA")
    if not base:
        base = str(Path.home() / "AppData" / "Local")
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
        "%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    file_handler = RotatingFileHandler(
        LOG_PATH,
        maxBytes=1_000_000,
        backupCount=3,
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)

    if sys.stdout and sys.stdout.isatty():
        stream_handler = logging.StreamHandler(sys.stdout)
        stream_handler.setFormatter(formatter)
        logger.addHandler(stream_handler)

    return logger


log = setup_logging()


def message_box(title: str, text: str, flags: int = 0x40) -> None:
    try:
        ctypes.windll.user32.MessageBoxW(None, text, title, flags)
    except Exception:
        print(f"{title}: {text}")


def prompt_api_key(current_key: str = "") -> str | None:
    result: dict[str, str | None] = {"value": None}
    root = tk.Tk()
    root.title(f"{APP_NAME} Kurulum")
    root.resizable(False, False)
    root.geometry("460x210")
    root.attributes("-topmost", True)

    frame = tk.Frame(root, padx=18, pady=16)
    frame.pack(fill="both", expand=True)

    tk.Label(
        frame,
        text="ARC Vault Internal API Key",
        font=("Segoe UI", 11, "bold"),
        anchor="w",
    ).pack(fill="x")
    tk.Label(
        frame,
        text=(
            "Harvester'ın tokenları sunucuya gönderebilmesi için API key gerekir. "
            "Key Windows Credential Manager ve DPAPI ile saklanır."
        ),
        font=("Segoe UI", 9),
        justify="left",
        wraplength=410,
        anchor="w",
    ).pack(fill="x", pady=(8, 10))

    value = tk.StringVar(value=current_key)
    entry = tk.Entry(frame, textvariable=value, show="*", width=56)
    entry.pack(fill="x")
    entry.focus_set()

    show_var = tk.BooleanVar(value=False)

    def toggle_show() -> None:
        entry.config(show="" if show_var.get() else "*")

    tk.Checkbutton(
        frame,
        text="Key'i göster",
        variable=show_var,
        command=toggle_show,
        font=("Segoe UI", 9),
    ).pack(anchor="w", pady=(6, 0))

    buttons = tk.Frame(frame)
    buttons.pack(fill="x", pady=(14, 0))

    def save() -> None:
        key = normalize_secret_text(value.get())
        if not key:
            messagebox.showerror(APP_NAME, "API key boş olamaz.", parent=root)
            return
        result["value"] = key
        root.destroy()

    def cancel() -> None:
        result["value"] = None
        root.destroy()

    tk.Button(buttons, text="Kaydet", command=save, width=12).pack(side="right")
    tk.Button(buttons, text="İptal", command=cancel, width=10).pack(side="right", padx=(0, 8))
    root.bind("<Return>", lambda _event: save())
    root.protocol("WM_DELETE_WINDOW", cancel)
    root.mainloop()
    return result["value"]


def has_console() -> bool:
    return bool(sys.stdout and not getattr(sys, "frozen", False) or sys.stdout and sys.stdout.isatty())


def emit(text: str, *, title: str = APP_NAME) -> None:
    if sys.stdout:
        try:
            print(text)
        except Exception:
            pass
    if getattr(sys, "frozen", False) and not has_console():
        message_box(title, text)


def write_console(text: str) -> None:
    if sys.stdout:
        try:
            print(text)
        except Exception:
            pass


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
        "poll_interval": DEFAULT_POLL_INTERVAL,
    }


def load_config() -> dict[str, Any]:
    cfg = load_json(CONFIG_PATH, default_config())
    changed = False
    defaults = default_config()
    for key, value in defaults.items():
        if key not in cfg:
            cfg[key] = value
            changed = True
    if changed:
        save_json(CONFIG_PATH, cfg)
    return cfg


def write_api_key(api_key: str) -> None:
    api_key = normalize_secret_text(api_key)
    last_error: Exception | None = None
    try:
        win32cred.CredWrite(
            {
                "Type": win32cred.CRED_TYPE_GENERIC,
                "TargetName": SECRET_TARGET,
                "CredentialBlob": api_key,
                "Persist": win32cred.CRED_PERSIST_ENTERPRISE,
                "UserName": APP_ID,
            },
            0,
        )
    except Exception as exc:
        last_error = exc

    try:
        encrypted = win32crypt.CryptProtectData(
            api_key.encode("utf-8"),
            APP_ID,
            None,
            None,
            None,
            0,
        )
        SECRET_PATH.write_bytes(encrypted)
    except Exception as exc:
        if last_error:
            raise RuntimeError(
                f"API key saklanamadı. Credential Manager: {last_error}; DPAPI: {exc}"
            ) from exc
        raise


def normalize_secret_text(value: Any) -> str:
    if isinstance(value, bytes):
        raw = value
        try:
            if b"\x00" in raw:
                text = raw.decode("utf-16-le", errors="ignore")
            else:
                text = raw.decode("utf-8", errors="ignore")
        except Exception:
            text = raw.decode("utf-8", errors="ignore")
    else:
        text = str(value)
    return text.replace("\x00", "").strip()


def read_api_key() -> str:
    try:
        cred = win32cred.CredRead(SECRET_TARGET, win32cred.CRED_TYPE_GENERIC)
        blob = cred.get("CredentialBlob", b"")
        key = normalize_secret_text(blob)
        if key:
            return key
    except Exception:
        pass

    try:
        encrypted = SECRET_PATH.read_bytes()
        decrypted = win32crypt.CryptUnprotectData(encrypted, None, None, None, 0)[1]
        return normalize_secret_text(decrypted)
    except Exception:
        return ""


def decode_payload(token: str) -> dict[str, Any]:
    try:
        payload = token.split(".")[1]
        payload += "=" * ((4 - len(payload) % 4) % 4)
        return json.loads(base64.urlsafe_b64decode(payload.encode("ascii")))
    except Exception:
        return {}


def payload_summary(payload: dict[str, Any]) -> str:
    ext = payload.get("ext") if isinstance(payload.get("ext"), dict) else {}
    fields = {
        "sub": mask_identifier(payload.get("sub")),
        "embark_user_id": mask_identifier(ext.get("embark_user_id")),
        "name": payload.get("name") or payload.get("preferred_username") or ext.get("name"),
        "provider": ext.get("provider"),
    }
    return " | ".join(f"{k}={v}" for k, v in fields.items() if v)


def mask_identifier(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value)
    if len(text) <= 8:
        return "..." + text
    return "..." + text[-8:]


def state_key_for_sub(sub: str) -> str:
    return hashlib.sha256(sub.encode("utf-8")).hexdigest()[:24]


def sanitize_text(text: str, limit: int = 240) -> str:
    text = JWT_RE.sub("[jwt-redacted]", text)
    text = LONG_NUMBER_RE.sub(lambda m: mask_identifier(m.group(0)) or "", text)
    return text[:limit]


def is_pending_match_response(status_code: int, text: str) -> bool:
    if status_code != 404:
        return False
    lowered = text.lower()
    return (
        "hesap bulunamad" in lowered
        or "pending token" in lowered
        or "admin panel" in lowered
    )


def read_embark_jwts() -> dict[str, dict[str, Any]]:
    results: dict[str, dict[str, Any]] = {}
    now = time.time()
    for target in EMBARK_TARGETS:
        try:
            cred = win32cred.CredRead(target, win32cred.CRED_TYPE_GENERIC)
            blob = cred.get("CredentialBlob", b"")
            text = blob.decode("utf-8", errors="ignore") if isinstance(blob, bytes) else str(blob)
            match = JWT_RE.search(text)
            if not match:
                continue
            jwt = match.group(1)
            payload = decode_payload(jwt)
            sub = payload.get("sub")
            exp = int(payload.get("exp", 0) or 0)
            if sub and exp > now:
                results[str(sub)] = {
                    "jwt": jwt,
                    "exp": exp,
                    "target": target,
                    "payload": payload,
                }
        except Exception:
            continue
    return results


def _inspect_credential(cred: dict[str, Any]) -> dict[str, Any]:
    target = str(cred.get("TargetName", ""))
    blob = cred.get("CredentialBlob", b"")
    text = blob.decode("utf-8", errors="ignore") if isinstance(blob, bytes) else str(blob or "")
    match = JWT_RE.search(text)
    payload = decode_payload(match.group(1)) if match else {}
    exp = int(payload.get("exp", 0) or 0)
    sub = str(payload.get("sub") or "")
    ext = payload.get("ext") if isinstance(payload.get("ext"), dict) else {}
    return {
        "target": target,
        "has_jwt": bool(match),
        "valid": bool(exp and exp > time.time()),
        "exp": datetime.fromtimestamp(exp).strftime("%Y-%m-%d %H:%M:%S") if exp else "-",
        "sub": mask_identifier(sub) if sub else "-",
        "embark_user_id": mask_identifier(ext.get("embark_user_id")) if ext.get("embark_user_id") else "-",
    }


def list_embark_credentials() -> tuple[list[dict[str, Any]], list[str]]:
    """List relevant Credential Manager entries without printing secrets."""
    rows: list[dict[str, Any]] = []
    notes: list[str] = []

    for target in EMBARK_TARGETS:
        try:
            cred = win32cred.CredRead(target, win32cred.CRED_TYPE_GENERIC)
            row = _inspect_credential(cred)
            row["target"] = target
            rows.append(row)
        except Exception as exc:
            notes.append(f"{target}: okunamadı/bulunamadı ({type(exc).__name__}: {exc})")

    try:
        credentials = win32cred.CredEnumerate(None, 0)
    except Exception as exc:
        credentials = []
        notes.append(f"CredEnumerate başarısız: {type(exc).__name__}: {exc}")

    seen = {row["target"] for row in rows}
    for cred in credentials or []:
        row = _inspect_credential(cred)
        target = row["target"]
        lower = target.lower()
        relevant_name = "embark" in lower or "arc" in lower or "pioneer" in lower
        if not relevant_name and not row["has_jwt"]:
            continue
        if target in seen:
            continue
        rows.append(row)
        seen.add(target)
    return sorted(rows, key=lambda row: row["target"].lower()), notes


def load_state() -> dict[str, Any]:
    state = load_json(STATE_PATH, {"last_sent": {}})
    if not isinstance(state.get("last_sent"), dict):
        state["last_sent"] = {}
    return state


def push_token(api_url: str, api_key: str, embark_jwt: str) -> tuple[bool, str]:
    try:
        resp = requests.post(
            api_url,
            headers={
                "X-Api-Key": api_key,
                "Content-Type": "application/json",
            },
            json={"embark_jwt": embark_jwt},
            timeout=30,
        )
    except requests.exceptions.ConnectionError:
        return False, f"API bağlantı hatası: {api_url}"
    except Exception as exc:
        return False, f"Gönderim hatası: {exc}"

    if resp.status_code == 200:
        try:
            data = resp.json()
        except Exception:
            data = {}
        if data.get("skipped") == "already_current":
            name = f"{data.get('displayName', '?')}#{data.get('discriminator', '?')}"
            return True, f"Atlandı: {name} zaten güncel"
        name = f"{data.get('displayName', '?')}#{data.get('discriminator', '?')}"
        return True, f"Gönderildi: {name} (sync={data.get('syncEnabled')})"

    if resp.status_code == 400 and "cloudflare" in resp.text.lower():
        curl_ok, curl_message = push_token_with_curl(api_url, api_key, embark_jwt)
        if curl_ok:
            return True, curl_message
        return False, f"API hata: HTTP 400 Cloudflare; curl fallback: {curl_message}"

    if is_pending_match_response(resp.status_code, resp.text):
        return True, "Eşleşme bekliyor: token admin panelindeki Token Eşleştirme listesine kaydedildi"

    return False, f"API hata: HTTP {resp.status_code} - {sanitize_text(resp.text)}"


def push_token_with_curl(api_url: str, api_key: str, embark_jwt: str) -> tuple[bool, str]:
    curl = shutil.which("curl.exe") or shutil.which("curl")
    if not curl:
        return False, "curl bulunamadı"

    body = json.dumps({"embark_jwt": embark_jwt}, separators=(",", ":"))
    try:
        proc = subprocess.run(
            [
                curl,
                "--silent",
                "--show-error",
                "--location",
                "--max-time",
                "30",
                "--request",
                "POST",
                "--header",
                f"X-Api-Key: {api_key}",
                "--header",
                "Content-Type: application/json",
                "--data-binary",
                "@-",
                api_url,
            ],
            input=body,
            text=True,
            capture_output=True,
            check=False,
        )
    except Exception as exc:
        return False, f"curl çalıştırılamadı: {exc}"

    output = proc.stdout or proc.stderr
    if proc.returncode != 0:
        return False, f"curl exit={proc.returncode}: {sanitize_text(output)}"

    try:
        data = json.loads(output)
    except Exception:
        return False, f"curl HTTP/parse hata: {sanitize_text(output)}"

    if data.get("displayName") or data.get("success"):
        if data.get("skipped") == "already_current":
            name = f"{data.get('displayName', '?')}#{data.get('discriminator', '?')}"
            return True, f"Atlandı: {name} zaten güncel"
        name = f"{data.get('displayName', '?')}#{data.get('discriminator', '?')}"
        return True, f"Gönderildi: {name} (sync={data.get('syncEnabled')})"

    detail = data.get("detail") or data
    if is_pending_match_response(404, str(detail)):
        return True, "Eşleşme bekliyor: token admin panelindeki Token Eşleştirme listesine kaydedildi"
    return False, f"curl API hata: {sanitize_text(str(detail))}"


def set_autostart(enabled: bool) -> None:
    import winreg

    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, AUTOSTART_REG_PATH, 0, winreg.KEY_SET_VALUE) as key:
        if enabled:
            exe = Path(sys.executable).resolve()
            script = Path(__file__).resolve()
            if exe.name.lower() == "python.exe":
                pythonw = exe.with_name("pythonw.exe")
                if pythonw.exists():
                    exe = pythonw
            if getattr(sys, "frozen", False):
                command = f'"{exe}"'
            else:
                command = f'"{exe}" "{script}" --tray'
            winreg.SetValueEx(key, AUTOSTART_VALUE, 0, winreg.REG_SZ, command)
        else:
            try:
                winreg.DeleteValue(key, AUTOSTART_VALUE)
            except OSError:
                pass


def is_autostart_enabled() -> bool:
    import winreg

    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, AUTOSTART_REG_PATH, 0, winreg.KEY_READ) as key:
            value, _kind = winreg.QueryValueEx(key, AUTOSTART_VALUE)
            return bool(value)
    except OSError:
        return False


def open_path(path: Path) -> None:
    try:
        os.startfile(str(path))  # type: ignore[attr-defined]
    except Exception as exc:
        message_box(APP_NAME, f"Açılamadı: {exc}", 0x10)


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


class HarvesterApp:
    def __init__(self, no_tray: bool = False) -> None:
        self.cfg = load_config()
        self.api_key = read_api_key()
        self.state = load_state()
        self.no_tray = no_tray
        self.stop_event = threading.Event()
        self.worker: threading.Thread | None = None
        self.icon = None
        self.status = "Başlatılıyor"
        self.last_scan = "-"
        self.last_success = "-"
        self.last_error = ""

    def start(self) -> None:
        if not self.api_key:
            key = prompt_api_key()
            if not key:
                self.status = "API key eksik"
                log.error("API key eksik.")
                message_box(APP_NAME, "API key kaydedilmedi. Harvester başlatılmadı.", 0x10)
                return
            try:
                write_api_key(key)
                self.api_key = read_api_key()
                log.info("API key kaydedildi")
            except Exception as exc:
                self.status = "API key kaydedilemedi"
                log.error("API key kaydedilemedi: %s", exc)
                message_box(APP_NAME, f"API key kaydedilemedi:\n{exc}", 0x10)
                return

        self.worker = threading.Thread(target=self.loop, name="harvester-loop", daemon=True)
        self.worker.start()

        if self.no_tray or pystray is None:
            if pystray is None and not self.no_tray:
                message = (
                    "System tray modülü yüklenemedi; uygulama görünmez arka plan "
                    "modunda çalışıyor.\n\n"
                    f"Hata: {TRAY_IMPORT_ERROR}\n\n"
                    "Debug için console sürümüyle çalıştırın:\n"
                    "ARC Vault Harvester CLI.exe --no-tray"
                )
                log.error(message)
                message_box(APP_NAME, message, 0x30)
            try:
                while not self.stop_event.wait(1):
                    pass
            except KeyboardInterrupt:
                self.stop()
            return

        self.icon = pystray.Icon(
            APP_NAME,
            make_icon_image(),
            APP_NAME,
            menu=self.make_menu(),
        )
        self.icon.run()

    def stop(self) -> None:
        self.stop_event.set()
        save_json(STATE_PATH, self.state)
        if self.icon:
            self.icon.stop()

    def make_menu(self):
        return pystray.Menu(
            pystray.MenuItem(lambda _: f"Durum: {self.status}", None, enabled=False),
            pystray.MenuItem(lambda _: f"Son tarama: {self.last_scan}", None, enabled=False),
            pystray.MenuItem(lambda _: f"Son başarı: {self.last_success}", None, enabled=False),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Şimdi Tara", self.scan_once),
            pystray.MenuItem("API Key Güncelle", self.update_api_key),
            pystray.MenuItem("Log Dosyasını Aç", lambda _: open_path(LOG_PATH)),
            pystray.MenuItem("Ayar Klasörünü Aç", lambda _: open_path(app_dir())),
            pystray.MenuItem(
                "Windows ile Başlat",
                self.toggle_autostart,
                checked=lambda _: is_autostart_enabled(),
            ),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Çıkış", lambda _: self.stop()),
        )

    def toggle_autostart(self, _item=None) -> None:
        try:
            target = not is_autostart_enabled()
            set_autostart(target)
            self.status = "Windows başlangıcı açık" if target else "Windows başlangıcı kapalı"
            if self.icon:
                self.icon.update_menu()
        except Exception as exc:
            self.last_error = str(exc)
            self.status = "Başlangıç ayarı hatası"
            log.error("Autostart ayarlanamadı: %s", exc)

    def update_api_key(self, _item=None) -> None:
        key = prompt_api_key()
        if not key:
            return
        try:
            write_api_key(key)
            self.api_key = read_api_key()
            self.status = "API key güncellendi"
            log.info("API key güncellendi")
        except Exception as exc:
            self.last_error = str(exc)
            self.status = "API key güncelleme hatası"
            log.error("API key güncellenemedi: %s", exc)
            message_box(APP_NAME, f"API key güncellenemedi:\n{exc}", 0x10)

    def loop(self) -> None:
        log.info("%s başladı", APP_NAME)
        log.info("API: %s", self.cfg["api_url"])
        self.status = "Çalışıyor"
        interval = max(5, int(self.cfg.get("poll_interval", DEFAULT_POLL_INTERVAL)))
        while not self.stop_event.is_set():
            self.scan_once()
            self.stop_event.wait(interval)
        log.info("%s durdu", APP_NAME)

    def scan_once(self, _item=None, force: bool = False) -> None:
        try:
            self.last_scan = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            jwts = read_embark_jwts()
            if not jwts:
                self.status = "Token bekleniyor"
                log.debug("Embark token bulunamadı")
                return

            last_sent = self.state.setdefault("last_sent", {})
            sent_any = False
            for sub, info in jwts.items():
                exp = int(info["exp"])
                state_key = state_key_for_sub(sub)
                if not force and last_sent.get(state_key) == exp:
                    continue

                exp_dt = datetime.fromtimestamp(exp).strftime("%Y-%m-%d %H:%M")
                log.info(
                    "Yeni token: sub=...%s exp=%s kaynak=%s %s",
                    sub[-8:],
                    exp_dt,
                    info["target"],
                    payload_summary(info.get("payload", {})),
                )

                ok, message = push_token(self.cfg["api_url"], self.api_key, info["jwt"])
                if ok:
                    last_sent[state_key] = exp
                    self.last_success = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    self.status = message
                    log.info(message)
                    sent_any = True
                else:
                    self.last_error = message
                    self.status = "Gönderim hatası"
                    log.warning(message)

            if sent_any:
                save_json(STATE_PATH, self.state)
            elif self.status == "Çalışıyor":
                self.status = "Yeni token yok"
        except Exception as exc:
            self.last_error = str(exc)
            self.status = "Döngü hatası"
            log.exception("Döngü hatası")


def configure(args: argparse.Namespace) -> int:
    cfg = load_config()
    changed = False

    if args.api_url:
        cfg["api_url"] = args.api_url
        changed = True
    if args.poll_interval:
        cfg["poll_interval"] = max(5, args.poll_interval)
        changed = True
    if changed:
        save_json(CONFIG_PATH, cfg)
        write_console(f"Config yazıldı: {CONFIG_PATH}")

    api_key = args.api_key
    if args.prompt_api_key:
        api_key = prompt_api_key(read_api_key() if args.show_existing else "")

    if api_key:
        write_api_key(api_key)
        write_console("API key Windows Credential Manager'a yazıldı.")

    if args.autostart is not None:
        set_autostart(args.autostart)
        write_console(f"Windows ile başlat: {'açık' if args.autostart else 'kapalı'}")

    emit(
        "Kurulum tamamlandı.\n\n"
        f"Ayar klasörü: {app_dir()}\n"
        f"Log dosyası: {LOG_PATH}\n"
        f"API key: {'var' if read_api_key() else 'yok'}\n"
        f"Windows ile başlat: {'açık' if is_autostart_enabled() else 'kapalı'}"
    )
    return 0


def status() -> int:
    cfg = load_config()
    emit(
        "ARC Vault Harvester durumu\n\n"
        f"Config: {CONFIG_PATH}\n"
        f"API URL: {cfg.get('api_url')}\n"
        f"Poll interval: {cfg.get('poll_interval')}s\n"
        f"API key: {'var' if read_api_key() else 'yok'}\n"
        f"Autostart: {'açık' if is_autostart_enabled() else 'kapalı'}\n"
        f"Log: {LOG_PATH}"
    )
    return 0


def diagnose() -> int:
    rows, notes = list_embark_credentials()
    watched = set(EMBARK_TARGETS)
    lines = [
        "ARC Vault Harvester diagnostic",
        "",
        "İzlenen targetlar:",
        *[f"  - {target}" for target in EMBARK_TARGETS],
        "",
        "Bulunan Embark/Pioneer benzeri Credential Manager kayıtları:",
    ]
    if not rows:
        lines.append("  kayıt yok")
    for row in rows:
        marker = "WATCHED" if row["target"] in watched else "not-watched"
        lines.append(
            "  - {target} [{marker}] jwt={has_jwt} valid={valid} exp={exp} "
            "sub={sub} embark_user_id={embark_user_id}".format(marker=marker, **row)
        )
    if notes:
        lines.extend(["", "Notlar:"])
        lines.extend(f"  - {note}" for note in notes)
    emit("\n".join(lines), title=f"{APP_NAME} Diagnostic")
    return 0


def scan(force: bool = False) -> int:
    app = HarvesterApp(no_tray=True)
    if not app.api_key:
        emit("API key yok. Önce configure komutunu çalıştırın.", title=f"{APP_NAME} Scan")
        return 1
    app.scan_once(force=force)
    lines = [
        "ARC Vault Harvester scan",
        "",
        f"API URL: {app.cfg.get('api_url')}",
        f"Durum: {app.status}",
        f"Son tarama: {app.last_scan}",
        f"Son başarı: {app.last_success}",
    ]
    if app.last_error:
        lines.append(f"Hata: {app.last_error}")
    emit("\n".join(lines), title=f"{APP_NAME} Scan")
    return 0 if not app.last_error else 1


def acquire_single_instance() -> Any:
    mutex = ctypes.windll.kernel32.CreateMutexW(None, False, "Global\\ARC_Vault_Harvester")
    if ctypes.windll.kernel32.GetLastError() == 183:
        raise RuntimeError("ARC Vault Harvester zaten çalışıyor.")
    return mutex


def main() -> int:
    parser = argparse.ArgumentParser(prog="arc_vault_harvester")
    sub = parser.add_subparsers(dest="command")

    configure_parser = sub.add_parser("configure", help="Ayarları yaz")
    configure_parser.add_argument("--api-url")
    configure_parser.add_argument("--api-key")
    configure_parser.add_argument("--prompt-api-key", action="store_true")
    configure_parser.add_argument("--show-existing", action="store_true")
    configure_parser.add_argument("--poll-interval", type=int)
    configure_parser.add_argument("--autostart", action=argparse.BooleanOptionalAction)

    sub.add_parser("status", help="Ayar durumunu göster")
    sub.add_parser("diagnose", help="Credential Manager token kayıtlarını güvenli listele")
    scan_parser = sub.add_parser("scan", help="Tokenları bir kez tara ve push dene")
    scan_parser.add_argument("--force", action="store_true", help="Daha önce gönderilmiş exp değerlerini de tekrar dene")
    parser.add_argument("--tray", action="store_true", help="Tray modunda çalış")
    parser.add_argument("--no-tray", action="store_true", help="Console/servis modunda çalış")

    args = parser.parse_args()

    if args.command == "configure":
        return configure(args)
    if args.command == "status":
        return status()
    if args.command == "diagnose":
        return diagnose()
    if args.command == "scan":
        return scan(force=args.force)

    try:
        acquire_single_instance()
    except RuntimeError as exc:
        log.warning("%s", exc)
        return 0

    app = HarvesterApp(no_tray=args.no_tray)
    app.start()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

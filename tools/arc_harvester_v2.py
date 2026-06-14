"""
ARC Token Harvester v2
======================
Arka planda çalışır. Credential Manager'da yeni Embark JWT görünce
bizim API'ye gönderir. API arctracker.io'yu halleder.

Kurulum:
  pip install requests pywin32

Ayarlar (aşağıda):
  ARC_VAULT_API_URL          → Sunucu adresi
  ARC_VAULT_INTERNAL_API_KEY → INTERNAL_API_KEY (sunucu .env'deki değer)

Başlatmak için:
  set ARC_VAULT_INTERNAL_API_KEY=<sunucu .env'deki değer>
  python arc_harvester_v2.py

Arka planda otomatik başlatmak için:
  - Görev Zamanlayıcı'ya ekle (Windows başlangıcında)
  - Veya: pythonw arc_harvester_v2.py (konsol penceresi açılmaz)
"""

import sys, subprocess, json, re, time, logging, os
from datetime import datetime

# ── Paket kurulumu ────────────────────────────────────────────────────────────
for pkg in ["requests", "pywin32"]:
    try:
        __import__(pkg if pkg != "pywin32" else "win32cred")
    except ImportError:
        subprocess.check_call([sys.executable, "-m", "pip", "install", pkg, "-q"])

import requests
import win32cred

# ── AYARLAR ───────────────────────────────────────────────────────────────────
API_URL       = os.getenv("ARC_VAULT_API_URL", "https://arc-vault.kemalkondakci.me/api/accounts/token-push")
API_KEY       = os.getenv("ARC_VAULT_INTERNAL_API_KEY", "")
POLL_INTERVAL = 30   # Credential Manager kontrol sıklığı (saniye)
LOG_FILE      = "arc_harvester_v2.log"

EMBARK_TARGETS = [
    "EmbarkID/embark-pioneer/",
    "EmbarkID/embark-pioneer/pioneer-live",
]
# ─────────────────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger(__name__)


def decode_payload(token: str) -> dict:
    try:
        import base64
        p = token.split(".")[1]
        p += "=" * (4 - len(p) % 4)
        return json.loads(base64.urlsafe_b64decode(p))
    except Exception:
        return {}


def payload_summary(payload: dict) -> str:
    ext = payload.get("ext") if isinstance(payload.get("ext"), dict) else {}
    fields = {
        "sub": payload.get("sub"),
        "embark_user_id": ext.get("embark_user_id"),
        "name": payload.get("name") or payload.get("preferred_username") or ext.get("name"),
        "provider": ext.get("provider"),
    }
    return " | ".join(f"{k}={v}" for k, v in fields.items() if v)


def read_embark_jwts() -> dict[str, dict]:
    """Credential Manager'daki geçerli Embark JWT'leri okur. {sub: {jwt, exp}} döner."""
    results = {}
    for target in EMBARK_TARGETS:
        try:
            cred = win32cred.CredRead(target, win32cred.CRED_TYPE_GENERIC)
            blob = cred.get("CredentialBlob", b"")
            text = blob.decode("utf-8", errors="ignore")
            m = re.search(r"(eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+)", text)
            if not m:
                continue
            jwt     = m.group(1)
            payload = decode_payload(jwt)
            sub     = payload.get("sub")
            exp     = payload.get("exp", 0)
            if sub and exp > time.time():
                results[sub] = {"jwt": jwt, "exp": exp, "target": target, "payload": payload}
        except Exception:
            pass
    return results


def push_token(embark_jwt: str) -> bool:
    """Embark JWT'yi API'ye gönderir. Başarılıysa True döner."""
    try:
        resp = requests.post(
            API_URL,
            headers={
                "X-Api-Key":    API_KEY,
                "Content-Type": "application/json",
            },
            json={"embark_jwt": embark_jwt},
            timeout=30,
        )
        if resp.status_code == 200:
            data = resp.json()
            name = f"{data.get('displayName', '?')}#{data.get('discriminator', '?')}"
            log.info("✓ Gönderildi: %s (sync=%s)", name, data.get("syncEnabled"))
            return True
        else:
            log.warning("API hata: HTTP %d — %s", resp.status_code, resp.text[:200])
    except requests.exceptions.ConnectionError:
        log.warning("API'ye bağlanılamadı: %s", API_URL)
    except Exception as exc:
        log.error("Gönderim hatası: %s", exc)
    return False


def main():
    if not API_KEY:
        log.error("ARC_VAULT_INTERNAL_API_KEY ortam değişkeni tanımlı değil.")
        sys.exit(1)

    log.info("ARC Token Harvester v2 başladı (kontrol: her %ds)", POLL_INTERVAL)
    log.info("API: %s", API_URL)

    last_sent: dict[str, int] = {}  # sub → gönderilen exp

    while True:
        try:
            jwts = read_embark_jwts()

            for sub, info in jwts.items():
                exp = info["exp"]

                # Bu exp ile zaten gönderdik mi?
                if last_sent.get(sub) == exp:
                    continue

                exp_dt = datetime.fromtimestamp(exp).strftime("%Y-%m-%d %H:%M")
                log.info(
                    "Yeni token: sub=...%s | exp=%s | kaynak=%s | %s",
                    sub[-8:],
                    exp_dt,
                    info["target"],
                    payload_summary(info.get("payload", {})),
                )

                if push_token(info["jwt"]):
                    last_sent[sub] = exp

        except Exception as exc:
            log.error("Döngü hatası: %s", exc)

        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()

"""
ARC Token Harvester
====================
Arka planda çalışır. Credential Manager'da yeni Embark JWT görünce
ilgili arctracker.io hesabına otomatik gönderir.

Kurulum:
  pip install requests pywin32

İlk çalıştırma (setup):
  python arc_harvester.py --setup
  Her hesap için arctracker.io'ya giriş yapılır.

Normal kullanım (arka planda):
  python arc_harvester.py
  Oyun açıldığında token otomatik yakalanır ve gönderilir.

Otomatik başlatmak için:
  Görev Zamanlayıcı'ya ekle veya Başlangıç klasörüne shortcut koy.
"""

import sys, subprocess, json, re, time, threading, webbrowser, secrets, logging, os
import urllib.parse
from http.server       import HTTPServer, BaseHTTPRequestHandler
from datetime          import datetime, timezone

for pkg in ["requests", "pywin32"]:
    try:
        __import__(pkg if pkg != "pywin32" else "win32cred")
    except ImportError:
        subprocess.check_call([sys.executable, "-m", "pip", "install", pkg, "-q"])

import requests, win32cred

# ── Ayarlar ──────────────────────────────────────────────────────────────────
ARCTRACKER_BASE  = "https://arctracker.io"
CALLBACK_PORT    = 39876
POLL_INTERVAL    = 30        # Credential Manager kontrol sıklığı (saniye)
REFRESH_DAYS     = 7         # arctracker.io JWT bu kadar gün kaldığında yenile
ACCOUNTS_FILE    = "arc_accounts.json"
LOG_FILE         = "arc_harvester.log"

EMBARK_TARGETS = [
    "EmbarkID/embark-pioneer/",
    "EmbarkID/embark-pioneer/pioneer-live",
]

# ── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger(__name__)

# ── Accounts JSON ─────────────────────────────────────────────────────────────
def load_accounts():
    try:
        with open(ACCOUNTS_FILE, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}

def save_accounts(data):
    with open(ACCOUNTS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

# ── JWT yardımcılar ───────────────────────────────────────────────────────────
def decode_payload(token):
    try:
        import base64
        p = token.split(".")[1]
        p += "=" * (4 - len(p) % 4)
        return json.loads(base64.urlsafe_b64decode(p))
    except Exception:
        return {}

def jwt_days_remaining(token):
    exp = decode_payload(token).get("exp", 0)
    return max(0, (exp - time.time()) / 86400)

# ── Credential Manager ────────────────────────────────────────────────────────
def read_embark_jwts():
    results = {}
    for target in EMBARK_TARGETS:
        try:
            cred = win32cred.CredRead(target, win32cred.CRED_TYPE_GENERIC)
            blob = cred.get("CredentialBlob", b"")
            text = blob.decode("utf-8", errors="ignore")
            m    = re.search(r"(eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+)", text)
            if m:
                jwt     = m.group(1)
                payload = decode_payload(jwt)
                sub     = payload.get("sub")
                exp     = payload.get("exp", 0)
                if sub and exp > time.time():          # Sadece geçerli token
                    results[sub] = {"jwt": jwt, "payload": payload, "target": target}
        except Exception:
            pass
    return results

# ── arctracker.io OAuth ───────────────────────────────────────────────────────
_callback_result = {}

class _Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        params = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        _callback_result.update(params)
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(
            b"<html><body style='font-family:sans-serif;text-align:center;padding:40px'>"
            b"<h2>Giri&#351; ba&#351;ar&#305;l&#305;! Bu pencereyi kapatabilirsin.</h2>"
            b"</body></html>"
        )
    def log_message(self, *a): pass

def arctracker_login(label=""):
    _callback_result.clear()
    state    = secrets.token_hex(16)
    callback = f"http://127.0.0.1:{CALLBACK_PORT}/auth/callback?state={state}"
    url      = (
        f"{ARCTRACKER_BASE}/api/auth/bridge/authorize"
        f"?app=arctracker-sync"
        f"&returnTo={urllib.parse.quote(callback)}"
        f"&state={state}"
    )
    print(f"\n  [{label}] Tarayıcı açılıyor...")
    srv = HTTPServer(("127.0.0.1", CALLBACK_PORT), _Handler)
    t   = threading.Thread(target=srv.serve_forever)
    t.daemon = True
    t.start()
    webbrowser.open(url)

    for _ in range(240):          # 2 dk bekle
        time.sleep(0.5)
        if "token" in _callback_result or "error" in _callback_result:
            break

    srv.shutdown()

    if _callback_result.get("state") != state:
        return None
    if "error" in _callback_result:
        print(f"  Hata: {_callback_result['error']}")
        return None
    return _callback_result.get("token")

def refresh_arctracker_jwt(jwt):
    try:
        r = requests.post(
            f"{ARCTRACKER_BASE}/api/auth/bridge/refresh",
            headers={"Authorization": f"Bearer {jwt}", "Content-Type": "application/json"},
            timeout=15,
        )
        if r.status_code == 200:
            return r.json().get("token")
    except Exception:
        pass
    return None

# ── Embark token gönder ───────────────────────────────────────────────────────
def submit_embark_token(arctracker_jwt, embark_jwt, payload):
    body = {
        "accessToken": embark_jwt,
        "observedAt":  datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00"),
        "host":        "api-gateway.europe.es-pio.net",
        "path":        "/v1/shared/manifest",
        "source":      "arctracker-sync",
    }
    try:
        r = requests.post(
            f"{ARCTRACKER_BASE}/api/desktop/embark-token",
            headers={"Authorization": f"Bearer {arctracker_jwt}", "Content-Type": "application/json"},
            json=body,
            timeout=20,
        )
        if r.status_code == 200:
            resp = r.json()
            if resp.get("success"):
                name = f"{resp.get('displayName','?')}#{resp.get('displayNameDiscriminator','?')}"
                log.info("✓ Token gönderildi: %s (embark_id=%s)", name,
                         payload.get("ext", {}).get("embark_user_id", "?"))
                return True, resp
        log.warning("Token gönderme başarısız: HTTP %s — %s", r.status_code, r.text[:200])
    except Exception as e:
        log.error("submit hatası: %s", e)
    return False, {}

# ── SETUP: her hesap için bir kez çalıştır ────────────────────────────────────
def setup():
    print("=" * 60)
    print("  ARC Harvester — Hesap Kurulumu")
    print("=" * 60)
    print("""
Her hesap için şunu yapacağız:
  1. Tarayıcıda arctracker.io'ya giriş yap
  2. Oyunu o hesapla aç (Embark JWT yazmak için)
  3. Eşleştirme kaydedilir

Kaç hesap kurmak istiyorsun?""")

    accounts = load_accounts()
    n = int(input("Hesap sayısı: ").strip() or "1")

    for i in range(n):
        print(f"\n{'='*50}")
        print(f"  Hesap {i+1}/{n}")
        print(f"{'='*50}")
        print("  Önce: oyunu bu hesapla aç ve ana menüye gel.")
        input("  Hazır olduğunda Enter'a bas...")

        # Embark JWT oku
        jwts = read_embark_jwts()
        if not jwts:
            print("  Embark JWT bulunamadı! Oyunu açtığından emin ol.")
            continue

        print(f"\n  Bulunan geçerli Embark JWT'ler:")
        subs = list(jwts.keys())
        for idx, sub in enumerate(subs):
            p = jwts[sub]["payload"]
            name = f"{p.get('ext', {}).get('embark_user_id', '?')}"
            print(f"    [{idx}] sub={sub} | embark_id={name}")

        sel = 0
        if len(subs) > 1:
            sel = int(input("  Hangisi bu hesap? ").strip() or "0")

        sub     = subs[sel]
        emb_jwt = jwts[sub]["jwt"]
        emb_payload = jwts[sub]["payload"]

        # arctracker.io girişi
        print(f"\n  Şimdi BU hesabın arctracker.io hesabıyla giriş yap:")
        arc_jwt = arctracker_login(label=f"Hesap {i+1}")
        if not arc_jwt:
            print("  Giriş başarısız, atlanıyor.")
            continue

        arc_payload = decode_payload(arc_jwt)
        arc_email   = arc_payload.get("email", "?")
        arc_name    = arc_payload.get("name", "?")
        print(f"  arctracker.io: {arc_name} ({arc_email})")

        # Test et
        success, resp = submit_embark_token(arc_jwt, emb_jwt, emb_payload)
        if not success:
            print("  Token gönderme başarısız!")
            continue

        game_name = f"{resp.get('displayName','?')}#{resp.get('displayNameDiscriminator','?')}"
        print(f"  ✓ Eşleşme kuruldu: {game_name} ↔ {arc_email}")

        # Kaydet
        accounts[sub] = {
            "sub":            sub,
            "embark_user_id": emb_payload.get("ext", {}).get("embark_user_id", "?"),
            "game_name":      game_name,
            "arc_email":      arc_email,
            "arc_jwt":        arc_jwt,
            "last_sent_sub":  sub,
        }
        save_accounts(accounts)

    print("\n\nKurulum tamamlandı!")
    print(f"Kayıtlı hesaplar ({len(accounts)}):")
    for sub, acc in accounts.items():
        print(f"  {acc['game_name']} ↔ {acc['arc_email']}")
    print("\nHarvester'ı başlatmak için: python arc_harvester.py")

# ── HARVESTER: sürekli çalışır ────────────────────────────────────────────────
def run_harvester():
    log.info("ARC Token Harvester başladı (kontrol aralığı: %ds)", POLL_INTERVAL)
    accounts      = load_accounts()
    last_seen_exp = {}   # sub → son gönderilen token'ın exp değeri

    if not accounts:
        log.warning("Kayıtlı hesap yok. Önce: python arc_harvester.py --setup")
        return

    log.info("Takip edilen hesaplar: %s",
             ", ".join(a["game_name"] for a in accounts.values()))

    while True:
        try:
            accounts = load_accounts()    # Değişiklikleri al
            jwts     = read_embark_jwts()

            for sub, token_data in jwts.items():
                if sub not in accounts:
                    log.debug("Bilinmeyen sub=%s, atlanıyor", sub)
                    continue

                acc     = accounts[sub]
                emb_jwt = token_data["jwt"]
                payload = token_data["payload"]
                exp     = payload.get("exp", 0)

                # Daha önce bu exp ile gönderdik mi?
                if last_seen_exp.get(sub) == exp:
                    continue

                log.info("Yeni token: %s (exp=%s)",
                         acc["game_name"],
                         datetime.fromtimestamp(exp).strftime("%Y-%m-%d %H:%M"))

                # arctracker.io JWT yenile (gerekiyorsa)
                arc_jwt  = acc["arc_jwt"]
                days_rem = jwt_days_remaining(arc_jwt)
                if days_rem < REFRESH_DAYS:
                    log.info("arctracker.io JWT yenileniyor (%s gün kalmış)...", int(days_rem))
                    new_jwt = refresh_arctracker_jwt(arc_jwt)
                    if new_jwt:
                        arc_jwt           = new_jwt
                        acc["arc_jwt"]    = arc_jwt
                        accounts[sub]     = acc
                        save_accounts(accounts)
                        log.info("arctracker.io JWT yenilendi")
                    else:
                        log.warning("JWT yenilenemedi! Manuel giriş gerekebilir.")

                # Embark token gönder
                success, _ = submit_embark_token(arc_jwt, emb_jwt, payload)
                if success:
                    last_seen_exp[sub] = exp

        except Exception as e:
            log.error("Döngü hatası: %s", e)

        time.sleep(POLL_INTERVAL)

# ── Giriş noktası ─────────────────────────────────────────────────────────────
if __name__ == "__main__":
    if "--setup" in sys.argv:
        setup()
    else:
        # Daha önce kurulum yapılmışsa doğrudan başlat
        if not os.path.exists(ACCOUNTS_FILE) or not load_accounts():
            print("Hesap kurulmamış. Önce: python arc_harvester.py --setup")
            sys.exit(1)
        run_harvester()

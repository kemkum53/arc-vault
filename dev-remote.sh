#!/bin/bash
# Local API + Web'i server DB'sine bağlar.
# Gereksinim: ssh config'de 'yelora-dev' alias tanımlı olmalı.

set -e

TUNNEL_PORT=15432
SSH_HOST=yelora-dev
COMPOSE_FILE=docker-compose.dev-remote.yml
DEV_REMOTE_PSQL_URL=${DEV_REMOTE_PSQL_URL:-}

if [[ -z "$DEV_REMOTE_PSQL_URL" ]]; then
    echo "HATA: DEV_REMOTE_PSQL_URL tanımlı değil."
    echo "Örnek: postgresql://postgres:<password>@192.168.65.254:${TUNNEL_PORT}/account_tracker"
    exit 1
fi

echo "[1/3] SSH tunnel kontrol ediliyor..."
if lsof -ti:$TUNNEL_PORT > /dev/null 2>&1; then
    echo "  Port $TUNNEL_PORT zaten açık, tunnel çalışıyor."
else
    echo "  Tunnel açılıyor: localhost:$TUNNEL_PORT → $SSH_HOST postgres..."
    ssh -L 0.0.0.0:${TUNNEL_PORT}:127.0.0.1:${TUNNEL_PORT} $SSH_HOST -N -f
    sleep 1
    echo "  Tunnel açık."
fi

echo "[2/3] DB bağlantısı test ediliyor..."
docker run --rm \
    postgres:16-alpine \
    psql "$DEV_REMOTE_PSQL_URL" \
    -c "SELECT count(*) as hesap_sayisi FROM tracker_accounts;" 2>&1 | grep -v "^$" || {
    echo "  HATA: DB bağlantısı başarısız!"
    exit 1
}

echo "[3/3] Docker Compose başlatılıyor..."
docker compose -f $COMPOSE_FILE up --build "$@"

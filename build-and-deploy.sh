#!/bin/bash
# Image'ları build et, paketle ve server'a gönder.
# Kullanım: ./build-and-deploy.sh [--no-web]

set -e

SSH_HOST=yelora-dev
DEPLOY_DIR=/home/yelora-dev/compose-projects/kemalkondakci.me/arc_vault
IMAGES_FILE=deploy/arc-vault-images.tar.gz

BUILD_WEB=true
if [[ "$1" == "--no-web" ]]; then
    BUILD_WEB=false
fi

echo "=== ARC Vault Build & Deploy ==="
mkdir -p "$(dirname "$IMAGES_FILE")"

echo "[1] API image build ediliyor → arc-vault-api:latest (linux/amd64)"
docker buildx build --platform linux/amd64 -t arc-vault-api:latest --load ./api

if $BUILD_WEB; then
    echo "[2] Web image build ediliyor → arc-vault-web:latest (linux/amd64)"
    docker buildx build --platform linux/amd64 -t arc-vault-web:latest --load ./web
    echo "[3] Image'lar paketleniyor → $IMAGES_FILE"
    docker save arc-vault-api:latest arc-vault-web:latest | gzip > $IMAGES_FILE
else
    echo "[2] Web atlandı (--no-web)"
    echo "[3] Sadece API paketleniyor → $IMAGES_FILE"
    docker save arc-vault-api:latest | gzip > $IMAGES_FILE
fi

echo "[4] Server'a gönderiliyor ($SSH_HOST:$DEPLOY_DIR)..."
scp $IMAGES_FILE $SSH_HOST:$DEPLOY_DIR/arc-vault-images.tar.gz
echo "[5] Server'da deploy yapılıyor..."
ssh $SSH_HOST "cd $DEPLOY_DIR && \
    docker load < arc-vault-images.tar.gz && \
    docker compose -f docker-compose.yml --env-file .env up -d api web"

echo ""
echo "=== Tamamlandı ==="
echo "Server logları: ssh $SSH_HOST 'cd $DEPLOY_DIR && docker compose -f docker-compose.yml logs -f api'"

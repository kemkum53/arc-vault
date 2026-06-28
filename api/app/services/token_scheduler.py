"""Arka planda token süresini kontrol edip otomatik yenileyen scheduler."""

import asyncio
import logging
from datetime import datetime, timezone, timedelta

from sqlalchemy import select

from app.core.database import async_session
from app.models import TrackerAccount
from app.services.token_refresh import auto_refresh, complete_refresh

logger = logging.getLogger(__name__)

CHECK_INTERVAL = 30 * 60  # 30 dakikada bir kontrol
REFRESH_BEFORE = timedelta(hours=2)   # bitime 2 saat kala token yenile
SYNC_BEFORE    = timedelta(hours=1)   # bitime 1 saat kala son sync yap


async def _check_and_refresh():
    """Tüm hesapları kontrol et, süresi yaklaşanları yenile."""
    async with async_session() as db:
        result = await db.execute(select(TrackerAccount))
        accounts = result.scalars().all()

    now = datetime.now(timezone.utc)
    refreshed = 0

    for acc in accounts:
        if not acc.xbox_email or not acc.xbox_password:
            continue

        if not acc.token_expires_at:
            continue

        expires = acc.token_expires_at
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)

        remaining = expires - now
        if remaining > REFRESH_BEFORE:
            continue

        # Zaten expire olmuş ve çok geçmişse (>6 saat) otomatik yenileme mümkün değil.
        # Bu hesaplar için manuel browser re-link gerekir; sürekli deneme diğer
        # akışları (browser + scheduler concurrent) birbirini bozar.
        if remaining < -timedelta(hours=6):
            logger.debug("[TokenScheduler] %s#%s token %s önce dolmuş, manuel re-link gerekiyor, atlanıyor.",
                         acc.display_name, acc.display_name_discriminator, abs(remaining))
            continue

        logger.info("[TokenScheduler] %s#%s token %s sonra doluyor, yenileniyor...",
                    acc.display_name, acc.display_name_discriminator, remaining)

        try:
            result = await auto_refresh(acc)
            if result.get("status") == "success":
                async with async_session() as db:
                    db_acc = await db.get(TrackerAccount, acc.id)
                    if db_acc:
                        await complete_refresh(db, db_acc)
                refreshed += 1
                logger.info("[TokenScheduler] %s#%s token yenilendi! Yeni süre: %s",
                            acc.display_name, acc.display_name_discriminator,
                            result.get("new_expires"))
            else:
                logger.warning("[TokenScheduler] %s#%s refresh başarısız: %s",
                               acc.display_name, acc.display_name_discriminator,
                               result.get("message"))
        except Exception as e:
            logger.error("[TokenScheduler] %s#%s refresh hatası: %s",
                         acc.display_name, acc.display_name_discriminator, e,
                         exc_info=True)

        # Microsoft rate limit'i önlemek için hesaplar arası bekleme
        await asyncio.sleep(60)

    if refreshed:
        logger.info("[TokenScheduler] %d hesap yenilendi", refreshed)


async def _check_and_sync_expiring():
    """Token süresi 1 saat içinde dolacak hesapları sync eder."""
    from app.services.auto_sync import run_sync_for_account

    async with async_session() as db:
        result = await db.execute(select(TrackerAccount))
        accounts = result.scalars().all()

    now = datetime.now(timezone.utc)
    queued = 0

    for acc in accounts:
        if not acc.token_expires_at:
            continue

        expires = acc.token_expires_at
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)

        remaining = expires - now

        # Sadece "1 saat içinde dolacak ama henüz dolmamış" hesaplar
        if remaining.total_seconds() < 0 or remaining > SYNC_BEFORE:
            continue

        # Son 1 saat içinde zaten sync yapıldıysa atla
        if acc.last_sync_at:
            last = acc.last_sync_at
            if last.tzinfo is None:
                last = last.replace(tzinfo=timezone.utc)
            if (now - last).total_seconds() < 3600:
                logger.debug(
                    "[TokenScheduler] %s#%s expiry yakın ama son 1 saatte sync yapıldı, atlanıyor",
                    acc.display_name, acc.display_name_discriminator,
                )
                continue

        logger.info(
            "[TokenScheduler] %s#%s token %s sonra doluyor — expiry sync başlatılıyor",
            acc.display_name, acc.display_name_discriminator, remaining,
        )

        asyncio.create_task(
            run_sync_for_account(acc.id, reason="expiry-sync")
        )
        queued += 1
        await asyncio.sleep(3)  # ardışık sync'ler arası kısa bekleme

    if queued:
        logger.info("[TokenScheduler] %d hesap expiry sync kuyruğuna alındı", queued)


async def run_scheduler():
    """Ana scheduler döngüsü — uygulama başladığında çalışır."""
    logger.info("[TokenScheduler] Başlatıldı — her %d dk kontrol, bitime %s kala yenileme",
                CHECK_INTERVAL // 60, REFRESH_BEFORE)

    # İlk kontrolü 30sn sonra yap (uygulama başlasın)
    await asyncio.sleep(30)

    while True:
        try:
            await _check_and_refresh()
            await _check_and_sync_expiring()
        except Exception as e:
            logger.error("[TokenScheduler] Döngü hatası: %s", e)

        await asyncio.sleep(CHECK_INTERVAL)

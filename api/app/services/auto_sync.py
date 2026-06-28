"""Arka planda hesap sync çalıştıran yardımcı servis.

Hem token-push hem de expiry-scheduler tarafından kullanılır.
Kendi DB oturumunu açar; çağıran tarafı bloklamaz.
"""

import logging
from datetime import datetime, timezone

from app.core.database import async_session
from app.models import TrackerAccount

logger = logging.getLogger(__name__)


async def run_sync_for_account(account_id: str, reason: str = "auto") -> None:
    """Verilen hesap için tam sync çalıştırır.

    Kendi DB session'ını açar; concurrent çağrılar sync_status ile engellenir.
    Hatalar loglanır ama yukarıya fırlatılmaz (fire-and-forget güvenli).
    """
    from app.services.sync_service import run_sync

    async with async_session() as db:
        acc = await db.get(TrackerAccount, account_id)
        if not acc:
            logger.warning("[AutoSync] Hesap bulunamadı: %s", account_id)
            return

        if acc.sync_status == "syncing" and acc.sync_started_at:
            elapsed = (datetime.now(timezone.utc) - acc.sync_started_at).total_seconds()
            if elapsed < 600:
                logger.info(
                    "[AutoSync] %s zaten sync yapıyor, atlanıyor (%s)",
                    acc.display_name or acc.arctracker_email,
                    reason,
                )
                return
            # 10 dk üzerinde takılı kalmış — sıfırla
            acc.sync_status = None
            acc.sync_started_at = None

        acc.sync_status = "syncing"
        acc.sync_started_at = datetime.now(timezone.utc)
        await db.commit()

        logger.info(
            "[AutoSync] Başlatıldı: %s#%s (neden: %s)",
            acc.display_name or acc.arctracker_email,
            acc.display_name_discriminator or "?",
            reason,
        )

        try:
            stats = await run_sync(db, acc)
            acc.sync_status = None
            acc.sync_started_at = None
            await db.commit()
            logger.info(
                "[AutoSync] Tamamlandı: %s#%s — %d item, %d blueprint (neden: %s)",
                acc.display_name,
                acc.display_name_discriminator,
                stats.get("synced_items", 0),
                stats.get("synced_blueprints", 0),
                reason,
            )
        except Exception as exc:
            logger.error(
                "[AutoSync] Hata: %s#%s — %s (neden: %s)",
                acc.display_name or acc.arctracker_email,
                acc.display_name_discriminator or "?",
                exc,
                reason,
            )
            await db.rollback()
            async with async_session() as db2:
                acc2 = await db2.get(TrackerAccount, account_id)
                if acc2:
                    acc2.sync_status = "error"
                    acc2.sync_started_at = None
                    await db2.commit()

"""Server-side bulk sync for the matrix.

One run at a time for the whole site: whoever starts it, every open matrix
sees the same progress by polling, and nobody can start a second run on top.

Accounts are synced through the regular per-account sync under one global
concurrency cap shared with manual and automatic syncs
(sync_service.SYNC_SEM / SYNC_CONCURRENCY, default 4). So each row's sync_status
in the DB shows what is happening, several rows can sync at once, and the whole
site never exceeds the cap no matter how the syncs were triggered.

State lives in this process (the API runs a single uvicorn worker); a restart
ends any run, and startup already clears stale "syncing" flags.
"""

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone

from app.services.auto_sync import _run_sync_for_account_inner
from app.services.sync_service import SYNC_CONCURRENCY, SYNC_SEM

logger = logging.getLogger(__name__)


class BulkSyncBusy(Exception):
    """A bulk sync is already running."""


@dataclass
class BulkRun:
    ids: list[str]
    started_by: str
    # Started by an admin: skip the per-account minimum interval.
    ignore_interval: bool = False
    started_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    done: list[str] = field(default_factory=list)
    failed: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)
    in_progress: set[str] = field(default_factory=set)
    stop_requested: bool = False
    finished_at: datetime | None = None

    def as_dict(self) -> dict:
        current = list(self.in_progress)
        return {
            "running": self.finished_at is None,
            "started_by": self.started_by,
            "started_at": self.started_at.isoformat(),
            "finished_at": self.finished_at.isoformat() if self.finished_at else None,
            "total": len(self.ids),
            "done": len(self.done),
            "failed": self.failed,
            "skipped": self.skipped,
            "concurrency": SYNC_CONCURRENCY,
            "current": current,  # accounts syncing right now (list; was a single id)
            "queued": [i for i in self.ids if i not in self.done and i not in self.in_progress]
            if self.finished_at is None else [],
            "stopped": self.stop_requested,
        }


_run: BulkRun | None = None
_lock = asyncio.Lock()


def current_run() -> BulkRun | None:
    return _run


async def start(ids: list[str], started_by: str, ignore_interval: bool = False) -> BulkRun:
    global _run
    async with _lock:
        if _run and _run.finished_at is None:
            raise BulkSyncBusy(_run.started_by)
        _run = BulkRun(ids=list(dict.fromkeys(ids)), started_by=started_by, ignore_interval=ignore_interval)
        asyncio.create_task(_execute(_run))
        logger.info("[BulkSync] %d hesap, es zamanli=%d, baslatan %s", len(_run.ids), SYNC_CONCURRENCY, started_by)
        return _run


def stop(requested_by: str) -> BulkRun | None:
    if _run and _run.finished_at is None:
        _run.stop_requested = True
        logger.info("[BulkSync] durdurma istegi: %s", requested_by)
    return _run


async def _sync_one(run: BulkRun, account_id: str) -> None:
    if run.stop_requested:
        return
    # Take a global slot first, then mark the row as actively syncing: "current"
    # never shows more than SYNC_CONCURRENCY accounts, and queued accounts wait on
    # the semaphore without holding a DB connection (the session is opened inside).
    async with SYNC_SEM:
        if run.stop_requested:
            return
        run.in_progress.add(account_id)
        try:
            ok = await _run_sync_for_account_inner(
                account_id, reason=f"matrix:{run.started_by}", ignore_interval=run.ignore_interval,
            )
        except Exception:
            logger.exception("[BulkSync] hesap sync hatasi: %s", account_id)
            ok = False
        finally:
            run.in_progress.discard(account_id)
        run.done.append(account_id)
        if ok is False:
            run.failed.append(account_id)
        elif ok is None:  # synced moments ago, or already syncing
            run.skipped.append(account_id)


async def _execute(run: BulkRun) -> None:
    try:
        # Schedule every account at once; SYNC_SEM caps how many actually run.
        await asyncio.gather(*(_sync_one(run, account_id) for account_id in run.ids))
    except Exception:  # never leave a run stuck as "running"
        logger.exception("[BulkSync] beklenmeyen hata")
    finally:
        run.in_progress.clear()
        run.finished_at = datetime.now(timezone.utc)
        logger.info(
            "[BulkSync] bitti: %d/%d basarili, %d hata%s",
            len(run.done) - len(run.failed), len(run.ids), len(run.failed),
            " (durduruldu)" if run.stop_requested else "",
        )

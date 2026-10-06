"""Server-side bulk sync for the matrix.

One run at a time for the whole site: whoever starts it, every open matrix
sees the same progress by polling, and nobody can start a second run on top.
Accounts are synced one after another with the regular account sync, so each
row's sync_status in the DB shows what is happening.

State lives in this process (the API runs a single uvicorn worker); a restart
ends any run, and startup already clears stale "syncing" flags.
"""

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone

from app.services.auto_sync import run_sync_for_account

logger = logging.getLogger(__name__)


class BulkSyncBusy(Exception):
    """A bulk sync is already running."""


@dataclass
class BulkRun:
    ids: list[str]
    started_by: str
    started_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    done: list[str] = field(default_factory=list)
    failed: list[str] = field(default_factory=list)
    current: str | None = None
    stop_requested: bool = False
    finished_at: datetime | None = None

    def as_dict(self) -> dict:
        return {
            "running": self.finished_at is None,
            "started_by": self.started_by,
            "started_at": self.started_at.isoformat(),
            "finished_at": self.finished_at.isoformat() if self.finished_at else None,
            "total": len(self.ids),
            "done": len(self.done),
            "failed": self.failed,
            "current": self.current,
            "queued": [i for i in self.ids if i not in self.done and i != self.current] if self.finished_at is None else [],
            "stopped": self.stop_requested,
        }


_run: BulkRun | None = None
_lock = asyncio.Lock()


def current_run() -> BulkRun | None:
    return _run


async def start(ids: list[str], started_by: str) -> BulkRun:
    global _run
    async with _lock:
        if _run and _run.finished_at is None:
            raise BulkSyncBusy(_run.started_by)
        _run = BulkRun(ids=list(dict.fromkeys(ids)), started_by=started_by)
        asyncio.create_task(_execute(_run))
        logger.info("[BulkSync] %d hesap, başlatan %s", len(_run.ids), started_by)
        return _run


def stop(requested_by: str) -> BulkRun | None:
    if _run and _run.finished_at is None:
        _run.stop_requested = True
        logger.info("[BulkSync] durdurma isteği: %s", requested_by)
    return _run


async def _execute(run: BulkRun) -> None:
    try:
        for account_id in run.ids:
            if run.stop_requested:
                break
            run.current = account_id
            ok = await run_sync_for_account(account_id, reason=f"matrix:{run.started_by}")
            run.done.append(account_id)
            if ok is False:
                run.failed.append(account_id)
    except Exception:  # never leave a run stuck as "running"
        logger.exception("[BulkSync] beklenmeyen hata")
    finally:
        run.current = None
        run.finished_at = datetime.now(timezone.utc)
        logger.info(
            "[BulkSync] bitti: %d/%d, %d hata%s",
            len(run.done) - len(run.failed), len(run.ids), len(run.failed),
            " (durduruldu)" if run.stop_requested else "",
        )

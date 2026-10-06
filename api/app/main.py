import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

from app.api.accounts import router as accounts_router
from app.api.auth import router as auth_router
from app.api.sync import router as sync_router
from app.api.token_refresh import router as token_refresh_router
from app.api.reference import router as reference_router
from app.api.workshop import router as workshop_router
from app.api.expedition import router as expedition_router
from app.api.harvester import router as harvester_router
from app.api.sheets import router as sheets_router
from app.api.matrix import router as matrix_router
from app.core.config import settings
from app.services.token_scheduler import run_scheduler

import app.models  # noqa: F401

logging.basicConfig(level=logging.INFO, format="%(name)s | %(levelname)s | %(message)s")


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response


async def _create_tables():
    """Tabloları oluşturur (yoksa)."""
    from app.core.database import engine, Base
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def _ensure_schema():
    """Eksik kolonları otomatik ekler (alembic yerine basit migration)."""
    from sqlalchemy import text, inspect
    from app.core.database import engine
    async with engine.begin() as conn:
        tables = await conn.run_sync(
            lambda sync_conn: inspect(sync_conn).get_table_names()
        )
        if "users" not in tables:
            return

        columns = await conn.run_sync(
            lambda sync_conn: [c["name"] for c in inspect(sync_conn).get_columns("users")]
        )
        if "token_version" not in columns:
            await conn.execute(text(
                "ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0"
            ))
        if "expedition_supply_included" not in columns:
            await conn.execute(text(
                "ALTER TABLE users ADD COLUMN expedition_supply_included TEXT"
            ))
        if "account_group" not in columns:
            await conn.execute(text("ALTER TABLE users ADD COLUMN account_group TEXT"))
        for col, ddl in (
            ("last_seen_at", "TIMESTAMPTZ"), ("last_seen_ip", "VARCHAR(64)"), ("last_seen_ua", "VARCHAR(255)"),
        ):
            if col not in columns:
                await conn.execute(text(f"ALTER TABLE users ADD COLUMN {col} {ddl}"))
        if "refresh_tokens" in tables:
            rt_cols = await conn.run_sync(
                lambda sync_conn: [c["name"] for c in inspect(sync_conn).get_columns("refresh_tokens")]
            )
            if "ip" not in rt_cols:
                await conn.execute(text("ALTER TABLE refresh_tokens ADD COLUMN ip VARCHAR(64)"))
        if "matrix_views" not in columns:
            await conn.execute(text(
                "ALTER TABLE users ADD COLUMN matrix_views TEXT"
            ))

        if "inventory_items" in tables:
            inv_cols = await conn.run_sync(
                lambda sync_conn: [c["name"] for c in inspect(sync_conn).get_columns("inventory_items")]
            )
            if "mods_unknown" not in inv_cols:
                await conn.execute(text(
                    "ALTER TABLE inventory_items ADD COLUMN mods_unknown BOOLEAN NOT NULL DEFAULT false"
                ))

        if "tracker_accounts" not in tables:
            return

        ta_cols = await conn.run_sync(
            lambda sync_conn: [c["name"] for c in inspect(sync_conn).get_columns("tracker_accounts")]
        )
        if "sync_status" not in ta_cols:
            await conn.execute(text(
                "ALTER TABLE tracker_accounts ADD COLUMN sync_status VARCHAR(20)"
            ))
        if "sync_started_at" not in ta_cols:
            await conn.execute(text(
                "ALTER TABLE tracker_accounts ADD COLUMN sync_started_at TIMESTAMPTZ"
            ))
        if "arctracker_bridge_jwt" not in ta_cols:
            await conn.execute(text(
                "ALTER TABLE tracker_accounts ADD COLUMN arctracker_bridge_jwt TEXT"
            ))
        for col in ("steam_username", "steam_password", "arctracker_session"):
            if col not in ta_cols:
                await conn.execute(text(f"ALTER TABLE tracker_accounts ADD COLUMN {col} TEXT"))
        if "arctracker_session_at" not in ta_cols:
            await conn.execute(text(
                "ALTER TABLE tracker_accounts ADD COLUMN arctracker_session_at TIMESTAMPTZ"
            ))
        if "arctracker_bridge_jwt_exp" not in ta_cols:
            await conn.execute(text(
                "ALTER TABLE tracker_accounts ADD COLUMN arctracker_bridge_jwt_exp TIMESTAMPTZ"
            ))


async def _seed_matrix_settings():
    """Create the shared matrix layout row once, starting from the admin's own views."""
    from sqlalchemy import select
    from app.core.database import async_session
    from app.models import MatrixSetting, User
    async with async_session() as db:
        if await db.get(MatrixSetting, 1):
            return
        users = (await db.execute(select(User).where(User.matrix_views.is_not(None)))).scalars().all()
        source = next((u for u in users if u.username == "admin"), None)             or next((u for u in users if u.role == "admin"), None)             or (users[0] if users else None)
        db.add(MatrixSetting(
            id=1,
            views=source.matrix_views if source else None,
            version=1 if source else 0,
            updated_by=source.username if source else None,
        ))
        await db.commit()
        logging.getLogger(__name__).info(
            "Shared matrix views seeded from %s", source.username if source else "defaults"
        )


async def _clear_stale_syncs():
    """Sunucu başlarken takılı kalmış sync durumlarını temizle."""
    from sqlalchemy import text
    from app.core.database import engine
    async with engine.begin() as conn:
        await conn.execute(text(
            "UPDATE tracker_accounts SET sync_status = NULL, sync_started_at = NULL "
            "WHERE sync_status IS NOT NULL"
        ))


@asynccontextmanager
async def lifespan(app: FastAPI):
    await _create_tables()
    await _ensure_schema()
    await _seed_matrix_settings()
    await _clear_stale_syncs()
    task = None
    if settings.auto_refresh_enabled:
        task = asyncio.create_task(run_scheduler())
    else:
        logging.getLogger(__name__).info("Token scheduler devre dışı (AUTO_REFRESH_ENABLED=false)")
    yield
    if task:
        task.cancel()


app = FastAPI(
    title="ARC Vault",
    description="ARC Raiders envanter ve ilerleme takip API'si — arctracker.io üzerinden sync",
    version="0.1.0",
    lifespan=lifespan,
)

cors_origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(SecurityHeadersMiddleware)

app.include_router(auth_router, prefix="/api")
app.include_router(accounts_router, prefix="/api")
app.include_router(sync_router, prefix="/api")
app.include_router(token_refresh_router, prefix="/api")
app.include_router(reference_router, prefix="/api")
app.include_router(workshop_router, prefix="/api")
app.include_router(expedition_router, prefix="/api")
app.include_router(harvester_router, prefix="/api")
app.include_router(sheets_router, prefix="/api")
app.include_router(matrix_router, prefix="/api")


@app.get("/health")
async def health():
    return {"status": "ok"}

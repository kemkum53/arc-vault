from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api.accounts import router as accounts_router
from app.api.sync import router as sync_router
from app.api.token_refresh import router as token_refresh_router

# Modelleri import et (Alembic metadata için)
import app.models  # noqa: F401

app = FastAPI(
    title="ARC Vault",
    description="ARC Raiders envanter ve ilerleme takip API'si — arctracker.io üzerinden sync",
    version="0.1.0",
)

# CORS — Chrome eklentisi farklı origin'den istek atar
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Prod'da kısıtlanmalı
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(accounts_router, prefix="/api")
app.include_router(sync_router, prefix="/api")
app.include_router(token_refresh_router, prefix="/api")

# Static dosyalar
STATIC_DIR = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
async def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/extension")
async def extension_page():
    return FileResponse(STATIC_DIR / "extension.html")


@app.get("/health")
async def health():
    return {"status": "ok"}

"""Harvester sürüm endpoint'i — auth gerektirmez."""

from fastapi import APIRouter

router = APIRouter(tags=["harvester"])

# Yeni harvester yayınlandığında bu iki sabit güncellenir.
LATEST_VERSION = "2.1.0"
DOWNLOAD_URL = (
    "https://github.com/kemkum53/arc-vault/releases/download"
    f"/v{LATEST_VERSION}/ARC%20Vault%20Harvester.exe"
)


@router.get("/harvester/version")
async def get_harvester_version():
    return {"version": LATEST_VERSION, "url": DOWNLOAD_URL}

"""Read-only client for Embark's shared account gateway.

Used to resolve an Embark token to a human-readable account identity
(display name + linked store gamertag) so unmatched pending tokens can be
recognised in the admin panel. See ARCTRACKER_LINK_V2.md.
"""

import logging

import httpx

logger = logging.getLogger(__name__)

GATEWAY = "https://api-gateway.europe.es-pio.net"


async def fetch_profile(embark_jwt: str) -> dict | None:
    """Return {name, discriminator, gamertag, account_id, country} or None.

    Calls GET /v1/shared/profile with the account's own token. Returns None if
    the token is expired/invalid or the call fails. No manifest-id required.
    """
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"{GATEWAY}/v1/shared/profile",
                headers={"Authorization": f"Bearer {embark_jwt}", "Accept": "application/json"},
            )
        if resp.status_code != 200:
            logger.info("Embark profile HTTP %d", resp.status_code)
            return None
        data = resp.json()
    except Exception as exc:
        logger.info("Embark profile alınamadı: %s", exc)
        return None

    display = data.get("displayName") or {}
    return {
        "name": display.get("name"),
        "discriminator": display.get("discriminator"),
        "gamertag": data.get("thirdPartyLastSeenAccountName"),
        "account_id": str(data.get("accountId")) if data.get("accountId") is not None else None,
        "country": data.get("countryCode"),
    }

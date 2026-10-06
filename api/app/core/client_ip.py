"""The visitor's real IP behind Cloudflare and Traefik.

Requests reach the API from Traefik's container address, so request.client
is useless for logging or rate limits. Cloudflare puts the visitor IP in
CF-Connecting-IP; X-Forwarded-For is the fallback. These headers can be
forged by someone talking to the origin directly, so the value is only used
for records and rate limiting, never for access decisions.
"""

from fastapi import Request


def client_ip(request: Request) -> str:
    cf = request.headers.get("cf-connecting-ip")
    if cf:
        return cf.strip()[:64]
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()[:64]
    return request.client.host if request.client else "unknown"

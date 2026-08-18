"""Refresh token akışı: rotasyon, iptal ve yeniden kullanım tespiti."""

from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from app.core import auth as auth_core
from app.main import app

USERNAME = "refresh-tester"
PASSWORD = "s3cret-passw0rd"


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        c.post("/api/auth/setup", json={"username": USERNAME, "password": PASSWORD})
        yield c


def _login(client: TestClient) -> dict:
    res = client.post("/api/auth/login", json={"username": USERNAME, "password": PASSWORD})
    assert res.status_code == 200, res.text
    return res.json()


def test_login_returns_access_and_refresh_token(client):
    data = _login(client)

    assert data["token"]
    assert data["refresh_token"]
    assert data["user"]["username"] == USERNAME


def test_refresh_rotates_token_and_returns_working_access_token(client):
    first = _login(client)

    res = client.post("/api/auth/refresh", json={"refresh_token": first["refresh_token"]})
    assert res.status_code == 200, res.text
    rotated = res.json()

    assert rotated["refresh_token"] != first["refresh_token"]

    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {rotated['token']}"})
    assert me.status_code == 200
    assert me.json()["username"] == USERNAME


def test_refresh_token_cannot_be_used_as_access_token(client):
    data = _login(client)

    res = client.get("/api/auth/me", headers={"Authorization": f"Bearer {data['refresh_token']}"})

    assert res.status_code == 401


def test_logout_revokes_refresh_token(client):
    data = _login(client)

    assert client.post("/api/auth/logout", json={"refresh_token": data["refresh_token"]}).status_code == 204

    # Kasıtlı iptal — rotasyon toleransından yararlanmamalı, anında reddedilmeli.
    res = client.post("/api/auth/refresh", json={"refresh_token": data["refresh_token"]})
    assert res.status_code == 401


def test_reuse_outside_leeway_revokes_all_sessions(client, monkeypatch):
    first = _login(client)
    other_session = _login(client)

    rotated = client.post(
        "/api/auth/refresh", json={"refresh_token": first["refresh_token"]}
    ).json()

    # Tolerans penceresi içinde eski token hâlâ çalışır — paralel sekmeler alarm tetiklemesin.
    grace = client.post("/api/auth/refresh", json={"refresh_token": first["refresh_token"]})
    assert grace.status_code == 200

    monkeypatch.setattr(auth_core, "REFRESH_REUSE_LEEWAY", timedelta(seconds=-1))

    reuse = client.post("/api/auth/refresh", json={"refresh_token": first["refresh_token"]})
    assert reuse.status_code == 401

    # Hırsızlık şüphesi: diğer oturumun refresh token'ı ve access token'ı da düşmeli.
    assert client.post(
        "/api/auth/refresh", json={"refresh_token": other_session["refresh_token"]}
    ).status_code == 401
    assert client.get(
        "/api/auth/me", headers={"Authorization": f"Bearer {rotated['token']}"}
    ).status_code == 401


def test_unknown_refresh_token_is_rejected(client):
    res = client.post("/api/auth/refresh", json={"refresh_token": "kesinlikle-gecersiz"})

    assert res.status_code == 401

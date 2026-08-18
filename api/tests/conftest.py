import os
from pathlib import Path

import pytest

# app.core.config import edilmeden önce çalışmalı — testler her zaman yerel sqlite kullanır.
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///./test.db")
os.environ.setdefault("JWT_SECRET", "test-secret-only-for-pytest-0123456789")
os.environ.setdefault("ENCRYPTION_KEY", "MXi0hAJ8AFH8s4aBvULzzaDJObeUvWudIeX-0dAqKOQ=")
os.environ.setdefault("AUTO_REFRESH_ENABLED", "false")

_DB_FILE = Path(__file__).resolve().parents[1] / "test.db"


@pytest.fixture(scope="session", autouse=True)
def fresh_database():
    """Her test oturumu boş bir sqlite dosyasıyla başlar; tablolar lifespan'de kurulur."""
    _DB_FILE.unlink(missing_ok=True)
    yield
    _DB_FILE.unlink(missing_ok=True)


@pytest.fixture(autouse=True)
def reset_login_rate_limit():
    """Login rate limit'i testler arasında sıfırla — aksi halde 6. login 429 alır."""
    from app.api.auth import _login_attempts

    _login_attempts.clear()
    yield

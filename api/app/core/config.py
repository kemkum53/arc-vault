from pydantic import field_validator
from pydantic_settings import BaseSettings

MIN_JWT_SECRET_LENGTH = 32


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/account_tracker"
    arctracker_base_url: str = "https://arctracker.io"
    # Varsayılanı yok: eksik ya da zayıf bir secret sessizce kabul edilirse tüm
    # oturum güvenliği düşer, bu yüzden açılışta hata vermesi tercih edilir.
    jwt_secret: str
    cors_origins: str = "*"
    encryption_key: str = ""
    auto_refresh_enabled: bool = True
    internal_api_key: str = ""

    @field_validator("jwt_secret")
    @classmethod
    def _reject_weak_jwt_secret(cls, v: str) -> str:
        if len(v) < MIN_JWT_SECRET_LENGTH:
            raise ValueError(
                f"JWT_SECRET en az {MIN_JWT_SECRET_LENGTH} karakter olmalı "
                "(üretmek için: openssl rand -hex 32)"
            )
        return v

    # Alembic için sync URL (asyncpg -> psycopg2)
    @property
    def database_url_sync(self) -> str:
        return self.database_url.replace("+asyncpg", "")

    model_config = {"env_file": [".env", "../.env"], "extra": "ignore"}


settings = Settings()

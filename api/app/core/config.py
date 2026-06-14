from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/account_tracker"
    arctracker_base_url: str = "https://arctracker.io"
    jwt_secret: str = "arc-vault-secret-change-me"
    cors_origins: str = "*"
    encryption_key: str = ""
    auto_refresh_enabled: bool = True
    internal_api_key: str = ""

    # Alembic için sync URL (asyncpg -> psycopg2)
    @property
    def database_url_sync(self) -> str:
        return self.database_url.replace("+asyncpg", "")

    model_config = {"env_file": [".env", "../.env"], "extra": "ignore"}


settings = Settings()

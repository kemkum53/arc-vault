from datetime import datetime, timezone

from pydantic import BaseModel, model_validator


class AccountCreate(BaseModel):
    arctracker_email: str
    arctracker_password: str
    xbox_email: str | None = None
    xbox_password: str | None = None


class AccountUpdate(BaseModel):
    xbox_email: str | None = None
    xbox_password: str | None = None


class PendingTokenAssign(BaseModel):
    account_id: str


class PendingTokenResponse(BaseModel):
    id: str
    embark_user_id: str | None
    sub: str | None
    token_expires_at: datetime | None
    source: str | None
    status: str
    seen_count: int
    first_seen_at: datetime
    last_seen_at: datetime
    resolved_account_id: str | None

    model_config = {"from_attributes": True}


class AccountResponse(BaseModel):
    id: str
    xbox_email: str | None = None
    has_xbox_credentials: bool = False
    display_name: str | None
    display_name_discriminator: str | None
    embark_user_id: str | None
    embark_account_id: str | None
    provider: str | None
    is_linked: bool | None
    is_token_expired: bool | None
    token_expires_at: datetime | None
    embark_linked_at: datetime | None
    credits: int | None
    cred: int | None
    raider_tokens: int | None
    xp: int | None
    used_slots: int | None
    max_slots: int | None
    total_value: int | None
    profile_data: dict | None
    last_sync_at: datetime | None
    sync_status: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}

    @model_validator(mode="before")
    @classmethod
    def compute_has_xbox(cls, data):
        # ORM model → property zaten var, dict ise hesapla
        if isinstance(data, dict):
            xbox_email = data.get("xbox_email")
            xbox_password = data.get("xbox_password")
            data["has_xbox_credentials"] = bool(xbox_email and xbox_password)
        return data

    @model_validator(mode="after")
    def compute_effective_token_expiry(self):
        if self.token_expires_at:
            expires_at = self.token_expires_at
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)
            if expires_at <= datetime.now(timezone.utc):
                self.is_token_expired = True
        return self

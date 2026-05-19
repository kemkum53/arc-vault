from datetime import datetime

from pydantic import BaseModel


class AccountCreate(BaseModel):
    arctracker_email: str
    arctracker_password: str


class AccountResponse(BaseModel):
    id: str
    arctracker_email: str
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
    loadout: dict | None
    profile_data: dict | None
    last_sync_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class TrackerAccount(Base):
    """arctracker.io hesap bilgileri."""

    __tablename__ = "tracker_accounts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    arctracker_email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    arctracker_password: Mapped[str] = mapped_column(Text, nullable=False)

    # Xbox/Microsoft kimlik bilgileri (otomatik token yenileme için)
    xbox_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    xbox_password: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Embark profil (/api/embark/status)
    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    display_name_discriminator: Mapped[str | None] = mapped_column(String(20), nullable=True)
    embark_user_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    embark_account_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    provider: Mapped[str | None] = mapped_column(String(50), nullable=True)
    is_linked: Mapped[bool | None] = mapped_column(nullable=True)
    is_token_expired: Mapped[bool | None] = mapped_column(nullable=True)
    token_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    embark_linked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Ekonomi & ilerleme (/api/embark/inventory/latest → snapshot)
    credits: Mapped[int | None] = mapped_column(nullable=True)
    cred: Mapped[int | None] = mapped_column(nullable=True)
    raider_tokens: Mapped[int | None] = mapped_column(nullable=True)
    xp: Mapped[int | None] = mapped_column(nullable=True)
    used_slots: Mapped[int | None] = mapped_column(nullable=True)
    max_slots: Mapped[int | None] = mapped_column(nullable=True)
    total_value: Mapped[int | None] = mapped_column(nullable=True)
    loadout: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    profile_data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    sync_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    sync_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # arctracker.io bridge JWT (harvester'dan gelen Embark JWT'leri iletmek için)
    arctracker_bridge_jwt: Mapped[str | None] = mapped_column(Text, nullable=True)
    arctracker_bridge_jwt_exp: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    @property
    def has_xbox_credentials(self) -> bool:
        return bool(self.xbox_email and self.xbox_password)

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class PendingEmbarkToken(Base):
    """Harvester'dan gelen ama hesaba eşleşmeyen Embark token."""

    __tablename__ = "pending_embark_tokens"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    embark_user_id: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True)
    sub: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    token_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    encrypted_embark_jwt: Mapped[str] = mapped_column(Text, nullable=False)
    token_payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    source: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    seen_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    resolved_account_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Human-readable identity resolved from Embark (stored in token_payload["resolved"]).
    @property
    def _resolved(self) -> dict:
        payload = self.token_payload if isinstance(self.token_payload, dict) else {}
        resolved = payload.get("resolved")
        return resolved if isinstance(resolved, dict) else {}

    @property
    def display_name(self) -> str | None:
        return self._resolved.get("name")

    @property
    def display_name_discriminator(self) -> str | None:
        return self._resolved.get("discriminator")

    @property
    def gamertag(self) -> str | None:
        return self._resolved.get("gamertag")

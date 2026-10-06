import uuid
from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    username: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="user")
    token_version: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expedition_supply_included: Mapped[str | None] = mapped_column(Text, nullable=True)
    matrix_views: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Non-admin users with a group only see tracker accounts in that group (see core/scope.py).
    account_group: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Last authenticated request: when, from which IP and browser (refreshed at most every 2 min).
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_seen_ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    last_seen_ua: Mapped[str | None] = mapped_column(String(255), nullable=True)

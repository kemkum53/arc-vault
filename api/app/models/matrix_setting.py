from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class MatrixSetting(Base):
    """Shared matrix view layouts: a single row (id=1) that every user reads and edits.

    version goes up on every save so a stale editor cannot silently overwrite
    someone else's newer layout.
    """

    __tablename__ = "matrix_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    views: Mapped[str | None] = mapped_column(Text, nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    updated_by: Mapped[str | None] = mapped_column(String(100), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

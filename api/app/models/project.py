import uuid

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class CharacterProject(Base):
    __tablename__ = "character_projects"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    account_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tracker_accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    embark_project_id: Mapped[str] = mapped_column(String(100), nullable=False)
    project_name: Mapped[str] = mapped_column(String(255), nullable=False)
    phases: Mapped[dict] = mapped_column(JSON, nullable=False)  # tüm phase verisi JSON olarak saklanır

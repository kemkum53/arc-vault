import uuid

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class CharacterQuest(Base):
    __tablename__ = "character_quests"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    account_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tracker_accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    quest_id: Mapped[str] = mapped_column(String(100), nullable=False)

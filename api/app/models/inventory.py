import uuid

from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class InventoryItem(Base):
    __tablename__ = "inventory_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    account_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tracker_accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    item_id: Mapped[str] = mapped_column(String(100), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    tier: Mapped[str | None] = mapped_column(String(10), nullable=True)  # "I", "II", "III", "IV"
    durability: Mapped[int | None] = mapped_column(Integer, nullable=True)  # Math.round(durabilityPercent)

    mods: Mapped[list["InventoryItemMod"]] = relationship(back_populates="inventory_item", cascade="all, delete-orphan")


class InventoryItemMod(Base):
    __tablename__ = "inventory_item_mods"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    inventory_item_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("inventory_items.id", ondelete="CASCADE"), nullable=False, index=True
    )
    slot_type: Mapped[str] = mapped_column(String(50), nullable=False)  # "Muzzle", "Magazine", "Stock" vb.
    mod_id: Mapped[str] = mapped_column(String(100), nullable=False)

    inventory_item: Mapped["InventoryItem"] = relationship(back_populates="mods")

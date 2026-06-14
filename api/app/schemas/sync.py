from pydantic import BaseModel


class SyncRequest(BaseModel):
    """Manuel sync tetiklemek için opsiyonel parametreler."""
    force: bool = False  # True ise last_sync_at'e bakmadan sync yapar


class SyncResponse(BaseModel):
    ok: bool
    synced_items: int = 0
    synced_blueprints: int = 0
    synced_quests: int = 0
    synced_hideout: int = 0
    synced_projects: int = 0
    unmapped_count: int = 0
    credits: int | None = None
    source: str = "arctracker"
    message: str | None = None


class InventoryItemResponse(BaseModel):
    id: str
    item_id: str
    quantity: int
    tier: str | None
    durability: int | None
    mods: list["InventoryItemModResponse"]

    model_config = {"from_attributes": True}


class InventoryItemModResponse(BaseModel):
    slot_type: str
    mod_id: str

    model_config = {"from_attributes": True}


class BlueprintResponse(BaseModel):
    blueprint_id: str
    learned: bool = True
    name_tr: str | None = None
    name_en: str | None = None
    rarity: str | None = None
    image: str | None = None

    model_config = {"from_attributes": True}


class QuestResponse(BaseModel):
    quest_id: str

    model_config = {"from_attributes": True}


class HideoutModuleResponse(BaseModel):
    module_id: str
    level: int

    model_config = {"from_attributes": True}


class ProjectResponse(BaseModel):
    embark_project_id: str
    project_name: str
    phases: dict | list

    model_config = {"from_attributes": True}


class FullSyncDataResponse(BaseModel):
    """Tüm sync edilmiş verileri tek seferde döner."""
    credits: int | None
    last_sync_at: str | None
    inventory: list[InventoryItemResponse]
    blueprints: list[BlueprintResponse]
    quests: list[QuestResponse]
    hideout: list[HideoutModuleResponse]
    projects: list[ProjectResponse]
    loadout: dict | None = None

"""arctracker slug'larını iç item/mod ID'lerine çeviren yardımcı modül.

NOT: arcNameLookup ve modSlugToId / modIdToSlot map'leri oyun verisine göre
doldurulmalıdır. Şimdilik boş dict ile başlatılmıştır — oyun verisi eklendikçe
burası güncellenecek.
"""

import re
import logging

logger = logging.getLogger(__name__)

# ----- Item slug → itemId eşleme tablosu -----
# Anahtar: normalize edilmiş slug, Değer: iç itemId
# Örnek: {"ak74": "w-ak74", "medkit": "med-kit-basic"}
arc_name_lookup: dict[str, str] = {}

# ----- Mod slug → modId eşleme -----
mod_slug_to_id: dict[str, str] = {}

# ----- modId → slot type -----
mod_id_to_slot: dict[str, str] = {}

# Tier suffix regex
_TIER_PATTERN = re.compile(r"_(iv|iii|ii|i)$")
_TIER_MAP = {"i": "I", "ii": "II", "iii": "III", "iv": "IV"}


def normalize(name: str) -> str:
    """Küçük harf, noktalama kaldır, boşluk → alt çizgi."""
    name = name.lower().strip()
    name = re.sub(r"[^\w\s]", "", name)
    name = re.sub(r"\s+", "_", name)
    return name


def parse_tier(slug: str) -> tuple[str, str | None]:
    """Slug'dan tier suffix'ini ayrıştırır. (base_slug, tier) döner."""
    m = _TIER_PATTERN.search(slug)
    if m:
        tier = _TIER_MAP[m.group(1)]
        base = slug[: m.start()]
        return base, tier
    return slug, None


def resolve_item(slug: str) -> tuple[str, str | None]:
    """arctracker slug → (itemId, tier). Mapping yoksa slug'ın kendisini döner."""
    normalized = normalize(slug)
    base, tier = parse_tier(normalized)

    # Lookup map'te ara (3 varyasyon)
    variants = [
        base,
        re.sub(r"_(\d)", r"\1", base),  # rakam öncesi alt çizgi kaldır
        base.replace("_", ""),           # tüm alt çizgiler kaldır
    ]

    for v in variants:
        if v in arc_name_lookup:
            return arc_name_lookup[v], tier

    # Mapping bulunamazsa raw slug'ı direkt kullan
    return base, tier


def resolve_mod(slug: str) -> tuple[str, str]:
    """arctracker mod slug → (modId, slotType). Mapping yoksa slug ve 'Unknown' döner."""
    normalized = normalize(slug)
    mod_id = mod_slug_to_id.get(normalized, normalized)
    slot = mod_id_to_slot.get(mod_id, "Unknown")
    return mod_id, slot

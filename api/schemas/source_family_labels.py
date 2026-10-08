"""Plain staff words for the closed source-family list (owner ruling 10-08: "Source-family names: a small SERVER
word list next to the closed family list (source_family_label); never show keys.").

The closed list is Go's `aidSourceFamilies` (pocketbase/sync/aid_sources_config.go), mirrored by
`ClassifiedSourceFamily` in financial_aid.py, plus the transform-only "unclassified". A test pins the Python list to
the Go one, so a new family fails until it gets a word here. The words are generic category names, never a funder or
program name.

Every RESPONSE model that sends `source_family` inherits `SourceFamilyLabelled`, which fills `source_family_label`
from it, so no builder can forget the label. Request bodies do not inherit it.
"""

from __future__ import annotations

from typing import Final, Self

from pydantic import BaseModel, model_validator

SOURCE_FAMILY_LABELS: Final[dict[str, str]] = {
    "camp_fa": "Camp financial aid",
    "one_happy_camper": "First-time camper incentive",
    "synagogue_federation": "Congregation grants",
    "new_israeli": "Newcomer family grants",
    "pj": "Reading-program incentive",
    "jfcs": "Family services agency grants",
    "jfam_incentive": "Family incentive grants",
    "named_fund": "Named funds",
    "other_outside": "Other outside grants",
    "application_marker": "Application marker (no money)",
    "placeholder": "Placeholder",
    "unclassified": "Not yet classified",
}


def source_family_label(key: str) -> str:
    """The staff words for a family key; "" for an unknown or blank key, never the key itself."""
    return SOURCE_FAMILY_LABELS.get(key, "")


class SourceFamilyLabelled(BaseModel):
    """A response model that sends `source_family` also sends its words, default-valued so it is never required."""

    source_family: str
    source_family_label: str = ""

    @model_validator(mode="after")
    def _label_the_family(self) -> Self:
        if not self.source_family_label:
            self.source_family_label = source_family_label(self.source_family)
        return self

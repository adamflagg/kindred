"""Program-family labels for the Camperships screens: the season's rules name every program (programs.<key>.label),
and a posting's program family is that same key. Screens show the label, never the key spelled out. Reads that
carry no rules get the fixed words for the families the rules never name (quest, teen, bmitzvah); a bucket nobody
can name (ambiguous, unattributed) gives ""."""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Mapping
from typing import TYPE_CHECKING, Final

if TYPE_CHECKING:
    from bunking.financial_aid.rules.schema import AidRules

ProgramLabelLoader = Callable[[int], Awaitable[Mapping[str, str]]]


# One vocabulary for every Camperships screen (Requests, Ledger, Grants, the Rules Programs card): each program family
# has one fixed word, the summer app's own (At Camp / Quests / Teen Programs), whatever the rules call their program.
# The one exception is bmitzvah: the rules key that program `tbm`, so its word is the rules' (TBM without rules).
# Ambiguous and unattributed buckets stay unnamed.
FAMILY_WORDS: Final[Mapping[str, str]] = {
    "summer": "At Camp",
    "quest": "Quests",
    "teen": "Teen Programs",
    "family_camp": "Family Camp",
    "adult_weekend": "Adult Weekends",
    "family_school": "Family School",
}
RULES_KEY_ALIASES: Final[Mapping[str, str]] = {"bmitzvah": "tbm"}
BMITZVAH_FALLBACK: Final = "TBM"


def program_labels(document: AidRules | None) -> dict[str, str]:
    """family (or rules program key) -> label: the rules' label for each program they name, then every family's
    shared word over it; bmitzvah reads the rules' own label for it (or its `tbm` alias), else TBM."""
    labels = {key: program.label for key, program in document.programs.items()} if document is not None else {}
    labels.update(FAMILY_WORDS)
    if "bmitzvah" not in labels:
        labels["bmitzvah"] = labels.get(RULES_KEY_ALIASES["bmitzvah"], BMITZVAH_FALLBACK)
    return labels

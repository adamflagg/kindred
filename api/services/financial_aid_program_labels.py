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


# The ledger's program families are not all the rules' program keys: the rules key the B*Mitzvah program `tbm` (the
# family is `bmitzvah`), and never name quest or teen. A family the rules name by its own key takes that label; else,
# for bmitzvah, its alias's; else the fixed word here. Ambiguous and unattributed buckets stay unnamed.
RULES_KEY_ALIASES: Final[Mapping[str, str]] = {"bmitzvah": "tbm"}
FALLBACK_LABELS: Final[Mapping[str, str]] = {"quest": "Quest", "teen": "Teen Leadership", "bmitzvah": "B*Mitzvah"}


def program_labels(document: AidRules | None) -> dict[str, str]:
    """program key -> label: the rules' label for each program they name, then each ledger family the rules don't
    name by its own key, from its rules alias or the fixed fallback. With no rules, only the fallbacks."""
    labels = {key: program.label for key, program in document.programs.items()} if document is not None else {}
    for family, fallback in FALLBACK_LABELS.items():
        if family not in labels:
            labels[family] = labels.get(RULES_KEY_ALIASES.get(family, ""), fallback)
    return labels

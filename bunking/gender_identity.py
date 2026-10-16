"""The gender identity label every report counts under: Camperships' development report and Analytics (#2898).

Epic #3207 decision 38: gender in reporting is CampMinder's Gender Identity, not the binary Gender field. Cabins,
capacity, bunk gender and the solver stay on the binary field and never read this module. A write-in is
"self-described" and a blank is "not given" (Camperships' D94, decision 38b).

Both surfaces call `gender_label`, so they never report different splits for the same campers who answered. The one
difference is ruled: owner ruling 58 (b) has Analytics count a camper with no identity answer by the binary field,
which Analytics turns on by passing `binary_fallback`. Camperships never passes it, so its output is unchanged.
"""

from __future__ import annotations

from typing import Final

SELF_DESCRIBED: Final = "self-described"
NOT_GIVEN: Final = "not given"
PREFER_NOT_TO_ANSWER: Final = "Prefer not to answer"

# The order a gender split is listed in: CampMinder's identity options, most common first, then the non-answers.
# A label CampMinder adds later lists after the known identities (alphabetically) and before the non-answers.
IDENTITY_ORDER: Final[tuple[str, ...]] = (
    "Girl/woman",
    "Boy/man",
    "Non-binary",
    "Transgender girl/woman",
    "Transgender boy/man",
    "Agender",
    "Not listed above",
    SELF_DESCRIBED,
    PREFER_NOT_TO_ANSWER,
    NOT_GIVEN,
)
_RANK: Final = {label: i for i, label in enumerate(IDENTITY_ORDER)}
_UNLISTED_RANK: Final = _RANK[SELF_DESCRIBED] - 0.5

# Ruling 58: the identity label a blank answer counts under, read from the binary Gender field (F / M / Other). Other
# (CampMinder's "undefined") has nothing to fall back to and stays "not given".
BINARY_FALLBACK: Final = {"F": "Girl/woman", "M": "Boy/man"}


def gender_label(name: str, write_in: str, *, binary_fallback: str | None = None) -> str:
    """A write-in is "self-described"; otherwise CampMinder's own label. A blank is "not given", unless the caller
    passes the binary field as `binary_fallback` (Analytics, ruling 58): then F or M counts by BINARY_FALLBACK."""
    if write_in.strip():
        return SELF_DESCRIBED
    if name.strip():
        return name.strip()
    if binary_fallback is not None:
        return BINARY_FALLBACK.get(binary_fallback.strip(), NOT_GIVEN)
    return NOT_GIVEN


def has_identity_answer(name: str, write_in: str) -> bool:
    """Whether the camper answered CampMinder's Gender Identity question (a label or a write-in)."""
    return bool(name.strip() or write_in.strip())


def identity_sort_key(label: str) -> tuple[float, str]:
    """Sort key for a list of gender identity labels (IDENTITY_ORDER)."""
    return (_RANK.get(label, _UNLISTED_RANK), label.casefold())


# Owner answer #75 (a): a chart with little room (stacked bars, Trends and Velocity lines, the Trends table) folds every
# label into five fixed groups, in this order. Donuts, comparison tables, Retention, the drill-down and the CSV list
# every label. Transgender campers sit under Another identity (flagged to the owner, who did not object). A label
# CampMinder adds later is an identity someone gave, so it is Another identity, never No answer.
ANOTHER_IDENTITY: Final = "Another identity"
NO_ANSWER: Final = "No answer"
IDENTITY_GROUPS: Final[tuple[str, ...]] = ("Girl/woman", "Boy/man", "Non-binary", ANOTHER_IDENTITY, NO_ANSWER)
_OWN_GROUP: Final = frozenset(IDENTITY_GROUPS[:3])
_NO_ANSWER_LABELS: Final = frozenset({PREFER_NOT_TO_ANSWER, NOT_GIVEN})


def identity_group(label: str) -> str:
    """The one of IDENTITY_GROUPS a gender identity label folds into (#75 a)."""
    if label in _OWN_GROUP:
        return label
    if label in _NO_ANSWER_LABELS:
        return NO_ANSWER
    return ANOTHER_IDENTITY

"""FA program answer -> CampMinder session (campership sub-project 5, spec 9.1).

The FA form's option text is not the camp_sessions name for 22 of 43 options
(sheet levers catalogue 2.5): punctuation variants, a dropped possessive
prefix, a dropped "(w/ kids ...)" suffix, and options that combine or rename
sessions. The sheet's exact-text join sent two rows to "No Session Match" and
priced them at $0. Here, the first tier that yields any candidate decides:

  1. alias    -- a staff-entered aid_session_aliases row for this option.
  2. exact    -- normalised option text == normalised session name.
  3. contains -- the option text appears inside the session name on word
                 boundaries ("Family Camp 3: X" inside "Family Camp 3: X (w/ ...)").
                 "Session 2" is never inside "Session 2a".

One candidate resolves. Several are narrowed to the ones this camper or family
is registered in. If that leaves exactly one, it resolves by "enrollment".
Otherwise the request is UNMATCHED and lists its candidates. There is never a
first-match or a default.

Only sessions of the request's own program family are candidates, so a summer
answer can never land on a family-camp weekend.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Mapping, Sequence
from types import MappingProxyType
from typing import Final

from api.services.financial_aid_intake_types import (
    PROGRAM_ADULT_WEEKEND,
    PROGRAM_BMITZVAH,
    PROGRAM_FAMILY_CAMP,
    PROGRAM_SUMMER,
    RESOLUTION_UNMATCHED,
    AliasRow,
    SessionResolution,
    SessionRow,
)
from api.utils.session_metrics import SUMMER_PROGRAM_SESSION_TYPES, SUMMER_TEEN_TYPES

PROGRAM_SESSION_TYPES: Final[Mapping[str, frozenset[str]]] = MappingProxyType(
    {
        PROGRAM_SUMMER: frozenset({*SUMMER_PROGRAM_SESSION_TYPES, *SUMMER_TEEN_TYPES, "teen"}),
        PROGRAM_FAMILY_CAMP: frozenset({"family"}),
        PROGRAM_BMITZVAH: frozenset({"bmitzvah"}),
        PROGRAM_ADULT_WEEKEND: frozenset({"adult"}),
    }
)

_QUOTES: Final = str.maketrans({"‘": "'", "’": "'", "`": "'", "´": "'", "“": '"', "”": '"'})
_SPACES: Final = re.compile(r"\s+")


def normalize_option_text(text: str) -> str:
    folded = unicodedata.normalize("NFKC", text).translate(_QUOTES).casefold()
    return _SPACES.sub(" ", folded).strip()


def _contains(haystack: str, needle: str) -> bool:
    return re.search(rf"(?<!\w){re.escape(needle)}(?!\w)", haystack) is not None


def _decide(method: str, candidates: tuple[int, ...], registered: frozenset[int]) -> SessionResolution:
    if len(candidates) == 1:
        return SessionResolution(candidates[0], method, candidates)
    narrowed = tuple(c for c in candidates if c in registered)
    if len(narrowed) == 1:
        return SessionResolution(narrowed[0], "enrollment", candidates)
    return SessionResolution(0, RESOLUTION_UNMATCHED, candidates)


def resolve_session(
    option_text: str,
    program_key: str,
    sessions: Sequence[SessionRow],
    aliases: Sequence[AliasRow],
    registered_session_ids: frozenset[int],
) -> SessionResolution:
    key = normalize_option_text(option_text)
    if not key:
        return SessionResolution(0, RESOLUTION_UNMATCHED, ())
    in_scope = [s for s in sessions if s.session_type in PROGRAM_SESSION_TYPES[program_key]]
    scope_ids = {s.cm_id for s in in_scope}
    names = {s.cm_id: normalize_option_text(s.name) for s in in_scope}
    tiers = (
        ("alias", {a.session_cm_id for a in aliases if a.program_key == program_key and a.option_key == key}),
        ("exact", {cm_id for cm_id, name in names.items() if name == key}),
        ("contains", {cm_id for cm_id, name in names.items() if _contains(name, key)}),
    )
    for method, found in tiers:
        candidates = tuple(sorted(found & scope_ids))
        if candidates:
            return _decide(method, candidates, registered_session_ids)
    return SessionResolution(0, RESOLUTION_UNMATCHED, ())


def resolve_adult_session(sessions: Sequence[SessionRow], registered_session_ids: frozenset[int]) -> SessionResolution:
    """WW-FA names no weekend, so the adult's own registration is the only source."""
    adult_types = PROGRAM_SESSION_TYPES[PROGRAM_ADULT_WEEKEND]
    candidates = tuple(
        sorted(s.cm_id for s in sessions if s.session_type in adult_types and s.cm_id in registered_session_ids)
    )
    if len(candidates) == 1:
        return SessionResolution(candidates[0], "enrollment", candidates)
    return SessionResolution(0, RESOLUTION_UNMATCHED, candidates)

"""FA program answer -> CampMinder session (campership sub-project 5, spec 9.1).

REGISTRATION FIRST (owner ruling 2026-09-27). The program question the family
answered (summer, family camp or B*Mitzvah) only says WHICH PROGRAM. The
camper's (or, for family camp, the household's) registration decides the
session, and only an ENROLLED registration (status_id 2) counts: waitlisted,
applied, cancelled and the rest never set one. The form's options are
hand-maintained labels ("Taste of Camp" covers two sessions, one in-training
option covers two), so their text is not trusted to name a session.

Among the enrolled sessions of the answer's program:

  * exactly one  -> it resolves, method "enrollment";
  * two or more  -> the option text breaks the tie among THOSE sessions only:
                    the exact tier (normalised text == normalised name), else
                    the contains tier (the text inside the name on word
                    boundaries; "Session 2" is never inside "Session 2a").
                    Exactly one hit resolves, method "enrollment_text";
                    otherwise UNMATCHED, listing the enrolled sessions;
  * none         -> UNMATCHED with no candidates.

There is never a first-match or a default, and only sessions of the answer's
own program are candidates, so a summer answer can never land on a
family-camp weekend. `session_named_by` reports the one session the text
names on its own, so staff see when registration and answer differ.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Mapping, Sequence
from types import MappingProxyType
from typing import Final

from api.services.financial_aid_intake_types import (
    OPTION_TEXT_MAX_LENGTH,
    PROGRAM_ADULT_WEEKEND,
    PROGRAM_BMITZVAH,
    PROGRAM_FAMILY_CAMP,
    PROGRAM_SUMMER,
    RESOLUTION_UNMATCHED,
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
    """The option's key: typographic variants folded. Clipped to the length
    aid_requests.program_option_key holds, since NFKC can lengthen text that was
    clipped to that length already."""
    folded = unicodedata.normalize("NFKC", text).translate(_QUOTES).casefold()
    return _SPACES.sub(" ", folded).strip()[:OPTION_TEXT_MAX_LENGTH]


def _contains(haystack: str, needle: str) -> bool:
    return re.search(rf"(?<!\w){re.escape(needle)}(?!\w)", haystack) is not None


def _in_program(program_key: str, sessions: Sequence[SessionRow]) -> list[SessionRow]:
    return [s for s in sessions if s.session_type in PROGRAM_SESSION_TYPES[program_key]]


def _named(option_text: str, sessions: Sequence[SessionRow]) -> tuple[int, ...]:
    """The sessions the option text names: the exact tier, else the contains tier."""
    key = normalize_option_text(option_text)
    if not key:
        return ()
    names = {s.cm_id: normalize_option_text(s.name) for s in sessions}
    for found in (
        {cm_id for cm_id, name in names.items() if name == key},
        {cm_id for cm_id, name in names.items() if _contains(name, key)},
    ):
        if found:
            return tuple(sorted(found))
    return ()


def session_named_by(option_text: str, program_key: str, sessions: Sequence[SessionRow]) -> int:
    """The one in-program session the option text names on its own, or 0 when it names
    none or several. Information only: registration decides the session."""
    named = _named(option_text, _in_program(program_key, sessions))
    return named[0] if len(named) == 1 else 0


def resolve_session(
    option_text: str,
    program_key: str,
    sessions: Sequence[SessionRow],
    enrolled_session_ids: frozenset[int],
) -> SessionResolution:
    in_program = [s for s in _in_program(program_key, sessions) if s.cm_id in enrolled_session_ids]
    candidates = tuple(sorted(s.cm_id for s in in_program))
    if len(candidates) == 1:
        return SessionResolution(candidates[0], "enrollment", candidates)
    named = _named(option_text, in_program)
    if len(named) == 1:
        return SessionResolution(named[0], "enrollment_text", candidates)
    return SessionResolution(0, RESOLUTION_UNMATCHED, candidates)


def resolve_adult_session(sessions: Sequence[SessionRow], enrolled_session_ids: frozenset[int]) -> SessionResolution:
    """WW-FA names no weekend, so the adult's own ENROLLED weekend is the only source. The
    builder still creates the request for an adult who is only waitlisted or applied; it
    stays unmatched until they enroll."""
    candidates = tuple(
        sorted(s.cm_id for s in _in_program(PROGRAM_ADULT_WEEKEND, sessions) if s.cm_id in enrolled_session_ids)
    )
    if len(candidates) == 1:
        return SessionResolution(candidates[0], "enrollment", candidates)
    return SessionResolution(0, RESOLUTION_UNMATCHED, candidates)

"""Stale dated-note detection (#1801).

Staff-note fields (bunking_notes / internal_notes) are cumulative history —
entries accumulate across seasons and carry dates in one of two forms:

- CampMinder-appended entry datestamp: ``AUTHOR (Jul  4 2025  1:58PM)``
- Manual year-prefix convention: ``2019 - Bunk with younger kids next yr``

An entry whose newest detectable year is ``STALE_NOTE_YEARS``+ before the
current season is a historical record, not current intent. The disposition
layer auto-declines such requests (reason ``stale_dated_note``) instead of
skipping them at parse: the request stays visible in request management,
where staff flip it back to resolved in one click if the old note still
matters. This deliberately does NOT touch ``SOURCE_FIELD_PRIORITY`` —
current-season staff observations still outrank the socialize_with dropdown;
the year signal, not the ranking, was the problem.

When both conventions appear, the newest year wins: a re-entered/confirmed
old note ("2019 - ... re-confirmed (May 22 2026)") is current intent.
"""

import re

from ..shared.constants import NOTES_FIELDS

# "3+ years prior to the current season" — season 2026 declines <= 2023.
STALE_NOTE_YEARS = 3

# CampMinder entry datestamp suffix, e.g. "(Jul  4 2025  1:58PM)".
# Month is an alpha token so bare parenthesised numbers never match.
_CM_DATESTAMP_RE = re.compile(r"\(\s*[A-Z][a-z]{2,8}\s+\d{1,2}\s+((?:19|20)\d{2})\s+\d{1,2}:\d{2}\s*[AP]M\s*\)")

# Manual year prefix at the very start of the entry: "2019 - ..." / "2021: ...".
# Anchored so years in prose ("class of 2019") never match.
_YEAR_PREFIX_RE = re.compile(r"^\s*((?:19|20)\d{2})\s*[-–:]")


def newest_note_year(text: str) -> int | None:
    """Return the newest year detectable in *text*, or None when undated."""
    years = [int(y) for y in _CM_DATESTAMP_RE.findall(text or "")]
    prefix_match = _YEAR_PREFIX_RE.match(text or "")
    if prefix_match:
        years.append(int(prefix_match.group(1)))
    return max(years) if years else None


def is_stale_dated_note(source_field: str, raw_text: str, season_year: int) -> bool:
    """True when a staff-note entry's newest detectable year is 3+ years old.

    Structured fields (form, dropdown, admin UI) are current-season by
    construction and never stale; undated note entries parse normally.
    """
    if source_field not in NOTES_FIELDS:
        return False
    year = newest_note_year(raw_text)
    return year is not None and year <= season_year - STALE_NOTE_YEARS

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

Datestamp caveat: for bunking_notes the orchestrator strips ``STAFFNAME
(DATETIME)`` signatures via ``parse_multi_staff_notes()`` BEFORE parsing and
joins entries with ``" | "`` — the signatures survive only as authorship
timestamps in ``staff_metadata``. Staleness therefore reads BOTH the text
(entry-split year prefixes, plus any datestamps the stripper missed) and the
``staff_metadata`` timestamps.
"""

import re
from typing import Any

from ..shared.constants import NOTES_FIELDS

# "3+ years prior to the current season" — season 2026 declines <= 2023.
STALE_NOTE_YEARS = 3

# CampMinder entry datestamp suffix, e.g. "(Jul  4 2025  1:58PM)".
# Month is an alpha token so bare parenthesised numbers never match.
_CM_DATESTAMP_RE = re.compile(r"\(\s*[A-Z][a-z]{2,8}\s+\d{1,2}\s+((?:19|20)\d{2})\s+\d{1,2}:\d{2}\s*[AP]M\s*\)")

# Manual year prefix at the start of an entry: "2019 - ..." / "2021: ...".
# Anchored per entry so years in prose ("class of 2019") never match.
_YEAR_PREFIX_RE = re.compile(r"^\s*((?:19|20)\d{2})\s*[-–:]")

# Entry boundaries: raw newlines (internal_notes) or the " | " separator the
# orchestrator uses when re-joining stripped bunking_notes entries.
_ENTRY_SPLIT_RE = re.compile(r"\n|\s\|\s")

# Year inside a staff_metadata authorship timestamp, e.g. "May 22 2026  4:04PM".
_TIMESTAMP_YEAR_RE = re.compile(r"\b((?:19|20)\d{2})\b")


def newest_note_year(text: str) -> int | None:
    """Return the newest year detectable in *text*, or None when undated."""
    text = text or ""
    years = [int(y) for y in _CM_DATESTAMP_RE.findall(text)]
    for entry in _ENTRY_SPLIT_RE.split(text):
        prefix_match = _YEAR_PREFIX_RE.match(entry)
        if prefix_match:
            years.append(int(prefix_match.group(1)))
    return max(years) if years else None


def _staff_timestamp_years(staff_metadata: dict[str, Any] | None) -> list[int]:
    """Years from authorship timestamps the orchestrator stripped into metadata."""
    if not staff_metadata:
        return []
    timestamps = [entry.get("timestamp") for entry in staff_metadata.get("all_staff", [])]
    if not timestamps and staff_metadata.get("timestamp"):
        timestamps = [staff_metadata["timestamp"]]
    years: list[int] = []
    for ts in timestamps:
        if ts:
            years.extend(int(y) for y in _TIMESTAMP_YEAR_RE.findall(str(ts)))
    return years


def is_stale_dated_note(
    source_field: str,
    raw_text: str,
    season_year: int,
    staff_metadata: dict[str, Any] | None = None,
) -> bool:
    """True when a staff-note entry's newest detectable year is 3+ years old.

    Structured fields (form, dropdown, admin UI) are current-season by
    construction and never stale; undated note entries parse normally.
    ``staff_metadata`` carries the authorship timestamps stripped from
    bunking_notes signatures upstream — the newest year across text and
    timestamps wins.
    """
    if source_field not in NOTES_FIELDS:
        return False
    years = _staff_timestamp_years(staff_metadata)
    text_year = newest_note_year(raw_text)
    if text_year is not None:
        years.append(text_year)
    if not years:
        return False
    return max(years) <= season_year - STALE_NOTE_YEARS

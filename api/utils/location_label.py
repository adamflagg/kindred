"""Shared helper for a person's display-ready city/state label (kindred#2755).

Mirrors Go's `PersonLocation` / `PersonLocationCityOnly`
(`pocketbase/sync/location_label.go`) and the frontend's `personLocation`
(`frontend/src/utils/addressUtils.ts`): one place owns the rule so a caller
can't reintroduce the "San Carlos, CA, CA" bug (kindred#2753) by composing
`address_city` + `address_state` on top of an already-complete
`normalized_city`.

The rule:

1. `normalized_city`, when non-blank, IS the whole label (set by
   `normalize_geographic.go` as a complete "City, ST" string).
2. Otherwise compose `address_city` + `address_state`, omitting either side
   that is blank.
3. A caller wanting the city without the state calls `person_city_only`,
   not its own regex.

This module is deliberately NOT the place that decides which raw columns to
read for metrics group-by/filter keys -- those stay on `normalized_city` /
`address_city` directly (see `api/services/extractors.py`'s `extract_city`
and `api/services/registration_service.py`'s city breakdown), per the
kindred#2755 owner ruling that no staff-facing number moves.
"""

import re
from typing import Any

# Matches the trailing ", CA" that normalized_city carries (see
# pocketbase/sync/normalize_geographic.go). Two uppercase letters only:
# "Washington, District" is a city, not a state suffix.
_STATE_SUFFIX_RE = re.compile(r",\s*[A-Z]{2}$")
# The same suffix, capturing both halves, for a caller that needs them apart.
_STATE_SPLIT_RE = re.compile(r"^(?P<city>.*?),\s*(?P<state>[A-Z]{2})$")


def _str_attr(person: Any, attr: str) -> str:
    """Read a string attribute, treating anything not a real string as blank.

    `getattr(mock, attr, None)` never falls through to the default on a
    `Mock`/`MagicMock` -- it auto-vivifies a truthy child mock for any
    attribute name -- so a caller that only checks truthiness mistakes an
    untouched test double for real data. Mirrors
    `api.services.drilldown_service._get_str_attr`.
    """
    val = getattr(person, attr, None)
    return val.strip() if isinstance(val, str) else ""


def _join_city_state(city: str | None, state: str | None) -> str | None:
    """Join raw city/state into "City, ST", omitting whichever side is blank."""
    trimmed_city = (city or "").strip()
    trimmed_state = (state or "").strip()
    if trimmed_city and trimmed_state:
        return f"{trimmed_city}, {trimmed_state}"
    return trimmed_city or trimmed_state or None


def person_location(person: Any) -> str | None:
    """A person's display-ready "City, ST" label, or None if there is none.

    `normalized_city`, when non-blank, is returned verbatim -- it already IS
    the whole label. Otherwise composes `address_city` + `address_state`.
    """
    normalized = _str_attr(person, "normalized_city")
    if normalized:
        return normalized
    return _join_city_state(_str_attr(person, "address_city"), _str_attr(person, "address_state"))


def person_city_state_for_display(person: Any) -> tuple[str | None, str | None]:
    """(city, state) for a caller with SEPARATE city/state fields, e.g.
    `api.schemas.metrics.DrilldownAttendee`.

    When `normalized_city` is used it is SPLIT at its ", ST" suffix: the city
    part goes in `city` and the suffix in `state`, so a caller that renders
    f"{city}, {state}" (frontend/src/components/metrics/DrillDownModal.tsx)
    reproduces the label without doubling it, while that modal's CSV/XLSX
    export still gets a populated State column. The state comes from the
    label, not `address_state` -- the label is the whole location (rule 1).
    A `normalized_city` with no ", ST" suffix is all city, with state None.
    Only the raw-column fallback reads `address_state`.
    """
    normalized = _str_attr(person, "normalized_city")
    if normalized:
        match = _STATE_SPLIT_RE.match(normalized)
        if match:
            return match.group("city").strip() or None, match.group("state")
        return normalized, None
    return _str_attr(person, "address_city") or None, _str_attr(person, "address_state") or None


def person_city_only(person: Any) -> str | None:
    """A person's city with no state suffix -- for a caller that wants the
    city alone (e.g. the bunk-request school-disambiguation strategy, which
    compares city and state independently and must not have one side skewed
    by the other). Prefers `normalized_city` (also fixing casing, e.g.
    "berkeley" -> "Berkeley"), falls back to raw `address_city`, and strips a
    trailing ", ST" rather than composing with `address_state` at all.
    """
    value = _str_attr(person, "normalized_city")
    if not value:
        value = _str_attr(person, "address_city")
    return _STATE_SUFFIX_RE.sub("", value).strip() or None

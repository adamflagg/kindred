"""Adult-weekend cabin attribution — the adult camper journey's one rule.

Spec: docs/superpowers/specs/2026-09-22-adult-camper-journey-design.md §4.2
(local, gitignored).

Adult weekends (Women's, Men's, Divorce & Discovery, Adults Unplugged, ...) keep
their cabin in a PERSON custom field that holds ONE value per person per SEASON
and has no session dimension. Verified live against CampMinder 2026-09-16: no
adult weekend has a bunk plan, a bunk, or a housing field in any season, and our
sync filters nothing. So a cabin must be ATTRIBUTED to a weekend, and in 2022-23
it is spread across two fields that belong to two different weekends.

The rule generalizes the Go ingest's `AttributeSession` best guess
(`pocketbase/sync/lodging_session_attribution.go`: "staff edit the value shortly
before the weekend it applies to") from an advisory suggestion into an
assignment. That is safe here and nowhere else: the journey shows only PRIOR
years, which no board ever covered, so there is no board answer to disagree with
(#2393), and every case the rule decides was measured on the prod snapshot.

Pure -- no database, no I/O. `person_housing_service` does the reads.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from api.services.lodging_rules import housing_lookup_key

# ⛔ THE ALLOWLIST (spec §4.1): `Adult Weekend Program Cabin` (2022-23) and
# `Reportable Family Camp Cabin` (2022+). The best-covered fields on the adult
# cohort are Race, Folks of Color, Judaism, Congregation, financial aid and the
# `20XX History` staff records -- which embed SALARY. A read that is not pinned
# to exactly these two ids is how any of them would reach the wire.
ADULT_WEEKEND_CABIN_FIELD_CM_IDS: tuple[int, ...] = (212997, 223823)

# A value with no readable timestamp sorts as the earliest possible write: it
# can still be the only answer, but it never beats a dated one.
_UNDATED = datetime.min.replace(tzinfo=UTC)

ResolveCodes = Callable[[str, int], tuple[str, ...]]


@dataclass(frozen=True, slots=True)
class CabinValue:
    """One person's cabin string for one season, from one allowlisted field."""

    year: int
    field_cm_id: int
    raw: str
    written_at: datetime | None


@dataclass(frozen=True, slots=True)
class AdultWeekend:
    """One enrolled adult weekend. `last_day_ends` is when its last day is over."""

    year: int
    session_cm_id: int
    last_day_ends: datetime


@dataclass(frozen=True, slots=True)
class AttributedCabin:
    """A weekend and its cabin, named as recorded that year."""

    year: int
    session_cm_id: int
    cabin_name: str
    cabin_name_raw: str


def parse_instant(value: str) -> datetime | None:
    """CampMinder `last_updated` (up to 7 fractional digits) or a PocketBase
    date, as an aware UTC instant. Blank or unreadable is None -- unknown,
    never an error."""
    text = value.strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=UTC)


def weekend_last_day_ends(end_date: str) -> datetime | None:
    """`camp_sessions.end_date` is stored as midnight Pacific of the LAST day
    (`2025-10-19 07:00:00.000Z`), so the weekend is over 24 hours after it."""
    start_of_last_day = parse_instant(end_date)
    return None if start_of_last_day is None else start_of_last_day + timedelta(days=1)


def attribute_adult_cabins(
    values: Iterable[CabinValue],
    weekends: Iterable[AdultWeekend],
    resolve_codes: ResolveCodes,
) -> list[AttributedCabin]:
    """Pin each season's cabin value(s) to the person's enrolled adult weekends.

    Spec §4.2, in order: ASSIGN each value to a weekend first, THEN collapse
    values naming one place WITHIN each weekend's own pool. With ONE weekend,
    every value is assigned to it and the latest one written before it ended
    wins (a lone late edit still counts); with TWO OR MORE, each value belongs
    to the first weekend that had not yet ended when it was written (after
    every weekend -> the last one). Only then does a weekend's pool collapse
    same-place values down to their latest write and hand over its winner; a
    same-instant tie between two places is no cabin.

    Collapsing happens PER WEEKEND, AFTER assignment, not once over the whole
    year before assignment: collapsing first would keep only the later of two
    same-place writes and hand that single survivor to whichever weekend it
    landed in, starving the earlier weekend of a value it genuinely had. The
    label is the raw string, outer whitespace trimmed -- never today's name.
    """
    weekends_by_year: dict[int, dict[int, AdultWeekend]] = defaultdict(dict)
    for weekend in weekends:
        weekends_by_year[weekend.year][weekend.session_cm_id] = weekend
    values_by_year: dict[int, list[CabinValue]] = defaultdict(list)
    for value in values:
        if value.raw.strip():
            values_by_year[value.year].append(value)

    out: list[AttributedCabin] = []
    for year in sorted(weekends_by_year):
        year_weekends = sorted(weekends_by_year[year].values(), key=lambda w: w.last_day_ends)
        year_values = values_by_year.get(year, [])
        if not year_values:
            continue
        for weekend, pool in _assign(year_values, year_weekends):
            winner = _latest(_collapse_same_place(pool, year, resolve_codes))
            if winner is not None:
                out.append(
                    AttributedCabin(
                        year=year,
                        session_cm_id=weekend.session_cm_id,
                        cabin_name=winner.raw.strip(),
                        cabin_name_raw=winner.raw,
                    )
                )
    return out


def _written(value: CabinValue) -> datetime:
    return value.written_at or _UNDATED


def _collapse_same_place(values: Sequence[CabinValue], year: int, resolve_codes: ResolveCodes) -> list[CabinValue]:
    """Values naming one place -- same lookup key, or the same resolved unit
    set -- keep only their latest write."""
    latest_by_place: dict[tuple[str, ...], CabinValue] = {}
    for value in values:
        codes = resolve_codes(value.raw, year)
        place = ("unit", *sorted(codes)) if codes else ("text", housing_lookup_key(value.raw))
        held = latest_by_place.get(place)
        if held is None or _written(value) >= _written(held):
            latest_by_place[place] = value
    return list(latest_by_place.values())


def _assign(
    values: Sequence[CabinValue], weekends: Sequence[AdultWeekend]
) -> list[tuple[AdultWeekend, list[CabinValue]]]:
    if len(weekends) == 1:
        (only,) = weekends
        before = [v for v in values if _written(v) < only.last_day_ends]
        # A lone late edit is still the only answer: the Go ingest treats a
        # single weekend as certain.
        return [(only, before or list(values))]
    pools: dict[int, list[CabinValue]] = {w.session_cm_id: [] for w in weekends}
    for value in values:
        target = next((w for w in weekends if _written(value) < w.last_day_ends), weekends[-1])
        pools[target.session_cm_id].append(value)
    return [(w, pools[w.session_cm_id]) for w in weekends]


def _latest(pool: Sequence[CabinValue]) -> CabinValue | None:
    """The most recent write, or None when empty or when two places tie."""
    if not pool:
        return None
    ordered = sorted(pool, key=_written)
    if len(ordered) >= 2 and _written(ordered[-1]) == _written(ordered[-2]):
        return None
    return ordered[-1]

"""Adult-weekend cabin attribution — the adult camper journey's one rule.

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

FROM 2026 THE RULE IS THE FALLBACK (kindred#2775). The Go ingest now writes one
live `lodging_assignments` row per weekend from the captured value history
(#2784) -- the CampMinder layer -- and a person-year whose every enrolled
weekend has one reads those rows instead (`overlay_live_cabins`). A year the
layer does not fully cover keeps this rule, as typed.

Pure -- no database, no I/O. `person_housing_service` (one person, the
journey) and `lodging_roster_service` (a whole weekend's guests at once, the
card's last-year cabin, kindred#2767) do the reads; both convert the rows with
the two `*_from_rows` helpers below, so one row shape means one thing.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable, Collection, Iterable, Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from typing import Any

from api.services.lodging_rules import housing_lookup_key

# ⛔ THE ALLOWLIST: `Adult Weekend Program Cabin` (2022-23) and
# `Reportable Family Camp Cabin` (2022+). The best-covered fields on the adult
# cohort are Race, Folks of Color, Judaism, Congregation, financial aid and the
# `20XX History` staff records -- which embed SALARY. A read that is not pinned
# to exactly these two ids is how any of them would reach the wire.
ADULT_WEEKEND_CABIN_FIELD_CM_IDS: tuple[int, ...] = (212997, 223823)

# kindred#2775, owner ruling 2026-09-23: from this season on, the captured
# value history is the gold standard for housing, applied ONCE in the Go ingest
# (#2784), which writes one live `lodging_assignments` row per weekend -- the
# CampMinder layer. Displays read those rows. Earlier seasons have no history
# and keep their rules unchanged. A constant, never discovered from which rows
# exist: the ingest writes only the active season, and its orphan sweep skips
# every other year, so 2026's rows survive the season flip.
LIVE_HOUSING_FROM_YEAR = 2026

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
    """A weekend and its cabin, per THIS rule alone: `cabin_name` is the raw
    string, outer whitespace trimmed -- `named_adult_cabins` replaces it with
    today's registry name (`display_name`, kindred#2332), or a live row's name,
    before either caller publishes it, so the rule's own value is never the
    published label.
    `cabin_name_raw` is the untouched value."""

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


def _expanded(row: Any, name: str) -> Any:
    expand = getattr(row, "expand", None) or {}
    return expand.get(name) if isinstance(expand, dict) else None


def cabin_values_from_rows(rows: Iterable[Any]) -> list[CabinValue]:
    """`person_custom_values` rows (with `field_definition` expanded) as
    `CabinValue`s, allowlisted fields only."""
    out: list[CabinValue] = []
    for row in rows:
        field_cm_id = int(getattr(_expanded(row, "field_definition"), "cm_id", 0) or 0)
        # Defense in depth: the repository already filters to the allowlist.
        if field_cm_id not in ADULT_WEEKEND_CABIN_FIELD_CM_IDS:
            continue
        out.append(
            CabinValue(
                year=int(getattr(row, "year", 0) or 0),
                field_cm_id=field_cm_id,
                raw=str(getattr(row, "value", "") or ""),
                written_at=parse_instant(str(getattr(row, "last_updated", "") or "")),
            )
        )
    return out


def adult_weekends_from_rows(rows: Iterable[Any]) -> list[AdultWeekend]:
    """Enrolled adult-weekend `attendees` rows (with `session` expanded) as
    `AdultWeekend`s. A row with no readable end date or session id is dropped."""
    out: list[AdultWeekend] = []
    for row in rows:
        session = _expanded(row, "session")
        if session is None:
            continue
        ends = weekend_last_day_ends(str(getattr(session, "end_date", "") or ""))
        session_cm_id = int(getattr(session, "cm_id", 0) or 0)
        if ends is None or session_cm_id <= 0:
            continue
        out.append(
            AdultWeekend(year=int(getattr(row, "year", 0) or 0), session_cm_id=session_cm_id, last_day_ends=ends)
        )
    return out


def pick_year_cabin(
    attributed: Iterable[AttributedCabin],
    weekends: Iterable[AdultWeekend],
    *,
    year: int,
    prefer_session_cm_id: int,
) -> AttributedCabin | None:
    """ONE cabin for one person-season, for a card that has room for one
    (kindred#2767).

    Attribution can pin a cabin to each of a person's weekends that season.
    When there are two, prefer the weekend sharing `prefer_session_cm_id` --
    the board's own program, since CampMinder reuses a program's session id
    every season -- else the one whose last day ends latest. None when the
    person has no attributed cabin that season.
    """
    in_year = [cabin for cabin in attributed if cabin.year == year]
    if not in_year:
        return None
    for cabin in in_year:
        if cabin.session_cm_id == prefer_session_cm_id:
            return cabin
    ends = {w.session_cm_id: w.last_day_ends for w in weekends if w.year == year}
    return max(in_year, key=lambda cabin: ends.get(cabin.session_cm_id, _UNDATED))


def live_names(rows: Iterable[Any], name_units: Callable[[Sequence[str]], str]) -> dict[tuple[int, int], str]:
    """One party's live `lodging_assignments` rows as (year, session_cm_id) ->
    today's name for the units (`HousingNameResolver.display_name_for_unit_ids`
    in production). A row naming nothing maps to "" and counts as missing."""
    out: dict[tuple[int, int], str] = {}
    for row in rows:
        year = int(getattr(row, "year", 0) or 0)
        session_cm_id = int(getattr(row, "session_cm_id", 0) or 0)
        if year <= 0 or session_cm_id <= 0:
            continue
        units = getattr(row, "units", None) or []
        out[(year, session_cm_id)] = name_units([str(u) for u in units]).strip()
    return out


def enrolled_sessions_by_year(rows: Iterable[Any]) -> dict[int, set[int]]:
    """Enrolled attendee rows (with `session` expanded) as year -> session
    cm_ids. Keyed on the weekend's ID alone, never on whether its end date
    parses: the every-weekend coverage test must count an undated enrollment
    (#2789 review), even though the attribution rule cannot place one."""
    out: dict[int, set[int]] = defaultdict(set)
    for row in rows:
        session_cm_id = int(getattr(_expanded(row, "session"), "cm_id", 0) or 0)
        year = int(getattr(row, "year", 0) or 0)
        if session_cm_id > 0 and year > 0:
            out[year].add(session_cm_id)
    return dict(out)


def live_cabins_for_year(
    year: int, enrolled_session_cm_ids: Collection[int], live: Mapping[int, str]
) -> dict[int, str] | None:
    """kindred#2775's reading rule for one party-year.

    `{session_cm_id: name}` for every enrolled weekend when the year reads the
    CampMinder layer: a season from `LIVE_HOUSING_FROM_YEAR` on, where EVERY
    enrolled weekend has a live row that names a unit. Otherwise None, and the
    caller keeps today's one-cabin-for-the-year rule (#2393's ruling) -- never
    a blank, and never a mix of the two within one year.
    """
    if year < LIVE_HOUSING_FROM_YEAR or not enrolled_session_cm_ids:
        return None
    if any(not live.get(session_cm_id) for session_cm_id in enrolled_session_cm_ids):
        return None
    return {session_cm_id: live[session_cm_id] for session_cm_id in enrolled_session_cm_ids}


def overlay_live_cabins(
    named: Iterable[AttributedCabin],
    weekends: Iterable[AdultWeekend],
    live: Mapping[tuple[int, int], str],
    enrolled: Mapping[int, Collection[int]] | None = None,
) -> list[AttributedCabin]:
    """The adult side of kindred#2775: each person-year that reads the
    CampMinder layer (`live_cabins_for_year`) REPLACES the attribution rule's
    answer for that year; every other year keeps the rule's, unchanged.

    `named` is the rule's output with `cabin_name` already today's name. A
    live cabin keeps the rule's as-typed string for the same weekend as its
    provenance (the value the ingest built the row from), or "" when the rule
    attributed none there. Ordered by year, then weekend end, as the rule's is.

    `enrolled` (year -> session cm_ids, from `enrolled_sessions_by_year`) is
    the coverage set; without it the dated `weekends` stand in, which misses an
    enrollment whose end date does not parse.
    """
    by_year: dict[int, list[AttributedCabin]] = defaultdict(list)
    for cabin in named:
        by_year[cabin.year].append(cabin)
    weekends_by_year: dict[int, list[AdultWeekend]] = defaultdict(list)
    for weekend in weekends:
        weekends_by_year[weekend.year].append(weekend)

    out: list[AttributedCabin] = []
    for year in sorted(set(by_year) | set(weekends_by_year)):
        year_weekends = sorted(weekends_by_year.get(year, []), key=lambda w: w.last_day_ends)
        year_live = live_cabins_for_year(
            year,
            enrolled.get(year, set()) if enrolled is not None else {w.session_cm_id for w in year_weekends},
            {session: name for (live_year, session), name in live.items() if live_year == year},
        )
        if year_live is None:
            out.extend(by_year.get(year, []))
            continue
        raw_by_session = {cabin.session_cm_id: cabin.cabin_name_raw for cabin in by_year.get(year, [])}
        out.extend(
            AttributedCabin(
                year=year,
                session_cm_id=weekend.session_cm_id,
                cabin_name=year_live[weekend.session_cm_id],
                cabin_name_raw=raw_by_session.get(weekend.session_cm_id, ""),
            )
            for weekend in year_weekends
            if weekend.session_cm_id in year_live
        )
    return out


def named_adult_cabins(
    values: Iterable[CabinValue],
    weekends: Sequence[AdultWeekend],
    live: Mapping[tuple[int, int], str],
    resolve_codes: ResolveCodes,
    display_name: Callable[[str, int], str],
    enrolled: Mapping[int, Collection[int]] | None = None,
) -> list[AttributedCabin]:
    """The adult journey's whole answer, as the per-person journey and the
    roster card's cohort read BOTH compute it -- one composition, so the two
    cannot disagree: attribute each value to a weekend, name it with today's
    registry name (kindred#2332; the trimmed as-typed string when nothing
    resolves), then let a live-housing year's CampMinder-layer rows replace
    the rule's answer (kindred#2775)."""
    attributed = attribute_adult_cabins(values, weekends, resolve_codes)
    named = [replace(cabin, cabin_name=display_name(cabin.cabin_name_raw, cabin.year).strip()) for cabin in attributed]
    return overlay_live_cabins(named, weekends, live, enrolled)


def attribute_adult_cabins(
    values: Iterable[CabinValue],
    weekends: Iterable[AdultWeekend],
    resolve_codes: ResolveCodes,
) -> list[AttributedCabin]:
    """Pin each season's cabin value(s) to the person's enrolled adult weekends.

    In order: ASSIGN each value to a weekend first, THEN collapse
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
    landed in, starving the earlier weekend of a value it genuinely had. This
    rule's own `cabin_name` is the raw string, outer whitespace trimmed --
    `named_adult_cabins` resolves today's registry name, not this function,
    for both the journey and the card (kindred#2767, kindred#2775).
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
                        # This rule's own label -- `named_adult_cabins`
                        # replaces it with today's registry name.
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

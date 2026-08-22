"""Assembles the per-weekend lodging roster.

Two grains, one surface. Family camp enrols only children, so accompanying
adults come from family_camp_adults and a party is a HOUSEHOLD. Adult
weekends enrol individuals directly, so a party is a PERSON. That mirrors
lodging_assignments' dual grain exactly.

Medical narrative: the roster and summary reads do not touch
family_camp_medical at all. They used to, to derive a boolean from the
presence of a value -- see `_build_flags` for why that boolean is gone
(kindred#1889). The narrative has one reader, get_household_medical, which
fetches ONE household behind `bunking.manage` at the router (kindred#2312
retargeted the gate from the now-removed Permission.LODGING_PHI).
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Mapping, Sequence
from datetime import date
from typing import TYPE_CHECKING, Any, NamedTuple, cast

from api.constants.lodging import INFANT_BED_EXEMPT_MONTHS, is_attending_adult_name
from api.schemas.lodging import (
    MEDICAL_NARRATIVE_FIELD_NAMES,
    AccessibilityFlagSummary,
    EffectiveBathroom,
    HouseholdJourneyResponse,
    HouseholdJourneySession,
    HouseholdJourneyYear,
    HouseholdMedicalResponse,
    HousingState,
    LodgingUnitSummary,
    PartyAdult,
    PartyChild,
    ProximityKind,
    RampAssessment,
    RequestTextBlock,
    RequestTextEntry,
    RosterCounts,
    RosterParty,
    Shareability,
    ShareEligibility,
    ShareEligibilitySource,
    SharePreference,
    ShareRequestSummary,
    WeekendRosterResponse,
    WeekendSessionListResponse,
    WeekendSessionStatus,
    WeekendSessionSummary,
    WeekendSummaryEntry,
    WeekendSummaryResponse,
    WriteInCover,
)
from api.services.lodging_rules import (
    REQUEST_TEXT_SOURCES,
    HousingNameResolver,
    RegistryUnit,
    UnitAlias,
    amenity_coverage,
    container_bathroom,
    effective_bathroom,
    is_family_available,
    ramp_coverage,
    request_text_authorship,
    request_text_source_order,
    unit_capacity,
    unit_shareability,
)
from bunking.logging_config import get_logger

if TYPE_CHECKING:
    from api.services.lodging_repository import LodgingRepository, RequestValueRow

logger = get_logger(__name__)

# family_camp_registrations.share_cabin_gate values, which are the Go ingest's.
# An empty column means nobody answered; it renders as "unknown" and is never
# coerced into permission to pair.
_GATE_VALUES: frozenset[str] = frozenset({"no_share", "maybe_mutual", "yes_share"})
# "unknown" / "none" are deliberately absent: they are what an unrecognised or
# empty column FALLS BACK to, so accepting them here would be redundant and
# would hide a value drifting out of the migration's select list.
_ELIGIBILITY_VALUES: frozenset[str] = frozenset({"open", "named", "declined"})
_ELIGIBILITY_SOURCE_VALUES: frozenset[str] = frozenset({"form", "registration"})

# kindred#1920: `build_summary` opens a `TaskGroup` per weekend and each one
# opens four `to_thread` reads of its own, so an uncapped year is 4x its
# weekend count in concurrent reads against one executor -- 48 for 2026's 12
# weekends, 72 for 2024's 18. The default `to_thread` pool is
# `min(32, cpu+4)`, so 8 concurrent weekends (32 reads) keeps the fan-out
# from ever queuing behind itself.
SUMMARY_ENTRY_CONCURRENCY = 8


class SessionNotFoundError(LookupError):
    """No family/adult session matches the requested (year, cm_id)."""


class _Placement(NamedTuple):
    """A row's resolved target(s) -- the RosterParty placement fields.

    unit_code/unit_name/is_merged_slot are the exact triple `_placement_of`
    returned before kindred#1931's map-view follow-up added unit_codes: the
    response shape a `lodging_merges` row used to produce, preserved so the
    board needs no changes. unit_codes adds every leaf code the party
    occupies, in the same order unit_name's label was built from, for a
    caller (the map view) that needs to know WHICH units a merged party
    spans, not just how many.

    A plain 3-tuple was the return type before this, and still type-checks
    and still unpacks as a 3-tuple -- the trap is a fallback default left at
    the old shape, which only breaks on `.unit_codes` attribute access, on
    the one path that never hits `_placement_of` at all. `_NO_PLACEMENT`
    below is the fix: every fallback site uses this NamedTuple's own zero
    value, not a bare tuple literal.
    """

    unit_code: str
    unit_name: str
    is_merged_slot: bool
    unit_codes: tuple[str, ...]


_NO_PLACEMENT = _Placement("", "", False, ())


def _s(record: Any, field: str, default: str = "") -> str:
    value = getattr(record, field, default)
    return default if value is None else str(value)


def _i(record: Any, field: str, default: int = 0) -> int:
    value = getattr(record, field, default)
    try:
        return int(value)
    except TypeError, ValueError:
        return default


def _ramp_assessment(value: str) -> RampAssessment:
    """Rail a raw `has_ramp` string to the select's own vocabulary.

    NOT a defence against the registry loader: migration 1500000131 declares
    `has_ramp` as a PocketBase `select` with `values: ['yes','no','partial']`,
    and PB validates that on save, so `registry.go`'s write of a typo'd value
    fails the save rather than persisting it. This rails two OTHER directions,
    both real. A later migration may WIDEN the value list -- that is how a
    select grows -- and a grade this code has never heard of must read as NOT
    ASSESSED rather than fall through `ramp_coverage`'s chain to `none`, which
    is a claim. And `_s` is total over a record that lacks the attribute
    entirely, which is what a summary built before the column existed looks
    like.

    Blank already means NOT ASSESSED -- 104 of the 118 production rows are
    blank -- and coercing either case to "no" is the inversion the select
    exists to prevent.
    """
    if value in ("yes", "no", "partial"):
        return cast(RampAssessment, value)
    return ""


def _b(record: Any, field: str) -> bool:
    return bool(getattr(record, field, False))


def _maybe_bool(record: Any, field: str) -> bool | None:
    """A stored boolean, or None when there is no ROW to read it off.

    NOT `_b` with a default. `_b` flattens a missing row to False, which is the
    right answer for a column that is always present on a row that always
    exists; here the absence of a row is a THIRD state -- "no override for this
    weekend, so the unit's own role decides" -- and collapsing it into False
    would close every cabin nobody has said anything about.
    """
    return None if record is None else _b(record, field)


def _f(record: Any, field: str) -> float | None:
    value = getattr(record, field, None)
    try:
        return None if value is None else float(value)
    except TypeError, ValueError:
        return None


def _as_date(value: str) -> date | None:
    """A PocketBase date column as a `date`, or None when it says nothing.

    PocketBase hands dates back as `YYYY-MM-DD HH:MM:SS.mmmZ` -- a space, not
    a `T`, and a `Z` suffix `fromisoformat` will not take before the time is
    dropped. Only the calendar day matters here: a session starts on a day,
    and an age in whole months does not care what time the gate opened.
    """
    text = value.strip()[:10]
    if not text:
        return None
    try:
        return date.fromisoformat(text)
    except ValueError:
        return None


def _completed_months(start: date, end: date) -> int:
    """Whole months elapsed, the way a parent counts them.

    Calendar months, not `days // 30`: a child born on the 4th is "18 months"
    on the 4th, whatever the intervening month lengths were. The day-of-month
    adjustment is what makes the last month count only once it has finished.
    """
    months = (end.year - start.year) * 12 + (end.month - start.month)
    return months - 1 if end.day < start.day else months


def _consumes_a_bed(child: Any, session_start: date | None) -> bool:
    """Whether this child needs a bed of their own (kindred#2046).

    Under 18 months at session start they do not -- they travel in a cot or
    share with a parent. Everything else here is the same decision made
    conservatively: an unreadable session date, a missing birthdate, or the
    unknown-age sentinel all KEEP the bed, because over-stating a party reads
    as "look at this" while under-stating it reads as "room for more".

    `persons.age == 0.0` is the documented unknown-age sentinel, and a bed is
    never removed on the strength of a sentinel -- not even when a birthdate
    sits beside it saying newborn. Measured on 2026's rostered cohort exactly
    one child is in that state, which is why the rule discounts 24 households
    rather than 25.

    The birthdate is already in hand: `fetch_attendees_for_session` expands
    `person`, so this costs no read.
    """
    if session_start is None:
        return True
    birthdate = _as_date(_s(child, "birthdate"))
    if birthdate is None:
        return True
    if (_f(child, "age") or 0.0) == 0.0:
        return True
    return _completed_months(birthdate, session_start) >= INFANT_BED_EXEMPT_MONTHS


# The board's baby/toddler mark (staff ruling, 2026-08-21): a child still
# under TWO YEARS at session start. Deliberately NOT
# `INFANT_BED_EXEMPT_MONTHS` -- that 18-month rule answers "does this child
# need a bed", this answers "is there a baby or toddler in this party", and
# coupling them would move a bed count whenever the icon's threshold is
# re-ruled (or vice versa).
UNDER_TWO_MONTHS = 24


def _has_child_under_two(children: list[Any], session_start: date | None) -> bool:
    """Whether ANY child is under 24 months at session start.

    Computed from `persons.birthdate` against `camp_sessions.start_date`,
    never from `persons.age` -- that column is CampMinder's `yy.mm` snapshot
    and thresholding on it is forbidden (see `INFANT_BED_EXEMPT_MONTHS`'s doc
    for the measured miscounts).

    ⚠️ OPPOSITE POLARITY from `_consumes_a_bed` on every unknown, and on
    purpose. The bed rule falls back toward KEEPING the bed, because
    over-stating a party reads as "look at this" while under-stating it reads
    as "room for more". This flag draws an ICON that asserts knowledge --
    "there is a child under two here" -- so a missing or unparseable
    birthdate, or an unreadable session start, contributes FALSE: an absent
    mark reads as "nothing known", never as "no baby". The age == 0.0
    unknown-sentinel guard is likewise not copied over -- it exists to stop a
    bed being REMOVED on a sentinel's strength, and no bed rides on this.
    """
    if session_start is None:
        return False
    for child in children:
        birthdate = _as_date(_s(child, "birthdate"))
        if birthdate is None:
            continue
        if _completed_months(birthdate, session_start) < UNDER_TWO_MONTHS:
            return True
    return False


def _adult_display_name(adult: Any) -> str:
    """A `family_camp_adults` row's name, coalesced.

    `name` is the COLUMN OF RECORD for an attending adult, and the split
    columns are a best-effort Adult-1/2-only extra: first_name/last_name are
    empty for 100% of adult_number 3-5 rows in every measured year, and
    last_name is empty for all of 2026 (kindred#1945).

    THE FALLBACK IS LOAD-BEARING -- do not "simplify" it away on the grounds
    that `name` is authoritative. Re-measured against production 2026-08-09:
    376 of the 382 rostered 2026 households have a non-blank `name`; the
    fallback rescues 5 of the remaining 6, taking coverage to 381/382. For
    those 5 it is the only thing that renders an adult at all. Equally, never
    conclude a row is empty from the split columns alone: 196 real adults
    across 2022-2026 are blank in first_name/last_name and populated in
    `name`.
    """
    return _s(adult, "name") or f"{_s(adult, 'first_name')} {_s(adult, 'last_name')}".strip()


def _map_point(record: Any) -> tuple[float | None, float | None]:
    """A unit's map coordinates, with the unset pair reported as unset.

    PAIR-level, deliberately, and NOT the per-field treatment `sleeps` gets a
    few lines above (kindred#1941). `sleeps` maps 0 -> None because zero beds
    is never a meaningful answer. Coordinates are normalised 0-1 fractions --
    observed x 0.074-0.888, y 0.154-0.761 -- so a zero on ONE axis is a unit
    sitting exactly on the map edge, which is legitimate. Only both axes at
    zero is the "never positioned" signal `LodgingUnitForm` leaves behind when
    it omits the key.

    `_f` sees a single field and structurally cannot make this call, which is
    why this reads both. Do not replace it with an `_f_or_none()`: that ships
    a bug for a unit at (0, 0.47).

    The frontend keeps its own `hasCoordinates` guard (`mapModel.ts`) --
    defense in depth, and it is the guard that has been holding this up so
    far.
    """
    x = _f(record, "map_x")
    y = _f(record, "map_y")
    if x == 0 and y == 0:
        return None, None
    return x, y


def resolved_units(row: Any) -> list[Any]:
    """The unit RECORDS a placement row resolves to, in stored relation order.

    Shared with the write layer's copy operation, which needs the same answer
    in ids: a scenario seeded by resolving a row differently from how the
    roster reads it would disagree with the mirror it was copied from.

    Order comes from `row.units` (the relation's own stored id order), not
    from iterating `row.expand["units"]`. Expand comes back from an IN-clause
    query and PocketBase does not promise that order matches the field's
    stored order, so reading expand's own order would let a merged slot's
    label -- and its unit_codes -- reorder between requests.

    An id in `units` with no matching record in `expand["units"]` names a unit
    that no longer exists -- the DB permits a relation to outlive its target --
    and is dropped rather than surfacing as a placeholder.
    """
    by_id = {_s(u, "id"): u for u in (getattr(row, "expand", None) or {}).get("units") or []}
    return [by_id[uid] for uid in (getattr(row, "units", None) or []) if uid in by_id]


def placement_grain(row: Any) -> tuple[str, int] | None:
    """("person" | "household", cm_id), or None for a row with neither.

    A person row OVERRIDES its household's, which is the dual grain the
    assignment tables were built around: family camp places households, adult
    weekends place people, and a grandparent housed apart from their family is
    a household row plus one person override.

    Shared with the write layer for the same reason `resolved_units` is: the
    copy must key a seeded row exactly as the roster will read it back.
    """
    person_cm_id = _i(row, "person_cm_id")
    if person_cm_id > 0:
        return "person", person_cm_id
    household_cm_id = _i(row, "household_cm_id")
    if household_cm_id > 0:
        return "household", household_cm_id
    return None


def _request_blocks(values: Sequence[RequestValueRow], *, include_staff_notes: bool) -> list[RequestTextBlock]:
    """One block per SOURCE FIELD, one entry per distinct answer inside it.

    kindred#2330, owner ruling 2026-08-17. BOTH dimensions render: which form
    an answer came from, and which child said it. The `'; '` join destroyed
    both, and recovering only one leaves the other still lost.

    Rules, each of which is a measured fact about the 2026 production
    snapshot rather than a preference:

    * Dedup is per FIELD, on case-folded text -- not per household. Today's
      ingest dedupes across fields, which hides the 4 rostered households
      whose same sentence really was written into two different questions;
      splitting by field re-exposes them, correctly.
    * A repeated answer collapses to ONE entry naming EVERY contributor. 48
      of the 131 (household, field) sibling groups are exact duplicates --
      one parent's answer copied onto each child's record -- so rendering it
      twice is noise, while dropping a name misstates who asked. The other 83
      genuinely disagree and stay separate.
    * Blocks follow `REQUEST_TEXT_SOURCES`: family-authored first, staff notes
      last. Entries within a block sort by contributor then text, so the
      panel does not reshuffle between requests because PocketBase paged the
      rows back in a different order.
    * An unregistered source field is DROPPED, not rendered under a label
      nobody approved -- `Do Not Share Bunk With` is the live case, excluded
      by the ruling's silence.
    * A blank contributor is dropped rather than rendered as an empty
      sub-label over a real request.
    * The two STAFF-authored fields are withheld unless the caller holds
      `bunking.manage`. They are `original_bunk_requests` rows, a table whose
      own PocketBase listRule is `bunking.manage` and whose raw `content`
      every other API route serves only to an admin; `/lodging/roster` takes
      any authenticated user, so emitting them unconditionally would widen
      who can read internal staff commentary about a family. The
      family-authored blocks are NOT gated, for the same reason `request_text`
      is not (kindred#2398): a household's own housing ask is a placement
      input. Gating happens HERE rather than in the repository because that
      read is cached per year and shared across callers.
    """
    by_field: dict[str, dict[str, tuple[str, list[str]]]] = {}
    for value in values:
        if request_text_source_order(value.source_field) >= len(REQUEST_TEXT_SOURCES):
            continue
        if not include_staff_notes and request_text_authorship(value.source_field) == "staff":
            continue
        text = value.text.strip()
        if not text:
            continue
        entries = by_field.setdefault(value.source_field, {})
        # FIRST spelling of the text wins the render; later ones only add
        # their author. Two children carrying one parent's answer differ in
        # capitalisation often enough that picking arbitrarily would make the
        # panel flicker between syncs.
        _, contributors = entries.setdefault(text.casefold(), (text, []))
        name = _person_display_name(value.person) if value.person is not None else ""
        if name and name not in contributors:
            contributors.append(name)

    blocks: list[RequestTextBlock] = []
    for source_field in sorted(by_field, key=request_text_source_order):
        entries_for_field = [
            RequestTextEntry(text=text, contributors=sorted(contributors, key=str.casefold))
            for text, contributors in by_field[source_field].values()
        ]
        entries_for_field.sort(key=lambda entry: ((entry.contributors or [""])[0].casefold(), entry.text.casefold()))
        blocks.append(
            RequestTextBlock(
                source_field=source_field,
                authorship=request_text_authorship(source_field),
                entries=entries_for_field,
            )
        )
    return blocks


def _person_display_name(person: Any) -> str:
    preferred = _s(person, "preferred_name")
    first = preferred or _s(person, "first_name")
    last = _s(person, "last_name")
    return f"{first} {last}".strip()


def _party_adult(adult: Any) -> PartyAdult:
    """A `family_camp_adults` row as the wire sees it.

    ONE mapping, shared by the roster's party and kindred#2073's per-year
    journey party, because they are the same thing seen at two grains: a
    journey year IS a household's party for that year. Two mappings would
    drift, and the drift would be invisible -- both render fine in isolation.
    """
    return PartyAdult(
        adult_number=_i(adult, "adult_number"),
        display_name=_adult_display_name(adult),
        relationship=_s(adult, "relationship_to_camper"),
    )


def _age_at(birthdate: date, as_of: date) -> float | None:
    """Completed years.months at `as_of`, in the same yy.mm encoding
    `persons.age` uses (kindred#2420).

    Built on `_completed_months` -- the same whole-month arithmetic
    `_consumes_a_bed` already trusts for the infant-bed rule -- so a
    historical age and an infant-bed decision can never disagree about how
    a month is counted.

    A negative month count means `as_of` predates the birth -- bad data, not
    a valid age -- and is reported as unknown rather than a nonsense
    negative number.
    """
    total_months = _completed_months(birthdate, as_of)
    if total_months < 0:
        return None
    years, months = divmod(total_months, 12)
    return float(f"{years}.{months:02d}")


def _party_child(child: Any, *, as_of: date | None = None, session_cm_ids: Sequence[int] = ()) -> PartyChild:
    """A `persons` row as the wire sees it. See `_party_adult` on sharing.

    `session_cm_ids` is the same kind of journey-only argument `as_of` is
    (kindred#2393): the weekends THIS child attended that year, earliest
    first. `_build_household_parties` omits it and publishes an empty list,
    because the roster is already one weekend and a per-child weekend list
    there would restate the page's own title once per camper.

    `as_of` is the ONE thing that lets this stay one mapping instead of
    forking (kindred#2420). `_build_household_parties` (the current-season
    roster) omits it and gets the same `persons.age` snapshot it always has
    -- that surface's blast radius is deliberately untouched. Only
    `build_household_journey` passes it, because only the journey renders a
    PAST year, and `persons.age` is CampMinder's LIVE attribute: the sync
    mirrors it on every touch, so a historical row without `as_of` would
    show the child's age TODAY on every year of their history, which is
    kindred#2420's bug verbatim.
    """
    age = _f(child, "age") or None
    if as_of is not None:
        birthdate = _as_date(_s(child, "birthdate"))
        # A missing/unparseable birthdate shows NO age for a historical row
        # rather than falling back to the stale stored value -- that
        # fallback is exactly the bug this branch exists to fix.
        age = _age_at(birthdate, as_of) if birthdate is not None else None
    return PartyChild(
        person_cm_id=_i(child, "cm_id"),
        display_name=_person_display_name(child),
        # The same column `_person_display_name` appends, sent separately so
        # the client never has to split it back off (kindred#2180) -- 32 of
        # 2026's rostered children have a SPACE inside their own last_name,
        # for which that split is wrong.
        last_name=_s(child, "last_name"),
        # persons.age is CampMinder's yy.mm as a REAL (kindred#2088): 0.06 is a
        # real 6-month-old, not a rounding artifact, so the current-season
        # (`as_of=None`) path must read the raw float, not _i()'s truncated
        # int. `or None` is still deliberate there -- age == 0.0 is the
        # UNKNOWN-AGE population (no birthdate on file), not a newborn.
        #
        # DO NOT threshold the infant discount on this field, here or
        # client-side (kindred#2046). yy.mm means months never exceed `.11`, so
        # `age < 1.5` is really "under 24 months" -- 44 children on 2026's
        # rostered cohort against the derived rule's 24. `_consumes_a_bed`
        # reads `birthdate` instead.
        age=age,
        grade=_i(child, "grade") or None,
        # A LIST COPY, not the caller's own: the journey builds one list per
        # (year, child) and a shared reference would let a later mutation
        # reach a wire object already handed out.
        session_cm_ids=list(session_cm_ids),
    )


def _children_oldest_first(children: list[Any]) -> list[Any]:
    """The order every surface prints a household's children in."""
    return sorted(children, key=lambda c: -(_f(c, "age") or 0.0))


def _child_identity(person: Any) -> Any:
    """The same key `PartyChild.person_cm_id` is published under.

    CampMinder id when there is one; the PB record id string otherwise, for
    the rare person row with neither -- kept rather than collapsed onto
    every other anonymous sibling. Shared by `build_household_journey`'s
    dedup (`seen_by_year`) and its per-child session lookup
    (`session_start_by_year`) so the two can never disagree about which
    child is which.
    """
    return _i(person, "cm_id") or str(getattr(person, "id", ""))


def _session_order(entry: HouseholdJourneySession) -> tuple[int, date, int]:
    """A season read left to right (kindred#2393).

    Start date first, because that is the order staff say the weekends in;
    the CampMinder id breaks a tie, so two weekends opening on the same day
    print in a stable order rather than in whatever order the attendee rows
    happened to arrive.

    A weekend with no readable `start_date` sorts LAST rather than first. An
    unparseable date is an unknown, and `date.min` would file the unknown at
    the head of the season -- claiming a position the data does not support,
    in the one spot a reader trusts most.
    """
    start = _as_date(entry.start_date)
    if start is None:
        return (1, date.min, entry.session_cm_id)
    return (0, start, entry.session_cm_id)


def _housing_state(cabin: str, year_assignments: Mapping[int, str]) -> HousingState:
    """What is known about one household's housing in one year (kindred#2073).

    ⚠️ AN EMPTY CABIN IS NOT MISSING DATA, and the second argument is the
    whole reason this is a function rather than a ternary: the SAME blank
    means two different things depending on whether the year recorded housing
    for anybody at all.

    * 2017-2021 record 1,433 family registrations and ZERO cabin assignments,
      so the map is empty and nothing can be said -- "unknown".
    * 2022-2025 and 2026 record cabins for other households, so a blank is a
      real absence -- "not_placed". The client words it: "not yet placed" for
      the season being worked, "no cabin on file" for a past one.

    Derived from the data rather than from a hard-coded 2022 floor, so the
    boundary moves when the data does -- when 2026 fills in, nothing here
    changes, and if housing history is ever backfilled to 2019 that year
    stops claiming ignorance on its own.
    """
    if cabin:
        return "placed"
    return "not_placed" if year_assignments else "unknown"


def _household_display_name(household: Any, fallback_cm_id: int) -> str:
    for field in ("mailing_title", "greeting"):
        value = _s(household, field)
        if value:
            return value
    return f"Household {fallback_cm_id}"


def _last_token(value: str) -> str:
    """Last whitespace-delimited token. The one heuristic in the chain, reached
    only when no enrolled child on the party carries a last_name.

    For a household its input is the MAILING TITLE, not a name, so its answer
    is wrong whenever the title does not end in the surname -- "The Chen
    Family" files under F. Pinned rather than fixed
    (`test_last_resort_yields_family_for_a_real_mailing_title`), and safe to
    leave that way: every household party has an enrolled child by
    construction, and measured against production ZERO rostered households in
    any year 2022-2026 lack a child `last_name`, so nothing reaches this rung.
    """
    parts = value.split()
    return parts[-1] if parts else ""


def _household_sort_name(children: list[Any], display_name: str) -> str:
    """Surname for a household party, from the ELDEST enrolled child's column.

    `children` arrives oldest-first, so the child rung prefers the eldest
    enrolled camper.

    THERE IS DELIBERATELY NO ADULT RUNG (kindred#1945). This used to read
    `family_camp_adults.last_name` first, on the reasoning that a household's
    surname is its adults'. That column is DEAD UPSTREAM: its two CampMinder
    sources (`Family Camp-P1/P2 Last Name`, cm_id 216785/216786) stopped being
    populated after 2022, so measured against the production snapshot the
    column holds 0 of 834 rows in 2026 and 2 rows a year in 2023-2025. The rung
    could not fire on any current weekend -- retiring it moved the sort key for
    ZERO of the 382 rostered 2026 households -- while its docstring described a
    walk over "adults 1-2" that in fact reached nothing.

    Do NOT reinstate it by deriving a surname from the combined `name` column
    instead. `name` is a whole name typed into a field CampMinder labels "First
    Name" (773 of 788 2026 values contain a space), so a last-token split is a
    heuristic, and the rung it would shadow -- the child's `last_name` -- is a
    real column that is actually populated. Never persist such a derivation
    back to the database either; a split that works on ~95% mishandles the rest
    permanently.
    """
    for child in children:
        child_last = _s(child, "last_name")
        if child_last:
            return child_last
    return _last_token(display_name)


def _is_planning_inventory(unit: LodgingUnitSummary) -> bool:
    """Whether this unit is inventory the weekend is planned against.

    THE SAME PREDICATE the board applies in `boardLayout.isPlanningInventory`
    (frontend). If the two drift, the Housing tab and the stats bar describe
    different weekends -- the board drawing 81 cards beside a bar reporting
    102 units is exactly the disagreement this shape exists to prevent.

    Reads RESOLVED availability rather than the standing role, so a staff
    cabin released to families for one weekend rejoins the inventory; hiding
    the cabin staff just released would make the release capability useless.

    The converse is deliberately NOT symmetric: a family cabin held back this
    weekend is still inventory and is reported by `units_reserved`. Permanent
    staff housing was never inventory, so it cannot be "held back".
    """
    return unit.inventory_class != "staff_default" or unit.is_family_available


def resolve_combined(*, default: bool, override: bool | None, session_override: bool | None = None) -> bool:
    """The draw level for one container, resolved through up to two override tiers.

    Highest first: `override` (this scenario's own `lodging_slot_merges` row),
    then `session_override` (the WEEKEND-LEVEL row -- `scenario == ""`,
    1500000140), then `default` (`lodging_units.default_combined`).

    The weekend-level tier exists because a merge is a fact about the
    weekend, not only about a plan: unlike a placement, no sync ever writes a
    draw level, so there is no CampMinder record of truth a writable mirror
    would corrupt. It is seen on the CampMinder mirror itself (`override` is
    always None there -- no scenario means no scenario row) AND inherited by
    every scenario that has not overridden it locally. Same argument
    1500000135 already made for lodging_availability.

    `is None` at EITHER tier means NO ROW at that tier, which inherits down
    to the next one -- it is not False. Flattening either absence to False
    would make it impossible to split a container whose registry default is
    combined with no scenario row present, or to have a scenario un-close a
    weekend-level split with no scenario row of its own (a bare
    `session_override` falling through to `default` while a real
    `session_override = False` got treated the same as "absent" would make a
    weekend-level split unreachable from a scenario that never touched the
    unit).
    """
    if override is not None:
        return override
    if session_override is not None:
        return session_override
    return default


def written_in_unit_ids(write_ins: list[Any]) -> frozenset[str]:
    """The unit ids the chosen write-in source names, for `write_in_covers` to walk.

    WHICHEVER source the request resolved to -- `lodging_write_ins` on the live
    board, `lodging_write_ins_draft` inside a scenario (kindred#2382). The
    caller has already made that choice, and a scenario REPLACES, so this walks
    exactly one scope's rows.

    Built ONCE per request and threaded, rather than re-derived inside the
    cover walk: `_build_units` already consumes the same rows on the way to the
    payload, and two derivations of "which units hold a write-in" are two
    things that can disagree about one cabin.
    """
    return frozenset(_s(row, "unit") for row in write_ins)


def write_in_covers(
    units: list[LodgingUnitSummary], write_in_unit_ids: frozenset[str]
) -> dict[str, list[WriteInCover]]:
    """Which write-ins close each unit's space, keyed by unit code.

    THE UNIT A ROW NAMES IS NOT THE ONLY SPACE IT CLOSES. A write-in is a fact
    about a physical space and a building's space contains its rooms', but the
    board draws whichever level the tree resolves to (`drawn_units`) and a
    merge or a split moves that level under staff's feet. A write-in recorded
    on a merged building went silent the moment somebody split it; one recorded
    on a room said nothing on the building's card after a merge. Either way a
    family could be dropped into a space somebody is already sleeping in.

    Order, highest first: the unit's OWN row, else the nearest ANCESTOR's, else
    EVERY written-into descendant beneath it. Own beats inherited because it is
    the more specific statement about the same space; an ancestor beats a
    descendant because a building closed whole says something about every room
    in it, where one room says only that the building is no longer free to let
    whole.

    THE DESCENDANT STEP RETURNS ALL OF THEM (kindred#2381), and that is the
    arity fix. A merged container draws in place of its rooms, so returning the
    first match dropped every other occupant off the board -- four of them on
    the one 2026 container that carries four -- and made each clear look like a
    failed click as the card re-resolved to the next room. The first two steps
    stay single-answer: an own row is one row, and an ancestor chain has exactly
    one nearest member.

    Per-branch NEAREST, not every descendant. A written-into bed inside a
    written-into wing is already inside that wing's space, so the wing's row
    speaks for it and returning both would print one space twice. The walk
    therefore stops descending a branch the moment it finds a row on it.

    Ordered by `code` at every level, so two identical payloads never disagree
    about the sequence a card draws its occupants in.

    RESOLVED FROM OWN ROWS ONLY, never transitively through a cover computed
    for somebody else -- which is what keeps a caretaker in room A off room B.
    A closes its building (a whole-house let is no longer available); the
    building does not then close B, because that would take a lettable room off
    the board for no reason.

    Only a write-in travels. A ROLE release is a staff cabin OPENED to families
    for the weekend: it names no occupant and closes nothing, so inheriting it
    would silently open every room beneath a released building.

    WHICH UNITS HOLD ONE IS AN INPUT, not something read off the summary
    (kindred#2382). It used to be `family_available_override is False`, which
    was the only spelling occupancy had while it shared
    `lodging_availability.family_available` with the staff<->family role. The
    two are separate tables now, so this walks the OCCUPANCY source directly and
    a bare `false` surviving on a role row -- which names nobody, and which
    1500000162 leaves none of -- can no longer masquerade as somebody sleeping
    in a cabin.

    Cycle-guarded on both walks. The server refuses to write a parent cycle
    (#1899), but one already in the data must not spin the roster build --
    the same backstop `drawn_units` and the frontend's `coveredCodes` carry.
    """
    # A blank `code` is a valid if unfortunate registry value and would occupy
    # the same key `parent_code == ""` uses for "no parent" -- the collision
    # `drawn_units._parent_of` guards. Excluded here and never looked up.
    by_code = {unit.code: unit for unit in units if unit.code}
    children: dict[str, list[LodgingUnitSummary]] = {}
    for unit in units:
        if unit.parent_code:
            children.setdefault(unit.parent_code, []).append(unit)
    # Sorted so two identical payloads never disagree about the ORDER a card
    # draws its occupants in when a building has several written-into rooms
    # beneath it. It used to settle WHICH single row was named, because only
    # one survived; kindred#2381 returns them all and this now fixes their
    # sequence instead.
    for bucket in children.values():
        bucket.sort(key=lambda child: child.code)

    def _is_written_in(unit: LodgingUnitSummary) -> bool:
        return unit.unit_id in write_in_unit_ids

    def _nearest_ancestor(unit: LodgingUnitSummary) -> LodgingUnitSummary | None:
        seen = {unit.code}
        cursor = by_code.get(unit.parent_code) if unit.parent_code else None
        while cursor is not None and cursor.code not in seen:
            if _is_written_in(cursor):
                return cursor
            seen.add(cursor.code)
            cursor = by_code.get(cursor.parent_code) if cursor.parent_code else None
        return None

    def _written_in_descendants(unit: LodgingUnitSummary) -> list[LodgingUnitSummary]:
        """Every written-into descendant, nearest-first on each branch.

        Breadth-first over `code`-sorted buckets, so the result is ordered and
        two identical payloads agree. A branch is not descended past a match:
        the matched unit's space contains whatever is below it, and its row
        already speaks for that space.
        """
        found: list[LodgingUnitSummary] = []
        seen = {unit.code}
        queue = list(children.get(unit.code, []))
        while queue:
            node = queue.pop(0)
            if node.code in seen:
                continue
            seen.add(node.code)
            if _is_written_in(node):
                found.append(node)
                continue
            queue.extend(children.get(node.code, []))
        return found

    covers: dict[str, list[WriteInCover]] = {}
    for unit in units:
        # Blank codes are excluded from BOTH sides, not just the lookup above.
        # `_build_units` reads this map back by code, so one blank-coded row
        # written into would hand its occupant to every other blank-coded row
        # through the shared `""` key -- a unit reporting somebody sleeping in
        # a space on the strength of a row it does not hold.
        if not unit.code:
            continue
        if _is_written_in(unit):
            sources = [unit]
        else:
            ancestor = _nearest_ancestor(unit)
            sources = [ancestor] if ancestor is not None else _written_in_descendants(unit)
        if not sources:
            continue
        covers[unit.code] = [
            WriteInCover(
                unit_id=source.unit_id,
                unit_code=source.code,
                unit_name=source.name,
                occupant_name=source.occupant_name,
                note=source.reason,
            )
            for source in sources
        ]
    return covers


def _resolve_write_in_covers(units: list[LodgingUnitSummary], write_in_unit_ids: frozenset[str]) -> None:
    """Attach each unit's resolved write-in cover, in place.

    The mutating counterpart to `write_in_covers`, mirroring
    `_resolve_power_coverage`: the pure function is what the tests reason
    about, and this is the one line the response path calls.
    """
    covers = write_in_covers(units, write_in_unit_ids)
    for unit in units:
        unit.write_ins = covers.get(unit.code, [])


def drawn_units(units: list[LodgingUnitSummary]) -> list[LodgingUnitSummary]:
    """The units that get a CARD, at the level each tree resolves to.

    THE PYTHON MIRROR of `drawnUnits` in
    `frontend/src/components/weekend/unitLevel.ts`, and the counts' half of
    the invariant `_is_planning_inventory` states for its own predicate: if
    the two drift, the Housing tab and the stats bar describe different
    weekends. Reads the RESOLVED `is_combined` (see `resolve_combined`), never
    `default_combined`, so a scenario merge moves the counts with the board.

    A leaf always draws. A container draws only when combined -- otherwise it
    is pure grouping and the walk descends past it. Nothing beneath a combined
    node draws, because combined means "draw the card here and stop
    descending": two nodes on one root-to-leaf path can both resolve combined
    (a scenario override can set one where an ancestor default already holds)
    and taking the higher is what keeps a room from being counted under a card
    that does not exist.

    Leaf-ness reads the `is_container` FLAG, never child count -- the same
    rule the frontend walk applies, and for the same reason: inferring "this
    is bookable" from an empty child list infers from missing data. Only a
    CONTAINER can block a descendant, which also makes this immune to a stale
    `is_combined` on a leaf. The admin form clears `default_combined` when "is
    a building" is unticked, so nothing writes that combination any more -- but
    rows saved before it did still carry it, and no migration went back for
    them.

    Cycle guard for the same reason `coveredCodes` carries one: the server
    guards against WRITING a cycle (`guardUnitParentCycle`, #1899), but a
    cycle already in the data must not hang a request. A cycle BLOCKS rather
    than merely stopping the walk -- see the comment at the guard for why
    that is what keeps this in step with the frontend.

    A blank `code` is a valid, if unfortunate, registry value, and `by_code`
    is keyed on it -- so a row with no code occupies the SAME `""` key that
    `parent_code == ""` uses to mean "no parent". `_parent_of` is the guard:
    an empty code is looked up as "no parent" and never handed to `by_code`,
    so a root can never be misread as a child of whichever row happens to
    have a blank code.
    """
    by_code = {unit.code: unit for unit in units}

    def _parent_of(code: str) -> LodgingUnitSummary | None:
        return by_code.get(code) if code else None

    drawn: list[LodgingUnitSummary] = []
    for unit in units:
        if unit.is_container and not unit.is_combined:
            continue
        seen = {unit.code}
        cursor = _parent_of(unit.parent_code)
        blocked = False
        while cursor is not None:
            if cursor.code in seen:
                # A CYCLE BLOCKS, rather than merely stopping the walk. The
                # frontend mirror seeds from ROOTS, so a unit whose ancestry
                # loops has no path from one and is never visited there --
                # it draws no card. Falling through to "not blocked" here
                # would count a unit the board will not draw, which is the
                # precise drift this function exists to prevent. The party
                # placed there rails to `offBoard`, which `buildBoard` is
                # total over, so nobody is lost either way.
                blocked = True
                break
            seen.add(cursor.code)
            if cursor.is_container and cursor.is_combined:
                blocked = True
                break
            cursor = _parent_of(cursor.parent_code)
        if not blocked:
            drawn.append(unit)
    return drawn


class _BathroomIndex(NamedTuple):
    """The unit tree, built ONCE per roster/summary call from the unit
    registry and threaded through to every consumer, rather than rebuilt per
    consumer -- the same "compute across all units, read per party" split
    `_build_units` already uses for `group_members`.

    Two consumers share it: `_resolve_party_bathroom` (via `_build_parties`)
    and, since kindred#2041, `_build_counts`'s `_effective_sleeps`, which
    walks `leaf_codes_under` to total a combined container's rooms. Both
    orchestrators (`build_roster`, `build_summary`'s per-weekend `_entry`)
    build ONE instance right after `_build_units` and pass it to both --
    building a second one from the same `units` list was caught in review on
    kindred#2041's PR and is exactly the duplicate work this docstring
    already warned against.
    """

    units_by_code: dict[str, LodgingUnitSummary]
    # Immediate children only, keyed by the PARENT's code. Nesting (a
    # container inside a container, e.g. an apartment under a larger
    # block) is walked at read time in `leaf_codes_under`, mirroring
    # `drawn_units`' own upward walk of the same `parent_code` relation.
    children_by_parent: dict[str, tuple[LodgingUnitSummary, ...]]
    group_members: dict[str, frozenset[str]]

    @classmethod
    def build(cls, units: list[LodgingUnitSummary]) -> _BathroomIndex:
        units_by_code = {unit.code: unit for unit in units}

        children: dict[str, list[LodgingUnitSummary]] = {}
        for unit in units:
            if unit.parent_code:
                children.setdefault(unit.parent_code, []).append(unit)

        group_members: dict[str, set[str]] = {}
        for unit in units:
            if unit.bathroom_group:
                group_members.setdefault(unit.bathroom_group, set()).add(unit.code)

        return cls(
            units_by_code=units_by_code,
            children_by_parent={code: tuple(rows) for code, rows in children.items()},
            group_members={group: frozenset(codes) for group, codes in group_members.items()},
        )

    def leaf_codes_under(self, container_code: str) -> frozenset[str]:
        """Every LEAF unit code under a container, walking the tree.

        Recurses rather than reading one level, because a container's own
        children may themselves be containers. Cycle-guarded for the same
        reason `drawn_units` guards its walk: a cycle already in the data
        must not hang a request.
        """
        leaves: set[str] = set()
        seen: set[str] = {container_code}
        stack = list(self.children_by_parent.get(container_code, ()))
        while stack:
            child = stack.pop()
            if child.code in seen:
                continue
            seen.add(child.code)
            if child.is_container:
                stack.extend(self.children_by_parent.get(child.code, ()))
            else:
                leaves.add(child.code)
        return frozenset(leaves)


def _resolve_party_bathroom(unit_codes: list[str], index: _BathroomIndex) -> str:
    """The bathroom a party ends up with once every code it occupies counts
    toward ONE merge -- kindred#2022.

    `effective_bathroom`'s exclusivity branch is unreachable at its one
    existing call site (`_build_units`, below) because that call always
    passes a one-element `frozenset({code})`: the units INVENTORY has no
    occupant, so it is evaluated one unit at a time and stays that way (see
    the comment there). This is the OTHER caller, added for exactly this
    fix: it passes the full set of codes the placement actually covers, so
    a real multi-unit merge can clear the bar.

    A container in `unit_codes` (a whole-let placement naming the building
    rather than its rooms) is expanded to its leaf descendants via
    `container_bathroom`, rather than read from its own registry row, which
    is always "none" -- see that function's docstring.

    The FIRST occupied code supplies the representative bathroom/group fed
    to `effective_bathroom`; every registry bathroom_group's members share
    one physical bathroom by construction, so any member speaks for the
    group. `unit_codes` naming units from two DIFFERENT groups is not a
    case any registry data produces today.
    """
    if not unit_codes:
        return "unknown"

    occupied: set[str] = set()
    bathroom = ""
    group = ""
    for code in unit_codes:
        unit = index.units_by_code.get(code)
        if unit is None:
            # A code the registry cannot resolve makes the WHOLE placement
            # unknown, rather than scoring from whatever else resolved.
            # Continuing here would answer "private"/"shared" on the strength
            # of a placement we can only partly see -- the same claim the
            # empty-`unit_codes` guard above already refuses to make.
            return "unknown"
        if unit.is_container:
            # ACTIVE leaves only, exactly as `_resolve_bathroom` filters the
            # same walk. THE TWO LANES MUST AGREE: this one answers for a
            # container once a family is IN it, that one answers for the
            # empty card staff are choosing from, and one field cannot mean
            # two things across a single click. A retired room otherwise
            # counted twice over here -- once to supply a bathroom nobody can
            # be placed in, and again to complete the group
            # `effective_bathroom`'s exclusivity branch checks, which is what
            # turned a live room with no bathroom into a `private` verdict on
            # a medical request.
            #
            # `index.group_members` stays UNFILTERED on both paths, and that
            # is deliberate rather than an oversight: a group with a retired
            # member is not fully covered by a whole-let of the live ones, so
            # both lanes hold at "shared" rather than upgrading. Filter it in
            # one place and they diverge again.
            leaves = frozenset(
                leaf_code
                for leaf_code in index.leaf_codes_under(code)
                if (leaf := index.units_by_code.get(leaf_code)) is not None and leaf.is_active
            )
            occupied |= leaves
            leaf_bathrooms = frozenset(
                (index.units_by_code[leaf].bathroom, index.units_by_code[leaf].bathroom_group) for leaf in leaves
            )
            inherited_bathroom, inherited_group = container_bathroom(leaf_bathrooms)
            if not bathroom:
                bathroom, group = inherited_bathroom, inherited_group
        else:
            occupied.add(code)
            if not bathroom:
                bathroom, group = unit.bathroom, unit.bathroom_group

    if not bathroom:
        return "unknown"
    return effective_bathroom(bathroom, group, index.group_members.get(group, frozenset()), frozenset(occupied))


def _resolve_power_coverage(units: list[LodgingUnitSummary], index: _BathroomIndex) -> None:
    """Fill in every unit's `power_coverage` in place — kindred#1912.

    Beside `_resolve_party_bathroom` above, and for the identical reason: a
    container's registry row describes the CONTAINER, not its rooms. Twelve of
    the fourteen 2026 family-pool containers record `has_power = 0` while
    every leaf beneath them has power, so the board judging a drop against the
    row marks twelve entirely-powered buildings unpowered.

    Resolved SERVER-SIDE and never stored. The admin panels write
    `lodging_units` straight to PocketBase from the browser
    (`frontend/src/services/lodgingCrud.ts`), bypassing FastAPI entirely, so a
    stored `effective_has_power` column would have no recompute trigger on the
    one path that actually edits amenities and would go stale the first time
    staff toggled a flag.

    Walks `index.leaf_codes_under`, which is the ONE walk over this tree --
    already shared by `_resolve_party_bathroom` and `_build_counts` -- rather
    than a second traversal of its own, because two walks over one tree are
    free to drift. It recurses to LEAVES at any depth, which is the whole
    point: `hc-health-center` looks split one level down (1 powered child, 2
    not) and is not, because its two "unpowered" children are themselves
    containers whose every leaf has power. A one-level walk gets that wrong in
    the direction that looks plausible.

    Rooms that are `is_active = False` do not answer for their building -- the
    same filter `_effective_sleeps` applies when totalling a combined
    container's rooms, and for the same reason: nobody can be placed there.

    A LEAF answers for itself: it has nothing beneath it to inherit from, so
    its own row is the only fact there is. A CONTAINER never does, and that
    asymmetry is the point of the function. Once no active room is left to
    supply the answer the container reports `unknown`, exactly as
    `_effective_sleeps` returns `None` in the same degenerate case ("0 is not
    a delta over anything, it is the claim 'this house sleeps nobody'"). It is
    tempting to fall back to the container's own flag here, on
    `container_bathroom`'s "nothing to inherit, so the container reports what
    its own row says" -- but that reasoning holds for `bathroom` only because
    a container's stored `"none"` is a deliberate registry convention.
    `has_power` is not: THIRTEEN of the fifteen 2026 containers record
    `has_power = 0` while their rooms are powered, so the fallback would take
    the one field this function exists to distrust and publish it as "nothing
    here has power" -- a mark stating a fact no row supports, in the
    plausible-looking direction.

    IN PLACE, on the very objects `index.units_by_code` holds, rather than
    returning a rebuilt list: a second list of summaries would leave the index
    pointing at the pre-resolution copies, which is exactly the kind of drift
    the one-index-per-call rule above exists to prevent.
    """
    _resolve_amenity_coverage(
        units, index, answer=lambda room: room.has_power, grade=amenity_coverage, target="power_coverage"
    )


def _resolve_fridge_coverage(units: list[LodgingUnitSummary], index: _BathroomIndex) -> None:
    """Fill in every unit's `fridge_coverage` in place — kindred#2224.

    The twin of `_resolve_power_coverage` above, and it shares that function's
    walk rather than repeating it, because two walks over one tree are free to
    drift. Every word of its docstring applies here unchanged: a container's
    registry row describes the CONTAINER, an unconfirmed row means "nobody has
    said", a deactivated room does not answer for its building, and a container
    with no active room left reports `unknown` rather than falling back to its
    own flag.

    ONE thing is this function's own, and it is the owner ruling of 2026-08-15:
    A SHARED FRIDGE IS A FRIDGE. `has_shared_fridge` NARROWS `has_fridge` --
    the registry defines it that way and states the contract as "none can
    contradict its parent, so a consumer reading only the parent stays
    correct" — so the OR below is that contract written down, not a repair.
    Production carries zero shared-without-parent rows, and the ruling
    generalises: a child column may never downgrade its parent's verdict, which
    is what keeps `has_fridge` safe to read alone and settles the same question
    for `has_tub ⊂ bathroom`. (`has_kitchenette ⊂ has_kitchen` was the third
    such pair; kindred#2390 collapsed it into `has_kitchen` and migration
    1500000159 dropped the column, so do not go looking for it.)

    Reading `has_fridge` alone would therefore give the same answer on today's
    data. The OR is here so that a future row carrying only the child cannot
    silently downgrade to "no fridge at all" — the direction that looks
    plausible and is wrong.
    """
    _resolve_amenity_coverage(
        units,
        index,
        answer=lambda room: room.has_fridge or room.has_shared_fridge,
        grade=amenity_coverage,
        target="fridge_coverage",
    )


def _resolve_ramp_coverage(units: list[LodgingUnitSummary], index: _BathroomIndex) -> None:
    """Fill in every unit's `ramp_coverage` in place — kindred#2438.

    The third resolver over the one leaf walk, and every rule
    `_resolve_power_coverage` established applies here unchanged: a container's
    registry row describes the CONTAINER, an unconfirmed row means "nobody has
    said", a deactivated room does not answer for its building, and a container
    with no active room left reports `unknown` rather than falling back to its
    own flag. One of the 14 production assessments IS on a container, and it is
    ignored for exactly that reason.

    TWO things are this function's own, and both come from `has_ramp` being a
    three-value select rather than a bool:

    1. A room answers in a THREE-VALUE vocabulary, so the verdict is graded by
       `ramp_coverage` rather than `amenity_coverage` and carries a fifth
       grade, `partial`. See that function for why `partial` folds into neither
       `none` nor `some`.
    2. BLANK IS NOT `no`. `_resolve_power_coverage`'s `None` case covers only
       the unconfirmed ROW; here the field itself can be unanswered on a
       confirmed row, and 104 of 118 production units are. So blank maps to
       `None` — not assessed — and the building reports `unknown`. Reading it
       as `no` would mark almost the whole registry step-free-hostile on
       evidence nobody recorded, which is the inversion migration 1500000131
       made the column a select to prevent.

    An unrecognised string maps to `None` too — see `_ramp_assessment` for the
    two directions that can produce one, neither of which is the registry
    loader. An unreadable answer is no answer, never a claim in either
    direction.
    """
    _resolve_amenity_coverage(
        units,
        index,
        answer=lambda room: room.has_ramp or None,
        grade=ramp_coverage,
        target="ramp_coverage",
    )


def _resolve_ac_coverage(units: list[LodgingUnitSummary], index: _BathroomIndex) -> None:
    """Fill in every unit's `ac_coverage` in place -- kindred#2502.

    The fourth caller of `_resolve_amenity_coverage`, and the last amenity on
    the card that had no resolver at all: `has_ac` sat in the schema between
    two fields that both have twins, and three surfaces read it raw. Seven of
    the 15 production containers record `has_ac = 0` with AC-bearing rooms.

    Display only -- see the schema field. Every rule this walk applies is
    `_resolve_power_coverage`'s, unchanged.
    """
    _resolve_amenity_coverage(
        units, index, answer=lambda room: room.has_ac, grade=amenity_coverage, target="ac_coverage"
    )


def _resolve_bathroom(units: list[LodgingUnitSummary], index: _BathroomIndex) -> None:
    """Fill in every CONTAINER's `bathroom` from its leaves -- kindred#2502.

    THE FIFTH IN-PLACE RESOLVER AND THE ONLY ONE THAT IS NOT A COVERAGE
    GRADE. Power, fridge, step-free and AC all funnel through
    `_resolve_amenity_coverage` and write a `*_coverage` field beside the raw
    column; this one overwrites the column itself, because `bathroom` is a
    four-value enum every surface already reads and giving it a parallel
    `bathroom_coverage` would have left two fields to keep in step. So it is
    the twin of those four in its walk and its `is_active` filter, and the
    last amenity that was still answered from the unit's own row.

    All 15 production containers store `bathroom = "none"` (a building is not
    a room) while 13 of them have at least one room that records one, so every
    whole-house card drew no bathroom while both its rooms drew one the moment
    staff split it.

    ⚠️ CONTAINERS ONLY, unlike the three above. A leaf's own row is already
    the right answer and `_build_units` already computes it correctly --
    `effective_bathroom` against a one-element slot leaves a `shared` leaf
    `shared`. Overwriting leaves here would be a no-op at best and would
    duplicate the one place that logic lives.

    ⚠️ WHY A RESOLVER AND NOT SLOT-CODE THREADING. The party path answers
    this correctly already (`_resolve_party_bathroom`), but only once a
    placement exists -- so the same building graded unmet in the picker and
    met once the family landed in it. Most containers are never placed into.
    A resolver has no placement to read, which is the whole point: it answers
    for an EMPTY building, which is when staff are choosing one.

    The exclusivity upgrade is honest here rather than generous: booking a
    whole container covers every room under it by construction, so if the
    rooms' shared group has no members outside the container,
    `effective_bathroom` is being handed a genuinely complete slot.
    """
    for unit in units:
        if not unit.is_container:
            continue
        leaves = [
            leaf
            for code in sorted(index.leaf_codes_under(unit.code))
            if (leaf := index.units_by_code.get(code)) is not None and leaf.is_active
        ]
        inherited, group = container_bathroom(frozenset((leaf.bathroom, leaf.bathroom_group) for leaf in leaves))
        if inherited == "none":
            # Nothing to inherit -- the container keeps exactly what its own
            # registry row says, which is what it already holds. This is also
            # the bathhouse case: rooms sharing a group that names somewhere
            # they WALK to, with no bathroom in any of them.
            continue
        unit.bathroom = cast(
            Any,
            effective_bathroom(
                inherited,
                group,
                index.group_members.get(group, frozenset()),
                frozenset(leaf.code for leaf in leaves),
            ),
        )


def _resolve_amenity_coverage[Answer](
    units: list[LodgingUnitSummary],
    index: _BathroomIndex,
    *,
    answer: Callable[[LodgingUnitSummary], Answer | None],
    grade: Callable[[Sequence[Answer | None]], str],
    target: str,
) -> None:
    """The one leaf walk all FOUR coverage resolvers above run.

    Four, not three: `_resolve_ac_coverage` (kindred#2502) joined power,
    fridge and step-free, and its own docstring already called itself the
    fourth caller while this line still said three. `_resolve_bathroom` sits
    above too and deliberately does NOT come through here -- it writes a
    container's own `bathroom` rather than a coverage grade, and needs
    `container_bathroom`'s group reasoning, which has no place in a walk
    parameterised on one flag per room.

    Parameterised on WHICH flag a room answers with and WHICH field receives
    the verdict, so a second amenity is a call site rather than a second
    traversal. The rules — leaves answer for themselves, containers never do,
    inactive rooms do not answer, unconfirmed rooms answer `None` — live here
    once; the reasoning for each lives in `_resolve_power_coverage`, which is
    the function that established them.

    `Answer` is the vocabulary a ROOM answers in — `bool` for the boolean
    flags, `str` for `has_ramp`'s three-value select — and `grade` is
    parameterised alongside it for ONE reason, not for generality
    (kindred#2438): `has_ramp` is a three-value select, so its rooms answer
    `"yes"` / `"partial"` / `"no"` rather than a bool and need
    `ramp_coverage`'s five-grade verdict. The WALK is what must not be
    duplicated; which vocabulary a room answers in is the caller's business.
    """
    for unit in units:
        rooms = [
            leaf
            for code in sorted(index.leaf_codes_under(unit.code))
            if (leaf := index.units_by_code.get(code)) is not None and leaf.is_active
        ]
        answering = rooms if unit.is_container else [unit]
        setattr(
            unit,
            target,
            # `None` where nobody has confirmed the row: an unconfirmed
            # `has_power = False` means "nobody has said", never "there is
            # no power" -- the same gate `rosterAttention` already applies
            # to the roster's own fit check.
            grade([answer(room) if room.is_confirmed else None for room in answering]),
        )


class LodgingRosterService:
    """Builds the read-only weekend roster from repository output."""

    def __init__(self, repository: LodgingRepository) -> None:
        self.repository = repository

    async def _fetch_session_statuses_or_active(self, year: int) -> Mapping[int, str]:
        """`fetch_session_statuses`, degraded to {} on a failed read.

        kindred#2092 finding 2. This method's caller runs the read INSIDE a
        TaskGroup alongside reads that must not fail -- `asyncio.TaskGroup`
        cancels every sibling task the moment any one of them raises, so an
        unwrapped failure here would 500 the whole endpoint (`/sessions` or
        `/summary`) over a status badge. The realistic trigger is ordinary:
        the API container starting against a PocketBase that has not yet
        applied migration 1500000142, so the collection does not exist yet.

        {} is not a made-up fallback -- it is the SAME value an empty,
        untouched `lodging_session_status` table produces, and this layer's
        own design is that absence of a row means active. Degrading a failed
        read to {} keeps that design holding end to end instead of adding a
        second "unknown" state nothing downstream understands.
        """
        try:
            return await self.repository.fetch_session_statuses(year)
        except Exception as exc:
            logger.warning(
                f"lodging_session_status read failed for year {year}, treating every weekend as active: {exc}"
            )
            return {}

    async def list_sessions(self, year: int) -> WeekendSessionListResponse:
        async with asyncio.TaskGroup() as tg:
            rows_task = tg.create_task(self.repository.fetch_weekend_sessions(year))
            statuses_task = tg.create_task(self._fetch_session_statuses_or_active(year))

        statuses = statuses_task.result()
        return WeekendSessionListResponse(
            year=year,
            sessions=[self._session_summary(row, statuses) for row in rows_task.result()],
        )

    @staticmethod
    def _weekend_status(raw: str) -> WeekendSessionStatus:
        """One stored value -> the vocabulary this layer publishes.

        TOTAL BY DESIGN, and it falls back to "active". The select is
        widenable on purpose (owner, 2026-08-07: two values now so a third is
        a value addition, not a type migration), so a value added to the
        column before this layer knows it must not be rendered as a
        cancellation -- telling staff a running weekend is cancelled is the
        one error here that empties a board somebody is working.
        """
        return "cancelled" if raw == "cancelled" else "active"

    @classmethod
    def _session_summary(cls, row: Any, statuses: Mapping[int, str]) -> WeekendSessionSummary:
        """One weekend's identity. Shared so the lander and the session list
        can never describe the same weekend differently.

        `statuses` is the season's staff-owned status map keyed by CampMinder
        id (kindred#2092). A weekend with no entry is ACTIVE -- the migration
        seeds nothing, so absence of a row is the normal state and not a gap
        to warn about.
        """
        session_cm_id = _i(row, "cm_id")
        return WeekendSessionSummary(
            session_id=_s(row, "id"),
            session_cm_id=session_cm_id,
            name=_s(row, "name"),
            session_type=_s(row, "session_type"),
            start_date=_s(row, "start_date"),
            end_date=_s(row, "end_date"),
            sort_order=_i(row, "sort_order"),
            status=cls._weekend_status(statuses.get(session_cm_id, "")),
        )

    async def build_roster(
        self,
        year: int,
        session_cm_id: int,
        scenario: str = "",
        *,
        # Whether the caller may read the two staff-authored request blocks
        # (`BunkingNotes Notes`, `Internal Bunk Notes`). DEFAULTS TO FALSE:
        # a caller that forgets this shows staff less than it could, never
        # more than it may. The router passes the caller's `bunking.manage`.
        include_staff_notes: bool = False,
    ) -> WeekendRosterResponse:
        """One weekend's roster, resolved through a scenario or not.

        No scenario is the CampMinder mirror -- the synced rows, exactly as
        before this layer existed, and read-only for everyone. A scenario
        REPLACES them with its own draft rows (kindred#1974), exactly as
        summer's `useCohortBunkAssignments` swaps `bunk_assignments` for
        `bunk_assignments_draft`. A party with no draft row is UNPLACED in
        that scenario; the mirror is not consulted, and is not even read.

        AVAILABILITY used to be the exception and is not any more. 1500000135
        deleted this table's scenario dimension, so there is ONE availability
        read, issued identically with or without a scenario -- a burst pipe
        closes a cabin in every plan for that weekend. See the TaskGroup below.
        """
        session = await self.repository.fetch_session(year, session_cm_id)
        if session is None:
            raise SessionNotFoundError(f"No weekend session {session_cm_id} in {year}")

        # TWO IDS, and the difference is kindred#2042. The lodging tables are
        # keyed on the weekend's CampMinder id (migration 1500000147 re-keyed
        # their unique indexes onto `session_cm_id`), which survives a
        # camp_sessions record being recreated rather than updated. `attendees`
        # is not a lodging table and has no such column, so it is still read
        # through the PocketBase relation.
        session_pb_id = _s(session, "id")
        session_type = _s(session, "session_type")

        # TaskGroup rather than asyncio.gather: typeshed only types gather
        # precisely up to six awaitables, and beyond that every result widens to
        # `object`, which would need eleven casts to use. Tasks keep their own
        # types and still run concurrently.
        #
        # The share gate, the NEAR/WITH modes and the household-grain request
        # text all arrive as DERIVED COLUMNS on the registration row --
        # already collapsed, already carrying the normaliser fixes this layer
        # cannot see -- and none of them is re-parsed here.
        #
        # There is ONE raw read, added by kindred#2330, and it buys back
        # exactly what the collapse spends: `request_text` is a `'; '` join
        # over several source fields with no field boundary kept, so the panel
        # cannot attribute a sentence to a form or to a child without the
        # values themselves. It derives nothing -- see
        # `fetch_request_text_values`.
        async with asyncio.TaskGroup() as tg:
            units_task = tg.create_task(self.repository.fetch_units(year))
            availability_task = tg.create_task(self.repository.fetch_availability(year, session_cm_id))
            # THE OCCUPANCY HALF, split out of availability by kindred#2382,
            # and chosen exactly the way the placement source below is chosen.
            # A scenario reads its OWN write-ins and REPLACES the live ones --
            # it does not read them at all -- matching kindred#1974's
            # no-fall-through rule for `lodging_assignments_draft`. A unit with
            # no draft row holds no write-in in that scenario, whatever the
            # live board says.
            #
            # The live board is the other scope, not the absence of one: with
            # no scenario this reads `lodging_write_ins` with no scenario
            # predicate, exactly as `lodging_assignments` is read.
            #
            # A fresh scenario is seeded by an explicit COPY in both seed paths
            # (`copy_from_mirror` and `copy_scenario_to_scenario`, owner ruling
            # 2026-08-16), which is what stops it starting blank -- without it
            # kindred#2247's placement gate would let a family be dropped into
            # a room the live board records as occupied. Rendering the live
            # rows through this read's gaps would be the overlay instead, and
            # would make two scenarios unable to disagree.
            write_ins_task = tg.create_task(
                self.repository.fetch_draft_write_ins(year, session_cm_id, scenario)
                if scenario
                else self.repository.fetch_write_ins(year, session_cm_id)
            )
            attendees_task = tg.create_task(self.repository.fetch_attendees_for_session(year, session_pb_id))
            households_task = tg.create_task(self.repository.fetch_households(year))
            prior_task = tg.create_task(self.repository.fetch_prior_household_cm_ids(year))
            # kindred#2075. `year - 1` is computed HERE and nowhere else: the
            # repository read takes a plain year, so kindred#2073's
            # year-over-year view can sweep 2022-2025 with the same function.
            # The ruling limits what the CARD renders, not what can be
            # fetched.
            #
            # The only read in this group that is not for `year`. It lands in
            # the same `@cached_by_year` store under a different key -- one
            # cold fetch per year per process, not one per request -- and is
            # deliberately absent from `build_summary`'s parallel TaskGroup,
            # which keeps nothing but counts.
            last_year_cabins_task = tg.create_task(self.repository.fetch_cabin_assignments_by_household_cm_id(year - 1))
            # kindred#2332's registry index, for turning the raw string above
            # into the name the unit carries TODAY. Two reads, neither
            # year-filtered and neither cached -- see `_housing_names`.
            # Deliberately absent from `build_summary`'s TaskGroup for exactly
            # the reason last year's cabins are: no `WeekendSummaryEntry`
            # carries a party, so both would be paid on every weekend of the
            # year to name a field nothing renders.
            housing_names_task = tg.create_task(self._housing_names())
            adults_task = tg.create_task(self.repository.fetch_family_camp_adults(year))
            registrations_task = tg.create_task(self.repository.fetch_family_camp_registrations(year))
            # kindred#2330. The RAW per-field, per-child request answers --
            # the one read on this path that is not a derived column, and the
            # only reason the paragraph above needs qualifying: the gate and
            # the modes are still read off the registration row and are still
            # never re-parsed here. This read exists because the derived
            # `request_text` joins its sources with `'; '` and keeps no field
            # boundary, so the panel cannot say which form -- or which child
            # -- produced which sentence without going back to the values.
            # Absent from `build_summary`'s TaskGroup for the same reason
            # last year's cabins are.
            request_values_task = tg.create_task(self.repository.fetch_request_text_values(year))
            aliases_task = tg.create_task(self.repository.count_open_unresolved_aliases(year))
            # ONE placement source, chosen here rather than merged later. A
            # scenario does not read the mirror at all -- which is what makes
            # "no fall-through" a property of the request rather than of the
            # merge that used to follow it, and saves a session-scoped round
            # trip while it is at it.
            placements_task = tg.create_task(
                self.repository.fetch_draft_assignments(year, session_cm_id, scenario)
                if scenario
                else self.repository.fetch_assignments(year, session_cm_id)
            )
            # There is deliberately NO second availability read here. 1500000135
            # deleted this table's scenario dimension, so a scenario has nothing
            # to overlay -- see fetch_availability.
            #
            # ALWAYS fetched now, mirror included (1500000140). A merge is a
            # fact about the weekend, not only about a plan -- unlike a
            # placement, no sync writes a draw level, so there is no record of
            # truth a scenario-gated read was ever protecting here. The
            # CampMinder mirror (`scenario == ""`) still gets no SCENARIO row
            # -- there is none to have -- but it can and does have a
            # WEEKEND-LEVEL row, and fetch_slot_merges returns exactly that
            # tier for a blank scenario rather than an empty list.
            # resolve_combined then sees both tiers.
            merges_task = tg.create_task(self.repository.fetch_slot_merges(year, session_cm_id, scenario))

        households = await self._resolve_households(session_type, attendees_task.result(), households_task.result())

        write_ins = write_ins_task.result()
        unit_summaries = self._build_units(
            units_task.result(),
            availability_task.result(),
            write_ins,
            merges_task.result(),
        )
        # ONE index, threaded to both consumers below -- see `_BathroomIndex`'s
        # own "built ONCE per call" docstring. Rebuilding a second one from the
        # same `unit_summaries` for `_build_counts` was caught in review on
        # kindred#2041's PR.
        unit_index = _BathroomIndex.build(unit_summaries)
        # FIVE IN-PLACE RESOLVERS, AND `build_summary._entry` RUNS THE SAME
        # FIVE.
        #
        # This comment said "only on THIS path" until kindred#2502, on the
        # reasoning that `WeekendSummaryEntry` carries no `units` so resolving
        # there would be work no response can read. That is no longer true of
        # any of them: the identical five are wired into `_entry` now, because
        # ONE orchestrator resolving and the other not is precisely how the
        # bathroom gap survived unnoticed. See the note there for what they do
        # and do not move on that path.
        #
        # Four of them walk the leaves and write a `*_coverage` grade
        # (kindred#1912, #2224, #2438, #2502). The fifth is not a coverage
        # grade at all: it overwrites a CONTAINER's own `bathroom` from its
        # rooms. It repeats their leaf comprehension and their `is_active`
        # filter rather than calling `_resolve_amenity_coverage`, because it
        # needs `container_bathroom`'s group reasoning and that walk is
        # parameterised on one flag per room. Nothing here depends on the
        # ORDER of the five -- they are independent, and grouped because they
        # are one thought.
        _resolve_power_coverage(unit_summaries, unit_index)
        _resolve_fridge_coverage(unit_summaries, unit_index)
        _resolve_ramp_coverage(unit_summaries, unit_index)
        _resolve_ac_coverage(unit_summaries, unit_index)
        _resolve_bathroom(unit_summaries, unit_index)
        # A SECOND PASS, and it has to be: a unit's cover can come from a row
        # on a unit built after it, so there is no order in which one pass over
        # `_build_units` would see every own-row it needs.
        #
        # Only on THIS path, and since kindred#2502 it is the ONLY resolver
        # here that is. `build_summary` builds its own units to get at the
        # counts, but its `WeekendSummaryEntry` carries no `units`, so
        # resolving covers there would be work no response can read -- once per
        # weekend, across every weekend of the year, on every lander request.
        # That argument survived for THIS function and not for the five above
        # because a cover is read off `units` and nothing else; no count reads
        # one.
        #
        # kindred#2503 is where that changes. If `is_family_available` ever
        # reads the RESOLVED cover rather than the unit's own write-in row,
        # `_build_counts` reads availability, and this call has to run on both
        # paths or the lander and the board will disagree about which houses
        # are free.
        _resolve_write_in_covers(unit_summaries, written_in_unit_ids(write_ins))
        housing_names = housing_names_task.result()
        parties = self._build_parties(
            session_type=session_type,
            session_start=_as_date(_s(session, "start_date")),
            attendees=attendees_task.result(),
            households=households,
            prior_cm_ids=prior_task.result(),
            # RESOLVED HERE, not in the party builder, and at `year - 1`
            # (kindred#2332). The string came out of the PRIOR season, so the
            # prior season is the year its alias window is tested at; testing
            # it at the roster's own year would strand every row whose alias
            # carries `valid_to_year = 2024` on its raw spelling. The NAME is
            # still the present one -- the window finds the unit, it does not
            # name it.
            last_year_cabins={
                household_cm_id: housing_names.display_name(raw, year - 1)
                for household_cm_id, raw in last_year_cabins_task.result().items()
            },
            adults_by_household=adults_task.result(),
            registrations=registrations_task.result(),
            request_values=request_values_task.result(),
            include_staff_notes=include_staff_notes,
            assignments=placements_task.result(),
            unit_index=unit_index,
        )
        counts = self._build_counts(unit_summaries, parties, aliases_task.result(), unit_index)

        return WeekendRosterResponse(
            year=year,
            session_cm_id=session_cm_id,
            session_name=_s(session, "name"),
            session_type=session_type,
            parties=parties,
            units=unit_summaries,
            counts=counts,
        )

    async def build_summary(self, year: int, scenario: str = "") -> WeekendSummaryResponse:
        """Every weekend in the year with its counts, in one pass.

        `build_roster` makes SIXTEEN reads (fourteen concurrent tasks issuing
        fifteen reads -- `_housing_names` is one task making two -- plus
        `fetch_session` alone before them), of which TEN are constant across
        every weekend of the year. EIGHT of the ten are year-scoped: the unit
        registry, households, the prior-household set, family-camp adults,
        registrations, the unresolved-alias count, last year's cabins
        (kindred#2075) and the raw per-field request answers (kindred#2330).
        The other two are kindred#2332's registry-naming pair, which carry no
        year at all and are therefore constant for the same reason. Calling
        `build_roster` once per weekend to fill the lander would repeat all
        ten N times, which is why a weekend with zero parties still costs
        about three seconds.

        The lander fetches only SIX of those ten, and declines four. No
        `WeekendSummaryEntry` carries a party -- `_build_parties` runs here
        purely to be counted -- so last year's cabins
        (`RosterParty.last_year_cabin`), kindred#2330's request answers, and
        kindred#2332's two registry reads that would name the cabin all buy
        fields nothing renders. `_build_parties` takes the first two as
        defaulted keywords for exactly that reason, and the naming pair is
        simply absent from the TaskGroup below.

        kindred#1963 measures this from eleven and eight, so that issue is
        partly pre-paid: kindred#1889 deleted `has_medical_narrative`, the only
        consumer of the whole-year `family_camp_medical` map, and kindred#1995
        deleted `count_unconfirmed_units` -- `units_unconfirmed` is now derived
        in `_build_counts` from units already in hand rather than fetched.

        So the year-scoped work happens once here, and only the genuinely
        session-scoped reads run per weekend: availability, write-ins,
        attendees and one placement read -- the synced rows, or the scenario's
        own. The
        per-weekend numbers then come from the SAME `_build_units` /
        `_build_parties` / `_build_counts` helpers the roster uses, so the
        lander cannot drift from the page it links to, and it resolves a
        scenario the same way: replace, never fall through.

        FIVE session-scoped reads per weekend, with or without a scenario:
        availability, one write-in source, attendees, one placement source, and
        slot merges (the last of these unconditional since 1500000140). The two
        "one source" reads are the scenario-aware pair -- the live table or the
        scenario's draft, never both. A `Semaphore` below
        bounds how many weekends' worth of those run at once -- kindred#1920,
        which also records why a per-weekend cap was chosen over collapsing
        the placement read to one call for the whole year.
        """
        sessions = await self.repository.fetch_weekend_sessions(year)
        if not sessions:
            return WeekendSummaryResponse(year=year, weekends=[])

        async with asyncio.TaskGroup() as tg:
            units_task = tg.create_task(self.repository.fetch_units(year))
            households_task = tg.create_task(self.repository.fetch_households(year))
            prior_task = tg.create_task(self.repository.fetch_prior_household_cm_ids(year))
            adults_task = tg.create_task(self.repository.fetch_family_camp_adults(year))
            registrations_task = tg.create_task(self.repository.fetch_family_camp_registrations(year))
            aliases_task = tg.create_task(self.repository.count_open_unresolved_aliases(year))
            # Season-scoped like the six above, and read HERE rather than per
            # weekend for the same reason: it is one small table for the whole
            # year, and the lander must badge from the same map `/sessions`
            # reads or the two pages would disagree about a weekend.
            #
            # Wrapped, not the raw repository call: this TaskGroup has six
            # OTHER reads in it, and this is the one PocketBase collection
            # that can legitimately not exist yet (a fresh migration). See
            # `_fetch_session_statuses_or_active` for why a failed read here
            # must not cancel the other six and 500 the lander.
            statuses_task = tg.create_task(self._fetch_session_statuses_or_active(year))

        units = units_task.result()
        households = households_task.result()
        prior_cm_ids = prior_task.result()
        adults_by_household = adults_task.result()
        registrations = registrations_task.result()
        unresolved_aliases = aliases_task.result()
        statuses = statuses_task.result()

        # Bounds how many weekends' four-read TaskGroups run at once. Per-year
        # (one instance per `build_summary` call), not module-level -- see
        # SUMMARY_ENTRY_CONCURRENCY.
        entry_gate = asyncio.Semaphore(SUMMARY_ENTRY_CONCURRENCY)

        async def _entry(session: Any) -> WeekendSummaryEntry:
            # Both ids, read off THIS weekend's record -- see build_roster's
            # own note. `_entry` runs once per weekend, so a session id hoisted
            # out of this closure would report every weekend against the first
            # one's placements.
            session_pb_id = _s(session, "id")
            entry_cm_id = _i(session, "cm_id")
            async with entry_gate, asyncio.TaskGroup() as inner:
                availability_task = inner.create_task(self.repository.fetch_availability(year, entry_cm_id))
                # Exactly as build_roster reads it, SCENARIO AND ALL, and
                # separately, because this is a DIFFERENT TaskGroup -- wiring
                # one and leaving the other is the half-fix the guards in this
                # file's tests exist to catch. The lander keeps only counts,
                # and every count on it goes through `is_family_available`, so
                # a weekend card that read the wrong scope would report a
                # written-into cabin as open beside a board that draws it
                # closed.
                write_ins_task = inner.create_task(
                    self.repository.fetch_draft_write_ins(year, entry_cm_id, scenario)
                    if scenario
                    else self.repository.fetch_write_ins(year, entry_cm_id)
                )
                attendees_task = inner.create_task(self.repository.fetch_attendees_for_session(year, session_pb_id))
                # One placement source, exactly as build_roster chooses it.
                placements_task = inner.create_task(
                    self.repository.fetch_draft_assignments(year, entry_cm_id, scenario)
                    if scenario
                    else self.repository.fetch_assignments(year, entry_cm_id)
                )
                # No second availability read, exactly as build_roster issues
                # none. These are separate TaskGroups and fixing only one of
                # them is the half-fix the guard tests exist to catch.
                #
                # Merges are ALWAYS fetched, exactly as build_roster now does
                # (1500000140) -- the mirror gets the weekend-level tier
                # rather than an empty list.
                merges_task = inner.create_task(self.repository.fetch_slot_merges(year, entry_cm_id, scenario))

            # Own local variable, not a mutation of the shared `households`
            # above: `_entry` runs concurrently, one per weekend, in the
            # TaskGroup below, and `_resolve_households` returns a merged
            # COPY rather than patching in place (kindred#2143) -- so two
            # weekends resolving different missing households at once can
            # never step on each other or leak one weekend's fresh fetch into
            # another's.
            session_households = await self._resolve_households(
                _s(session, "session_type"), attendees_task.result(), households
            )

            unit_summaries = self._build_units(
                units,
                availability_task.result(),
                write_ins_task.result(),
                merges_task.result(),
            )
            # Same one-index-per-call rule `build_roster` follows -- see the
            # comment there and `_BathroomIndex`'s own docstring.
            unit_index = _BathroomIndex.build(unit_summaries)
            # ⚠️ THIS PATH RAN NONE OF THE AMENITY RESOLVERS UNTIL kindred#2502.
            # `build_roster` runs all five right after building its index; this
            # one built the index and went straight to `_build_counts`, so every
            # coverage field stayed at its `"unknown"` default and a container's
            # bathroom stayed at its own blank row while the board resolved it.
            #
            # ALL FIVE MOVE NO NUMBER ON THIS PATH TODAY -- not four of them.
            # An earlier draft of this comment left the fifth unexplained, and
            # CodeRabbit read the gap the obvious way and asked for
            # `_resolve_bathroom`'s call to be deleted as having no observable
            # effect. The premise is right; the repair is not. Both halves,
            # verified rather than asserted:
            #
            #   * `_build_counts` reads `is_active`, `inventory_class`,
            #     `is_family_available`, `sleeps` and `is_confirmed`. It reads
            #     no `*_coverage` field and no `bathroom`, and
            #     `WeekendSummaryEntry` exposes nothing but `session` and
            #     `counts`.
            #   * `_resolve_bathroom` writes a CONTAINER's `bathroom`, and the
            #     one function on this path that could read it back --
            #     `_resolve_party_bathroom`, via `_build_parties` -- recomputes
            #     a container's answer from its leaves instead of reading the
            #     container's own field. So the overwrite is invisible there
            #     too.
            #
            # They are wired anyway, and deleting the call is the wrong repair,
            # because the ASYMMETRY is the defect rather than a consequence of
            # it. One orchestrator resolving and the other not is exactly how
            # the bathroom gap survived unnoticed, and the next reader of a
            # coverage field here -- a count over `power_coverage`, a
            # `WeekendSummaryEntry` that grows a units field -- would inherit
            # the gap silently, holding a plausible-looking `"unknown"` rather
            # than failing.
            _resolve_power_coverage(unit_summaries, unit_index)
            _resolve_fridge_coverage(unit_summaries, unit_index)
            _resolve_ramp_coverage(unit_summaries, unit_index)
            _resolve_ac_coverage(unit_summaries, unit_index)
            _resolve_bathroom(unit_summaries, unit_index)
            parties = self._build_parties(
                session_type=_s(session, "session_type"),
                # THIS weekend's start. The six year-scoped fetches above are
                # shared across every weekend in the year; the as-of date is
                # emphatically not one of them.
                session_start=_as_date(_s(session, "start_date")),
                attendees=attendees_task.result(),
                households=session_households,
                prior_cm_ids=prior_cm_ids,
                adults_by_household=adults_by_household,
                registrations=registrations,
                assignments=placements_task.result(),
                unit_index=unit_index,
            )
            return WeekendSummaryEntry(
                session=self._session_summary(session, statuses),
                counts=self._build_counts(unit_summaries, parties, unresolved_aliases, unit_index),
            )

        async with asyncio.TaskGroup() as tg:
            entry_tasks = [tg.create_task(_entry(session)) for session in sessions]

        return WeekendSummaryResponse(year=year, weekends=[task.result() for task in entry_tasks])

    async def get_household_medical(self, year: int, household_cm_id: int) -> HouseholdMedicalResponse:
        """The medical narrative. The router gates this on `bunking.manage`.

        Two narrow reads, deliberately sequential: the household resolves the
        PB id that the medical read is anchored to. The whole-year maps this
        used to scan would put every family's narrative in memory to answer
        one -- a disclosure problem before it is a performance one.
        """
        household = await self.repository.fetch_household_by_cm_id(year, household_cm_id)
        household_pb_id = _s(household, "id") if household is not None else ""
        record = await self.repository.fetch_medical_for_household(year, household_pb_id)
        if record is None:
            return HouseholdMedicalResponse(household_cm_id=household_cm_id, year=year)
        return HouseholdMedicalResponse(
            household_cm_id=household_cm_id,
            year=year,
            **{field: _s(record, field) for field in sorted(MEDICAL_NARRATIVE_FIELD_NAMES)},
        )

    async def _housing_names(self) -> HousingNameResolver:
        """The registry, indexed for naming -- kindred#2332's one helper.

        TWO READS, NEITHER YEAR-FILTERED, and both deliberately uncached (see
        their docstrings). `lodging_units` is year-scoped and holds 2026 only,
        so the season that NAMES a unit has to be discovered from the table;
        `lodging_unit_aliases` has no year column at all, because a row's
        window is a rename history rather than a per-year copy.

        The flattening happens here and the rule happens in `lodging_rules`,
        which is what keeps the resolution total over plain values and
        unit-testable without a database.
        """
        units, aliases = await asyncio.gather(
            self.repository.fetch_all_units(),
            self.repository.fetch_unit_aliases(),
        )
        return HousingNameResolver.build(
            [
                RegistryUnit(
                    unit_id=_s(unit, "id"),
                    code=_s(unit, "code"),
                    name=_s(unit, "name"),
                    year=_i(unit, "year"),
                    # The RAW relation value, which is a PocketBase record id
                    # and not a code -- joining `parent_unit` against `code`
                    # returns nothing, silently. `_build_units` publishes the
                    # code form for the board; the collapse rule needs the id
                    # form, because that is what it is stored as.
                    parent_id=_s(unit, "parent_unit"),
                )
                for unit in units
            ],
            [
                UnitAlias(
                    alias_string=_s(alias, "alias_string"),
                    member_unit_ids=tuple(str(member) for member in (getattr(alias, "member_units", None) or [])),
                    valid_from_year=_i(alias, "valid_from_year"),
                    valid_to_year=_i(alias, "valid_to_year"),
                )
                for alias in aliases
            ],
        )

    async def build_household_journey(self, household_cm_id: int) -> HouseholdJourneyResponse:
        """A household's family-camp record, year by year (kindred#2073).

        THE WINDOW IS DISCOVERED, NOT CHOSEN. A year appears when the
        household has a trace in it, and the three traces disagree about which
        years exist: attendance reaches back to 2017, housing only to 2022,
        and between 24 and 89 registrations a year carry neither an enrolled
        child nor an adult row. Taking their union is what makes the view
        honest about a four-year housing window sitting inside a longer
        attendance one -- and a hard-coded floor would either invent empty
        rows or truncate a long-standing family.

        The cabin comes from kindred#2075's helper, once per traced year. That
        helper takes a plain year precisely so this can sweep, and composing
        over it is what keeps ONE definition of "where did they sleep": it
        already knows that `cabin_assignment` is free text, that the bridge is
        `households.cm_id` and not the PB id, and that a year before 2022
        answers nothing. A second query here would be a second answer.

        HOUSEHOLD GRAIN, NOT CAMPER GRAIN. Each year's members are built from
        that year's rows and no other's -- children age out, adults change,
        and a party carried forward would show a family who no longer exists.

        Concurrency mirrors the roster's: the three cross-year reads go
        together, then the per-year cabin reads go together. The cabin reads
        are `@cached_by_year`, so a year the roster already loaded is free and
        a four-year sweep pays each year once per process.
        """
        # An unresolvable household (`household_cm_id = 0`) reads nothing --
        # each repository method refuses it too, but returning here keeps the
        # sweep from running against an empty trace set as though it were a
        # real first-time family.
        if household_cm_id <= 0:
            return HouseholdJourneyResponse(household_cm_id=household_cm_id)

        attendees, adults_by_year, registration_years = await asyncio.gather(
            self.repository.fetch_household_family_attendees(household_cm_id),
            self.repository.fetch_household_adults_by_year(household_cm_id),
            self.repository.fetch_household_registration_years(household_cm_id),
        )

        children_by_year: dict[int, list[Any]] = {}
        # kindred#2420: each traced child's age has to be computed at THAT
        # CHILD'S OWN family session start, not at the year's earliest
        # camp-wide family session -- a season runs several (6 to 10 a year
        # on the production snapshot, from May through December), and a
        # household attends whichever one it booked, not necessarily the
        # first of the year. Keyed the same way `seen_by_year` below is, so
        # the year's earliest of THIS CHILD'S OWN attendee rows wins, ties
        # included, without a second pass over `attendees`.
        session_start_by_year: dict[int, dict[Any, date]] = {}
        # A JOURNEY ROW IS A YEAR, NOT A SESSION, and this is where that stops
        # being a wording point. A family can book two of a season's weekends,
        # which gives one child TWO enrolled family attendee rows in the same
        # year -- both expanding to the SAME `persons` record, because
        # `persons` is per-year rather than per-enrollment. Measured on the
        # production snapshot 2026-08-09: 9 to 20 children a year from 2017
        # on, across 64 distinct (household, year) pairs.
        #
        # Keyed on the CampMinder person id, which is the identity the wire
        # already publishes the child under (`PartyChild.person_cm_id`) and
        # the key the members modal renders each <li> with -- so a duplicate
        # here is a duplicate name, a headcount overstated by one, and two
        # React children under one key. The PB record id is the fallback for
        # the rare person row with no cm_id; a row with neither is kept rather
        # than collapsed onto every other anonymous sibling.
        seen_by_year: dict[int, set[Any]] = {}
        # WHICH WEEKENDS, and who went to which (kindred#2393). Both fall out
        # of the SAME attendee rows the members already come from, so the
        # session grain costs no extra round trip -- `session` has been in the
        # expand since kindred#2420.
        #
        # Filled BEFORE the dedup below, deliberately: the second attendee row
        # for a child is exactly the second weekend, so skipping it here would
        # publish a multi-weekend year as a single-weekend one and then pin the
        # cabin to it -- the precise wrong answer `AttributeSession` refuses to
        # give.
        sessions_by_year: dict[int, dict[int, HouseholdJourneySession]] = {}
        child_sessions_by_year: dict[int, dict[Any, set[int]]] = {}
        for attendee in attendees:
            expand = getattr(attendee, "expand", None) or {}
            person = expand.get("person")
            if person is None:
                continue
            year = _i(attendee, "year")
            identity = _child_identity(person)
            session = expand.get("session")
            start = _as_date(_s(session, "start_date")) if session is not None else None
            if identity and start is not None:
                starts = session_start_by_year.setdefault(year, {})
                existing = starts.get(identity)
                if existing is None or start < existing:
                    starts[identity] = start
            # `cm_id` and not the PB record id: it is the identity the wire
            # publishes a weekend under everywhere else, and the key the
            # client tabs on. A session row without one is dropped rather
            # than published as weekend 0, which would collapse every
            # unidentified weekend onto a single tab.
            session_cm_id = _i(session, "cm_id") if session is not None else 0
            if session_cm_id:
                year_sessions = sessions_by_year.setdefault(year, {})
                if session_cm_id not in year_sessions:
                    year_sessions[session_cm_id] = HouseholdJourneySession(
                        session_cm_id=session_cm_id,
                        # VERBATIM. The client abbreviates it for the panel
                        # (`weekendLabel`); the wire carries what CampMinder
                        # calls the weekend.
                        name=_s(session, "name"),
                        start_date=_s(session, "start_date"),
                    )
                if identity:
                    child_sessions_by_year.setdefault(year, {}).setdefault(identity, set()).add(session_cm_id)
            if identity:
                seen = seen_by_year.setdefault(year, set())
                if identity in seen:
                    continue
                seen.add(identity)
            children_by_year.setdefault(year, []).append(person)

        # Year 0 is not a year. A row whose `year` column never populated
        # would otherwise open the journey with a blank heading.
        years = [
            year
            for year in sorted(
                set(children_by_year) | set(adults_by_year) | set(registration_years),
                reverse=True,
            )
            if year > 0
        ]
        # The cabin sweep and the registry read go together: the sweep is
        # `@cached_by_year` and usually free, the registry read never is, and
        # neither depends on the other.
        cabin_maps, housing_names = await asyncio.gather(
            asyncio.gather(*(self.repository.fetch_cabin_assignments_by_household_cm_id(year) for year in years)),
            self._housing_names(),
        )

        rows: list[HouseholdJourneyYear] = []
        for year, assignments in zip(years, cabin_maps, strict=True):
            cabin = assignments.get(household_cm_id, "")
            children = _children_oldest_first(children_by_year.get(year, []))
            year_starts = session_start_by_year.get(year, {})
            year_sessions_ordered = sorted(sessions_by_year.get(year, {}).values(), key=_session_order)
            child_sessions = child_sessions_by_year.get(year, {})
            rows.append(
                HouseholdJourneyYear(
                    year=year,
                    # PRESENCE, not resolvability: a string nobody can map is
                    # still a household that was placed. Deriving the state
                    # from `cabin_name` instead would report the three
                    # unmappable strings (kindred#2392) as unplaced families.
                    housing=_housing_state(cabin, assignments),
                    # kindred#2332. THIS ROW'S OWN YEAR is the alias window --
                    # the window says which raw string was in use then, which
                    # is what finds the unit. The name is always the present
                    # one.
                    cabin_name=housing_names.display_name(cabin, year),
                    cabin_name_raw=cabin,
                    sessions=year_sessions_ordered,
                    # THE GO INGEST'S REFUSAL, MIRRORED (kindred#2393).
                    # `AttributeSession` pins the year's one cabin string to a
                    # weekend only when the household attended exactly one; a
                    # read surface that guessed where the ingest declines
                    # would put the two into disagreement about the same fact.
                    #
                    # `cabin` and not `housing == "placed"` for the same
                    # reason `_housing_state` reads presence: an unmappable
                    # string is still a cabin to attribute. With no cabin
                    # there is nothing to pin, and publishing the weekend id
                    # anyway would read as "housed in FC1" for a household
                    # nobody placed.
                    housing_session_cm_id=(
                        year_sessions_ordered[0].session_cm_id if cabin and len(year_sessions_ordered) == 1 else None
                    ),
                    # An empty child list is NOT a childless family: 2020 was
                    # cancelled outright and 2021 has no family attendee rows
                    # at all. Naming the state here is what stops the client
                    # rendering either as an error or as a family with no kids.
                    enrollment="enrolled" if children else "none_on_file",
                    adults=[_party_adult(adult) for adult in adults_by_year.get(year, [])],
                    children=[
                        # Each child's OWN attended session start
                        # (kindred#2420) -- `None` when this child's
                        # attendee row carried no readable session date
                        # (e.g. an unexpanded `session` relation, or a
                        # camp_sessions row missing `start_date`), in which
                        # case `_party_child` keeps the current-season
                        # fallback rather than guessing at a camp-wide date.
                        _party_child(
                            child,
                            as_of=year_starts.get(_child_identity(child)),
                            # Ordered through the YEAR'S ordering rather than
                            # sorted again, so a child's weekends read in the
                            # same left-to-right order the row's own weekend
                            # line does. One rule, applied once.
                            session_cm_ids=[
                                entry.session_cm_id
                                for entry in year_sessions_ordered
                                if entry.session_cm_id in child_sessions.get(_child_identity(child), frozenset())
                            ],
                        )
                        for child in children
                    ],
                )
            )
        return HouseholdJourneyResponse(household_cm_id=household_cm_id, years=rows)

    # ---------------------------------------------------------------- units

    def _build_units(
        self, units: list[Any], availability: list[Any], write_ins: list[Any], merges: list[Any]
    ) -> list[LodgingUnitSummary]:
        # TWO SOURCES, ONE FIELD, and the split between them is kindred#2382.
        #
        # `lodging_availability` answers the staff<->family ROLE question --
        # "a staff cabin opened to families for this weekend" -- and keeps its
        # no-scenario shape, because that is an operational fact about the
        # WEEKEND and 1500000135's reasoning is exactly right for it.
        # `lodging_write_ins` answers OCCUPANCY: somebody is in the room. That
        # is a modelling fact (not every write-in is non-rostered staff -- some
        # are paper registrations for families arriving with no children), so it
        # got a table of its own with a scenario-scoped draft twin beside it.
        #
        # ONE layer each, and still no overlay -- but since PR 3 of
        # kindred#2382 the two halves SCOPE differently. The role rows are the
        # same for every plan (`lodging_availability` has no scenario column).
        # The write-in rows are whichever table the caller already chose, the
        # live one or a scenario's own draft, and a scenario REPLACES -- so
        # what arrives here is the whole occupancy answer for the scope that
        # was asked for, and nothing below merges a second source into it.
        role_row_by_unit = {_s(row, "unit"): row for row in availability}
        write_in_row_by_unit = {_s(row, "unit"): row for row in write_ins}

        # id -> code, so the parent relation can be published as a code.
        code_by_id = {_s(unit, "id"): _s(unit, "code") for unit in units}

        # Two tiers in one list (1500000140), split on whether the row's own
        # `scenario` is set. Absent row at EITHER tier means inherit -- see
        # resolve_combined -- so this builds two dicts rather than merging
        # session-level rows into `scenario_merge_by_unit` under a `, False`
        # default, which would collapse "no scenario row" into "scenario row
        # says split" and make a weekend-level combine unreachable from a
        # scenario that never touched the unit. Both keyed by unit id, which
        # is what the relation stores.
        scenario_merge_by_unit: dict[str, bool] = {}
        session_merge_by_unit: dict[str, bool] = {}
        for row in merges:
            target = scenario_merge_by_unit if _s(row, "scenario") else session_merge_by_unit
            target[_s(row, "unit")] = _b(row, "combined")

        # Bathroom groups are computed across ALL units, because a group's
        # membership does not depend on the session.
        group_members: dict[str, set[str]] = {}
        for unit in units:
            group = _s(unit, "bathroom_group")
            if group:
                group_members.setdefault(group, set()).add(_s(unit, "code"))

        summaries: list[LodgingUnitSummary] = []
        for unit in units:
            map_x, map_y = _map_point(unit)
            code = _s(unit, "code")
            group = _s(unit, "bathroom_group")
            area = (getattr(unit, "expand", None) or {}).get("area")
            inventory_class = _s(unit, "inventory_class")
            unit_id = _s(unit, "id")
            role_row = role_row_by_unit.get(unit_id)
            write_in_row = write_in_row_by_unit.get(unit_id)
            # TWO FIELDS, TWO QUESTIONS, since PR 4 of kindred#2382 took the
            # compat shim out. `family_available_override` is now the ROLE row
            # and nothing else -- a staff cabin opened to families for the
            # weekend, or a bare `false` closing one -- while "is somebody in
            # this space" is answered by `write_ins` alone. Until PR 4 this field
            # reported `False` for an occupancy too, because
            # `is_family_available` and the board's open-tint were both derived
            # from it; both read the occupancy source directly now.
            #
            # A unit with NO role row maps to None, never False: those are
            # different answers, and `bool(...)` on a missing row would close
            # every cabin nobody has said anything about. A written-into unit
            # with no role row is exactly that case -- the write-in says
            # nothing about the role, so neither does this.
            #
            # Occupancy still OUTRANKS the role, but in the DERIVED answer
            # rather than by overwriting the role on the wire: see
            # `is_family_available` below and its rule in lodging_rules.py.
            #
            # BOTH ROWS AT ONCE IS REACHABLE, and stopped needing a race in PR
            # 4 of kindred#2382. `set_availability` still drops the fact it is
            # not writing, but the occupancy drop is scoped to the caller's own
            # grain while the role row is shared by every scope -- so writing
            # somebody into a cabin on the live board and then releasing it
            # from inside a scenario leaves the live write-in standing beside
            # the new role row. Two staff racing on one cabin get there too.
            # Either way the safe answer is the closed one, which is what the
            # derivation returns.
            override = _maybe_bool(role_row, "family_available")
            # Display text travels BESIDE the decision, never into it, and it
            # comes from whichever row supplied the decision. Stored in the
            # `note` column (1500000118's header says why `note` was kept
            # rather than renamed to `reason`); surfaced to the API as
            # `reason`. This and `set_availability` are the only two places
            # that translate.
            #
            # WHO is in the room (kindred#2078) is translated nowhere: the
            # column and the API field share one name, so unlike `note`/`reason`
            # there is nothing here that can drift out of step with a writer.
            source_row = write_in_row if write_in_row is not None else role_row
            summaries.append(
                LodgingUnitSummary(
                    unit_id=unit_id,
                    code=code,
                    name=_s(unit, "name"),
                    area_code=_s(area, "code") if area is not None else "",
                    area_name=_s(area, "name") if area is not None else "",
                    area_sort_order=_i(area, "sort_order") if area is not None else 0,
                    sleeps=unit_capacity(_i(unit, "sleeps")),
                    # The units INVENTORY evaluates each unit as its own
                    # one-element slot, so a room that only clears the
                    # bathroom bar as half of a two-room placement is scored
                    # here as if it stood alone. (Multi-room placements do
                    # reach the roster: a placement whose `units` set has 2+
                    # members sets RosterParty.is_merged_slot and lists every
                    # leaf code on RosterParty.unit_codes -- so the gap is
                    # here, on the inventory, not on the surface as a whole.)
                    # When the board ships, pass the occupying placement's
                    # unit_codes here instead of the single unit's own code.
                    bathroom=cast(
                        Any,
                        effective_bathroom(
                            _s(unit, "bathroom"),
                            group,
                            frozenset(group_members.get(group, set())),
                            frozenset({code}),
                        ),
                    ),
                    bathroom_group=group,
                    near_bathhouse=_b(unit, "near_bathhouse"),
                    has_power=_b(unit, "has_power"),
                    has_ac=_b(unit, "has_ac"),
                    has_fridge=_b(unit, "has_fridge"),
                    has_shared_fridge=_b(unit, "has_shared_fridge"),
                    # RAILED to the select's own vocabulary, not cast, so a
                    # grade this code has never heard of reads as NOT ASSESSED
                    # rather than leaking into the payload's Literal
                    # (kindred#2438). See `_ramp_assessment`.
                    has_ramp=_ramp_assessment(_s(unit, "has_ramp")),
                    is_accessible=_b(unit, "is_accessible"),
                    is_confirmed=_b(unit, "is_confirmed"),
                    is_active=_b(unit, "is_active"),
                    is_container=_b(unit, "is_container"),
                    parent_code=code_by_id.get(_s(unit, "parent_unit"), ""),
                    is_combined=resolve_combined(
                        default=_b(unit, "default_combined"),
                        override=scenario_merge_by_unit.get(unit_id),
                        session_override=session_merge_by_unit.get(unit_id),
                    ),
                    inventory_class=inventory_class,
                    # cast, not a re-derivation: `unit_shareability` is total
                    # over the Literal's three members and rails everything
                    # else to `unknown`, but mypy cannot narrow a `str` return
                    # to the Literal on its own.
                    shareability=cast(Shareability, unit_shareability(_s(unit, "shareability"))),
                    family_available_override=override,
                    # `_s` is total over a missing row -- `getattr(None, ..., "")`
                    # -- so "no row at either source" reads as blank without a
                    # second branch. `_maybe_bool` above needs its own, because
                    # blank is not one of the three answers the decision has.
                    occupant_name=_s(source_row, "occupant_name"),
                    reason=_s(source_row, "note"),
                    # THREE inputs, and the third is the split's whole point:
                    # the ROLE from `lodging_availability`, and OCCUPANCY from
                    # whichever write-in table this request resolved to. The
                    # number staff read does not move -- what moved is that it
                    # is now derived from two named facts instead of from one
                    # boolean carrying both.
                    is_family_available=is_family_available(
                        inventory_class, override, is_occupied=write_in_row is not None
                    ),
                    map_x=map_x,
                    map_y=map_y,
                )
            )
        return summaries

    # -------------------------------------------------------------- parties

    async def _resolve_households(
        self, session_type: str, attendees: list[Any], households: dict[str, Any]
    ) -> dict[str, Any]:
        """`households`, patched with any household a fresh attendee names
        that the cached year snapshot does not have (kindred#2143).

        `households` is cached for up to 15 minutes (`fetch_households`,
        kindred#1963); `attendees` is fetched fresh on every call, in the
        SAME TaskGroup. A household created after the snapshot was cached is
        absent from the cached dict even though a brand-new attendee can
        already name it -- the fresh half of this mixed read outrunning the
        cached half. Left alone, `_build_household_parties` falls through to
        a blank record: display_name renders "Household 0" and is_returning
        reads False for a family that may have been coming for years.

        Person-grain (adult weekend) parties never read `households` at all
        (see `_build_parties`), so there is nothing to patch and no reason to
        pay for the check.

        Scoped to exactly the missing ids -- typically zero -- and never
        written back to `lodging_cache`: this is a per-request patch for a
        rare race, not a second cache to keep coherent with the first.
        """
        if session_type == "adult":
            return households
        missing_ids = sorted(
            {
                household_pb_id
                for attendee in attendees
                if (person := (getattr(attendee, "expand", None) or {}).get("person")) is not None
                and (household_pb_id := _s(person, "household"))
                and household_pb_id not in households
            }
        )
        if not missing_ids:
            return households
        fresh = await self.repository.fetch_households_by_ids(missing_ids)
        if not fresh:
            return households
        logger.info(f"Lodging roster: fetched {len(fresh)} household(s) fresh past the {len(households)}-entry cache")
        return {**households, **fresh}

    def _build_parties(
        self,
        *,
        session_type: str,
        session_start: date | None,
        attendees: list[Any],
        households: dict[str, Any],
        prior_cm_ids: set[int],
        adults_by_household: dict[str, list[Any]],
        registrations: dict[str, Any],
        assignments: list[Any],
        unit_index: _BathroomIndex,
        # kindred#2075, keyed by household cm_id. DEFAULTED, unlike
        # `prior_cm_ids` beside it, because omitting it is a choice a caller
        # legitimately makes: `build_summary` reads nothing off a party but
        # its counts, so fetching a whole prior year to fill a field nothing
        # renders would put back the cost kindred#1963 bought out. Every
        # OTHER argument here is required precisely because a caller that
        # dropped it would silently degrade the roster.
        last_year_cabins: dict[int, str] | None = None,
        # kindred#2330's raw per-field, per-child request answers, keyed by
        # household PB id. DEFAULTED for exactly the reason above: no
        # `WeekendSummaryEntry` carries a party, so the lander would pay two
        # extra year-scoped reads to build provenance blocks nothing renders.
        request_values: Mapping[str, list[RequestValueRow]] | None = None,
        # Same default and the same reason as `build_roster`'s: withhold.
        include_staff_notes: bool = False,
    ) -> list[RosterParty]:
        placement_by_household, placement_by_person = self._index_assignments(assignments)

        if session_type == "adult":
            return self._build_person_parties(attendees, placement_by_person, unit_index)

        return self._build_household_parties(
            attendees=attendees,
            # THIS weekend's start, not the year's. Required rather than
            # defaulted: the infant discount is measured against it, and a
            # caller that quietly omitted it would stop discounting on every
            # weekend at once with nothing to notice.
            session_start=session_start,
            households=households,
            prior_cm_ids=prior_cm_ids,
            last_year_cabins=last_year_cabins or {},
            adults_by_household=adults_by_household,
            registrations=registrations,
            request_values=request_values or {},
            include_staff_notes=include_staff_notes,
            placement_by_household=placement_by_household,
            bathroom_index=unit_index,
        )

    @staticmethod
    def _placement_of(row: Any) -> _Placement | None:
        """A row's resolved placement, or None.

        None means the row places nobody. On a synced row that is an orphan --
        every unit it named was deleted out from under it, which the DB allows
        -- and on a draft row it is the same thing: a row that says nothing.
        It used to mean more on a draft row (the tombstone, which suppressed
        the CampMinder mirror underneath); kindred#1974 removed the mirror
        from under a scenario, so there is nothing left to suppress.

        Bookability is not this function's concern. A unit that resolves --
        even a container, even an inactive one -- still places the party, and
        never reads as an unresolvable id. Whether staff CAN place a party
        onto such a unit is a write-path question.

        One unit is a normal placement; 2+ read as a merged slot with no unit
        code -- byte for byte the shape the old `lodging_merges` row produced,
        so callers and the board are unaffected by the collapse to one
        relation.
        """
        units = resolved_units(row)
        if not units:
            return None
        codes = tuple(_s(u, "code") for u in units)
        if len(units) == 1:
            return _Placement(codes[0], _s(units[0], "name"), False, codes)
        return _Placement("", " + ".join(_s(u, "name") for u in units), True, codes)

    def _index_assignments(self, assignments: list[Any]) -> tuple[dict[int, _Placement], dict[int, _Placement]]:
        """Map cm_id -> its resolved placement.

        One source, whichever the caller chose: the synced rows in production
        mode, a scenario's own rows under a scenario. There is no merge step
        -- that was the overlay, and kindred#1974 removed it.
        """
        by_household: dict[int, _Placement] = {}
        by_person: dict[int, _Placement] = {}
        for row in assignments:
            placement = self._placement_of(row)
            if placement is None:
                continue
            grain = placement_grain(row)
            if grain is None:
                continue
            if grain[0] == "person":
                by_person[grain[1]] = placement
            else:
                by_household[grain[1]] = placement
        return by_household, by_person

    def _build_person_parties(
        self,
        attendees: list[Any],
        placement_by_person: dict[int, _Placement],
        bathroom_index: _BathroomIndex,
    ) -> list[RosterParty]:
        parties: list[RosterParty] = []
        for attendee in attendees:
            person = (getattr(attendee, "expand", None) or {}).get("person")
            if person is None:
                continue
            person_cm_id = _i(person, "cm_id") or _i(attendee, "person_id")
            placement = placement_by_person.get(person_cm_id, _NO_PLACEMENT)
            parties.append(
                RosterParty(
                    grain="person",
                    person_cm_id=person_cm_id,
                    display_name=_person_display_name(person),
                    sort_name=_s(person, "last_name") or _last_token(_person_display_name(person)),
                    adults=[PartyAdult(adult_number=1, display_name=_person_display_name(person))],
                    party_size=1,
                    unit_code=placement.unit_code,
                    unit_name=placement.unit_name,
                    is_merged_slot=placement.is_merged_slot,
                    unit_codes=list(placement.unit_codes),
                    effective_bathroom=cast(
                        EffectiveBathroom, _resolve_party_bathroom(list(placement.unit_codes), bathroom_index)
                    ),
                )
            )
        parties.sort(key=lambda p: (p.sort_name.casefold(), p.display_name.casefold()))
        return parties

    def _build_household_parties(
        self,
        *,
        attendees: list[Any],
        session_start: date | None,
        households: dict[str, Any],
        prior_cm_ids: set[int],
        last_year_cabins: dict[int, str],
        adults_by_household: dict[str, list[Any]],
        registrations: dict[str, Any],
        request_values: Mapping[str, list[RequestValueRow]],
        include_staff_notes: bool,
        placement_by_household: dict[int, _Placement],
        bathroom_index: _BathroomIndex,
    ) -> list[RosterParty]:
        if session_start is None:
            # SAY IT. The keyword above is required rather than defaulted so a
            # caller cannot silently switch the infant discount off; an
            # unreadable `start_date` switches it off for the whole weekend
            # from the data side, where that guard cannot reach. Every party
            # keeps its infant bed and the board looks entirely ordinary.
            #
            # One line per roster build, and only on the broken path -- a
            # warning on the ordinary path would appear on every weekend and
            # stop being read. Deliberately NOT extended to a child's missing
            # `birthdate`: that loses one bed's worth of discount, toward
            # keeping the bed, and coverage on the rostered cohort is 100%.
            logger.warning(
                "Lodging roster: unreadable session start_date -- the infant bed discount is off for this weekend"
            )
        children_by_household: dict[str, list[Any]] = {}
        for attendee in attendees:
            person = (getattr(attendee, "expand", None) or {}).get("person")
            if person is None:
                continue
            household_pb_id = _s(person, "household")
            if not household_pb_id:
                continue
            children_by_household.setdefault(household_pb_id, []).append(person)

        parties: list[RosterParty] = []
        for household_pb_id, children in children_by_household.items():
            household = households.get(household_pb_id)
            household_cm_id = _i(household, "cm_id") if household is not None else 0
            registration = registrations.get(household_pb_id)
            adults = adults_by_household.get(household_pb_id, [])
            placement = placement_by_household.get(household_cm_id, _NO_PLACEMENT)
            children_oldest_first = _children_oldest_first(children)
            # THE BED COUNT, and the only two terms in it (kindred#1925,
            # kindred#2046). Both are narrower than the rows they come from:
            # a five-slot adult scrape holds blanks and placeholders, and a
            # child under 18 months brings no bed. The ROWS are published
            # unchanged below -- only the count is filtered, so the frontend
            # can still show what it chose not to count.
            beds = sum(1 for adult in adults if is_attending_adult_name(_adult_display_name(adult)))
            beds += sum(1 for child in children if _consumes_a_bed(child, session_start))

            parties.append(
                RosterParty(
                    grain="household",
                    household_cm_id=household_cm_id,
                    display_name=_household_display_name(household, household_cm_id),
                    sort_name=_household_sort_name(
                        children_oldest_first, _household_display_name(household, household_cm_id)
                    ),
                    # EVERY row, placeholders and blanks included -- see
                    # `_adult_display_name` for the coalesce and why it is
                    # load-bearing. Filtering here instead would blind the
                    # frontend to what the server declined to count, and the
                    # frontend applies the same predicate at render time
                    # (`householdIdentity.isAttendingAdultName`).
                    adults=[_party_adult(adult) for adult in adults],
                    children=[_party_child(child) for child in children_oldest_first],
                    party_size=beds,
                    unit_code=placement.unit_code,
                    unit_name=placement.unit_name,
                    is_merged_slot=placement.is_merged_slot,
                    unit_codes=list(placement.unit_codes),
                    effective_bathroom=cast(
                        EffectiveBathroom, _resolve_party_bathroom(list(placement.unit_codes), bathroom_index)
                    ),
                    arrival_eta=_s(registration, "arrival_eta") if registration is not None else "",
                    is_returning=household_cm_id in prior_cm_ids,
                    # "" means UNKNOWN, and covers three different facts
                    # (kindred#2075): a first-timer, a family who skipped last
                    # year, and a family whose last visit predates 2022. The
                    # card renders nothing for all three -- see the schema
                    # field, which is where the reasoning lives. Not gated on
                    # `is_returning`: the two derive from different tables and
                    # a cabin we have is a cabin we can show.
                    last_year_cabin=last_year_cabins.get(household_cm_id, ""),
                    share=self._build_share(
                        registration,
                        request_values.get(household_pb_id, []),
                        include_staff_notes=include_staff_notes,
                    ),
                    flags=self._build_flags(
                        registration,
                        # The one COMPUTED flag on the summary (staff ruling,
                        # 2026-08-21) -- see `_has_child_under_two` and the
                        # schema field for why it cannot be read from the
                        # registration row like its siblings.
                        has_child_under_two=_has_child_under_two(children, session_start),
                    ),
                )
            )
        parties.sort(key=lambda p: (p.sort_name.casefold(), p.display_name.casefold()))
        return parties

    def _build_share(
        self,
        registration: Any,
        request_values: Sequence[RequestValueRow] = (),
        *,
        include_staff_notes: bool = False,
    ) -> ShareRequestSummary:
        """Read the ingest-derived request layer. Do NOT re-parse it here.

        Every field below has a raw counterpart still on the row
        (share_cabin_preference, shared_cabin_modes_raw) kept for provenance,
        and re-deriving from those is the trap this method exists to avoid:

        * The gate normaliser requires the sentence to mention sharing before a
          leading "no" reads as a decline, because the modes field's own
          "No requests" option -- 209 rows across 2025-2026 -- otherwise parses
          as a hard no and silently strips the household's pairing eligibility.
        * NEAR and WITH are tested independently, not as ordered arms, so an
          option naming more than one sets both.
        * request_text is already deduplicated across siblings (the source
          fields are person-partition) and joined across three source fields.

        One writer, one reader. If a value looks wrong, fix it in the ingest
        layer so every surface sees the correction.

        `request_values` is the ONE exception and it derives nothing
        (kindred#2330). It is the same free text read raw, so the panel can
        say which source field and which child produced each sentence -- both
        facts the `'; '` join destroys, and neither recoverable from the
        column afterwards. A household with no values still gets a summary:
        112 of 382 rostered 2026 households have no free-text signal at all.
        """
        blocks = _request_blocks(request_values, include_staff_notes=include_staff_notes)
        if registration is None:
            # Blocks still travel. A household can have request text in the
            # bunking-CSV lane and no `family_camp_registrations` row at all
            # -- that lane is fed by a different sync and keyed through the
            # requester person, not through this table. So does the marker:
            # blank `request_text` is not evidence of nothing to resolve.
            return ShareRequestSummary(request_blocks=blocks, needs_resolution=bool(blocks))

        gate = _s(registration, "share_cabin_gate")
        # An unrecognised or empty value is "unknown", never a default of open.
        preference: SharePreference = cast(SharePreference, gate if gate in _GATE_VALUES else "unknown")

        # Stable order, and similar_ages always follows the "with" it refines
        # rather than replacing it -- anything filtering on "with" must still
        # match these households.
        proximity: list[ProximityKind] = []
        if _b(registration, "wants_near"):
            proximity.append("near")
        if _b(registration, "wants_with"):
            proximity.append("with")
        if _b(registration, "wants_similar_ages"):
            proximity.append("similar_ages")

        request_text = _s(registration, "request_text")

        # Read, never re-derived. The two share questions are resolved once, in
        # the Go ingest, for the same reason `preference` is: doing it here
        # would fork a rule that has already been wrong twice. An unpopulated
        # column falls to "unknown"/"none", which places as no-share -- the
        # safe direction, and the honest one on a database whose
        # family_camp_derived has not re-run.
        raw_eligibility = _s(registration, "share_eligibility")
        eligibility = cast(
            ShareEligibility,
            raw_eligibility if raw_eligibility in _ELIGIBILITY_VALUES else "unknown",
        )
        raw_source = _s(registration, "share_eligibility_source")
        eligibility_source = cast(
            ShareEligibilitySource,
            raw_source if raw_source in _ELIGIBILITY_SOURCE_VALUES else "none",
        )

        return ShareRequestSummary(
            preference=preference,
            preference_raw=_s(registration, "share_cabin_preference"),
            proximity=proximity,
            request_text=request_text,
            # Slice 1 resolves no names, so any free text is outstanding work.
            # BLOCKS COUNT AS TEXT (kindred#2330): 32 rostered 2026 households
            # carry their ask only in the bunking-CSV lane, so `request_text`
            # is blank for them and reading this off that column alone would
            # render their request with no marker beside it.
            needs_resolution=bool(request_text or blocks),
            request_blocks=blocks,
            eligibility=eligibility,
            eligibility_source=eligibility_source,
            answers_conflict=_b(registration, "share_answers_conflict"),
        )

    def _build_flags(self, registration: Any, *, has_child_under_two: bool = False) -> AccessibilityFlagSummary:
        """Read the derived flags. Do NOT re-derive them here.

        ONE deliberate exception to that contract: `has_child_under_two` is
        COMPUTED by the caller from the children's birthdates and passed in,
        because its would-be column (`has_infant`) is answered only on adult
        sessions and is 0 across every production family-weekend row -- the
        full argument lives on the schema field. It is keyword-only so a
        caller cannot pass it by accident, and it defaults False so a
        registration with no children context honestly reports "nothing
        known".

        No medical record reaches this method, and that is deliberate
        (kindred#1889). It used to take one to set `has_medical_narrative`
        from the mere presence of text in any narrative column -- a flag that was
        true for 745/745 households in 2026 and 100.0% in every year measured,
        because these questions store their negative answer as the word "No".

        The flag is gone rather than filtered. Normalising the boilerplate
        negatives still lands at 67.7% / 52.6% / 55.9% across 2024-26, and a
        flag that swings 15 points a year on answer phrasing is not a signal.
        Deriving it from the housing-relevant columns instead was considered
        and rejected: the five housing booleans above already answer that
        question from the ingest's option-level classification, and inferring
        a need from `cpap_info` presence is the exact class of bug kindred#1875
        fixed -- worse here, because it would hide a severe-allergy disclosure
        behind a housing question.

        Deleting it took the whole-year `family_camp_medical` read out of both
        `build_roster` and `build_summary`. The narrative now has exactly one
        reader, `get_household_medical`, which fetches ONE household behind
        `Permission.BUNKING_MANAGE`.

        This method used to compute all three from raw sources, which was
        correct only while the columns did not exist. Phase C of the ingest
        plan writes them, and its rules are not reproducible from what this
        service can see:

        * `needs_power` came from `bool(cpap_info)`. The CPAP fields are
          multi-option selects, and 75 answers say the need is *"not CPAP
          related"* -- narrative presence reads those as power (kindred#1875).
        * `needs_private_bathroom` came from `FAM CAMP-bathroom` alone, so it
          missed `Adult-Bathroom` and those same 75 bathroom answers.
        * `accommodation_is_mandatory` came from `not opt_out_vip`, which is
          OR'd across household members and inverts on conflict
          (kindred#1874).

        One writer, one reader. If a flag looks wrong, fix it in the ingest
        layer so every surface sees the correction.
        """
        if registration is None:
            # A household with no registration row still builds a party, and
            # its children's birthdates are still real -- the computed flag
            # survives where the column-read flags honestly default.
            return AccessibilityFlagSummary(has_child_under_two=has_child_under_two)
        return AccessibilityFlagSummary(
            has_child_under_two=has_child_under_two,
            needs_private_bathroom=_b(registration, "needs_private_bathroom"),
            needs_power=_b(registration, "needs_power"),
            needs_accommodation=_b(registration, "needs_accommodation"),
            accommodation_is_mandatory=_b(registration, "accommodation_is_mandatory"),
            has_infant=_b(registration, "has_infant"),
            # kindred#2224. Read from the column for the same reason the five
            # above are: the derivation runs over RAW per-person narrative
            # values in the sync layer, and this service cannot see them.
            needs_fridge=_b(registration, "needs_fridge"),
            # kindred#2438, and read from the column for the same reason: the
            # derivation runs over RAW per-person narrative values in the sync
            # layer, across BOTH housing narratives, and this service cannot
            # see them.
            needs_step_free=_b(registration, "needs_step_free"),
        )

    # --------------------------------------------------------------- counts

    def _build_counts(
        self,
        units: list[LodgingUnitSummary],
        parties: list[RosterParty],
        unresolved_aliases: int,
        unit_index: _BathroomIndex,
    ) -> RosterCounts:
        # The population the BOARD DRAWS, at each tree's resolved level -- not
        # "every non-container row". A combined container IS one space a
        # family can hold, and its rooms are not separately lettable, so
        # counting them instead reports more spaces than the board draws
        # cards. That is the exact drift `_is_planning_inventory` exists to
        # prevent, one field over.
        #
        # A NON-combined container is still excluded, for the original reason:
        # it carries a whole-building aggregate its rooms already report, and
        # counting both double-counts beds (408 vs a true 389). What changed is
        # that "container" stopped being the same question as "not drawn".
        #
        # Owner ruling, kindred#2041: a container's `sleeps` is a DELTA over
        # its rooms -- the beds in space belonging to no single room, e.g. a
        # futon on a landing -- never a whole-house total. A drawn combined
        # container's true capacity is its own `sleeps` PLUS every LEAF
        # beneath it, walked past any intermediate container via
        # `unit_index.leaf_codes_under` -- the SAME index `_build_parties`
        # already built for bathroom resolution, passed in rather than
        # rebuilt here (see `_BathroomIndex`'s own "built ONCE" docstring).
        # An unset container reads as a delta of 0 -- real common space
        # nobody measured, correctly zero and never "unknown" -- so only a
        # genuinely unmeasured LEAF can still leave a total unknown.
        #
        # And it DOES leave it unknown, including a leaf beneath a drawn
        # container. That sentence used to be aspirational: the container
        # branch dropped unmeasured leaves from its sum, so it could never
        # return None, which structurally excluded every container from
        # `units_capacity_unknown` and let a half-measured house report a
        # confident undercount. Latent when fixed -- 0 of 15 active production
        # containers had an unmeasured active leaf, so no reported number moved
        # -- and live the moment staff add a room with no bed count under a
        # combined house.
        drawn = [u for u in drawn_units(units) if u.is_active]
        bookable = [u for u in drawn if _is_planning_inventory(u)]
        staff_housing = [u for u in drawn if not _is_planning_inventory(u)]
        available = [u for u in bookable if u.is_family_available]
        assigned = sum(1 for p in parties if p.unit_code or p.unit_name)

        def _effective_sleeps(unit: LodgingUnitSummary) -> int | None:
            # MIRRORED IN TWO PLACES, and both are named here on purpose --
            # the pairing being undocumented is what let the first two drift
            # apart unnoticed, and a change here that is not made there puts
            # disagreeing numbers on one screen:
            #
            #   1. `effectiveSleeps` in
            #      `frontend/src/components/weekend/rosterAttention.ts`, which
            #      `countUnmeasuredSpaces` reads to answer the same "has anyone
            #      measured this?" question for the chip `WeekendStatsBar`
            #      prints beside `beds_family_available`.
            #   2. `derivedWholeHouseSleeps` in
            #      `frontend/src/components/admin/lodging/derivedCapacity.ts`
            #      (kindred#2079), the read-only whole-house figure shown beside
            #      the container's delta field on the units admin form.
            #
            # THREE copies is one too many. (2) could not import (1): it is an
            # unexported helper, and routing admin code through a `weekend/**`
            # module adds a static import edge across two lazily-chunked route
            # trees -- see `WeekendRosterPage.chunkGraph.test.ts`, the real
            # `vite build` that guards it. The fix is a neutral leaf module both
            # frontends import, not a cross-tree import. Until then: change one,
            # change all three.
            if not unit.is_container:
                return unit.sleeps
            leaf_sleeps = [
                leaf.sleeps
                for code in unit_index.leaf_codes_under(unit.code)
                if (leaf := unit_index.units_by_code.get(code)) is not None and leaf.is_active
            ]
            # ACTIVE leaves only, in both directions: a retired room adds no
            # beds, and equally must not drag its whole house into "unknown".
            #
            # NOT additionally filtered by `_is_planning_inventory`, and that
            # is deliberate rather than an oversight. Six active
            # `staff_default` leaves sit under active containers in production
            # (44 family_pool + 6 staff_default under 15 containers), and the
            # SUM below has counted their beds since kindred#2041 -- a family
            # holding the whole house holds that room too, which is what
            # "combined" means. Gating the unknown on a narrower leaf set than
            # the sum reads from would let a room's beds count while its
            # missing measurement did not.
            if any(s is None for s in leaf_sleeps):
                return None
            # The degenerate case. "Unset container reads as a delta of 0"
            # holds only because its rooms supply the rest of the answer --
            # with no rooms to supply it, 0 is not a delta over anything, it
            # is the claim "this house sleeps nobody".
            if unit.sleeps is None and not leaf_sleeps:
                return None
            return (unit.sleeps or 0) + sum(s for s in leaf_sleeps if s is not None)

        effective_sleeps = {u.unit_id: _effective_sleeps(u) for u in bookable}

        return RosterCounts(
            parties_total=len(parties),
            parties_assigned=assigned,
            parties_unassigned=len(parties) - assigned,
            units_total=len(bookable),
            units_family_available=len(available),
            units_reserved=len(bookable) - len(available),
            units_staff_housing=len(staff_housing),
            beds_family_available=sum(s for u in available if (s := effective_sleeps[u.unit_id]) is not None),
            units_capacity_unknown=sum(1 for u in bookable if effective_sleeps[u.unit_id] is None),
            # Over `bookable`, NOT a separate PocketBase count. The old query
            # filtered is_confirmed/is_container/is_active with no inventory
            # predicate, so once units_total dropped staff housing the two
            # described different populations -- and the stats bar divides one
            # by the other ("N of M cabins have unconfirmed amenities"). Every
            # unit is already here with its is_confirmed, so the second answer
            # bought nothing but a chance to disagree, and one fetch.
            units_unconfirmed=sum(1 for u in bookable if not u.is_confirmed),
            units_missing_allocation=sum(1 for u in bookable if not u.inventory_class),
            unresolved_aliases=unresolved_aliases,
        )

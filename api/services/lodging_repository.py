"""Data access for the weekend lodging surface.

Every PocketBase read behind /api/lodging lives here so the service layer is
testable against mocks. Mirrors api/services/metrics_repository.py.

Two sources of placements, since 1500000132, and a request reads exactly ONE
of them. The SYNCED rows are read with no scenario predicate --
lodging_assignments no longer has that column, because it was dead weight that
invited a `scenario != ""` write rule instead of a draft table. (1500000132
dropped the same column from lodging_merges; 1500000134 then deleted that
collection outright, folding its member set into the placement's own `units`
relation.) A scenario's placements come from lodging_assignments_draft and
REPLACE them: kindred#1974 removed the fall-through, so a scenario is a plan
of its own, seeded by an explicit copy rather than by rendering the mirror
through the gaps.

AVAILABILITY WAS ONE TABLE ANSWERING TWO QUESTIONS, and kindred#2382 split it.
1500000132 left lodging_availability scenario-aware, reasoning that nothing
syncs into it so there was no record of truth to protect; 1500000135 then
deleted the column outright, because "a burst pipe closes a cabin in every plan
for that weekend". That reasoning was right about half of what the table held
and wrong about the other half, and the halves are now separate tables:

  ROLE -- "this staff cabin is released to families this weekend" -- stays in
  lodging_availability and keeps its no-scenario shape. It names no occupant
  and is an operational fact about the WEEKEND ("we're moving staff to X for
  weekend Y", owner ruling), so 1500000135's argument is exactly right for it
  and there is still ONE availability read, issued identically with or without
  a scenario.

  OCCUPANCY -- "somebody is in this room" -- moved to lodging_write_ins with a
  scenario-scoped draft twin, lodging_write_ins_draft (1500000161, backfilled
  by 1500000162).
  Not every write-in is non-rostered staff: some are paper registrations for
  families arriving with no children, and that is a modelling choice belonging
  to the plan that made it. So this half reads like a placement -- a scenario's
  rows REPLACE the live ones, with no fall-through -- and `fetch_write_ins` /
  `fetch_draft_write_ins` are the two reads a request chooses between.

No lodging read is an OVERLAY, then, on either half: one layer with no tiers
for the role, and replace-not-merge for the occupancy.

Request answers are NOT re-parsed here. The Go ingest derives the share gate,
the NEAR/WITH/similar-ages modes, the household-grain request text and the four
housing flags into typed columns on `family_camp_registrations`; this layer
reads those columns. See api/services/lodging_rules.py for why re-deriving them
in Python would regress fixes that live only on the Go side.

`fetch_request_text_values` is the ONE read here that goes to raw values, and
it derives nothing -- it is the same free text, unjoined. The household-grain
`request_text` column concatenates several distinct source fields with `'; '`
and keeps no field boundary, so which FORM and which CHILD produced a sentence
is destroyed there and recoverable nowhere downstream (kindred#2330). It also
reaches the summer bunking CSV lane, which `family_camp_registrations` is not
fed from at all.
"""

from __future__ import annotations

import asyncio
from collections import defaultdict
from typing import TYPE_CHECKING, Any, NamedTuple

from api.constants.collections import (
    ATTENDEES,
    CAMP_SESSIONS,
    FAMILY_CAMP_ADULTS,
    FAMILY_CAMP_MEDICAL,
    FAMILY_CAMP_REGISTRATIONS,
    HOUSEHOLDS,
    LODGING_ASSIGNMENTS,
    LODGING_ASSIGNMENTS_DRAFT,
    LODGING_AVAILABILITY,
    LODGING_INGEST_ISSUES,
    LODGING_SESSION_STATUS,
    LODGING_SLOT_MERGES,
    LODGING_UNITS,
    LODGING_WRITE_INS,
    LODGING_WRITE_INS_DRAFT,
    ORIGINAL_BUNK_REQUESTS,
    PERSON_CUSTOM_VALUES,
)
from api.constants.filters import ACTIVE_ENROLLED_FILTER
from api.dependencies import lodging_cache
from api.services.lodging_cache import cached_by_year
from api.services.lodging_rules import (
    BUNKING_CSV_REQUEST_TEXT_FIELDS,
    FAMILY_CAMP_REQUEST_TEXT_CM_IDS,
)
from api.utils.pb_filters import pb_escape
from bunking.logging_config import get_logger

if TYPE_CHECKING:
    from pocketbase import PocketBase

logger = get_logger(__name__)

# camp_sessions.session_type values that this surface owns. Summer types
# (main/embedded/ag/quest/...) belong to the bunking board, not here.
WEEKEND_SESSION_TYPES = ("family", "adult")

# lodging_ingest_issues.kind for a cabin string that resolved to no unit. The
# collection carries seven kinds and this surface reports only this one, so the
# roster's "unmapped cabins" figure cannot silently absorb ambiguous-session or
# write-failure rows. The migration's select list is the constraint on that
# vocabulary, not any constant here.
UNRESOLVED_ALIAS_KIND = "unresolved_alias"

# Every read below pages through `get_full_list`, which walks LIMIT/OFFSET
# without an ORDER BY unless one is given. SQLite may then return a different
# row order per request, so a row past the first page can be skipped or
# duplicated -- silently dropping a household from the roster. Reads with no
# meaningful display order pin the record id, which is stable and indexed.
# Same defect, same fix as the Go attribution reader in #1877.
STABLE_SORT = "id"

# Rows per HTTP request for every paged read below.
#
# The SDK's `get_full_list(batch: int = 100, ...)` defaults to 100 and recurses
# once per page, so a read is round-trip-bound rather than row-bound.
# `fetch_prior_household_cm_ids` pages every household from every prior year --
# 20,256 rows on 2026 data -- which at the default is 203 requests and ~2.3s of
# the roster's ~3.1s, to produce one boolean per party. At 1000 it is 21
# requests and ~1.0s (#1966).
#
# Applied in ONE place, `_page`, rather than at each call site: `batch` is a
# parameter of `get_full_list` itself and NOT a member of `query_params`, so
# putting it in the dict is accepted silently and leaves the default in place.
# A read that never passes the parameter cannot pass it wrongly.
#
# 1000 is the CEILING, not a guess: PocketBase declares `MaxPerPage int = 1000`
# and `tools/search/provider.go:289` CLAMPS a larger request rather than
# rejecting it. So a bigger number here would page identically while reading as
# though it did something.
PAGE_SIZE = 1000


def _weekend_type_filter() -> str:
    return " || ".join(f'session_type = "{t}"' for t in WEEKEND_SESSION_TYPES)


def _attendee_weekend_session_filter() -> str:
    """Same weekend types as `_weekend_type_filter`, but through the relation.

    This one filters `attendees` (via its `session` relation), which needs
    the `session.` prefix; `_weekend_type_filter` filters `camp_sessions`
    directly and would produce the wrong field name if reused here.
    """
    return " || ".join(f'session.session_type = "{t}"' for t in WEEKEND_SESSION_TYPES)


class RequestValueRow(NamedTuple):
    """One free-text bunk-request answer exactly as it was written.

    `source_field` is the CampMinder field name, verbatim -- resolved from
    whichever key the answer's lane stores (a custom-field cm_id, or the
    bunking CSV's own column slug), so both lanes reach the service under one
    vocabulary. `person` is the raw record of whoever answered, or None; the
    service turns it into a display name, because naming a person is its job
    everywhere else on this surface too.
    """

    source_field: str
    text: str
    person: Any


def _request_value(label: str, raw_text: str, person: Any) -> tuple[str, RequestValueRow] | None:
    """One raw answer paired with the household it belongs to, or None to drop it.

    THREE reasons to drop, and each is a state production really produces:

    * a blank answer -- the panel renders nothing for a source field with no
      text, so an empty rail must never be built (kindred#2255's ruling for
      this same modal);
    * an unregistered source field -- the filters name three keys per lane, so
      a fourth arriving means the filter stopped narrowing, and rendering it
      would put a block on the panel under a label nobody approved;
    * a person that resolves to no household -- a blank household id is not an
      identity, and grouping several of them together would invent a household
      holding other families' request text.
    """
    text = raw_text.strip()
    if not label or not text:
        return None
    household_pb_id = str(getattr(person, "household", "") or "") if person is not None else ""
    if not household_pb_id:
        return None
    return household_pb_id, RequestValueRow(source_field=label, text=text, person=person)


class LodgingRepository:
    """PocketBase access layer for the weekend lodging surface."""

    def __init__(self, pb: PocketBase) -> None:
        self.pb = pb

    async def _page(self, collection: str, query_params: dict[str, Any]) -> list[Any]:
        """Read a whole collection, paging at PAGE_SIZE.

        THE ONLY PLACE `get_full_list` IS NAMED. Every paged read goes through
        here so that a read added later cannot forget `batch` -- it never
        passes one. The earlier shape spelled `batch=PAGE_SIZE` at each of the
        seventeen call sites and relied on a test to catch the eighteenth,
        which is a weaker guarantee than not having the parameter to forget.

        `batch` is a parameter of `get_full_list` itself, NOT a member of
        `query_params`: putting it in the dict is accepted silently and leaves
        the SDK default of 100 in place.
        """
        return await asyncio.to_thread(
            self.pb.collection(collection).get_full_list,
            batch=PAGE_SIZE,
            query_params=query_params,
        )

    async def fetch_weekend_sessions(self, year: int) -> list[Any]:
        """All family + adult sessions for a year, in display order."""
        return await self._page(
            CAMP_SESSIONS,
            query_params={
                "filter": f"year = {year} && ({_weekend_type_filter()})",
                "sort": "sort_order,start_date",
            },
        )

    async def fetch_session(self, year: int, session_cm_id: int) -> Any | None:
        """One weekend session by CampMinder id, or None.

        Type-filtered like fetch_weekend_sessions, and for a reason beyond
        symmetry: build_roster branches on session_type and falls through to
        the HOUSEHOLD grain for anything that is not "adult". Without this
        filter a summer cm_id resolves here and is handed a family-grain
        roster, instead of the 404 the router promises.
        """
        rows = await self._page(
            CAMP_SESSIONS,
            query_params={
                "filter": f"year = {year} && cm_id = {session_cm_id} && ({_weekend_type_filter()})",
                "sort": STABLE_SORT,
            },
        )
        return rows[0] if rows else None

    async def fetch_session_statuses(self, year: int) -> dict[int, str]:
        """The staff-owned weekend status for a season, keyed by CampMinder id.

        kindred#2092. THE ONE LODGING TABLE WITH NO UPSTREAM: CampMinder's
        Sessions API exposes twenty properties and none is a status or
        registration-availability concept, so a cancelled weekend cannot be
        derived. Both derived rules the issue tried were measured and
        retracted -- `is_active` is 25% precise for this, and "attendee rows
        exist but none are enrolled" misses a weekend cancelled before anyone
        registered, which is byte-identical to one that has not opened yet.

        Keyed on `session_cm_id` and not on a `session` relation. camp_sessions
        rows are orphan-deleted by SessionsSync, and a cancelled weekend is
        precisely the one CampMinder may stop returning; the CampMinder id is
        what survives that (CLAUDE.md section 1) and is what the callers
        already hold.

        Returns a MAP so the caller does one read per season rather than one
        scan per weekend. An empty map is the normal state of an untouched
        season -- absence of a row means active, and the migration seeds
        nothing.

        Deliberately NOT cached, for the same reason as `fetch_units` above:
        this collection is written straight to PocketBase from the browser by
        the admin panel (`setWeekendSessionStatus` in
        frontend/src/services/lodgingCrud.ts), never through this API, so a
        cache hit would keep reporting a weekend as running for the whole TTL
        after staff cancelled it -- to buy back a read of at most a dozen rows.
        """
        rows = await self._page(
            LODGING_SESSION_STATUS,
            query_params={"filter": f"year = {year}", "sort": STABLE_SORT},
        )
        return {
            int(getattr(row, "session_cm_id", 0)): str(getattr(row, "status", ""))
            for row in rows
            if getattr(row, "session_cm_id", 0)
        }

    async def fetch_units(self, year: int) -> list[Any]:
        """Every lodging unit for ONE SEASON, with its area expanded.

        Deliberately unfiltered on is_container and is_active: container rows
        and inactive units stay in the payload so the roster can badge them.
        Only the CAPACITY COUNTS exclude containers (spec §9a: naive
        SUM(sleeps) is 408 vs a true 389).

        The YEAR filter is a different axis and is not optional. Units became
        year-scoped in 1500000141, so an unfiltered read returns every season
        at once — and since `code` is only unique per (code, year), the board's
        code-keyed index would collide two seasons onto one card.

        Deliberately NOT cached, despite being year-scoped like the four in
        lodging_cache.py (kindred#1963). `lodging_units` is written straight
        to PocketBase from the browser by the admin panel
        (createLodgingUnit / updateLodgingUnit / confirmLodgingUnits /
        deactivateLodgingUnit in frontend/src/services/lodgingCrud.ts), never
        through this API. A cache hit here would show a stale confirmation
        state for the TTL, to buy back a read that is not the expensive one.
        """
        return await self._page(
            LODGING_UNITS,
            query_params={
                "filter": f"year = {year}",
                "expand": "area",
                "sort": "area.sort_order,name",
            },
        )

    async def fetch_availability(self, year: int, session_cm_id: int) -> list[Any]:
        """Staff RELEASES for one session -- the staff<->family role override.

        HALF WHAT IT USED TO BE. `family_available` answered two unrelated
        questions through one boolean, and kindred#2382 split them: `true` is a
        staff cabin OPENED to families for this weekend, an operational fact
        that stays here, and `false` was an OCCUPANCY -- somebody is in the
        room -- which 1500000162 moved to `lodging_write_ins`. A reservation is
        therefore NOT in this table any more; `fetch_write_ins` is the read for
        it, and every `family_available = 0` row was moved out. Reading a
        surviving one as a write-in is the mistake `write_in_covers` documents
        at length.

        ONE layer, read identically with or without a scenario. 1500000135
        dropped this table's `scenario` column, and that reasoning is exactly
        right for the half that is left: a role move is a fact about the
        WEEKEND rather than about the plan, so there is nothing for a scenario
        to disagree about. There is no companion `fetch_scenario_availability`
        to overlay on top of this, and adding one back would reintroduce the
        last overlay in the lodging model. The occupancy half scopes
        differently -- see `fetch_draft_write_ins` -- which is why it needed a
        table rather than this one growing a column back.
        """
        return await self._page(
            LODGING_AVAILABILITY,
            query_params={
                "filter": f"session_cm_id = {session_cm_id} && year = {year}",
                "sort": STABLE_SORT,
            },
        )

    async def fetch_assignments(self, year: int, session_cm_id: int) -> list[Any]:
        """Synced lodging assignments for one session.

        No scenario predicate: 1500000132 dropped that column. It was never
        written -- all 67 rows carried '' -- and keeping it would have invited
        exactly the `scenario != ""` write rule the draft table exists to
        avoid. `lodging_availability` was the one table 1500000132 left
        scenario-aware in place; 1500000135 removed that too, so no lodging
        read is an overlay any more.
        These rows ARE the live plan. A request naming a scenario does not read
        them at all; it reads fetch_draft_assignments instead, and the copy
        operation is the one path between the two.

        `units` is the one relation a placement carries since 1500000134
        collapsed `unit`/`merge`/`merge_draft` into it -- a multi-select field,
        so expanding it hands back a LIST of unit records rather than one.
        _placement_of reads that list, not a lookup keyed by id.
        """
        return await self._page(
            LODGING_ASSIGNMENTS,
            query_params={
                "filter": f"session_cm_id = {session_cm_id} && year = {year}",
                "expand": "units",
                "sort": STABLE_SORT,
            },
        )

    async def fetch_draft_assignments(self, year: int, session_cm_id: int, scenario_id: str) -> list[Any]:
        """One scenario's placements for one session -- ALL of them.

        Not a delta over fetch_assignments. Under kindred#1974 these rows are
        the scenario's whole plan, so a party with no row here is unplaced in
        this scenario, whatever the mirror says.

        One target expands, not three: 1500000134 collapsed `unit` (an atomic
        room), `merge` (a slot the ingest built from a historical cabin
        string) and `merge_draft` (one the board built inside a scenario) into
        the single `units` relation. A draft row placing a party across
        multiple rooms is just a `units` list with 2+ ids now, whether the
        ingest or the board put it there.

        EVERY interpolated STRING here goes through pb_escape. `scenario_id`
        reaches this method straight off the `?scenario=` query parameter, and
        a value carrying a double quote closes the literal early: PocketBase
        binds `&&` tighter than `||`, so an injected `||` clause widens the
        predicate past its own session/year/scenario scoping. The session term
        is not a string -- see the note on the weekend key below -- so there is
        no literal for it to close.

        THE WEEKEND KEY IS `session_cm_id`, not the `session` relation
        (kindred#2042, migration 1500000147). camp_sessions is unique on
        (cm_id, year), so the two select the same row today -- but the
        PocketBase id is replaced if that record is ever recreated rather than
        updated, and the rows keyed on the old one stay in the table
        unreachable. Never write `!= ''` against it: PocketBase numbers are
        NUMERIC DEFAULT 0 NOT NULL and SQLite reads `0 != ''` as TRUE.
        """
        return await self._page(
            LODGING_ASSIGNMENTS_DRAFT,
            query_params={
                "filter": (
                    f'session_cm_id = {session_cm_id} && year = {year} && scenario = "{pb_escape(scenario_id)}"'
                ),
                "expand": "units",
                "sort": STABLE_SORT,
            },
        )

    async def fetch_slot_merges(self, year: int, session_cm_id: int, scenario_id: str) -> list[Any]:
        """One session's draw-level overrides: the weekend-level tier, plus a
        named scenario's own rows when there is one.

        TWO TIERS, one table, since `scenario` became optional (1500000140).
        `scenario = ""` is the WEEKEND-LEVEL row -- seen on the CampMinder
        mirror and inherited by every scenario -- because a merge is a fact
        about the weekend, not only about a plan: unlike a placement, no sync
        writes a draw level, so there is no record of truth a writable mirror
        would corrupt. That is a reversal of 1500000139's original call
        (`scenario` was a REQUIRED relation specifically so the mirror could
        never have a row); see 1500000140's header.

        A blank `scenario_id` (the mirror, and every unnamed-scenario caller)
        gets ONLY the weekend-level rows -- `scenario = ""` is already exactly
        that filter, no special-casing needed. A named scenario gets its own
        rows UNIONED with the weekend-level ones, because both tiers can name
        the same unit and the caller (resolve_combined, by way of
        LodgingRosterService._build_units) needs to see both to pick the
        higher one. The row's own `scenario` column is what tells the two
        tiers apart on the way back out.

        EVERY interpolated STRING here goes through pb_escape, matching
        fetch_draft_assignments: `scenario_id` reaches this straight off the
        `?scenario=` query parameter. The weekend is named by `session_cm_id`,
        a number -- see fetch_draft_assignments for why.
        """
        scenario_clause = (
            'scenario = ""' if not scenario_id else f'(scenario = "{pb_escape(scenario_id)}" || scenario = "")'
        )
        return await self._page(
            LODGING_SLOT_MERGES,
            query_params={
                "filter": (f"session_cm_id = {session_cm_id} && year = {year} && {scenario_clause}"),
                "sort": STABLE_SORT,
            },
        )

    async def fetch_write_ins(self, year: int, session_cm_id: int) -> list[Any]:
        """The LIVE board's write-ins for one weekend (kindred#2382).

        A write-in is an occupancy the roster does not otherwise know about:
        non-rostered weekend staff, or a paper registration for a family
        arriving with no children. It used to be stored as
        `lodging_availability.family_available = false`, where it shared a
        column with the staff<->family ROLE override and inherited that
        column's session-only scope.

        NO SCENARIO PREDICATE, and that is not the old shape coming back. The
        live board is a scope in its OWN RIGHT -- the owner's second
        requirement on 2026-08-15, "we need to allow write ins to happen in
        campminder prod, not just scenarios, for staff to properly evaluate
        the board" -- so these rows live in their own table with no scenario
        column at all, exactly as `lodging_assignments` does. A scenario's
        write-ins come from `fetch_draft_write_ins` and REPLACE these; there
        is no overlay.

        `build_roster` and `build_summary` both read this, and `_build_units`
        is where a row becomes the occupancy half of a unit's answer. Both pick
        THIS read or `fetch_draft_write_ins` below on whether the request named
        a scenario, exactly as they pick between `fetch_assignments` and
        `fetch_draft_assignments` -- never both.
        """
        return await self._page(
            LODGING_WRITE_INS,
            query_params={
                "filter": f"session_cm_id = {session_cm_id} && year = {year}",
                "sort": STABLE_SORT,
            },
        )

    async def fetch_draft_write_ins(self, year: int, session_cm_id: int, scenario_id: str) -> list[Any]:
        """One scenario's write-ins for one session -- ALL of them.

        REPLACE, not overlay, matching `fetch_draft_assignments` under
        kindred#1974: these rows are the scenario's whole set of write-ins, so
        a unit with no row here holds no write-in in this scenario, whatever
        the live board says. A scenario is seeded by an explicit copy (both
        seed paths, by owner ruling 2026-08-16) rather than by rendering the
        live board through the gaps.

        `fetch_slot_merges` is the near neighbour that does the opposite --
        it unions the weekend-level tier in -- and the difference is what the
        row records. A draw level is a fact about the WEEKEND that no sync
        writes, so a shared tier costs nothing. A write-in is an occupancy,
        the same kind of fact as a placement, so it follows the placement
        rule.

        `build_roster` and `build_summary` read THIS instead of
        `fetch_write_ins` whenever the request names a scenario, and the live
        table is then not read at all. `copy_from_mirror` and
        `copy_scenario_to_scenario` both seed it, so a fresh scenario starts
        with the write-ins its source had rather than blank -- without that,
        kindred#2247's placement gate would let a family be dropped into a room
        the live board records as occupied.

        `scenario_id` is client-supplied and escaped, for the reason
        `fetch_draft_assignments` spells out. The weekend is named by
        `session_cm_id`, a number, so there is no literal for an injected `||`
        to close.
        """
        return await self._page(
            LODGING_WRITE_INS_DRAFT,
            query_params={
                "filter": (
                    f'session_cm_id = {session_cm_id} && year = {year} && scenario = "{pb_escape(scenario_id)}"'
                ),
                "sort": STABLE_SORT,
            },
        )

    async def fetch_attendees_for_session(self, year: int, session_pb_id: str) -> list[Any]:
        """Active-enrolled attendees for one session, with person expanded.

        status_id = 2 is the single source of truth for enrollment; filtering
        any other way is silently wrong.
        """
        return await self._page(
            ATTENDEES,
            query_params={
                "filter": f'session = "{pb_escape(session_pb_id)}" && year = {year} && {ACTIVE_ENROLLED_FILTER}',
                "expand": "person",
                "sort": STABLE_SORT,
            },
        )

    async def fetch_household_family_attendees(self, household_cm_id: int) -> list[Any]:
        """One household's enrolled family-camp children, across EVERY year.

        The cross-year read behind the household journey (kindred#2073). The
        year is deliberately NOT a parameter here -- unlike every other read
        in this file -- because the journey's window is not chosen, it is
        discovered: the years a household appears in are exactly the years it
        has a trace, and a hard-coded floor would either invent empty rows or
        silently truncate a long-standing family's history.

        ⚠️ `person.household_id`, NOT `person.household`. Both exist on
        `persons` and both look right. `household` is a PocketBase relation
        into the YEAR-SCOPED `households` table, and `persons` rows are
        themselves per-year (11,432 distinct people across 28,635 rows on the
        production snapshot), so each year's person row points at that same
        year's household record. Filtering on it can therefore only ever
        match one season. `household_id` is the CampMinder id, which is the
        identity thread across seasons (CLAUDE.md section 1).

        `session.session_type = "family"` because an adult weekend is
        person-grain: it enrols the adult directly, and letting those rows
        through would file a parent's own weekend under their children.

        `status_id = 2` for the reason it is everywhere else, with one year
        that makes it vivid: 2020 has 1,264 family attendee rows and not one
        enrolled -- the season was cancelled outright -- so an unfiltered read
        renders 2020 as an ordinary year.

        NOT cached. `lodging_cache` is keyed by year and this read has no
        year; it is also per-household rather than per-season, so it is small
        (one family's children) and there is no year-scoped sharing to win.
        """
        # Never issue the query for an unresolvable household.
        # `_build_household_parties` gives one `household_cm_id = 0`, and
        # `person.household_id = 0` is a real predicate that matches whatever
        # rows carry a zero rather than an error.
        if household_cm_id <= 0:
            return []
        return await self._page(
            ATTENDEES,
            query_params={
                "filter": (
                    f"person.household_id = {household_cm_id} "
                    f'&& session.session_type = "family" && {ACTIVE_ENROLLED_FILTER}'
                ),
                "expand": "person",
                "sort": STABLE_SORT,
            },
        )

    async def fetch_household_adults_by_year(self, household_cm_id: int) -> dict[int, list[Any]]:
        """One household's accompanying adults, grouped by year (kindred#2073).

        Family Camp adults have NO `persons` row at all -- `family_camp_adults`
        is their only representation, and its rows are year-scoped -- so this
        is the only place a past year's adults can come from. That is also why
        2021 shows adults and no children: 647 adult rows against zero family
        attendee rows.

        Bridged through the relation's `cm_id` for the same reason
        `fetch_cabin_assignments_by_household_cm_id` is: `households` is
        year-scoped, so one PB id names one season and a cross-year read keyed
        on it returns one year's worth of rows and no error.

        Rows are published as they are found, blanks and placeholders
        included, exactly as `_build_household_parties` publishes them -- the
        client applies `isAttendingAdultName` at render time and must be able
        to see what the server declined to count.
        """
        if household_cm_id <= 0:
            return {}
        rows = await self._page(
            FAMILY_CAMP_ADULTS,
            query_params={
                "filter": f"household.cm_id = {household_cm_id}",
                "sort": "adult_number",
            },
        )
        grouped: dict[int, list[Any]] = defaultdict(list)
        for row in rows:
            grouped[int(getattr(row, "year", 0) or 0)].append(row)
        for adults in grouped.values():
            adults.sort(key=lambda a: int(getattr(a, "adult_number", 0) or 0))
        return dict(grouped)

    async def fetch_household_registration_years(self, household_cm_id: int) -> set[int]:
        """The years this household registered for family camp (kindred#2073).

        A trace of its own, and NOT recoverable from
        `fetch_cabin_assignments_by_household_cm_id`, which drops every blank
        `cabin_assignment` -- and blank is all 1,433 rows from 2017-2021.
        Measured on the production snapshot, between 24 and 89 registrations a
        year carry neither an enrolled child nor an adult row, so a journey
        assembled from children and adults alone loses those years entirely.
        """
        if household_cm_id <= 0:
            return set()
        rows = await self._page(
            FAMILY_CAMP_REGISTRATIONS,
            query_params={
                "filter": f"household.cm_id = {household_cm_id}",
                "fields": "year",
                "sort": STABLE_SORT,
            },
        )
        return {year for row in rows if (year := int(getattr(row, "year", 0) or 0))}

    @cached_by_year(lodging_cache)
    async def fetch_households(self, year: int) -> dict[str, Any]:
        """Households for a year, keyed by PocketBase record id.

        Cached (kindred#1963): year-scoped and sync-written only, so a hit is
        safe for the cache's whole TTL. See api/services/lodging_cache.py.
        """
        rows = await self._page(
            HOUSEHOLDS,
            query_params={"filter": f"year = {year}", "sort": STABLE_SORT},
        )
        return {row.id: row for row in rows}

    async def fetch_households_by_ids(self, household_pb_ids: list[str]) -> dict[str, Any]:
        """Households fetched fresh by PocketBase id, bypassing the year cache.

        The escape hatch for kindred#2143: `fetch_households`' cached snapshot
        can be up to 15 minutes stale (kindred#1963), but `build_roster` and
        `build_summary` always fetch attendees fresh. A household created
        after the snapshot was cached is absent from it even though a
        brand-new attendee can already name it -- the roster service calls
        this for exactly those ids, never for the whole year, so the fix costs
        one small extra read instead of giving up the cache entirely.

        Deliberately NOT decorated with @cached_by_year: caching this would
        reintroduce the exact staleness it exists to patch around.

        `household_pb_ids` is small by construction -- the caller has already
        narrowed to just the ids missing from the cached snapshot, typically
        zero or one -- so an OR clause of `id = "..."` terms is safe here even
        though the same shape was rejected for fetch_prior_household_cm_ids at
        250 terms (see that method's docstring): this list does not grow with
        the year's household count, only with how many are mid-flight right
        now. Every id is escaped, matching every other filter in this file.
        """
        if not household_pb_ids:
            return {}
        ids_clause = " || ".join(f'id = "{pb_escape(hid)}"' for hid in household_pb_ids)
        rows = await self._page(HOUSEHOLDS, query_params={"filter": ids_clause, "sort": STABLE_SORT})
        return {row.id: row for row in rows}

    async def fetch_household_by_cm_id(self, year: int, household_cm_id: int) -> Any | None:
        """One household by CampMinder id, or None.

        The medical-narrative path uses this instead of fetch_households:
        answering one household must not materialise every family in the year.
        """
        rows = await self._page(
            HOUSEHOLDS,
            query_params={
                "filter": f"year = {year} && cm_id = {household_cm_id}",
                "sort": STABLE_SORT,
            },
        )
        return rows[0] if rows else None

    @cached_by_year(lodging_cache)
    async def fetch_prior_household_cm_ids(self, year: int) -> set[int]:
        """CampMinder ids of every household seen in an EARLIER year.

        This is the returning-family signal: households rows are per-year, so
        a cm_id present before `year` means the family has been here before.

        The expensive one -- 20,256 rows on 2026 prod data for one boolean
        per party (kindred#1966). #1966/#1976 already bought back the
        round-trip cost (batch=PAGE_SIZE, 21 requests instead of 203) and
        explicitly rejected narrowing the filter to the current year's
        household ids: a 250-term OR clause returns HTTP 400 (undocumented,
        fails closed), so there is no query-shape lever left to pull. Caching
        is what is left, and it is safe here for the same reason as
        fetch_households: year-scoped, sync-written only. See
        api/services/lodging_cache.py.
        """
        rows = await self._page(
            HOUSEHOLDS,
            query_params={"filter": f"year < {year}", "fields": "cm_id", "sort": STABLE_SORT},
        )
        return {int(getattr(row, "cm_id", 0)) for row in rows if getattr(row, "cm_id", 0)}

    @cached_by_year(lodging_cache)
    async def fetch_family_camp_adults(self, year: int) -> dict[str, list[Any]]:
        """Accompanying adults grouped by household PB id, in adult_number order.

        CampMinder enrols only the children for family camp; the adults exist
        only as custom-field values scraped into this table.

        Cached (kindred#1963): year-scoped and sync-written only. See
        api/services/lodging_cache.py.
        """
        rows = await self._page(
            FAMILY_CAMP_ADULTS,
            query_params={"filter": f"year = {year}", "sort": "adult_number"},
        )
        grouped: dict[str, list[Any]] = defaultdict(list)
        for row in rows:
            grouped[str(getattr(row, "household", ""))].append(row)
        for adults in grouped.values():
            adults.sort(key=lambda a: int(getattr(a, "adult_number", 0) or 0))
        return dict(grouped)

    @cached_by_year(lodging_cache)
    async def fetch_family_camp_registrations(self, year: int) -> dict[str, Any]:
        """Registration answers keyed by household PB id.

        Carries the ingest-derived request layer -- share_cabin_gate,
        wants_near / wants_with / wants_similar_ages, request_text -- and the
        four narrative-free housing flags. Read those columns; do not re-derive them
        from share_cabin_preference / shared_cabin_modes_raw, which are the raw
        profile values kept for provenance.

        Cached (kindred#1963): year-scoped and sync-written only. See
        api/services/lodging_cache.py.
        """
        rows = await self._page(
            FAMILY_CAMP_REGISTRATIONS,
            query_params={"filter": f"year = {year}", "sort": STABLE_SORT},
        )
        return {str(getattr(row, "household", "")): row for row in rows}

    @cached_by_year(lodging_cache)
    async def fetch_request_text_values(self, year: int) -> dict[str, list[RequestValueRow]]:
        """The RAW free-text bunk-request answers, keyed by household PB id.

        The one read on this surface that is not a derived column, and the
        module docstring above still holds: nothing here normalises a gate,
        parses a NEAR/WITH mode or resolves a verdict. It reads free text as
        it was written, because the derived column cannot be un-joined --
        `CollapseToHouseholdGrain` joins its sources with `'; '` and keeps no
        field boundary, and 10 of 422 non-blank 2026 values contain that
        separator themselves (kindred#2330).

        TWO LANES, because the five ruled fields live in two different tables:

        * the family-camp forms, in `person_custom_values` keyed by
          CampMinder custom-field id (422 rows on 2026);
        * the summer bunking CSV, in `original_bunk_requests` keyed by its own
          column slug (1,262 rows on 2026).

        The second lane is why 32 households rostered into a 2026 family
        session had request text that appeared on NO weekend surface: the
        roster read only `family_camp_registrations`, and that table is fed
        solely from the first lane.

        Neither excluded field is requested at all rather than filtered later
        -- see `REQUEST_TEXT_SOURCES` for why `Do Not Share Bunk With` and
        `RetParent-Socializewithbest` are out.

        Cached (kindred#1963): year-scoped and sync-written only, exactly like
        the registrations read above. The family-camp lane is one page (422
        rows on 2026); the bunking-CSV lane is two, because it is not narrowed
        to family-camp people at all -- 1,262 of the year's rows come back
        against a PAGE_SIZE of 1,000, and 1,086 of them belong to households
        with no weekend party to hang them on. Narrowing it would need a
        person-id OR clause of the same shape kindred#1966 measured returning
        HTTP 400, so the cache is the lever, exactly as it is there.
        """
        family_camp, bunking_csv = await asyncio.gather(
            self._fetch_family_camp_request_values(year),
            self._fetch_bunking_csv_request_values(year),
        )
        grouped: dict[str, list[RequestValueRow]] = defaultdict(list)
        for household_pb_id, value in family_camp + bunking_csv:
            grouped[household_pb_id].append(value)
        return dict(grouped)

    async def _fetch_family_camp_request_values(self, year: int) -> list[tuple[str, RequestValueRow]]:
        """The family-camp form lane, filtered on custom-field cm_id.

        Both relations are expanded: `person` carries the household this
        answer belongs to and the name that sub-labels it, and
        `field_definition` carries the cm_id the label is resolved from. The
        stored `name` is deliberately not trusted for the label -- matching is
        on cm_id, so a CampMinder rename must not unlabel a block.
        """
        cm_id_filter = " || ".join(
            f"field_definition.cm_id = {cm_id}" for cm_id in sorted(FAMILY_CAMP_REQUEST_TEXT_CM_IDS)
        )
        rows = await self._page(
            PERSON_CUSTOM_VALUES,
            query_params={
                "filter": f"year = {year} && ({cm_id_filter})",
                "expand": "person,field_definition",
                "sort": STABLE_SORT,
            },
        )
        out: list[tuple[str, RequestValueRow]] = []
        for row in rows:
            expand = getattr(row, "expand", None) or {}
            definition = expand.get("field_definition") if isinstance(expand, dict) else None
            label = FAMILY_CAMP_REQUEST_TEXT_CM_IDS.get(int(getattr(definition, "cm_id", 0) or 0), "")
            person = expand.get("person") if isinstance(expand, dict) else None
            entry = _request_value(label, str(getattr(row, "value", "") or ""), person)
            if entry is not None:
                out.append(entry)
        return out

    async def _fetch_bunking_csv_request_values(self, year: int) -> list[tuple[str, RequestValueRow]]:
        """The summer bunking-CSV lane, filtered on the three column slugs.

        `original_bunk_requests` carries no household relation at all, so the
        only route to one is the `requester` person -- which is year-scoped,
        exactly like the value rows in the other lane, so no cm_id bridge is
        needed.
        """
        field_filter = " || ".join(f'field = "{slug}"' for slug in sorted(BUNKING_CSV_REQUEST_TEXT_FIELDS))
        rows = await self._page(
            ORIGINAL_BUNK_REQUESTS,
            query_params={
                "filter": f"year = {year} && ({field_filter})",
                "expand": "requester",
                "sort": STABLE_SORT,
            },
        )
        out: list[tuple[str, RequestValueRow]] = []
        for row in rows:
            expand = getattr(row, "expand", None) or {}
            person = expand.get("requester") if isinstance(expand, dict) else None
            label = BUNKING_CSV_REQUEST_TEXT_FIELDS.get(str(getattr(row, "field", "") or ""), "")
            entry = _request_value(label, str(getattr(row, "content", "") or ""), person)
            if entry is not None:
                out.append(entry)
        return out

    @cached_by_year(lodging_cache)
    async def fetch_cabin_assignments_by_household_cm_id(self, year: int) -> dict[int, str]:
        """Where each household slept in `year`, keyed by household CampMinder id.

        The staff-written string out of `family_camp_registrations.cabin_assignment`
        -- FREE TEXT, not a relation. It is deliberately NOT resolved to a
        `lodging_units` row here: `lodging_units` holds only the current year,
        so a 2023 string can name a cabin that no longer exists under that
        name, and 3 of the 88 distinct strings across 2022-2025 resolve to no
        alias at all. What staff wrote is the fact they are recalling; the
        alias resolution (`lodging_unit_aliases` → `member_units`, honouring
        `valid_from_year` / `valid_to_year`) is a separate job with a separate
        failure mode.

        ⚠️ KEYED BY cm_id, AND THAT IS THE ENTIRE POINT. `registration.household`
        is a PocketBase relation into a YEAR-SCOPED `households` table, so a
        2025 registration hangs off the *2025* households record -- a PB id the
        2026 roster has never seen. Joining a prior year's registrations onto
        the current year's household ids returns a plausible near-empty map
        rather than an error, which reads as "everyone is a first-timer" and
        survives review. Measured on the 2026 prod snapshot: bridging on
        `cm_id` finds 257 of 459 registered households with a 2025 cabin;
        joining on the PB id finds 0.

        THE YEAR IS THE PARAMETER, and no "last year" arithmetic happens here
        (kindred#2073 wants this same read once per year of 2022-2025;
        kindred#2075's card asks only for `year - 1`). Composed from the two
        existing `@cached_by_year` reads rather than a bespoke narrower query,
        so a year already in hand costs nothing and a sweep across four years
        pays each of them once per process. Its own cache entry on top is for
        the join, not the round trips.

        Empty for every year before 2022: `cabin_assignment` is blank on all
        1,433 rows from 2017-2021, so a family last here in 2019 is genuinely
        unrecoverable rather than missing.
        """
        registrations, households = await asyncio.gather(
            self.fetch_family_camp_registrations(year),
            self.fetch_households(year),
        )
        assignments: dict[int, str] = {}
        for household_pb_id, registration in registrations.items():
            cabin = str(getattr(registration, "cabin_assignment", "") or "").strip()
            if not cabin:
                continue
            household = households.get(household_pb_id)
            if household is None:
                continue
            # Never key on 0 -- `_build_household_parties` gives an
            # unresolvable household `household_cm_id = 0`, so a 0 entry here
            # would hand every one of those parties somebody else's cabin.
            household_cm_id = int(getattr(household, "cm_id", 0) or 0)
            if household_cm_id:
                assignments[household_cm_id] = cabin
        return assignments

    async def _fetch_weekend_touched_household_ids(self, year: int) -> set[str]:
        """PB ids of households with ANY attendee on a family/adult session
        this year (kindred#2306).

        `processMedical` (`family_camp_derived.go:981-1095`) reads
        `Family Medical-*` / `Family Camp-Physician*` custom values, and those
        fields are answered by summer households too -- so `family_camp_medical`
        holds rows for households with no family-camp connection at all: 310 of
        886 in the 2026 production snapshot. Owner ruling 2026-08-13 (campaign
        decision D3): filter at READ, leave `processMedical` and the write path
        alone -- reversible, where narrowing the write plus an unguarded sweep
        would not be.

        ANY status, deliberately NOT `ACTIVE_ENROLLED_FILTER`: a cancelled or
        waitlisted attendee still means the household touched a weekend
        session. Narrowing to status_id = 2 would ALSO drop the 71-of-886
        households that registered but had nobody actively enrolled -- that
        population is kindred#2305's separate problem, not this one, and the
        two issues are being kept apart deliberately.

        `person.household`, the PocketBase relation -- NOT `person.household_id`
        (the CampMinder int used elsewhere in this file for a cross-YEAR
        bridge). `family_camp_medical.household` is that same relation,
        already scoped to this year's `households` row, so no cm_id bridge is
        needed the way a cross-year read needs one.
        """
        rows = await self._page(
            ATTENDEES,
            query_params={
                "filter": (f"year = {year} && ({_attendee_weekend_session_filter()})"),
                "expand": "person",
                "sort": STABLE_SORT,
            },
        )
        touched: set[str] = set()
        for row in rows:
            expand = getattr(row, "expand", None) or {}
            person = expand.get("person") if isinstance(expand, dict) else None
            household_pb_id = str(getattr(person, "household", "") or "") if person is not None else ""
            if household_pb_id:
                touched.add(household_pb_id)
        return touched

    async def _household_touched_weekend_session(self, year: int, household_pb_id: str) -> bool:
        """One household's version of `_fetch_weekend_touched_household_ids`.

        A targeted existence check rather than the bulk helper, so the single-
        household narrative read below never has to pull the whole year's attendee
        roster into memory to answer one household's question. Same predicate
        (ANY status, family/adult session, this year) -- see that method's
        docstring for why.
        """
        if not household_pb_id:
            return False
        rows = await self._page(
            ATTENDEES,
            query_params={
                "filter": (
                    f'year = {year} && person.household = "{pb_escape(household_pb_id)}" '
                    f"&& ({_attendee_weekend_session_filter()})"
                ),
                "sort": STABLE_SORT,
            },
        )
        return bool(rows)

    async def fetch_family_camp_medical(self, year: int) -> dict[str, Any]:
        """The medical narrative, keyed by household PB id. NO PRODUCTION CALLER.

        kindred#1889 deleted the last one. The roster used to read this whole
        map to derive `has_medical_narrative` from PRESENCE -- a boolean true
        for every household, because these questions store "No" as text -- and
        deleting the flag took the read with it. The narrative is now served
        solely by the medical endpoint gated on `bunking.manage`, which reads ONE
        household through fetch_medical_for_household.

        So there is nothing a caller here should be doing: pulling every
        household's disclosure into API memory is the cost that deletion
        bought back, and presence is not a signal. Two tests in
        test_lodging_roster_service.py assert this is never called.

        Family-camp scoped (kindred#2306): rows for a household that never
        touched a family or adult session this year are dropped. See
        `_fetch_weekend_touched_household_ids` for the predicate.
        """
        rows = await self._page(
            FAMILY_CAMP_MEDICAL,
            query_params={"filter": f"year = {year}", "sort": STABLE_SORT},
        )
        touched = await self._fetch_weekend_touched_household_ids(year)
        return {
            household_pb_id: row for row in rows if (household_pb_id := str(getattr(row, "household", ""))) in touched
        }

    async def fetch_medical_for_household(self, year: int, household_pb_id: str) -> Any | None:
        """The medical narrative for ONE household, or None.

        A blank id means the household did not resolve, and is never turned
        into a query: an unanchored filter is how one family's narrative
        reaches another family's request.

        Family-camp scoped (kindred#2306), and checked BEFORE the narrative
        read below: a household that never touched a family or adult session this
        year gets None without `family_camp_medical` ever being queried, not
        merely filtered out of a result that already carried its narrative.
        See `_household_touched_weekend_session` for the predicate.

        `pb_escape` for the same reason, and it is the same anchor: a quote in
        the id closes the literal, and PocketBase binds `&&` tighter than
        `||`, so an injected `||` widens the predicate past BOTH the year and
        the household and this returns the first row of whatever is left. The
        id is server-resolved today, so this is defence in depth -- but every
        other id-carrying filter in this file escapes, and the narrative read
        is the last place to leave the odd one out.
        """
        if not household_pb_id:
            return None
        if not await self._household_touched_weekend_session(year, household_pb_id):
            return None
        rows = await self._page(
            FAMILY_CAMP_MEDICAL,
            query_params={
                "filter": f'year = {year} && household = "{pb_escape(household_pb_id)}"',
                "sort": STABLE_SORT,
            },
        )
        return rows[0] if rows else None

    async def _count(self, collection: str, filter_str: str) -> int:
        """Row count via the list total, without paging the rows in.

        One page of one row carries the same `total_items` as the full list,
        so a count never needs get_full_list.
        """
        result = await asyncio.to_thread(
            self.pb.collection(collection).get_list,
            1,
            1,
            query_params={"filter": filter_str, "fields": "id"},
        )
        return int(result.total_items)

    async def count_open_unresolved_aliases(self, year: int) -> int:
        """Cabin strings ingest could not resolve, still awaiting triage.

        One work queue, owned and solely written by the ingest layer. Narrowed
        to the alias kind so the roster's unmapped-cabin figure does not absorb
        the queue's six other kinds.

        The YEAR filter is not optional. `lodging_ingest_issues` has carried a
        required `year` since 1500000122; without it this count absorbs every
        season's unmapped cabin names, disagreeing with the year-scoped
        Unresolved names queue underneath the same header. Same defect, same
        fix, as `listUnresolvedAliasIssues` in `lodgingCrud.ts`.

        Deliberately NOT cached, despite being year-scoped like the four in
        lodging_cache.py (kindred#1963). The ROW is ingest-written, but
        `is_resolved` -- the column this filter tests -- is flipped straight
        against PocketBase from the admin panel
        (mapUnresolvedAlias / ignoreIngestIssue in
        frontend/src/services/lodgingCrud.ts), never through this API. A
        cache hit here would leave a cabin name staff just resolved sitting
        in the "unmapped" count for the TTL.
        """
        return await self._count(
            LODGING_INGEST_ISSUES,
            f'year = {year} && kind = "{UNRESOLVED_ALIAS_KIND}" && is_resolved = false',
        )

    # ---------------------------------------------------------------- writes
    #
    # Every write below targets the DRAFT grain or lodging_availability. None
    # of them can reach lodging_assignments, lodging_assignment_history or
    # lodging_field_mappings, which the ingest owns and which stay admin-only
    # in PocketBase regardless of what this layer asks for.

    async def find_draft_assignment(
        self, year: int, session_cm_id: int, scenario_id: str, household_cm_id: int, person_cm_id: int
    ) -> Any | None:
        """The one draft row for a party in a scenario, or None.

        Keyed exactly as the draft's two partial unique indexes are, so the
        lookup either finds the row the next write would collide with, or
        there is none. Migration 1500000147 re-keyed both onto `session_cm_id`
        (kindred#2042), so this filter moved with them -- naming the `session`
        relation here would ask for a row through a key the index no longer
        carries. THREE number columns are compared to a known value now; never
        write `!= ''` against any of them, because PocketBase numbers are
        NUMERIC DEFAULT 0 NOT NULL and SQLite reads `0 != ''` as TRUE, which
        matches every row of the other grain.

        `scenario_id` is client-supplied and escaped. Unescaped, an injected
        `||` would make this return a row from ANOTHER scenario, which the
        caller then updates or deletes. The two cm_ids are ints and need no
        escaping.
        """
        rows = await self._page(
            LODGING_ASSIGNMENTS_DRAFT,
            query_params={
                "filter": (
                    f"session_cm_id = {session_cm_id} && year = {year} "
                    f'&& scenario = "{pb_escape(scenario_id)}" '
                    f"&& household_cm_id = {household_cm_id} && person_cm_id = {person_cm_id}"
                ),
                "sort": STABLE_SORT,
            },
        )
        return rows[0] if rows else None

    async def count_draft_assignments(self, year: int, session_cm_id: int, scenario_id: str) -> int:
        """How many placements a scenario holds for one weekend.

        The copy operation's precheck. Scoped to the weekend as well as the
        scenario because a scenario spans weekends: placements made for one
        must not refuse a seed of another.

        A count, not a fetch: the answer is "any?", and paging in sixty-two
        rows with their unit expands to learn it is the read `/summary` was
        built to stop repeating. `scenario_id` is escaped for the reason
        fetch_draft_assignments spells out.
        """
        return await self._count(
            LODGING_ASSIGNMENTS_DRAFT,
            (f'session_cm_id = {session_cm_id} && year = {year} && scenario = "{pb_escape(scenario_id)}"'),
        )

    async def create_draft_assignment(self, data: dict[str, Any]) -> Any:
        return await asyncio.to_thread(self.pb.collection(LODGING_ASSIGNMENTS_DRAFT).create, data)

    async def update_draft_assignment(self, record_id: str, data: dict[str, Any]) -> Any:
        return await asyncio.to_thread(self.pb.collection(LODGING_ASSIGNMENTS_DRAFT).update, record_id, data)

    async def delete_draft_assignment(self, record_id: str) -> None:
        await asyncio.to_thread(self.pb.collection(LODGING_ASSIGNMENTS_DRAFT).delete, record_id)

    async def find_availability_override(self, year: int, session_cm_id: int, unit_pb_id: str) -> Any | None:
        """The one availability row for a unit this weekend, or None.

        Matches idx_lodging_avail_unique, which 1500000135 rebuilt as
        (session, year, unit) and 1500000147 re-keyed to
        (session_cm_id, year, unit). Without an index of exactly this shape a unit
        could carry two contradicting rows for one weekend and "is this cabin
        available?" would stop being a question with an answer -- which is why
        the migration rebuilds the index rather than only dropping the column.

        `unit_pb_id` arrives in the request body and is escaped. Unescaped, an
        injected `||` would make this return some other weekend's row, which
        set_availability then updates or deletes.
        """
        rows = await self._page(
            LODGING_AVAILABILITY,
            query_params={
                "filter": (f'session_cm_id = {session_cm_id} && year = {year} && unit = "{pb_escape(unit_pb_id)}"'),
                "sort": STABLE_SORT,
            },
        )
        return rows[0] if rows else None

    async def create_availability(self, data: dict[str, Any]) -> Any:
        return await asyncio.to_thread(self.pb.collection(LODGING_AVAILABILITY).create, data)

    async def update_availability(self, record_id: str, data: dict[str, Any]) -> Any:
        return await asyncio.to_thread(self.pb.collection(LODGING_AVAILABILITY).update, record_id, data)

    async def delete_availability(self, record_id: str) -> None:
        await asyncio.to_thread(self.pb.collection(LODGING_AVAILABILITY).delete, record_id)

    async def find_write_in(self, year: int, session_cm_id: int, unit_pb_id: str) -> Any | None:
        """The one LIVE write-in for a unit this weekend, or None.

        Keyed exactly as `idx_lodging_write_in_unique` is
        (session_cm_id, year, unit), so the lookup either finds the row the
        next write would collide with or there is none -- the same argument
        `find_availability_override` makes for the table this half moves off.

        `unit_pb_id` arrives in the request body and is escaped. Unescaped, an
        injected `||` would return some OTHER weekend's row, which the caller
        then updates or deletes.
        """
        rows = await self._page(
            LODGING_WRITE_INS,
            query_params={
                "filter": (f'session_cm_id = {session_cm_id} && year = {year} && unit = "{pb_escape(unit_pb_id)}"'),
                "sort": STABLE_SORT,
            },
        )
        return rows[0] if rows else None

    async def find_draft_write_in(self, year: int, session_cm_id: int, scenario_id: str, unit_pb_id: str) -> Any | None:
        """The one write-in for a unit in a scenario, or None.

        The live key plus `scenario`, matching
        `idx_lodging_write_in_draft_unique` -- two scenarios may hold
        contradicting write-ins for one unit without colliding, which is the
        whole point of the draft grain.

        TWO client-supplied strings reach this filter, `scenario_id` off the
        `?scenario=` query parameter and `unit_pb_id` from the request body,
        and both are escaped: either one unescaped widens the predicate past
        its own scoping, and on a lookup the caller updates or deletes what
        comes back.
        """
        rows = await self._page(
            LODGING_WRITE_INS_DRAFT,
            query_params={
                "filter": (
                    f"session_cm_id = {session_cm_id} && year = {year} "
                    f'&& scenario = "{pb_escape(scenario_id)}" && unit = "{pb_escape(unit_pb_id)}"'
                ),
                "sort": STABLE_SORT,
            },
        )
        return rows[0] if rows else None

    async def create_write_in(self, data: dict[str, Any]) -> Any:
        return await asyncio.to_thread(self.pb.collection(LODGING_WRITE_INS).create, data)

    async def update_write_in(self, record_id: str, data: dict[str, Any]) -> Any:
        return await asyncio.to_thread(self.pb.collection(LODGING_WRITE_INS).update, record_id, data)

    async def delete_write_in(self, record_id: str) -> None:
        await asyncio.to_thread(self.pb.collection(LODGING_WRITE_INS).delete, record_id)

    async def create_draft_write_in(self, data: dict[str, Any]) -> Any:
        return await asyncio.to_thread(self.pb.collection(LODGING_WRITE_INS_DRAFT).create, data)

    async def update_draft_write_in(self, record_id: str, data: dict[str, Any]) -> Any:
        return await asyncio.to_thread(self.pb.collection(LODGING_WRITE_INS_DRAFT).update, record_id, data)

    async def delete_draft_write_in(self, record_id: str) -> None:
        await asyncio.to_thread(self.pb.collection(LODGING_WRITE_INS_DRAFT).delete, record_id)

    async def find_slot_merge(self, year: int, session_cm_id: int, unit_pb_id: str, scenario: str) -> Any | None:
        """The one merge row for a container at this tier, or None.

        `scenario` is optional (1500000140): a blank value looks up the
        WEEKEND-LEVEL row exactly as a named one looks up that scenario's own
        row -- same filter shape, same tier the caller asked for.

        Matches idx_lodging_slot_merge_unique, which 1500000147 re-keyed to
        (unit, session_cm_id, year, scenario).
        Without an index of exactly this shape a container could carry two
        contradicting rows and "is this house one card?" would stop having an
        answer -- the same argument as find_availability_override.

        Every interpolated string is escaped, matching find_availability_override:
        `unit_pb_id` and `scenario` arrive in the request body.
        """
        rows = await self._page(
            LODGING_SLOT_MERGES,
            query_params={
                "filter": (
                    f"session_cm_id = {session_cm_id} && year = {year} "
                    f'&& unit = "{pb_escape(unit_pb_id)}" && scenario = "{pb_escape(scenario)}"'
                ),
                "sort": STABLE_SORT,
            },
        )
        return rows[0] if rows else None

    async def create_slot_merge(self, data: dict[str, Any]) -> Any:
        return await asyncio.to_thread(self.pb.collection(LODGING_SLOT_MERGES).create, data)

    async def update_slot_merge(self, record_id: str, data: dict[str, Any]) -> Any:
        return await asyncio.to_thread(self.pb.collection(LODGING_SLOT_MERGES).update, record_id, data)

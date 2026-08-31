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

from pocketbase.client import ClientResponseError  # type: ignore[attr-defined]

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
    LODGING_UNIT_ALIASES,
    LODGING_UNITS,
    LODGING_WRITE_IN_PUSHES,
    LODGING_WRITE_INS,
    LODGING_WRITE_INS_DRAFT,
    ORIGINAL_BUNK_REQUESTS,
    PERSON_CUSTOM_VALUES,
    SYNC_RUNS,
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

# `camp_sessions.session_type` for a family-camp weekend. The same literal
# `SessionResolver.GetFamilyCampSessionCMIDs` filters on -- exactly and only --
# which is what makes kindred#2478 section 5.1's scope ruling a fact about the
# data rather than a preference: the adult sessions are not in the bounded
# cohort at all, so their cabin answers are never fetched by the six-job chain
# and their mirror rows are rewritten daily from custom values up to seven days
# old.
#
# Named here rather than in either service because BOTH read it -- the compare
# footer and the roster's per-weekend housing freshness -- and
# `lodging_compare_service` already imports `lodging_roster_service`, so the
# constant cannot live in the one that would then have to import back.
FAMILY_SESSION_TYPE = "family"

# camp_sessions.session_type values that this surface owns. Summer types
# (main/embedded/ag/quest/...) belong to the bunking board, not here.
WEEKEND_SESSION_TYPES = (FAMILY_SESSION_TYPE, "adult")

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
# `fetch_prior_household_cm_ids` pages every ENROLLED weekend attendee from
# every prior year (kindred#2475 moved it off `households`, which had no
# enrollment predicate at all) -- at the default batch of 100 that is still a
# round-trip-bound read over thousands of rows to produce one boolean per
# party. At 1000 it was 21 requests and ~1.0s against the smaller `households`
# read this replaced (#1966); the `attendees` read is pricier per row (each
# expands `person`), but the same round-trip-bound argument for PAGE_SIZE
# applies to it unchanged.
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

    async def fetch_all_units(self) -> list[Any]:
        """EVERY lodging unit, every season -- the registry, for NAMING things.

        kindred#2332. Deliberately unfiltered, and that is what separates it
        from `fetch_units`. Naming a unit is a question about the PRESENT, so
        the registry's latest season has to be discovered from the table
        rather than assumed to be the year being read: `lodging_units` holds
        2026 only (118 of 118), so resolving a 2023 cabin string against 2023's
        units finds nothing at all. That is the trap that made display
        resolution look impossible (kindred#2392).

        Older seasons are read too, not merely tolerated. An alias stores
        whichever season's record ids existed when it was written and is never
        re-pointed, so translating a stored member id needs `code` for units of
        EVERY year -- `code` is the cross-year identity thread, exactly as
        `AliasResolver` uses it.

        No `expand`: `HousingNameResolver` wants `code`, `name`, `year` and
        `parent_unit`, and the area relation is `fetch_units`' business.

        Deliberately NOT cached, for `fetch_units`' reason made sharper by this
        issue -- `lodging_units.name` is written straight to PocketBase from
        the admin panel, and staff rename in bursts (fourteen of the 118 units
        on 2026-08-15, inside two minutes). A TTL here would show the old name
        on four surfaces at once.
        """
        return await self._page(LODGING_UNITS, query_params={"sort": STABLE_SORT})

    async def fetch_unit_aliases(self) -> list[Any]:
        """Every `lodging_unit_aliases` row -- the historical spellings.

        NO YEAR FILTER, because the table has no `year` column and never
        should: a row's `valid_from_year` / `valid_to_year` window records what
        a building was CALLED from a given year, which is a rename history and
        not a per-year copy. The window is applied per raw string at the year
        THAT STRING came from (`HousingNameResolver.display_name`), never at
        the registry's loaded year -- pinning it to the current season
        discards the four rows carrying `valid_to_year = 2024` and strands 49
        of the 1,861 cabin-bearing rows at their raw spelling.

        `member_units` is left as raw relation ids rather than expanded: the
        resolver maps id -> code -> the registry year's row off
        `fetch_all_units`, which it holds anyway, so an expand would pay for
        rows already in hand.

        Deliberately NOT cached: `mapUnresolvedAlias` in `lodgingCrud.ts`
        writes this table straight from the admin panel, never through this
        API -- the same argument `count_open_unresolved_aliases` makes for the
        queue that feeds it.
        """
        return await self._page(LODGING_UNIT_ALIASES, query_params={"sort": STABLE_SORT})

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
        """One household's FAMILY-session attendees, EVERY year, EVERY status.

        The cross-year read behind the household journey (kindred#2073). The
        year is deliberately NOT a parameter here -- unlike every other read
        in this file -- because the journey's window is not chosen, it is
        discovered: the years a household appears in are exactly the years it
        was with us, and a hard-coded floor would either invent empty rows or
        silently truncate a long-standing family's history.

        ⚠️ `person.household_id`, NOT `person.household`. Both exist on
        `persons` and both look right. `household` is a PocketBase relation
        into the YEAR-SCOPED `households` table, and `persons` rows are
        themselves per-year (11,432 distinct people across 28,635 rows on the
        production snapshot), so each year's person row points at that same
        year's household record. Filtering on it can therefore only ever
        match one season. `household_id` is the CampMinder id, which is the
        identity thread across seasons (CLAUDE.md section 1).

        `session.session_type = "family"`, and adult weekends are NOT read.
        Men's and Women's Weekend and the Divorce & Discovery retreat are a
        DIFFERENT PROGRAM that happens to enrol adults directly, so their
        attendee rows say nothing about family camp. kindred#2516 briefly
        proposed reading them, on the measurement that 34 of 2026's 425
        "enrolled" family-camp registrations have no enrolled child and an
        adult-weekend row. That reasoning is CIRCULAR and the number is an
        artefact: `enrollment_status` is itself derived from
        `session_type IN ("family", "adult")`, so those 34 are "enrolled"
        BECAUSE of the adult weekend. Checked against the snapshot, all 34
        have no family-session attendee row in any state -- they never
        registered for a family weekend at all.

        ⚠️ NO STATUS FILTER, and that is a deliberate reversal. Every other
        attendee read here applies `ACTIVE_ENROLLED_FILTER`; this one cannot,
        because the journey has to tell two things apart that an enrolled-only
        read renders identical:

        * a household whose child was booked and then CANCELLED -- its
          `cabin_assignment` string is stale, staff assigned it before the
          cancellation and nothing clears the field. 101 household-years on
          the snapshot. The year must NOT render.
        * a household with NO family attendee row at all that still holds a
          cabin -- a PAPER registration. Adults-only family camp is never
          entered into CampMinder, so the cabin staff typed is the household's
          only trace, and it is proof they slept here. 57 household-years,
          51 of them in 2022. The year MUST render.

        Both look like "no enrolled child" to a filtered read. The caller
        applies `status_id = 2` itself when collecting MEMBERS, and uses the
        bare presence of a row for the paper test.

        NOT cached. `lodging_cache` is keyed by year and this read has no
        year; it is also per-household rather than per-season, so it is small
        (one family's members) and there is no year-scoped sharing to win.
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
                "filter": (f'person.household_id = {household_cm_id} && session.session_type = "family"'),
                # `session` alongside `person` (kindred#2420): the journey
                # needs to know WHICH session this attendee row is enrolled
                # in, to compute that child's age at that specific session's
                # start rather than at the year's earliest camp-wide family
                # session -- a season runs several, months apart, and a
                # household does not necessarily attend the first one.
                #
                # Since kindred#2516 it carries a second load: `session_type`
                # is what the caller splits family from adult on, so an
                # unexpanded `session` would not merely lose an age, it would
                # make an adult weekend indistinguishable from a family one.
                "expand": "person,session",
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

    async def fetch_household_registration_cabins(self, household_cm_id: int) -> dict[int, str]:
        """This household's staff-written cabin string, per year (kindred#2073).

        ⚠️ THIS READ STOPPED BEING A YEAR SOURCE IN kindred#2516. It used to
        return the bare set of years a `family_camp_registrations` row exists
        for, and the journey unioned that into its window -- which is what put
        a cancelled or waitlisted family's year on the card looking exactly
        like a year they attended. A registration row means a form was filled
        in, never that anybody turned up.

        What it carries now is the CABIN, because a cabin means somebody
        SLEPT here. That is the one fact in this table which is evidence of
        attendance rather than of intent, and it exists to rescue exactly one
        population: PAPER registrations. Adults-only family camp is never
        entered into CampMinder at all, so a household that registered on
        paper has no attendee row in any state -- the cabin staff typed is its
        only trace. 57 household-years on the snapshot, 51 of them in 2022.

        ⛔ A CABIN IS NOT ENOUGH ON ITS OWN, and the caller enforces that. A
        household whose child was booked and then cancelled ALSO holds a
        cabin: staff assigned it before the cancellation and nothing clears
        the field, so the string is stale. 101 household-years look like that,
        and they must not render. The discriminator is whether a
        family-session attendee row exists AT ALL, which is why
        `fetch_household_family_attendees` dropped its status filter.

        Blank on all 1,433 rows from 2017-2021, so this rescues nothing before
        2022 -- which is correct: 2020's season was cancelled after enrollment
        and 2021 was cancelled before it, and neither has a cabin on file.
        """
        if household_cm_id <= 0:
            return {}
        rows = await self._page(
            FAMILY_CAMP_REGISTRATIONS,
            query_params={
                "filter": f"household.cm_id = {household_cm_id}",
                # `cabin_assignment` alongside `year`: requesting `year` alone
                # is what made this a bare year set, and the whole point of the
                # read now is the string beside it.
                "fields": "year,cabin_assignment",
                "sort": STABLE_SORT,
            },
        )
        cabins: dict[int, str] = {}
        for row in rows:
            year = int(getattr(row, "year", 0) or 0)
            if not year:
                continue
            # RAW, exactly as `fetch_cabin_assignments_by_household_cm_id`
            # returns it: resolution happens at display (kindred#2332), and a
            # string nobody can map is still a household that was placed.
            cabin = str(getattr(row, "cabin_assignment", "") or "")
            # One row per household-year (unique index), so no merge rule is
            # needed -- but prefer a non-blank if the index ever loosens,
            # rather than letting row order decide whether a family attended.
            if cabin or year not in cabins:
                cabins[year] = cabin
        return cabins

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
        """CampMinder ids of every household with an ENROLLED weekend attendee
        in an EARLIER year -- the returning-family signal (kindred#2475).

        This used to page `households` on a bare `year < {year}`, with no
        enrollment predicate at all. A `households` row exists for a year
        because a *person* record existed that year -- registration,
        waitlist, cancellation and inquiry alike, since `households` carries
        no status column of its own. That badged a family Returning off a
        year they only ever cancelled or waitlisted (21 of 396 badged
        2026 households on the production snapshot, 8-11% in settled years).

        `attendees` is where enrollment actually lives, so this reads THAT
        table instead: `status_id = 2` (`ACTIVE_ENROLLED_FILTER`) is the
        single source of truth for enrollment everywhere else in this file,
        and `_attendee_weekend_session_filter` keeps summer sessions
        (main/embedded/ag/quest/...) from counting as a prior weekend visit.

        Bridged through `person.household_id` (the CampMinder id) rather than
        `person.household` (the PocketBase relation): this is a cross-YEAR
        read, exactly like `fetch_household_weekend_attendees`, and
        `household` is a relation into the year-scoped `households` table --
        it can only ever match one season. `household_id` is the identity
        thread across seasons (CLAUDE.md section 1).

        Deliberately NOT `persons.years_at_camp`: it counts only SUMMER
        attendance and is blind to weekends (225 of 360 genuine 2026
        returners have `max(years_at_camp) = 0`) -- it would misclassify most
        real returners as first-time.

        `attendees` is the pricier table to page here (each row expands
        `person`), but this is still the once-per-year cross-season read
        #1966/#1976 already bought the round-trip cost down for
        (batch=PAGE_SIZE); caching is what is left, and it is safe here for
        the same reason as fetch_households: year-scoped, sync-written only.
        See api/services/lodging_cache.py.
        """
        rows = await self._page(
            ATTENDEES,
            query_params={
                "filter": (f"year < {year} && ({_attendee_weekend_session_filter()}) && {ACTIVE_ENROLLED_FILTER}"),
                "expand": "person",
                "sort": STABLE_SORT,
            },
        )
        ids: set[int] = set()
        for row in rows:
            expand = getattr(row, "expand", None) or {}
            person = expand.get("person") if isinstance(expand, dict) else None
            household_id = int(getattr(person, "household_id", 0) or 0) if person is not None else 0
            if household_id:
                ids.add(household_id)
        return ids

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
        wants_near / wants_with_named / wants_similar_ages, request_text --
        and the six narrative-free housing flags -- needs_private_bathroom,
        needs_power, needs_accommodation, has_infant, needs_fridge since
        kindred#2224, and needs_step_free since kindred#2438. Read those
        columns; do not re-derive them from
        share_cabin_preference / shared_cabin_modes_raw, which are the raw
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
        -- FREE TEXT, not a relation, and RAW: this read returns exactly what
        staff typed that season and resolves nothing.

        RESOLUTION HAPPENS AT DISPLAY, ONE LAYER UP (kindred#2332). Owner
        ruling 2026-08-18: every surface renders the unit's CURRENT registry
        name, so `HousingNameResolver` -- fed by `fetch_all_units` and
        `fetch_unit_aliases` -- translates this string in the service, at the
        year the string came from. Keeping the raw value here is what lets the
        journey publish the name and its provenance from one read, and what
        keeps `_housing_state` deciding placed/not-placed on PRESENCE rather
        than on whether a name happened to resolve.

        ⚠ ONE STRING PER HOUSEHOLD-YEAR, WITH NO SESSION DIMENSION, and no
        caller may present it as per-weekend (kindred#2336). The source is a
        single CampMinder household custom field (`Family Camp Cabin`, one
        value per household-year), so a household attending two weekends of a
        season has one cabin for both -- there is no second weekend's answer
        being lost, and widening the grain would replicate one string N times
        and bake the fan-out into the schema. Staff confirmed 2026-08-15 that
        the overwrite is acceptable and declined a snapshot or lookback. 41 of
        1,703 cabin-holding household-years are multi-weekend; cutting this
        column by weekend as though it were a placement manufactured 12 of 17
        false multi-household occupancies in one analysis. The honest
        per-weekend rule already ships in Go
        (`LodgingAssignmentsSync.AttributeSession`), which pins the year's
        single string to a weekend only when the household attended exactly
        one and queues an ingest issue otherwise.

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

    async def fetch_last_successful_sync_end(self, service: str) -> str:
        """When `service`'s last SUCCESSFUL sync finished, RFC3339, or "".

        The freshness half of a payload that wants to state the age of the
        data it just read. A caller that reads this BEFORE the rows can only
        understate freshness -- a sync landing mid-request belongs to a run
        this timestamp predates -- whereas a browser asking a second endpoint
        afterwards can overstate it, which is the failure this exists to make
        impossible.

        SUCCESS ONLY. A failed run refreshed nothing, so publishing its
        `ended` would be the same lie `Orchestrator.LastRecordedRuns` refuses
        in `pocketbase/sync/sync_runs.go`. The two must agree: that function
        feeds the weekend shell's "Housing synced ..." line and this feeds the
        compare footer, and one screen may not date the mirror two ways.

        SORTED `-started,-id`, matching that function's
        `ROW_NUMBER() OVER (PARTITION BY service ORDER BY started DESC, id DESC)`
        exactly rather than sorting on `ended`. Stored timestamps are
        millisecond precision and a fast transform can produce two within one,
        so the id breaks the tie the same way on both sides.

        ONE ROW, via `_count`'s `get_list` shape rather than `_page`:
        `sync_runs` holds every service's run for the whole retention window,
        and `get_full_list` would page thousands in to read one field.

        "" for a service that has never recorded a success. The caller renders
        that as "unknown", which is a warning; any invented timestamp would
        read as a guarantee.
        """
        result = await asyncio.to_thread(
            self.pb.collection(SYNC_RUNS).get_list,
            1,
            1,
            query_params={
                "filter": f'service = "{pb_escape(service)}" && status = "success"',
                "sort": "-started,-id",
                "fields": "ended",
            },
        )
        items = list(result.items)
        if not items:
            return ""
        ended = str(getattr(items[0], "ended", "") or "")
        # PocketBase serialises a datetime SPACE-separated
        # ("2026-08-23 10:16:08.257Z"). The Go status endpoint this replaces
        # emitted Go's own RFC3339, and `new Date()` parses the space form
        # only by engine leniency -- normalised here so the component never
        # has to know which producer it is reading.
        return ended.replace(" ", "T", 1)

    async def fetch_session_scoped_sync_ends(self, service: str, year: int) -> list[tuple[str, str]]:
        """`service`'s successful runs in `year`, newest first, as
        (session, ended) -- RFC3339, and "" for a run that covered every
        weekend.

        `fetch_last_successful_sync_end` above answers "when did this job last
        succeed", which is one row and enough for a job nobody scopes. Refresh
        Housing IS scoped (kindred#2601): a press names the weekend it was
        started for, so the last run of the job is often a run that covered a
        DIFFERENT weekend. The sync-status payload keeps one slot per job and
        cannot say more than that, which is why both weekend surfaces went
        silent there. THE ORDER IS THE ANSWER: the caller walks this list and
        takes the first row that covers its weekend, so the most recent run
        that was unscoped OR scoped to it wins (kindred#2617).

        EMPTY SESSION MEANS EVERY WEEKEND, not "unknown". The nightly cron
        refreshes the whole family-camp cohort and names no weekend, so a
        blank is a positive claim about coverage -- and it is what every row
        written before 1500000175 carries, correctly, because scoping a press
        did not exist when they ran.

        The YEAR filter is not optional: CampMinder REUSES session ids across
        years, so an unscoped 2025 run says nothing about the 2026 weekend
        wearing the same cm_id.

        SORTED `-started,-id`, matching `Orchestrator.LastRecordedRuns` and
        `fetch_last_successful_sync_end` exactly rather than sorting on
        `ended`. Stored timestamps are millisecond precision and a fast
        transform can produce two within one, so the id breaks the tie the
        same way in all three places -- and picking the first row of an
        ordered list, rather than comparing the timestamps as strings, is what
        keeps this from inventing a fourth ordering.

        PAGED, unlike its one-row sibling, and the filter is what makes that
        affordable: `sync_runs` holds every service's run for the whole
        retention window, but ONE service in ONE year over
        `SyncRunRetentionDays` is order tens of rows, of which two fields are
        read.

        A run with no `ended` is DROPPED rather than carried as a blank: it
        can date nothing, and keeping it would let it shadow the older run
        that can, turning a real timestamp into silence.

        WHAT THIS READ MAY EXPECT OF THE WRITER, stated here because
        `recordSyncRun` deliberately skips the Go sync layer's WAL checkpoint
        and kindred#2297 asked that the question be settled "on the read
        path's expectations" once a reader existed:

        - IT SEES EVERY COMMITTED ROW. This goes through PocketBase's REST
          API, so it is PocketBase reading its own writes on its own
          connection -- there is no cross-connection WAL visibility gap to
          worry about, and there would be one for a reader that opened
          `data.db` itself.
        - The one edge is a HOST POWER LOSS (not a crash, not a `docker
          stop` -- SQLite recovers committed WAL frames on the next open),
          which can lose the newest rows. That makes a weekend's freshness
          UNDERSTATE itself and self-heal at the next covering run. Every
          other failure in this feature is shaped the same way, so nothing
          downstream needs a special case for it.
        """
        rows = await self._page(
            SYNC_RUNS,
            query_params={
                "filter": f'service = "{pb_escape(service)}" && status = "success" && year = {year}',
                "sort": "-started,-id",
                "fields": "session,ended",
            },
        )

        ends: list[tuple[str, str]] = []
        for row in rows:
            # PocketBase serialises a datetime SPACE-separated
            # ("2026-08-23 10:16:08.257Z"); `new Date()` parses that form only
            # by engine leniency. Normalised here for the same reason
            # `fetch_last_successful_sync_end` normalises: the component must
            # not have to know which producer it is reading.
            ended = str(getattr(row, "ended", "") or "").replace(" ", "T", 1)
            if not ended:
                continue
            ends.append((str(getattr(row, "session", "") or ""), ended))
        return ends

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

    async def find_write_in(self, year: int, session_cm_id: int, unit_pb_id: str, occupant_name: str) -> Any | None:
        """The LIVE write-in naming this occupant in this unit, or None.

        Keyed exactly as `idx_lodging_write_in_unique` is since kindred#2583
        step 8 narrowed it: (session_cm_id, year, unit, occupant_name). So the
        lookup either finds the row the next write would collide with or there
        is none -- the same argument `find_availability_override` makes for
        the table this half moves off.

        ⚠️ THE OCCUPANT TERM IS LOAD-BEARING, NOT DECORATIVE, and this
        docstring used to argue from the (session_cm_id, year, unit) key --
        "the one LIVE write-in for a unit this weekend". `unit` alone stopped
        being an address the moment a shareable cabin was allowed two rows:
        a lookup keyed on it hands `set_availability` an arbitrary neighbour
        to overwrite, which is the silent data-loss path kindred#2583 exists
        to close. Design B (RULED 2026-08-29, owner: *"lets go with the
        identity of unit and occupant"*) makes `(unit, occupant_name)` the
        key, and this filter is where that decision is spelled.

        WHAT IT COSTS, stated rather than rediscovered: two genuinely
        different households typed as the same display string collapse into
        one row, and the second write edits the first. Real, uncommon, and
        strictly rarer than the failure this replaces.

        LIVE SINCE STEP 8 (`1500000176`). While the index still keyed on the
        unit alone this returned exactly what the unit-keyed finder did, for
        every row that could then exist; a unit may now hold two, and which
        one this returns is the whole of the difference.

        `unit_pb_id` and `occupant_name` both arrive in the request body and
        are both escaped. Unescaped, an injected `||` would return some OTHER
        weekend's or unit's row, which the caller then updates or deletes.
        """
        rows = await self._page(
            LODGING_WRITE_INS,
            query_params={
                "filter": (
                    f"session_cm_id = {session_cm_id} && year = {year} "
                    f'&& unit = "{pb_escape(unit_pb_id)}" && occupant_name = "{pb_escape(occupant_name)}"'
                ),
                "sort": STABLE_SORT,
            },
        )
        return rows[0] if rows else None

    async def find_draft_write_in(
        self, year: int, session_cm_id: int, scenario_id: str, unit_pb_id: str, occupant_name: str
    ) -> Any | None:
        """The write-in naming this occupant in this unit, in one scenario.

        The live key plus `scenario`, matching
        `idx_lodging_write_in_draft_unique` -- two scenarios may hold
        contradicting write-ins for one unit without colliding, which is the
        whole point of the draft grain. `scenario` is RETAINED under
        kindred#2583's narrowing: it is a legitimate second axis, and dropping
        it would let two scenarios' rows collide.

        THREE client-supplied strings reach this filter now, not two:
        `scenario_id` off the `?scenario=` query parameter, `unit_pb_id` from
        the request body, and `occupant_name` -- the Design B addressing key,
        typed by a staff member. Every one is escaped: any one unescaped
        widens the predicate past its own scoping, and on a lookup the caller
        updates or deletes what comes back.
        """
        rows = await self._page(
            LODGING_WRITE_INS_DRAFT,
            query_params={
                "filter": (
                    f"session_cm_id = {session_cm_id} && year = {year} "
                    f'&& scenario = "{pb_escape(scenario_id)}" && unit = "{pb_escape(unit_pb_id)}" '
                    f'&& occupant_name = "{pb_escape(occupant_name)}"'
                ),
                "sort": STABLE_SORT,
            },
        )
        return rows[0] if rows else None

    async def fetch_write_ins_on_unit(self, year: int, session_cm_id: int, unit_pb_id: str) -> list[Any]:
        """EVERY live occupancy row on one unit this weekend.

        The UNIT-grain read, and it exists because the two finders above are
        no longer one (kindred#2583 step 7). `family_available: null` clears a
        unit entirely and a release opens it to families; both are facts about
        the CABIN, not about an occupant, so neither may go through a lookup
        that names one. Routed through `find_write_in` a clear would delete
        whichever row came back first and leave the rest standing -- a cleared
        cabin still occupied, or a released one advertised as open with
        somebody in it.

        `unit_pb_id` arrives in the request body and is escaped, for the
        reason `find_write_in` spells out.
        """
        return await self._page(
            LODGING_WRITE_INS,
            query_params={
                "filter": (f'session_cm_id = {session_cm_id} && year = {year} && unit = "{pb_escape(unit_pb_id)}"'),
                "sort": STABLE_SORT,
            },
        )

    async def fetch_draft_write_ins_on_unit(
        self, year: int, session_cm_id: int, scenario_id: str, unit_pb_id: str
    ) -> list[Any]:
        """EVERY draft occupancy row on one unit, inside one scenario.

        The draft twin of `fetch_write_ins_on_unit`. `scenario` is not
        optional here: a clear made inside one plan must not reach another's
        rows, and the live board's rows are a third scope again.
        """
        return await self._page(
            LODGING_WRITE_INS_DRAFT,
            query_params={
                "filter": (
                    f"session_cm_id = {session_cm_id} && year = {year} "
                    f'&& scenario = "{pb_escape(scenario_id)}" && unit = "{pb_escape(unit_pb_id)}"'
                ),
                "sort": STABLE_SORT,
            },
        )

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

    # ---------------------------------------------------------- push ledger
    #
    # kindred#2477. `lodging_write_in_pushes` records each push a staff member
    # actually applies -- the audit trail behind "who pushed what, and when"
    # -- and is written after a push, never read to build the preview above.
    # `preview_push` (lodging_write_service.py) classifies straight off
    # `fetch_write_ins` / `fetch_draft_write_ins` and never touches this
    # collection at all.

    async def create_push_event(self, data: dict[str, Any]) -> Any:
        return await asyncio.to_thread(self.pb.collection(LODGING_WRITE_IN_PUSHES).create, data)

    async def find_push_event(self, record_id: str) -> Any | None:
        try:
            return await asyncio.to_thread(self.pb.collection(LODGING_WRITE_IN_PUSHES).get_one, record_id)
        except ClientResponseError as exc:
            if exc.status == 404:
                return None
            raise

    async def update_push_event(self, record_id: str, data: dict[str, Any]) -> Any:
        return await asyncio.to_thread(self.pb.collection(LODGING_WRITE_IN_PUSHES).update, record_id, data)

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

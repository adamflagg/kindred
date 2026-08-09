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

AVAILABILITY used to be the exception, and is not any more. 1500000132 left
lodging_availability scenario-aware in place, reasoning that nothing syncs into
it so there was no record of truth to protect. That argued against a draft
TWIN; it never established that availability varies by scenario, and it does
not -- a burst pipe closes a cabin in every plan for that weekend. 1500000135
deleted the column, so there is ONE availability read, issued identically with
or without a scenario, and no lodging read is an overlay any more.

Request answers are NOT re-parsed here. The Go ingest derives the share gate,
the NEAR/WITH/similar-ages modes, the household-grain request text and the four
housing flags into typed columns on `family_camp_registrations`; this layer
reads those columns. See api/services/lodging_rules.py for why re-deriving them
in Python would regress fixes that live only on the Go side.
"""

from __future__ import annotations

import asyncio
from collections import defaultdict
from typing import TYPE_CHECKING, Any

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
)
from api.constants.filters import ACTIVE_ENROLLED_FILTER
from api.dependencies import lodging_cache
from api.services.lodging_cache import cached_by_year
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
        """Staff reservations and releases for one session.

        ONE layer, read identically with or without a scenario. 1500000135
        dropped this table's `scenario` column: availability is a fact about
        the WEEKEND rather than about the plan, so a burst pipe closes a cabin
        in every scenario for that weekend and there is nothing for a scenario
        to disagree about. There is no companion `fetch_scenario_availability`
        to overlay on top of this, and adding one back would reintroduce the
        last overlay in the lodging model.
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

    async def fetch_attendees_for_session(self, year: int, session_pb_id: str) -> list[Any]:
        """Active-enrolled attendees for one session, with person expanded.

        status_id = 2 is the single source of truth for enrolment; filtering
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

        The PHI path uses this instead of fetch_households: answering one
        household must not materialise every family in the year.
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
        four PHI-free housing flags. Read those columns; do not re-derive them
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

    async def fetch_family_camp_medical(self, year: int) -> dict[str, Any]:
        """PHI, keyed by household PB id. NO PRODUCTION CALLER.

        kindred#1889 deleted the last one. The roster used to read this whole
        map to derive `has_medical_narrative` from PRESENCE -- a boolean true
        for every household, because these questions store "No" as text -- and
        deleting the flag took the read with it. The narrative is now served
        solely by the permission-gated medical endpoint, which reads ONE
        household through fetch_medical_for_household.

        So there is nothing a caller here should be doing: pulling every
        household's disclosure into API memory is the cost that deletion
        bought back, and presence is not a signal. Two tests in
        test_lodging_roster_service.py assert this is never called.
        """
        rows = await self._page(
            FAMILY_CAMP_MEDICAL,
            query_params={"filter": f"year = {year}", "sort": STABLE_SORT},
        )
        return {str(getattr(row, "household", "")): row for row in rows}

    async def fetch_medical_for_household(self, year: int, household_pb_id: str) -> Any | None:
        """PHI for ONE household, or None.

        A blank id means the household did not resolve, and is never turned
        into a query: an unanchored filter is how one family's narrative
        reaches another family's request.
        """
        if not household_pb_id:
            return None
        rows = await self._page(
            FAMILY_CAMP_MEDICAL,
            query_params={
                "filter": f'year = {year} && household = "{household_pb_id}"',
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

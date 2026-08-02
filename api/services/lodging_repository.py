"""Data access for the weekend lodging surface.

Every PocketBase read behind /api/lodging lives here so the service layer is
testable against mocks. Mirrors api/services/metrics_repository.py.

Two layers, since 1500000132. The SYNCED rows are the base and are read with
no scenario predicate -- lodging_assignments and lodging_merges no longer have
that column, because it was dead weight that invited a `scenario != ""` write
rule instead of a draft table. A scenario's own rows come from
lodging_assignments_draft, and from lodging_availability filtered to the
scenario, and OVERLAY the base per party and per unit.

Overlay rather than replace is what makes a freshly-created scenario render
the CampMinder mirror rather than an empty board, with no seed step to go
wrong. `scenario = ""` still means the live plan for availability, which kept
its column.

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
    LODGING_MERGES_DRAFT,
    LODGING_UNITS,
)
from api.constants.filters import ACTIVE_ENROLLED_FILTER
from bunking.logging_config import get_logger

if TYPE_CHECKING:
    from pocketbase import PocketBase

logger = get_logger(__name__)

# camp_sessions.session_type values that this surface owns. Summer types
# (main/embedded/ag/quest/...) belong to the bunking board, not here.
WEEKEND_SESSION_TYPES = ("family", "adult")

# Empty scenario = the live plan.
LIVE_PLAN_FILTER = 'scenario = ""'

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


def _weekend_type_filter() -> str:
    return " || ".join(f'session_type = "{t}"' for t in WEEKEND_SESSION_TYPES)


class LodgingRepository:
    """PocketBase access layer for the weekend lodging surface."""

    def __init__(self, pb: PocketBase) -> None:
        self.pb = pb

    async def fetch_weekend_sessions(self, year: int) -> list[Any]:
        """All family + adult sessions for a year, in display order."""
        return await asyncio.to_thread(
            self.pb.collection(CAMP_SESSIONS).get_full_list,
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
        rows = await asyncio.to_thread(
            self.pb.collection(CAMP_SESSIONS).get_full_list,
            query_params={
                "filter": f"year = {year} && cm_id = {session_cm_id} && ({_weekend_type_filter()})",
                "sort": STABLE_SORT,
            },
        )
        return rows[0] if rows else None

    async def fetch_units(self) -> list[Any]:
        """Every lodging unit with its area expanded.

        Deliberately unfiltered: container rows and inactive units stay in
        the payload so the roster can badge them. Only the CAPACITY COUNTS
        exclude containers (spec §9a: naive SUM(sleeps) is 408 vs a true 389).
        """
        return await asyncio.to_thread(
            self.pb.collection(LODGING_UNITS).get_full_list,
            query_params={"expand": "area", "sort": "area.sort_order,name"},
        )

    async def fetch_availability(self, year: int, session_pb_id: str) -> list[Any]:
        """Live-plan staff reservations / releases for one session.

        lodging_availability is the one placement table that stayed
        scenario-aware IN PLACE rather than gaining a draft twin: nothing syncs
        into it, so there is no record of truth to protect. This reads the LIVE
        rows only; a scenario's own overrides come from
        fetch_scenario_availability and overlay these.
        """
        return await asyncio.to_thread(
            self.pb.collection(LODGING_AVAILABILITY).get_full_list,
            query_params={
                "filter": f'session = "{session_pb_id}" && year = {year} && {LIVE_PLAN_FILTER}',
                "sort": STABLE_SORT,
            },
        )

    async def fetch_scenario_availability(self, year: int, session_pb_id: str, scenario_id: str) -> list[Any]:
        """One scenario's reservation overrides for one session."""
        return await asyncio.to_thread(
            self.pb.collection(LODGING_AVAILABILITY).get_full_list,
            query_params={
                "filter": f'session = "{session_pb_id}" && year = {year} && scenario = "{scenario_id}"',
                "sort": STABLE_SORT,
            },
        )

    async def fetch_assignments(self, year: int, session_pb_id: str) -> list[Any]:
        """Synced lodging assignments for one session.

        No scenario predicate: 1500000132 dropped that column. It was never
        written -- all 67 rows carried '' -- and keeping it would have invited
        exactly the `scenario != ""` write rule the draft table exists to avoid.
        These rows ARE the live plan, and a scenario overlays them.
        """
        return await asyncio.to_thread(
            self.pb.collection(LODGING_ASSIGNMENTS).get_full_list,
            query_params={
                "filter": f'session = "{session_pb_id}" && year = {year}',
                "expand": "unit,merge",
                "sort": STABLE_SORT,
            },
        )

    async def fetch_draft_assignments(self, year: int, session_pb_id: str, scenario_id: str) -> list[Any]:
        """One scenario's draft placements for one session.

        Three targets expand, not two: `unit` is an atomic room, `merge` is a
        slot the ingest built from a historical cabin string, and `merge_draft`
        is one the board built inside this scenario. A PocketBase relation
        names a single collection, so the two kinds of merge need two fields.
        """
        return await asyncio.to_thread(
            self.pb.collection(LODGING_ASSIGNMENTS_DRAFT).get_full_list,
            query_params={
                "filter": f'session = "{session_pb_id}" && year = {year} && scenario = "{scenario_id}"',
                "expand": "unit,merge,merge_draft",
                "sort": STABLE_SORT,
            },
        )

    async def fetch_attendees_for_session(self, year: int, session_pb_id: str) -> list[Any]:
        """Active-enrolled attendees for one session, with person expanded.

        status_id = 2 is the single source of truth for enrolment; filtering
        any other way is silently wrong.
        """
        return await asyncio.to_thread(
            self.pb.collection(ATTENDEES).get_full_list,
            query_params={
                "filter": f'session = "{session_pb_id}" && year = {year} && {ACTIVE_ENROLLED_FILTER}',
                "expand": "person",
                "sort": STABLE_SORT,
            },
        )

    async def fetch_households(self, year: int) -> dict[str, Any]:
        """Households for a year, keyed by PocketBase record id."""
        rows = await asyncio.to_thread(
            self.pb.collection(HOUSEHOLDS).get_full_list,
            query_params={"filter": f"year = {year}", "sort": STABLE_SORT},
        )
        return {row.id: row for row in rows}

    async def fetch_household_by_cm_id(self, year: int, household_cm_id: int) -> Any | None:
        """One household by CampMinder id, or None.

        The PHI path uses this instead of fetch_households: answering one
        household must not materialise every family in the year.
        """
        rows = await asyncio.to_thread(
            self.pb.collection(HOUSEHOLDS).get_full_list,
            query_params={
                "filter": f"year = {year} && cm_id = {household_cm_id}",
                "sort": STABLE_SORT,
            },
        )
        return rows[0] if rows else None

    async def fetch_prior_household_cm_ids(self, year: int) -> set[int]:
        """CampMinder ids of every household seen in an EARLIER year.

        This is the returning-family signal: households rows are per-year, so
        a cm_id present before `year` means the family has been here before.
        """
        rows = await asyncio.to_thread(
            self.pb.collection(HOUSEHOLDS).get_full_list,
            query_params={"filter": f"year < {year}", "fields": "cm_id", "sort": STABLE_SORT},
        )
        return {int(getattr(row, "cm_id", 0)) for row in rows if getattr(row, "cm_id", 0)}

    async def fetch_family_camp_adults(self, year: int) -> dict[str, list[Any]]:
        """Accompanying adults grouped by household PB id, in adult_number order.

        CampMinder enrols only the children for family camp; the adults exist
        only as custom-field values scraped into this table.
        """
        rows = await asyncio.to_thread(
            self.pb.collection(FAMILY_CAMP_ADULTS).get_full_list,
            query_params={"filter": f"year = {year}", "sort": "adult_number"},
        )
        grouped: dict[str, list[Any]] = defaultdict(list)
        for row in rows:
            grouped[str(getattr(row, "household", ""))].append(row)
        for adults in grouped.values():
            adults.sort(key=lambda a: int(getattr(a, "adult_number", 0) or 0))
        return dict(grouped)

    async def fetch_family_camp_registrations(self, year: int) -> dict[str, Any]:
        """Registration answers keyed by household PB id.

        Carries the ingest-derived request layer -- share_cabin_gate,
        wants_near / wants_with / wants_similar_ages, request_text -- and the
        four PHI-free housing flags. Read those columns; do not re-derive them
        from share_cabin_preference / shared_cabin_modes_raw, which are the raw
        profile values kept for provenance.
        """
        rows = await asyncio.to_thread(
            self.pb.collection(FAMILY_CAMP_REGISTRATIONS).get_full_list,
            query_params={"filter": f"year = {year}", "sort": STABLE_SORT},
        )
        return {str(getattr(row, "household", "")): row for row in rows}

    async def fetch_family_camp_medical(self, year: int) -> dict[str, Any]:
        """PHI, keyed by household PB id.

        CALLERS MUST NOT put these records into a roster payload. The roster
        derives booleans from PRESENCE only; the narrative is served solely by
        the permission-gated medical endpoint, which reads ONE household
        through fetch_medical_for_household rather than this whole-year map.
        """
        rows = await asyncio.to_thread(
            self.pb.collection(FAMILY_CAMP_MEDICAL).get_full_list,
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
        rows = await asyncio.to_thread(
            self.pb.collection(FAMILY_CAMP_MEDICAL).get_full_list,
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

    async def count_open_unresolved_aliases(self) -> int:
        """Cabin strings ingest could not resolve, still awaiting triage.

        One work queue, owned and solely written by the ingest layer. Narrowed
        to the alias kind so the roster's unmapped-cabin figure does not absorb
        the queue's six other kinds.
        """
        return await self._count(
            LODGING_INGEST_ISSUES,
            f'kind = "{UNRESOLVED_ALIAS_KIND}" && is_resolved = false',
        )

    async def count_unconfirmed_units(self) -> int:
        """Bookable units whose amenity data is still a seed guess.

        is_container = false because the seven building rows are not bookable
        and their amenity values are meaningless.
        """
        return await self._count(
            LODGING_UNITS,
            "is_confirmed = false && is_container = false && is_active = true",
        )

    # ---------------------------------------------------------------- writes
    #
    # Every write below targets the DRAFT grain or lodging_availability. None
    # of them can reach lodging_assignments, lodging_assignment_history or
    # lodging_field_mappings, which the ingest owns and which stay admin-only
    # in PocketBase regardless of what this layer asks for.

    async def find_draft_assignment(
        self, year: int, session_pb_id: str, scenario_id: str, household_cm_id: int, person_cm_id: int
    ) -> Any | None:
        """The one draft row for a party in a scenario, or None.

        Keyed exactly as the draft's two partial unique indexes are, so the
        lookup either finds the row the next write would collide with, or
        there is none. Both grain columns are compared to a known value; never
        write `!= ''` against them, because PocketBase numbers are
        NUMERIC DEFAULT 0 NOT NULL and SQLite reads `0 != ''` as TRUE, which
        matches every row of the other grain.
        """
        rows = await asyncio.to_thread(
            self.pb.collection(LODGING_ASSIGNMENTS_DRAFT).get_full_list,
            query_params={
                "filter": (
                    f'session = "{session_pb_id}" && year = {year} && scenario = "{scenario_id}" '
                    f"&& household_cm_id = {household_cm_id} && person_cm_id = {person_cm_id}"
                ),
                "sort": STABLE_SORT,
            },
        )
        return rows[0] if rows else None

    async def create_draft_assignment(self, data: dict[str, Any]) -> Any:
        return await asyncio.to_thread(self.pb.collection(LODGING_ASSIGNMENTS_DRAFT).create, data)

    async def update_draft_assignment(self, record_id: str, data: dict[str, Any]) -> Any:
        return await asyncio.to_thread(self.pb.collection(LODGING_ASSIGNMENTS_DRAFT).update, record_id, data)

    async def delete_draft_assignment(self, record_id: str) -> None:
        await asyncio.to_thread(self.pb.collection(LODGING_ASSIGNMENTS_DRAFT).delete, record_id)

    async def create_draft_merge(self, data: dict[str, Any]) -> Any:
        return await asyncio.to_thread(self.pb.collection(LODGING_MERGES_DRAFT).create, data)

    async def delete_draft_merge(self, record_id: str) -> None:
        await asyncio.to_thread(self.pb.collection(LODGING_MERGES_DRAFT).delete, record_id)

    async def find_availability_override(
        self, year: int, session_pb_id: str, scenario_id: str, unit_pb_id: str
    ) -> Any | None:
        """The one availability row for a unit in a scenario, or None.

        Matches idx_lodging_avail_unique, which is (session, year, scenario,
        unit): without that index a unit could carry both a reserved_staff and
        a released_to_family row for the same key and "is this available?"
        would stop being a question with an answer.
        """
        rows = await asyncio.to_thread(
            self.pb.collection(LODGING_AVAILABILITY).get_full_list,
            query_params={
                "filter": (
                    f'session = "{session_pb_id}" && year = {year} '
                    f'&& scenario = "{scenario_id}" && unit = "{unit_pb_id}"'
                ),
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

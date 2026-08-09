"""Writes for filling a fresh summer scenario: bunk_assignments / bunk_assignments_draft.

Extracted out of `api/routers/scenarios.py` (kindred#2164), mirroring
`LodgingWriteService`'s shape (`api/services/lodging_write_service.py`): a
router builds this service with its OWN PocketBase client, exactly as
`_seed_weekend_scenario` already builds
`LodgingWriteService(LodgingRepository(pb))`.

THE CLIENT IS INJECTED, NEVER IMPORTED. This module must not do
`from api.dependencies import pb` at module scope. Every test in
`tests/unit/api/routers/test_scenarios_program_aware.py` patches
`api.routers.scenarios.pb` and relies on that same object reaching whatever
seeds the scenario -- 33 `patch("api.routers.scenarios.pb", mock_pb)` calls
across `TestSummerCreationIsUnchanged`, `TestSummerCopyFromScenarioCarriesLockedGroups`,
and `TestAFailedSeedLeavesNoOrphanScenario` alone. A module-level import here
would silently stop reaching the mock and start issuing calls against a real,
unpatched PocketBase client instead of failing cleanly.

`clear_scenario`'s own inline program branch (`api/routers/scenarios.py`,
around its `target_collection` ternary) is deliberately NOT absorbed by this
service -- left for a separate change, per kindred#2164's own ruling.
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING

from api.constants.collections import (
    BUNK_ASSIGNMENTS,
    BUNK_ASSIGNMENTS_DRAFT,
    LOCKED_GROUP_MEMBERS,
    LOCKED_GROUPS,
)
from api.utils.pb_filters import pb_escape
from api.utils.session_metrics import get_person_from_expand, get_session_from_expand
from bunking.logging_config import get_logger

if TYPE_CHECKING:
    from api.services.session_context import SessionContext
    from bunking.models import CreateScenarioRequest
    from pocketbase import PocketBase

logger = get_logger(__name__)

# Mirrors `api/routers/scenarios.py`'s own `STABLE_SORT` (and
# `LodgingRepository`'s identically-named constant): every `get_full_list`
# call below pages through LIMIT/OFFSET without an ORDER BY unless one is
# given, and SQLite may then return a different row order per request -- a
# row past the first page can be skipped or duplicated. The record id is
# stable and indexed.
STABLE_SORT = "id"


class SummerScenarioWriteService:
    """Fills a fresh summer scenario: blank, copied from production, or
    copied from another scenario -- summer's side of the program-aware
    `POST /api/scenarios` branch (kindred#2021), the counterpart to
    `LodgingWriteService` on the weekend side.
    """

    def __init__(self, pb: PocketBase) -> None:
        self.pb = pb

    async def seed_summer_scenario(self, request: CreateScenarioRequest, ctx: SessionContext, scenario_id: str) -> None:
        """Fill a fresh summer scenario: bunk_assignments / bunk_assignments_draft.

        Pre-existing logic, unchanged in substance -- only extracted, first
        out of `create_scenario` into a module-level function (kindred#2021),
        now out of the router entirely into this service (kindred#2164). The
        locked-groups copy at the end used to run client-side (kindred#1046)
        and must not go missing now that creation happens server-side.
        """
        # Use pre-built filter from SessionContext
        session_filter_relation = ctx.session_relation_filter

        # Determine copy source
        copy_source_assignments = []

        if request.copy_from_scenario:
            logger.info(f"Copying assignments from scenario: {request.copy_from_scenario}")
            copy_source_assignments = await asyncio.to_thread(
                self.pb.collection(BUNK_ASSIGNMENTS_DRAFT).get_full_list,
                query_params={
                    "filter": f'scenario = "{pb_escape(request.copy_from_scenario)}" && ({session_filter_relation}) && year = {ctx.year}',
                    "expand": "person,session,bunk,bunk_plan",
                    "sort": STABLE_SORT,
                },
            )
        elif request.should_copy_from_production:
            logger.info("Copying assignments from production for all related sessions")
            copy_source_assignments = await asyncio.to_thread(
                self.pb.collection(BUNK_ASSIGNMENTS).get_full_list,
                query_params={
                    "filter": f"({session_filter_relation}) && year = {ctx.year}",
                    "expand": "person,session,bunk",
                    "sort": STABLE_SORT,
                },
            )

        # If we have assignments to copy
        if copy_source_assignments:
            # Copy each assignment to new scenario
            for assignment in copy_source_assignments:
                if request.should_copy_from_production and not request.copy_from_scenario:
                    assign_expand = getattr(assignment, "expand", {}) or {}
                    person_data = get_person_from_expand(assignment)
                    session_data = get_session_from_expand(assignment)
                    bunk_data = (
                        assign_expand.get("bunk")
                        if isinstance(assign_expand, dict)
                        else getattr(assign_expand, "bunk", None)
                    )

                    person_cm_id = person_data.cm_id if person_data and hasattr(person_data, "cm_id") else None
                    session_cm_id = session_data.cm_id if session_data and hasattr(session_data, "cm_id") else None
                    bunk_cm_id = bunk_data.cm_id if bunk_data and hasattr(bunk_data, "cm_id") else None

                    if not all([person_cm_id, session_cm_id, bunk_cm_id]):
                        logger.warning("Missing expanded relation data for assignment")
                        continue

                    # Use the session context's ID cache
                    # Handle potential None values with type narrowing
                    if person_cm_id is None or bunk_cm_id is None or session_cm_id is None:
                        logger.warning("Missing CM ID in assignment copy")
                        continue
                    person_pb_id = await ctx.id_cache.get_person_pb_id(person_cm_id)
                    bunk_pb_id = await ctx.id_cache.get_bunk_pb_id(bunk_cm_id)
                    session_pb_id = await ctx.id_cache.get_session_pb_id(session_cm_id)
                    # get_bunk_plan_id does its OWN targeted (bunk, session, year)
                    # lookup and may legitimately return None -- that is not a
                    # reason to drop the camper. bunk_assignments_draft.bunk_plan
                    # is required: false (1500000022), and the retired
                    # client-side copyProductionToScenario copied a camper
                    # unconditionally, including bunk_plan only when the source
                    # row happened to carry one. A pre-fetched, session-family-
                    # scoped bunk_plan_map used to gate the WHOLE camper on
                    # appearing in that separate list, which is both redundant
                    # with this lookup and stricter than it -- kindred#2021 found
                    # this promotes what was dead code (this branch had no
                    # frontend caller before this PR) into a path that could
                    # silently drop cabins the old path always copied.
                    bunk_plan_pb_id = await ctx.id_cache.get_bunk_plan_id(bunk_cm_id, session_cm_id, ctx.year)

                    if not all([person_pb_id, bunk_pb_id, session_pb_id]):
                        logger.warning("Failed to resolve PB IDs for production copy")
                        continue

                    draft_data = {
                        "scenario": scenario_id,
                        "person": person_pb_id,
                        "bunk": bunk_pb_id,
                        "session": session_pb_id,
                        "bunk_plan": bunk_plan_pb_id,
                        "year": getattr(assignment, "year", ctx.year),
                        "assignment_locked": False,
                    }
                else:
                    draft_data = {
                        "scenario": scenario_id,
                        "person": getattr(assignment, "person", None),
                        "bunk": getattr(assignment, "bunk", None),
                        "session": getattr(assignment, "session", None),
                        "bunk_plan": getattr(assignment, "bunk_plan", None),
                        "year": getattr(assignment, "year", ctx.year),
                        "assignment_locked": getattr(assignment, "assignment_locked", False),
                    }

                await asyncio.to_thread(self.pb.collection(BUNK_ASSIGNMENTS_DRAFT).create, draft_data)

        # kindred#1046, ported: a copy FROM another scenario carries its locked
        # friend groups along. A production copy has no prior scenario to carry
        # them from, matching the frontend callsite this replaces.
        if request.copy_from_scenario:
            await self._copy_locked_groups(request.copy_from_scenario, scenario_id, ctx.year)

    async def _copy_locked_groups(self, from_scenario: str, to_scenario: str, year: int) -> None:
        """Port of the frontend's copyLockedGroupsToScenario (kindred#1046).

        Summer's scenario creation used to run this client-side, after copying
        bunk_assignments_draft rows. Moving creation onto this endpoint
        (kindred#2021) must not silently drop it: a "copy from scenario" that
        lost its locked friend groups would be a correctness regression the
        solver depends on, not merely a cosmetic one. Weekend has no locked-group
        concept, so this is summer-only and is never called from the weekend
        branch on the router side.

        PRODUCTION-source copies never call this -- matching the frontend
        comment this replaces ("Production-source copies are skipped via the
        callsite"): there is no prior scenario to carry groups from.

        Sequential, like every copy loop in this service: a failure here
        raises into `create_scenario`'s own rollback try/except, exactly as a
        failed draft-assignment copy already does above.
        """
        groups = await asyncio.to_thread(
            self.pb.collection(LOCKED_GROUPS).get_full_list,
            query_params={
                "filter": f'scenario = "{pb_escape(from_scenario)}" && year = {year}',
                "sort": STABLE_SORT,
            },
        )
        if not groups:
            return

        group_id_map: dict[str, str] = {}
        for group in groups:
            new_group = await asyncio.to_thread(
                self.pb.collection(LOCKED_GROUPS).create,
                {
                    "scenario": to_scenario,
                    "name": getattr(group, "name", ""),
                    "color": getattr(group, "color", ""),
                    "session": getattr(group, "session", None),
                    "year": getattr(group, "year", year),
                },
            )
            group_id_map[group.id] = new_group.id

        member_filter = " || ".join(f'group = "{gid}"' for gid in group_id_map)
        members = await asyncio.to_thread(
            self.pb.collection(LOCKED_GROUP_MEMBERS).get_full_list,
            query_params={"filter": member_filter, "sort": STABLE_SORT},
        )
        for member in members:
            new_group_id = group_id_map.get(getattr(member, "group", ""))
            if new_group_id is None:
                # The parent group failed to create; skip rather than orphan a
                # member row under a group id that does not exist.
                continue
            await asyncio.to_thread(
                self.pb.collection(LOCKED_GROUP_MEMBERS).create,
                {"group": new_group_id, "attendee": getattr(member, "attendee", None)},
            )

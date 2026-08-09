"""
Scenarios Router - Endpoints for managing draft scenario bunking assignments.

This router handles:
- Creating, updating, and deleting scenarios
- Managing draft assignments within scenarios
- Copying assignments from production to scenarios
- Solving scenarios with the constraint solver
"""

import asyncio
from datetime import UTC, datetime
from typing import Annotated, Any
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Path, Query
from pocketbase.client import ClientResponseError  # type: ignore[attr-defined]

from api.schemas.lodging import PlacementCopyRequest
from api.services.lodging_repository import WEEKEND_SESSION_TYPES, LodgingRepository
from api.services.lodging_roster_service import SessionNotFoundError as LodgingSessionNotFoundError
from api.services.lodging_write_service import LodgingWriteService, ScenarioNotEmptyError
from api.services.summer_scenario_write_service import SummerScenarioWriteService
from bunking.auth_middleware import AuthUser
from bunking.logging_config import get_logger
from bunking.models import (
    ClearScenarioRequest,
    CreateScenarioRequest,
    SavedScenario,
    ScenarioAssignmentUpdate,
    UpdateScenarioRequest,
)
from bunking.rbac.dependencies import require_permission
from bunking.rbac.permissions import Permission
from bunking.solver.constants import DEFAULT_BUNK_CAPACITY
from bunking.solver.objective_evaluator import evaluate_objective

from ..constants.collections import (
    BUNK_ASSIGNMENTS,
    BUNK_ASSIGNMENTS_DRAFT,
    BUNK_PLANS,
    BUNK_REQUESTS,
    BUNKS,
    LODGING_ASSIGNMENTS_DRAFT,
    PERSONS,
    SAVED_SCENARIOS,
)
from ..dependencies import graph_cache, pb, solver_runs
from ..services.session_context import SessionContext, build_session_context
from ..services.solver_runner import run_solver_task_v2
from ..utils.pb_error import pb_error_to_http
from ..utils.pb_filters import pb_escape
from ..utils.session_metrics import get_person_from_expand, get_session_from_expand

logger = get_logger(__name__)

router = APIRouter(prefix="/api/scenarios", tags=["scenarios"])

# Every `get_full_list` call below pages through LIMIT/OFFSET without an
# ORDER BY unless one is given, and SQLite may then return a different row
# order per request -- a row past the first page can be skipped or
# duplicated across pages. Summer alone holds 1,248 draft rows across 8
# scenarios (~156/scenario on average), well past the SDK's 100-row default
# page size, so this is a live risk for a session-scoped read here, not a
# hypothetical. Same defect class `lodging_repository.py`'s own
# `STABLE_SORT` documents; the record id is stable and indexed.
STABLE_SORT = "id"


def _is_weekend_session_type(session_type: str) -> bool:
    """The one place `session_type in WEEKEND_SESSION_TYPES` gets spelled.

    Both `create_scenario` and `clear_scenario` branch on this; a shared
    predicate means a future change to what "weekend" means is one edit,
    not two greppable-but-independent copies.
    """
    return session_type in WEEKEND_SESSION_TYPES


def _expanded_session(scenario_record: Any) -> Any:
    """The scenario's session RECORD, from `expand`, not the bare relation id.

    PocketBase's Python SDK loads a record's own fields (including a
    relation like `session`) as the raw id string it always is on the wire;
    `expand: "session"` adds a SEPARATE `expand` dict carrying the resolved
    record (`pocketbase/models/record.py:Record.load`). Reading
    `getattr(scenario_record, "session", None)` -- which `delete_scenario`
    and `clear_scenario` used to do -- returns that bare string, and a
    string has no `.cm_id`, so the cache invalidation and the program branch
    below silently no-op against a real PocketBase server even though a
    MagicMock double that sets `.session` directly to an object cannot catch
    the difference. `get_session_from_expand` reads the right place.
    """
    return get_session_from_expand(scenario_record)


def _session_cm_id(scenario_record: Any) -> int:
    """A scenario's session CampMinder id, from the expanded `session` relation.

    `saved_scenarios` carries no `session_cm_id` column (kindred#2021) --
    only the `session` relation. Every caller of this must have fetched the
    record with `{"expand": "session"}`; without it there is nothing in
    `expand` to read and this falls through to 0.
    """
    session = _expanded_session(scenario_record)
    if session is None:
        return 0
    return int(getattr(session, "cm_id", 0) or 0)


async def _seed_weekend_scenario(request: CreateScenarioRequest, ctx: SessionContext, scenario_id: str) -> int | None:
    """Fill a fresh weekend scenario through LodgingWriteService.

    Weekend-scoped, deliberately (`PlacementCopyRequest`'s own docstring): a
    scenario is worked one weekend at a time. `ctx.related_session_ids` for a
    family/adult `session_type` is always exactly `[ctx.session_cm_id]` --
    `get_related_session_ids` only expands AG children for `session_type ==
    "main"` -- so this coincides with summer's own session-family scoping for
    every session this branch runs on.

    Returns the `skipped` count from `LodgingCopyResponse` when a copy ran,
    or None for a blank creation. A skipped row names a party or a unit that
    no longer resolves (see `copy_from_mirror`'s own docstring); silently
    dropping this count would leave staff looking at a board with fewer
    families than the source has, with nothing anywhere saying so.
    """
    writes = LodgingWriteService(LodgingRepository(pb))
    if request.copy_from_scenario:
        result = await writes.copy_scenario_to_scenario(
            year=ctx.year,
            session_cm_id=ctx.session_cm_id,
            from_scenario=request.copy_from_scenario,
            to_scenario=scenario_id,
        )
        return result.skipped
    elif request.should_copy_from_production:
        result = await writes.copy_from_mirror(
            PlacementCopyRequest(year=ctx.year, session_cm_id=ctx.session_cm_id, scenario=scenario_id)
        )
        return result.skipped
    return None


# ========================================
# Scenario CRUD
# ========================================


@router.post("")
async def create_scenario(
    request: CreateScenarioRequest, user: AuthUser = Depends(require_permission(Permission.BUNKING_MANAGE))
) -> SavedScenario:
    """Create a new scenario: blank, copied from production, or copied from another scenario.

    Program-aware (kindred#2021): `ctx.session_type` decides which draft
    grain gets seeded. A weekend session (`session_type` in
    `WEEKEND_SESSION_TYPES`) routes through `LodgingWriteService`, reading
    `lodging_assignments` / `lodging_assignments_draft`; every other session
    type keeps summer's existing `bunk_assignments` /
    `bunk_assignments_draft` copy below. Both branches write the identical
    `saved_scenarios` row shape -- only the SOURCE of the copy differs, which
    is what lets the frontend offer the same three choices, worded and laid
    out identically, for both programs.
    """
    try:
        # Build session context from request (validates session exists for year)
        ctx = await build_session_context(request.session_cm_id, request.year, pb)

        if request.copy_from_scenario:
            # useSavedScenarios carries a 30-minute staleTime
            # (userDataOptions), so the picker staff chose "copy from" out
            # of can already be stale by the time this request lands.
            # Without this check, a deleted source scenario reads as zero
            # rows everywhere downstream (BUNK_ASSIGNMENTS_DRAFT filtered by
            # a dead id, or copy_scenario_to_scenario's
            # fetch_draft_assignments) -- a blank scenario, reported as a
            # clean 200, silently different from the copy that was asked
            # for. Checked up front, before the destination scenario is even
            # created, so a caller never has to tell "copied and genuinely
            # empty" apart from "the source never existed" after the fact.
            try:
                await asyncio.to_thread(pb.collection(SAVED_SCENARIOS).get_one, request.copy_from_scenario)
            except ClientResponseError as e:
                if e.status == 404:
                    raise HTTPException(
                        status_code=404,
                        detail=f"Scenario {request.copy_from_scenario} to copy from was not found",
                    ) from e
                raise

        # Create the scenario record. NO session_cm_id, NO created_by: neither
        # is a column on saved_scenarios (pb_migrations/1500000021), so both
        # used to be written and silently dropped by PocketBase. `session` is
        # the only durable link to the CampMinder id, via ctx below.
        scenario_data = {
            "name": request.name,
            "session": ctx.session_pb_id,  # Use PB ID for relation
            "year": request.year,  # Store year in scenario
            "description": request.description,
            "is_active": True,
        }

        scenario = await asyncio.to_thread(pb.collection(SAVED_SCENARIOS).create, scenario_data)

        copy_skipped: int | None = None
        try:
            if _is_weekend_session_type(ctx.session_type):
                copy_skipped = await _seed_weekend_scenario(request, ctx, scenario.id)
            else:
                # Summer's copy loop does not count skips (pre-existing --
                # it silently `continue`s past an unresolvable relation);
                # copy_skipped stays None rather than claiming a count that
                # was never actually tracked.
                summer_writes = SummerScenarioWriteService(pb)
                await summer_writes.seed_summer_scenario(request, ctx, scenario.id)
        except Exception:
            # This scenario row was JUST created by this call, empty or
            # partially seeded -- no one else has ever seen it, so there is
            # nothing to preserve. A seed failure (an expired token
            # mid-copy, a locked-groups create that 400s, a genuinely
            # broken PocketBase write) must not leave an orphan for staff to
            # trip over with no way to finish or retry it: the two-step
            # create-then-seed flow's own recovery UI
            # (SeedScenarioNotice/useSeedScenario) is retired by this same
            # PR, and re-seeding an existing scenario 409s (seed-only).
            # Deleting the scenario CASCADES every table this call could
            # have written to -- bunk_assignments_draft,
            # lodging_assignments_draft, locked_groups (+ members),
            # lodging_slot_merges all carry `cascadeDelete: true` on their
            # `scenario` relation -- so "create failed" now means nothing
            # persists, not "created, empty or half-seeded, forever."
            await asyncio.to_thread(pb.collection(SAVED_SCENARIOS).delete, scenario.id)
            raise

        # Defensively invalidate the new scenario's cache slot. A brand-new
        # scenario should not have any cached graph yet, but if its id reuses
        # one that was deleted recently the slot could carry over — costing
        # ~µs to drop, much cheaper than serving a stale graph.
        graph_cache.invalidate_scenario(int(request.session_cm_id), int(ctx.year), scenario.id)

        return SavedScenario(
            id=scenario.id,
            name=str(getattr(scenario, "name", "")),
            # ctx is validated against the same `session` relation the record
            # was just created with, so this is authoritative without a
            # second round trip to re-fetch and expand what was just written.
            session_cm_id=ctx.session_cm_id,
            year=ctx.year,
            is_active=bool(getattr(scenario, "is_active", True)),
            description=str(getattr(scenario, "description", "")),
            copy_skipped=copy_skipped,
        )

    except LodgingSessionNotFoundError as e:
        # ctx already validated this exact session_cm_id/year against
        # camp_sessions, so LodgingRepository.fetch_session (which applies
        # the identical filter plus a weekend session_type predicate) cannot
        # legitimately miss here. Surfaced as a 404 rather than falling
        # through to the generic 500 handler below, in case that invariant
        # is ever wrong.
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ScenarioNotEmptyError as e:
        # Cannot legitimately happen: scenario.id above is freshly minted by
        # this same call. Answered as a 409 rather than a 500 anyway, in case
        # a future change makes it reachable.
        raise HTTPException(status_code=409, detail=str(e)) from e
    except HTTPException:
        # The copy-from-scenario existence check above is client-input-shaped
        # (404), not a server error -- don't pollute error logs with a
        # stacktrace for it.
        raise
    except ClientResponseError as e:
        logger.error(f"PocketBase error creating scenario: {e}", exc_info=True)
        raise pb_error_to_http(e)
    except Exception as e:
        logger.error(f"Error creating scenario: {e}", exc_info=True)
        raise


@router.get("")
async def list_scenarios(
    session_id: Annotated[int, Query(description="Session CampMinder ID")],
    year: Annotated[int, Query(description="Year to filter by")],  # Now required
    include_inactive: Annotated[bool, Query(description="Include inactive scenarios")] = False,
    user: AuthUser = Depends(require_permission(Permission.BUNKING_MANAGE)),
) -> list[SavedScenario]:
    """List all scenarios for a session and its related sessions."""
    try:
        # Build session context (validates session exists for year)
        ctx = await build_session_context(session_id, year, pb)

        # The RELATION filter, not a bare session_cm_id column (kindred#2021)
        # -- saved_scenarios has never had one, so this used to match zero
        # rows unconditionally.
        filter_str = f"({ctx.session_relation_filter}) && year = {ctx.year}"
        if not include_inactive:
            filter_str += " && is_active = true"

        scenarios = await asyncio.to_thread(
            pb.collection(SAVED_SCENARIOS).get_full_list,
            query_params={"filter": filter_str, "expand": "session"},
        )

        return [
            SavedScenario(
                id=s.id,
                name=str(getattr(s, "name", "")),
                session_cm_id=_session_cm_id(s),
                year=int(getattr(s, "year", ctx.year)),
                is_active=bool(getattr(s, "is_active", True)),
                description=str(getattr(s, "description", "")),
            )
            for s in scenarios
        ]

    except HTTPException:
        # build_session_context raises HTTPException(404) for unknown session/year — that's
        # client input, not a server error. Don't pollute error logs with stacktraces.
        raise
    except Exception as e:
        logger.error(f"Error listing scenarios: {e}", exc_info=True)
        raise


@router.get("/score")
async def evaluate_score(
    session_id: Annotated[int, Query(description="Session CampMinder ID")],
    year: Annotated[int, Query(description="Year")],
    scenario_id: Annotated[str | None, Query(description="Scenario ID (omit for production)")] = None,
    user: AuthUser = Depends(require_permission(Permission.BUNKING_MANAGE)),
) -> dict[str, Any]:
    """Evaluate the solver objective score for a scenario or production assignments.

    Returns the EXACT same score the solver optimizer would produce, allowing
    accurate comparison between different scenarios or between scenario and production.

    Score components:
    - Request satisfaction (with first-pick boost, source multipliers, diminishing returns)
    - Age/grade flow bonuses (target grade distribution)
    - Penalties (grade spread, capacity, occupancy)
    """
    try:
        # Build session context
        ctx = await build_session_context(session_id, year, pb)
        session_filter = ctx.session_relation_filter
        session_id_filter = ctx.session_id_filter

        # Fetch bunk requests for the session. status="resolved" mirrors
        # data_fetcher.py:140 — the solver only ever scores resolved requests,
        # so the evaluator (which claims to mirror the solver) must too.
        # Without this filter, a pending B→A reciprocating a resolved A→B
        # would phantom-detect mutual and inflate the evaluator score vs. the
        # solver's objective (Stream 4 / #1382).
        requests_raw = await asyncio.to_thread(
            pb.collection(BUNK_REQUESTS).get_full_list,
            query_params={
                "filter": f'({session_id_filter}) && year = {year} && status = "resolved"',
            },
        )

        # Convert requests to evaluator format
        requests = []
        for r in requests_raw:
            req_dict = {
                "requester_id": getattr(r, "requester_id", None),
                "requestee_id": getattr(r, "requestee_id", None),
                "request_type": getattr(r, "request_type", ""),
                "is_first_requested": bool(getattr(r, "is_first_requested", False)),
                "source_field": getattr(r, "source_field", None),
            }
            ai_reasoning = getattr(r, "ai_reasoning", None)
            if isinstance(ai_reasoning, dict):
                req_dict["csv_source_fields"] = ai_reasoning.get("csv_source_fields", [])
            requests.append(req_dict)

        # Fetch assignments - from draft if scenario specified, else production
        if scenario_id:
            assignments_raw = await asyncio.to_thread(
                pb.collection(BUNK_ASSIGNMENTS_DRAFT).get_full_list,
                query_params={
                    "filter": f'scenario = "{scenario_id}" && ({session_filter}) && year = {year}',
                    "expand": "person,bunk",
                },
            )
        else:
            assignments_raw = await asyncio.to_thread(
                pb.collection(BUNK_ASSIGNMENTS).get_full_list,
                query_params={
                    "filter": f"({session_filter}) && year = {year}",
                    "expand": "person,bunk",
                },
            )

        # Build assignment map (person_cm_id -> bunk_cm_id)
        assignment_map: dict[int, int] = {}
        for a in assignments_raw:
            expand = getattr(a, "expand", {}) or {}
            person_data = get_person_from_expand(a)
            bunk_data = expand.get("bunk") if isinstance(expand, dict) else getattr(expand, "bunk", None)

            if person_data and bunk_data:
                person_cm_id = getattr(person_data, "cm_id", None)
                bunk_cm_id = getattr(bunk_data, "cm_id", None)
                if person_cm_id and bunk_cm_id:
                    assignment_map[int(person_cm_id)] = int(bunk_cm_id)

        # Fetch persons with session info (needed for age/grade flow)
        persons_raw = await asyncio.to_thread(
            pb.collection(PERSONS).get_full_list,
            query_params={"filter": f"year = {year}"},
        )
        persons = [
            {
                "cm_id": getattr(p, "cm_id", None),
                "grade": getattr(p, "grade", None),
                "gender": getattr(p, "gender", None),
                "age": getattr(p, "age", None),
                "session_cm_id": session_id,  # For age/grade flow calculation
            }
            for p in persons_raw
        ]

        # Fetch bunks with session info
        bunks_raw = await asyncio.to_thread(
            pb.collection(BUNKS).get_full_list,
            query_params={"filter": f"year = {year}"},
        )
        bunks = [
            {
                "cm_id": getattr(b, "cm_id", None),
                "name": getattr(b, "name", None),
                "gender": getattr(b, "gender", None),
                "capacity": DEFAULT_BUNK_CAPACITY,
                "session_cm_id": session_id,  # For age/grade flow calculation
            }
            for b in bunks_raw
        ]

        # Evaluate using the exact solver objective function
        breakdown = evaluate_objective(assignment_map, requests, persons, bunks)

        return {
            "scenario_id": scenario_id,
            "session_id": session_id,
            "year": year,
            # Main scores (matches SolverScoreResult interface)
            "total_score": breakdown.total_score,
            "request_satisfaction_score": breakdown.request_satisfaction_score,
            "soft_penalty_score": breakdown.penalty_score,  # Frontend expects soft_penalty_score
            # Request stats
            "total_requests": breakdown.total_requests,
            "satisfied_requests": breakdown.satisfied_requests,
            "satisfaction_rate": breakdown.satisfaction_rate,
            # Detailed breakdowns
            "field_scores": breakdown.field_breakdown,  # Frontend expects field_scores
            "penalties": breakdown.penalties,
            # Additional detail (not in original interface but useful)
            "age_grade_flow_score": breakdown.age_grade_flow_score,
            "grade_flow_details": breakdown.grade_flow_details,
        }

    except ClientResponseError as e:
        logger.error(f"PocketBase error evaluating score: {e}", exc_info=True)
        raise pb_error_to_http(e)
    except Exception as e:
        logger.error(f"Error evaluating score: {e}", exc_info=True)
        raise


@router.get("/{scenario_id}")
async def get_scenario(
    scenario_id: Annotated[str, Path(description="Scenario ID")],
    include_assignments: Annotated[bool, Query(description="Include bunk assignments")] = True,
    user: AuthUser = Depends(require_permission(Permission.BUNKING_MANAGE)),
) -> SavedScenario | dict[str, Any]:
    """Get a specific scenario with optional assignments."""
    try:
        scenario = await asyncio.to_thread(pb.collection(SAVED_SCENARIOS).get_one, scenario_id, {"expand": "session"})
        session_type = str(getattr(_expanded_session(scenario), "session_type", "") or "")

        # Include year in response (required field now)
        scenario_result = SavedScenario(
            id=scenario.id,
            name=str(getattr(scenario, "name", "")),
            session_cm_id=_session_cm_id(scenario),
            year=int(getattr(scenario, "year", 0)),
            is_active=bool(getattr(scenario, "is_active", True)),
            description=str(getattr(scenario, "description", "")),
        )

        if include_assignments:
            # Filter assignments by scenario and year for safety
            scenario_year = getattr(scenario, "year", None)
            filter_str = f'scenario = "{pb_escape(scenario_id)}"'
            if scenario_year:
                filter_str += f" && year = {scenario_year}"

            # Program-aware (kindred#2021): this endpoint has no frontend
            # caller today, but it is public API surface this same PR made
            # program-aware everywhere else -- unconditionally reading
            # bunk_assignments_draft would silently return an empty
            # assignment list for every weekend scenario.
            if _is_weekend_session_type(session_type):
                assignments = await asyncio.to_thread(
                    pb.collection(LODGING_ASSIGNMENTS_DRAFT).get_full_list,
                    query_params={"filter": filter_str, "expand": "units"},
                )
            else:
                assignments = await asyncio.to_thread(
                    pb.collection(BUNK_ASSIGNMENTS_DRAFT).get_full_list,
                    query_params={"filter": filter_str, "expand": "person,session,bunk,bunk_plan"},
                )

            return {"scenario": scenario_result, "assignments": assignments}

        return scenario_result

    except ClientResponseError as e:
        raise pb_error_to_http(e)
    except Exception as e:
        logger.error(f"Error getting scenario: {e}", exc_info=True)
        raise


@router.put("/{scenario_id}")
async def update_scenario(
    scenario_id: str,
    request: UpdateScenarioRequest,
    user: AuthUser = Depends(require_permission(Permission.BUNKING_MANAGE)),
) -> SavedScenario:
    """Update scenario metadata."""
    try:
        update_data: dict[str, Any] = {}
        if request.name is not None:
            update_data["name"] = request.name
        if request.description is not None:
            update_data["description"] = request.description
        if request.is_active is not None:
            update_data["is_active"] = request.is_active

        if not update_data:
            raise HTTPException(status_code=400, detail="No fields to update")

        update_data["updated"] = datetime.now(UTC).isoformat()

        scenario = await asyncio.to_thread(
            pb.collection(SAVED_SCENARIOS).update, scenario_id, update_data, {"expand": "session"}
        )

        return SavedScenario(
            id=scenario.id,
            name=str(getattr(scenario, "name", "")),
            session_cm_id=_session_cm_id(scenario),
            year=int(getattr(scenario, "year", 0)),
            is_active=bool(getattr(scenario, "is_active", True)),
            description=str(getattr(scenario, "description", "")),
        )

    except ClientResponseError as e:
        raise pb_error_to_http(e)
    except Exception as e:
        logger.error(f"Error updating scenario: {e}", exc_info=True)
        raise


@router.delete("/{scenario_id}")
async def delete_scenario(
    scenario_id: str, user: AuthUser = Depends(require_permission(Permission.BUNKING_MANAGE))
) -> dict[str, str]:
    """Delete a scenario and all its data."""
    try:
        # Expand session up front so we can grab session.cm_id for the
        # post-delete cache invalidation without a second round-trip.
        scenario = await asyncio.to_thread(pb.collection(SAVED_SCENARIOS).get_one, scenario_id, {"expand": "session"})
        scenario_session = _expanded_session(scenario)
        scenario_session_cm_id: int | None = None
        if scenario_session is not None:
            scenario_session_cm_id = int(getattr(scenario_session, "cm_id", 0)) or None
        scenario_year = int(getattr(scenario, "year", 0)) or None

        # Delete all related draft assignments first
        draft_assignments = await asyncio.to_thread(
            pb.collection(BUNK_ASSIGNMENTS_DRAFT).get_full_list,
            query_params={"filter": f'scenario = "{scenario_id}"'},
        )

        for assignment in draft_assignments:
            await asyncio.to_thread(pb.collection(BUNK_ASSIGNMENTS_DRAFT).delete, assignment.id)

        # Delete the scenario
        await asyncio.to_thread(pb.collection(SAVED_SCENARIOS).delete, scenario_id)

        # Drop the cache slot so the next request rebuilds (or short-circuits
        # to "scenario not found" cleanly instead of serving a phantom graph).
        if scenario_session_cm_id is not None and scenario_year is not None:
            graph_cache.invalidate_scenario(scenario_session_cm_id, scenario_year, scenario_id)

        return {"message": f"Scenario '{getattr(scenario, 'name', scenario_id)}' deleted successfully"}

    except ClientResponseError as e:
        raise pb_error_to_http(e)
    except Exception as e:
        logger.error(f"Error deleting scenario: {e}", exc_info=True)
        raise


# ========================================
# Scenario Assignment Management
# ========================================


@router.put("/{scenario_id}/assignments")
async def update_scenario_assignment(
    scenario_id: str,
    update: ScenarioAssignmentUpdate,
    user: AuthUser = Depends(require_permission(Permission.BUNKING_MANAGE)),
) -> dict[str, Any]:
    """Update a single assignment in a scenario.

    Uses relation-based schema with PocketBase IDs.
    Frontend sends CampMinder IDs which are looked up to get PocketBase IDs.
    """
    logger.info(f"update_scenario_assignment called: scenario_id={scenario_id}, update={update}")
    existing: list[Any] = []
    try:
        # Build session context from the update request (validates session/year)
        ctx = await build_session_context(update.session_cm_id, update.year, pb)

        scenario = await asyncio.to_thread(pb.collection(SAVED_SCENARIOS).get_one, scenario_id, {"expand": "session"})
        logger.debug(f"Found scenario: id={scenario.id}, session={getattr(scenario, 'session', None)}")

        session_pb_id = ctx.session_pb_id
        session_cm_id = ctx.session_cm_id
        logger.debug(f"Session: pb_id={session_pb_id}, cm_id={session_cm_id}, year={ctx.year}")

        # Look up person PocketBase ID from CampMinder ID (with year filter)
        persons = await asyncio.to_thread(
            pb.collection(PERSONS).get_full_list,
            query_params={"filter": f"cm_id = {update.person_id} && year = {ctx.year}"},
        )
        if not persons:
            raise HTTPException(
                status_code=404, detail=f"Person with cm_id {update.person_id} not found for year {ctx.year}"
            )
        person_pb_id = persons[0].id

        # Check if assignment exists
        existing = await asyncio.to_thread(
            pb.collection(BUNK_ASSIGNMENTS_DRAFT).get_full_list,
            query_params={"filter": f'scenario = "{scenario_id}" && person = "{person_pb_id}" && year = {ctx.year}'},
        )

        # Helper: drop the cache slot whenever this call mutates the draft.
        # Single-record edits change bunk membership for one camper, which
        # alters parent-compound grouping in the rendered graph; the cache
        # must rebuild against current DB on the next request.
        def _invalidate() -> None:
            graph_cache.invalidate_scenario(int(session_cm_id), int(ctx.year), scenario_id)

        if update.bunk_id is None:
            # Remove assignment
            if existing:
                await asyncio.to_thread(pb.collection(BUNK_ASSIGNMENTS_DRAFT).delete, existing[0].id)
                _invalidate()
                return {"message": "Assignment removed", "person_id": update.person_id, "changed": True}
            else:
                return {"message": "No change needed", "person_id": update.person_id, "changed": False}

        else:
            # Look up bunk PocketBase ID from CampMinder ID (with year filter)
            bunks = await asyncio.to_thread(
                pb.collection(BUNKS).get_full_list,
                query_params={"filter": f"cm_id = {update.bunk_id} && year = {ctx.year}"},
            )
            if not bunks:
                raise HTTPException(
                    status_code=404, detail=f"Bunk with cm_id {update.bunk_id} not found for year {ctx.year}"
                )
            bunk_pb_id = bunks[0].id

            if existing:
                # Update existing assignment
                existing_record = existing[0]
                record_id_val = existing_record.get("id") if isinstance(existing_record, dict) else existing_record.id
                record_id = str(record_id_val) if record_id_val else ""

                update_assignment_data: dict[str, str | bool] = {"bunk": bunk_pb_id}
                if update.locked is not None:
                    update_assignment_data["assignment_locked"] = update.locked

                await asyncio.to_thread(pb.collection(BUNK_ASSIGNMENTS_DRAFT).update, record_id, update_assignment_data)
                _invalidate()

                return {
                    "message": "Assignment updated successfully",
                    "person_id": update.person_id,
                    "bunk_id": update.bunk_id,
                    "changed": True,
                }

            else:
                # Create new assignment - use session context
                bunk_plan_filter = (
                    f"bunk.cm_id = {update.bunk_id} && session.cm_id = {session_cm_id} && year = {ctx.year}"
                )
                logger.debug(f"Looking up bunk_plan with filter: {bunk_plan_filter}")
                bunk_plans = await asyncio.to_thread(
                    pb.collection(BUNK_PLANS).get_full_list, query_params={"filter": bunk_plan_filter}
                )

                if not bunk_plans:
                    logger.warning(
                        f"No bunk_plan found: bunk_cm_id={update.bunk_id}, session_cm_id={session_cm_id}, year={ctx.year}"
                    )
                    raise HTTPException(
                        status_code=400,
                        detail=f"No bunk plan found for bunk cm_id {update.bunk_id} in session cm_id {session_cm_id} (year={ctx.year})",
                    )

                bunk_plan_pb_id = bunk_plans[0].id

                new_assignment = {
                    "scenario": scenario_id,
                    "person": person_pb_id,
                    "bunk": bunk_pb_id,
                    "session": session_pb_id,
                    "bunk_plan": bunk_plan_pb_id,
                    "year": ctx.year,
                    "assignment_locked": update.locked if update.locked is not None else False,
                }

                logger.info(f"Creating draft assignment: {new_assignment}")
                try:
                    await asyncio.to_thread(pb.collection(BUNK_ASSIGNMENTS_DRAFT).create, new_assignment)
                except ClientResponseError as create_error:
                    logger.error(
                        f"Failed to create draft assignment: status={create_error.status}, data={getattr(create_error, 'data', None)}"
                    )
                    logger.error(f"Assignment data was: {new_assignment}")
                    raise
                _invalidate()

                return {
                    "message": "Assignment created successfully",
                    "person_id": update.person_id,
                    "bunk_id": update.bunk_id,
                    "changed": True,
                }

    except ClientResponseError as e:
        if 400 <= e.status < 500:
            logger.warning(
                f"PocketBase error in update_scenario_assignment: status={e.status}, body={getattr(e, 'data', None)}"
            )
            logger.warning(f"Scenario ID: {scenario_id}, Update: {update}")
        else:
            logger.error(
                f"PocketBase error in update_scenario_assignment: status={e.status}, body={getattr(e, 'data', None)}",
                exc_info=True,
            )
            logger.error(f"Scenario ID: {scenario_id}, Update: {update}")
        raise pb_error_to_http(e)
    except HTTPException:
        # Explicit 4xx raises in the function body are client-input cases, not server errors.
        # Without this, they fall through to `except Exception` and pollute error dashboards
        # with ERROR-level stacktraces for routine 404/400 conditions.
        raise
    except Exception as e:
        # The custom formatter in bunking/logging_config.py only emits record.getMessage(),
        # so any `extra={}` payload is dropped. Inline diagnostic context into the message
        # so it actually reaches log output.
        logger.error(
            f"Error updating assignment: {e} scenario_id={scenario_id} update={update} existing_count={len(existing)}",
            exc_info=True,
        )
        raise


# ========================================
# Scenario Solver Operations
# ========================================


@router.post("/{scenario_id}/analyze")
async def analyze_scenario(
    scenario_id: str, user: AuthUser = Depends(require_permission(Permission.BUNKING_MANAGE))
) -> None:
    """Analyze the current assignments in a scenario."""
    raise HTTPException(status_code=501, detail="Analysis functionality is being reimplemented")


@router.post("/{scenario_id}/solve")
async def solve_scenario(
    scenario_id: str,
    background_tasks: BackgroundTasks,
    user: AuthUser = Depends(require_permission(Permission.BUNKING_MANAGE)),
) -> dict[str, str]:
    """Run the solver on a scenario.

    Reads existing assignments from bunk_assignments_draft (not production)
    and produces optimized assignments for the scenario.
    """
    try:
        scenario = await asyncio.to_thread(pb.collection(SAVED_SCENARIOS).get_one, scenario_id, {"expand": "session"})

        # Read via the relation (kindred#2021) -- session_cm_id has never been
        # a column on saved_scenarios, so the bare getattr this replaced
        # always fell through to 0, which would collide every scenario's
        # single-flight guard below onto the same fake session.
        session_cm_id: int = _session_cm_id(scenario)
        scenario_year: int = getattr(scenario, "year", 0)

        # A dangling session relation (saved_scenarios.session is
        # cascadeDelete: false, same edge case clear_scenario guards) or a
        # malformed year resolves session_cm_id=0 / year=0, which the
        # single-flight guard just below can never match against a real
        # run -- slipping past into a doomed sweep that fails later inside
        # fetch_session_data_v2, the identical failure mode solver.py's
        # sweep endpoint already guards against. Reject up front with 422
        # rather than let it start and fail confusingly.
        if session_cm_id == 0 or scenario_year == 0:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"Scenario {scenario_id} has missing or invalid session_cm_id "
                    f"({session_cm_id}) or year ({scenario_year})"
                ),
            )

        # Single-flight guard: reject duplicate in-progress runs for the same session.
        # Mirrors the guard in solver.py:run_solver — uses the unified "session_cm_id" key
        # so that both the regular solver path and the scenario path see each other's runs.
        for run in solver_runs.values():
            if run.get("session_cm_id") == session_cm_id and run.get("status") in {"pending", "running"}:
                raise HTTPException(
                    status_code=409,
                    detail={
                        "detail": f"Solver already running for session {session_cm_id}",
                        "in_progress_run_id": run["id"],
                    },
                )

        run_id = str(uuid4())
        solver_runs[run_id] = {
            "id": run_id,
            "status": "pending",
            "scenario": scenario_id,
            "session_cm_id": session_cm_id,
            "year": scenario_year,
            "started_at": datetime.now(UTC),
        }

        # Run solver with scenario parameter - this causes fetch_session_data_v2
        # to read from bunk_assignments_draft instead of bunk_assignments
        background_tasks.add_task(
            run_solver_task_v2,
            run_id=run_id,
            session_cm_id=session_cm_id,
            year=scenario_year,
            time_limit=30,
            scenario=scenario_id,
        )

        return {"run_id": run_id, "status": "started", "message": "Solver run started for scenario"}

    except HTTPException:
        # Both the malformed-session guard (422) and the single-flight
        # guard (409) above are client-input-shaped, not server errors --
        # don't pollute error logs with a stacktrace for either.
        raise
    except ClientResponseError as e:
        raise pb_error_to_http(e)
    except Exception as e:
        logger.error(f"Error starting solver for scenario: {e}", exc_info=True)
        raise


@router.post("/{scenario_id}/clear")
async def clear_scenario(
    scenario_id: str,
    request: ClearScenarioRequest,
    user: AuthUser = Depends(require_permission(Permission.BUNKING_MANAGE)),
) -> dict[str, str | int]:
    """Clear all assignments in a scenario.

    Program-aware (kindred#2021): before this fix, clearing ALWAYS deleted
    `bunk_assignments_draft` rows and nothing else, so calling it against a
    weekend scenario reported "Cleared 0 assignments" whether or not the
    scenario held any placements -- success, with nothing deleted, because
    the rows it needed to delete live in `lodging_assignments_draft` and
    this never looked there.
    """
    try:
        # Expand session so we have cm_id (for cache invalidation), the PB id
        # (to scope the delete filter) and session_type (for the program
        # branch) in one round trip.
        scenario = await asyncio.to_thread(pb.collection(SAVED_SCENARIOS).get_one, scenario_id, {"expand": "session"})
        scenario_session = _expanded_session(scenario)
        if scenario_session is None:
            # `saved_scenarios.session` is `cascadeDelete: false` (kindred#1879
            # / 1500000021), so a resynced or deleted session can leave the
            # relation dangling. Defaulting session_type to "" here used to
            # fall through to the summer branch silently -- reproducing this
            # PR's own bug (a program-blind clear that deletes nothing) under
            # a narrower trigger. Answered as an explicit error instead of a
            # guess at which draft table to clear.
            raise HTTPException(
                status_code=409,
                detail=f"Scenario {scenario_id} names a session that no longer resolves; cannot determine which assignments to clear",
            )
        session_pb_id = str(getattr(scenario_session, "id", ""))
        scenario_session_cm_id = int(getattr(scenario_session, "cm_id", 0)) or None
        session_type = str(getattr(scenario_session, "session_type", "") or "")

        # Session-scoped, matching how every weekend draft write already is
        # (LodgingWriteService, LodgingRepository) -- a scenario id alone
        # does not prove which weekend a row belongs to; nothing at the write
        # path cross-checks a placement's session_cm_id against the
        # scenario's own `session` relation.
        #
        # WHICH id scopes it depends on the table, and the two are not
        # interchangeable (kindred#2042, migration 1500000147):
        #
        #   lodging_assignments_draft -> session_cm_id. Every lodging read and
        #     index keys on the CampMinder id, which survives a camp_sessions
        #     record being RECREATED rather than updated. Keyed on the
        #     relation, this endpoint reports "Cleared 0 assignments" over a
        #     full board the moment that happens -- exactly the bug #2021
        #     fixed, under a narrower trigger -- and reads unindexed besides.
        #   bunk_assignments_draft   -> the `session` relation. Summer's draft
        #     table has no session_cm_id column at all (1500000022), so a
        #     filter naming one is an "unknown field" error.
        is_weekend = _is_weekend_session_type(session_type)
        target_collection = LODGING_ASSIGNMENTS_DRAFT if is_weekend else BUNK_ASSIGNMENTS_DRAFT

        if is_weekend:
            if scenario_session_cm_id is None:
                # Same call as the dangling-relation guard above, for the same
                # reason: `session_cm_id = 0` is a filter PocketBase answers
                # with zero rows (the column is `min: 1`), so guessing here
                # reports a confident "Cleared 0" over placements that are
                # still there. Refuse instead of clearing nothing quietly.
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f"Scenario {scenario_id} names a weekend session with no CampMinder id; "
                        "cannot determine which assignments to clear"
                    ),
                )
            filter_str = (
                f'scenario = "{pb_escape(scenario_id)}" '
                f"&& session_cm_id = {scenario_session_cm_id} && year = {request.year}"
            )
        else:
            filter_str = (
                f'scenario = "{pb_escape(scenario_id)}" '
                f'&& session = "{pb_escape(session_pb_id)}" && year = {request.year}'
            )
        assignments = await asyncio.to_thread(
            pb.collection(target_collection).get_full_list,
            query_params={"filter": filter_str, "sort": STABLE_SORT},
        )

        deleted_count = 0
        for assignment in assignments:
            await asyncio.to_thread(pb.collection(target_collection).delete, assignment.id)
            deleted_count += 1

        # Drop this scenario's cache slot so the next graph request rebuilds
        # against the now-empty draft set.
        if scenario_session_cm_id is not None:
            graph_cache.invalidate_scenario(scenario_session_cm_id, int(request.year), scenario_id)

        return {
            "message": f"Cleared {deleted_count} assignments from scenario for year {request.year}",
        }

    except HTTPException:
        # The dangling-session guard above is client-input-shaped (409), not
        # a server error -- don't pollute error logs with a stacktrace for it.
        raise
    except ClientResponseError as e:
        raise pb_error_to_http(e)
    except Exception as e:
        logger.error(f"Error clearing scenario: {e}", exc_info=True)
        raise

"""
Solver Router - Endpoints for running the bunking solver.

This router handles:
- Running the OR-Tools constraint solver
- Getting solver run status
- Pre-validation of solver inputs
- Applying solver results
- Multi-session solving
- Solver logs
- Clearing session assignments
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pocketbase.client import ClientResponseError  # type: ignore[attr-defined]

from bunking.config import ConfigLoader

from ..dependencies import pb, solver_runs
from ..schemas import (
    ClearAssignmentsRequest,
    MultiSessionSolverRequest,
    SolverRequest,
    SolverResponse,
)
from ..services.session_context import build_session_context
from ..services.solver_runner import run_solver_task_v2

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["solver"])


# ========================================
# Solver Run Endpoints
# ========================================


@router.post("/solver/run")
async def run_solver(request: SolverRequest, background_tasks: BackgroundTasks) -> SolverResponse:
    """Run the bunking solver for a session."""
    run_id = str(uuid4())

    # Get time limit from config if not specified in request
    time_limit = request.time_limit
    if time_limit is None:
        config = ConfigLoader()
        time_limit = config.get_int("solver.time_limit_seconds", default=60)
        logger.info(f"Using config solver time limit: {time_limit}s")

    # Initialize run record
    solver_runs[run_id] = {
        "id": run_id,
        "session_cm_id": request.session_cm_id,
        "status": "pending",
        "created_at": datetime.now(UTC),
        "config": request.dict(),
    }

    # Start solver in background
    background_tasks.add_task(
        run_solver_task_v2,
        run_id,
        request.session_cm_id,
        request.year,
        request.respect_locks,
        time_limit,
        request.include_analysis,
        request.scenario,
        request.debug_constraints,
        request.config,
    )

    return SolverResponse(run_id=run_id, status="started", message="Solver run started in background")


@router.get("/solver/run/{run_id}")
async def get_solver_run(run_id: str) -> dict[str, Any]:
    """Get status and results of a solver run."""
    if run_id not in solver_runs:
        # Try to fetch from PocketBase
        try:
            pb_run = await asyncio.to_thread(pb.collection("solver_runs").get_one, run_id)
            return {
                "id": pb_run.id,
                "status": getattr(pb_run, "status", "unknown"),
                "results": json.loads(getattr(pb_run, "results", "{}")) if getattr(pb_run, "results", None) else None,
                "error_message": getattr(pb_run, "error_message", None),
            }
        except Exception:
            raise HTTPException(status_code=404, detail="Solver run not found")

    run = solver_runs[run_id]
    return {
        "id": run["id"],
        "status": run["status"],
        "results": run.get("results"),
        "error_message": run.get("error_message"),
    }


@router.post("/solver/pre-validate")
async def pre_validate_solver(request: SolverRequest) -> dict[str, Any]:
    """Pre-validate solver request to check for unsatisfiable constraints.

    Returns detailed information about:
    - Campers with requests for people not in the session
    - Conflicting requests
    - Other issues that would prevent the solver from finding a solution
    """
    try:
        # Build session context from request (validates session exists for year)
        ctx = await build_session_context(request.session_cm_id, request.year, pb)

        # Load all data needed for validation
        logger.info(f"Pre-validating solver request for session {ctx.session_cm_id} year {ctx.year}")

        # Use pre-built filters from SessionContext
        session_relation_filter = ctx.session_relation_filter
        session_id_filter = ctx.session_id_filter

        # Get all active, enrolled attendees for all related sessions
        # Filter: is_active = 1 AND status_id = 2 (enrolled status)
        # See CLAUDE.md "Attendee Active Status Filtering"
        attendees = await asyncio.to_thread(
            pb.collection("attendees").get_full_list,
            query_params={
                "filter": f"({session_relation_filter}) && year = {ctx.year} && is_active = 1 && status_id = 2",
                "expand": "session",
            },
        )

        # Create person lookup (using person_id field)
        person_cm_ids = {getattr(a, "person_id", None) for a in attendees if getattr(a, "person_id", None)}

        # Build mapping of person_cm_id → session_type for gender counting
        # This allows us to exclude AG session enrollees from boys/girls counts
        person_session_type: dict[int, str] = {}
        for attendee in attendees:
            person_id = getattr(attendee, "person_id", None)
            if person_id and hasattr(attendee, "expand") and attendee.expand:
                session = attendee.expand.get("session")
                if session:
                    session_type: str = str(getattr(session, "type", None) or getattr(session, "session_type", "main"))
                    person_session_type[person_id] = session_type

        # Count attendees by session for breakdown
        attendees_by_session: defaultdict[int, int] = defaultdict(int)
        for attendee in attendees:
            if hasattr(attendee, "expand") and attendee.expand:
                session = attendee.expand.get("session")
                if session and hasattr(session, "cm_id"):
                    attendees_by_session[session.cm_id] += 1

        # Fetch persons to get names (with year filter for data integrity)
        persons_dict: dict[int, Any] = {}
        if person_cm_ids:
            batch_size = 50
            for i in range(0, len(person_cm_ids), batch_size):
                batch_ids = list(person_cm_ids)[i : i + batch_size]
                filter_str = " || ".join([f"cm_id = {cm_id}" for cm_id in batch_ids])
                batch_persons = await asyncio.to_thread(
                    pb.collection("persons").get_full_list,
                    query_params={"filter": f"({filter_str}) && year = {ctx.year}"},
                )
                for person in batch_persons:
                    persons_dict[getattr(person, "cm_id", 0)] = person

        # Get all bunk requests for related sessions
        requests = await asyncio.to_thread(
            pb.collection("bunk_requests").get_full_list,
            query_params={
                "filter": f'({session_id_filter}) && year = {ctx.year} && status = "resolved"',
                "sort": "-priority",
            },
        )

        # Validation results
        errors = []
        warnings = []

        # Group requests by person
        requests_by_person: dict[int, list[Any]] = {}
        for req in requests:
            person_cm_id = getattr(req, "requester_id", None)
            if person_cm_id is None:
                continue
            if person_cm_id not in requests_by_person:
                requests_by_person[person_cm_id] = []
            requests_by_person[person_cm_id].append(req)

        # Check each person's requests
        campers_with_only_unsatisfiable = []

        for person_cm_id, person_requests in requests_by_person.items():
            if person_cm_id not in person_cm_ids:
                continue

            satisfiable_requests = []

            for req in person_requests:
                req_type = getattr(req, "request_type", "")
                if req_type in ["bunk_with", "not_bunk_with"]:
                    requestee = getattr(req, "requestee_id", None)
                    if requestee and requestee not in person_cm_ids:
                        continue
                    else:
                        satisfiable_requests.append(req)
                else:
                    satisfiable_requests.append(req)

            if len(person_requests) > 0 and len(satisfiable_requests) == 0:
                camper_name = f"Camper {person_cm_id}"
                if person_cm_id in persons_dict:
                    p = persons_dict[person_cm_id]
                    camper_name = f"{getattr(p, 'first_name', '')} {getattr(p, 'last_name', '')}"

                campers_with_only_unsatisfiable.append(
                    {"cm_id": person_cm_id, "name": camper_name, "unsatisfiable_count": len(person_requests)}
                )

        # Check for campers with only unsatisfiable requests (advisory only)
        # The optimizer uses soft constraints with penalties, so it won't fail - just note the issue
        if campers_with_only_unsatisfiable:
            count = len(campers_with_only_unsatisfiable)
            if count == 1:
                warnings.append("1 camper has requests that may not be fulfilled. The optimizer will do its best.")
            else:
                warnings.append(
                    f"{count} campers have requests that may not be fulfilled. The optimizer will do its best."
                )

        # Check for conflicting requests
        for person_cm_id, person_requests in requests_by_person.items():
            if person_cm_id not in person_cm_ids:
                continue

            bunk_with = set()
            not_bunk_with = set()

            for req in person_requests:
                requestee = getattr(req, "requestee_id", None)
                req_type = getattr(req, "request_type", "")
                if req_type == "bunk_with" and requestee:
                    if requestee in person_cm_ids:
                        bunk_with.add(requestee)
                elif req_type == "not_bunk_with" and requestee:
                    if requestee in person_cm_ids:
                        not_bunk_with.add(requestee)

            conflicts = bunk_with.intersection(not_bunk_with)
            if conflicts:
                requester_name = f"Camper {person_cm_id}"
                if person_cm_id in persons_dict:
                    p = persons_dict[person_cm_id]
                    requester_name = f"{getattr(p, 'first_name', '')} {getattr(p, 'last_name', '')} ({person_cm_id})"

                for conflict_id in conflicts:
                    conflict_name = f"camper {conflict_id}"
                    if conflict_id in persons_dict:
                        cp = persons_dict[conflict_id]
                        conflict_name = (
                            f"{getattr(cp, 'first_name', '')} {getattr(cp, 'last_name', '')} ({conflict_id})"
                        )

                    warnings.append(
                        f"{requester_name} has conflicting requests for {conflict_name} "
                        f"(both 'bunk with' and 'not bunk with')"
                    )

        # Statistics
        total_campers = len(person_cm_ids)
        total_requests = len(requests)
        campers_with_requests = len(requests_by_person)
        campers_without_requests = total_campers - campers_with_requests

        # Get bunk plans for all related sessions (expand bunk to get gender)
        logger.info(f"Pre-validate: Fetching bunk plans with filter: ({session_relation_filter}) && year = {ctx.year}")
        bunk_plans = await asyncio.to_thread(
            pb.collection("bunk_plans").get_full_list,
            query_params={
                "filter": f"({session_relation_filter}) && year = {ctx.year}",
                "expand": "bunk",
            },
        )
        logger.info(f"Pre-validate: Found {len(bunk_plans)} bunk plans")

        # Calculate capacity: bunk_plans count × default capacity (from config)
        # This matches the frontend's capacity calculation approach
        config_loader = ConfigLoader.get_instance()
        default_capacity = config_loader.get_int("constraint.cabin_capacity.standard", default=12)
        total_capacity = len(bunk_plans) * default_capacity

        # Gender-segmented capacity analysis (Boys/Girls/AG)
        # Count campers by gender, EXCLUDING AG session enrollees from boys/girls
        # AG campers go in AG bunks only, so they shouldn't count against boy/girl capacity
        boys_campers = 0
        girls_campers = 0
        ag_campers = 0

        for person_cm_id_val in person_cm_ids:
            if person_cm_id_val is None:
                continue
            person_record = persons_dict.get(int(person_cm_id_val))
            if not person_record:
                continue
            gender = getattr(person_record, "gender", None)
            session_type = person_session_type.get(int(person_cm_id_val), "main")

            # AG session enrollees are counted separately - they go in AG bunks only
            if session_type == "ag":
                ag_campers += 1
            elif gender == "M":
                boys_campers += 1
            elif gender == "F":
                girls_campers += 1

        # Count bunks by gender
        boys_bunks = 0
        girls_bunks = 0
        ag_bunks = 0

        for bp in bunk_plans:
            expand = getattr(bp, "expand", {}) or {}
            bunk_data = expand.get("bunk") if isinstance(expand, dict) else getattr(expand, "bunk", None)
            if bunk_data:
                bunk_gender = getattr(bunk_data, "gender", None)
                if bunk_gender == "M":
                    boys_bunks += 1
                elif bunk_gender == "F":
                    girls_bunks += 1
                elif bunk_gender in ("Mixed", "AG"):
                    ag_bunks += 1

        boys_capacity = boys_bunks * default_capacity
        girls_capacity = girls_bunks * default_capacity
        ag_capacity = ag_bunks * default_capacity

        # Build capacity breakdown (Boys, Girls, and AG)
        capacity_breakdown = {
            "boys": {
                "campers": boys_campers,
                "beds": boys_capacity,
                "sufficient": boys_campers <= boys_capacity,
            },
            "girls": {
                "campers": girls_campers,
                "beds": girls_capacity,
                "sufficient": girls_campers <= girls_capacity,
            },
            "ag": {
                "campers": ag_campers,
                "beds": ag_capacity,
                "sufficient": ag_campers <= ag_capacity,
            },
        }

        # Capacity check with gender breakdown
        capacity_issues = []
        if boys_campers > boys_capacity:
            over = boys_campers - boys_capacity
            capacity_issues.append(f"Boys: {boys_campers} campers, {boys_capacity} beds ({over} OVER)")
        if girls_campers > girls_capacity:
            over = girls_campers - girls_capacity
            capacity_issues.append(f"Girls: {girls_campers} campers, {girls_capacity} beds ({over} OVER)")
        if ag_campers > ag_capacity:
            over = ag_campers - ag_capacity
            capacity_issues.append(f"AG: {ag_campers} campers, {ag_capacity} beds ({over} OVER)")

        if capacity_issues:
            errors.append("Gender capacity issues: " + "; ".join(capacity_issues))
        elif total_campers > total_capacity:
            # Fallback to total capacity error if gender breakdown doesn't explain it
            errors.append(f"Insufficient capacity: {total_campers} campers but only {total_capacity} beds available")

        # Get session names for better reporting (filter by year to avoid cross-year contamination)
        session_names: dict[int, str] = {}
        all_sessions = await asyncio.to_thread(
            pb.collection("camp_sessions").get_full_list,
            query_params={
                "filter": f"({' || '.join([f'cm_id = {sid}' for sid in ctx.related_session_ids])}) && year = {ctx.year}"
            },
        )
        for s in all_sessions:
            session_names[getattr(s, "cm_id", 0)] = getattr(s, "name", "")

        # Build session breakdown
        session_breakdown = []
        for sid, count in attendees_by_session.items():
            session_breakdown.append(
                {
                    "session_cm_id": sid,
                    "session_name": session_names.get(sid, f"Session {sid}"),
                    "attendee_count": count,
                }
            )

        valid = len(errors) == 0

        return {
            "valid": valid,
            "errors": errors,
            "warnings": warnings,
            "statistics": {
                "total_campers": total_campers,
                "total_bunks": len(bunk_plans),
                "total_capacity": total_capacity,
                "total_requests": total_requests,
                "campers_with_requests": campers_with_requests,
                "campers_without_requests": campers_without_requests,
                "unsatisfiable_requests": [],
                "capacity_breakdown": capacity_breakdown,
            },
            "session_breakdown": session_breakdown,
            "related_sessions": ctx.related_session_ids,
        }

    except ClientResponseError as e:
        logger.error(f"PocketBase API error in pre-validation: {e.status} - {e.data}")
        raise HTTPException(status_code=500, detail=f"PocketBase error: {e.status} - {e.data}")
    except Exception as e:
        logger.error(f"Pre-validation failed: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/solver/run/{run_id}/analyze")
async def analyze_solver_run(run_id: str) -> None:
    """Analyze an existing solver run results."""
    raise HTTPException(status_code=501, detail="Analysis functionality is being reimplemented")


@router.post("/solver/apply/{run_id}")
async def apply_solver_results(run_id: str) -> dict[str, str]:
    """Apply the results of a solver run to the database."""
    session_cm_id = None
    scenario = None

    results: dict[str, Any] = {}
    if run_id not in solver_runs:
        try:
            pb_run = await asyncio.to_thread(pb.collection("solver_runs").get_one, run_id)
            results = json.loads(getattr(pb_run, "results", "{}") or "{}")
            session_cm_id = getattr(pb_run, "session_cm_id", None)
            if not session_cm_id and getattr(pb_run, "session", None):
                session_record = await asyncio.to_thread(
                    pb.collection("camp_sessions").get_one, getattr(pb_run, "session", "")
                )
                session_cm_id = getattr(session_record, "cm_id", None)

            scenario = getattr(pb_run, "scenario", None)
        except Exception:
            raise HTTPException(status_code=404, detail="Solver run not found")
    else:
        run_data = solver_runs[run_id]
        if run_data["status"] != "completed":
            raise HTTPException(status_code=400, detail="Solver run not completed")
        results = run_data.get("results", {})
        session_cm_id = run_data.get("session_cm_id")
        scenario = run_data.get("scenario")

    assignments = results["assignments"]

    # Get year from run config, fall back to results or current year
    run_year = None
    if run_id in solver_runs:
        run_config = solver_runs[run_id].get("config", {})
        run_year = run_config.get("year")
    if not run_year and "year" in results:
        run_year = results["year"]
    if not run_year:
        run_year = datetime.now().year
        logger.warning(f"apply_solver_results: No year in run config/results, using current year {run_year}")

    # Create ID cache for the run year
    from ..services.id_cache import IDLookupCache

    cache = IDLookupCache(pb, run_year)

    # Build session context to get proper session filter (includes AG sessions)
    # This ensures we get the correct attendee record for multi-enrolled campers
    if session_cm_id is None:
        raise HTTPException(status_code=400, detail="Session ID not found in solver run")
    ctx = await build_session_context(int(session_cm_id), run_year, pb)
    session_filter = ctx.session_relation_filter

    for person_cm_id_str, bunk_name in assignments.items():
        try:
            person_cm_id = int(person_cm_id_str)

            bunks = await asyncio.to_thread(
                pb.collection("bunks").get_full_list,
                query_params={"filter": f'name = "{bunk_name}" && year = {run_year}'},
            )

            if not bunks:
                logger.warning(f"Bunk {bunk_name} not found")
                continue

            bunk = bunks[0]
            bunk_cm_id = getattr(bunk, "cm_id", None)
            if bunk_cm_id is None:
                logger.warning(f"Bunk {bunk_name} has no cm_id")
                continue

            if scenario:
                collection_name = "bunk_assignments_draft"
                person_pb_id = await cache.get_person_pb_id(person_cm_id)
                if not person_pb_id:
                    logger.warning(f"Person with cm_id {person_cm_id} not found")
                    continue

                existing = await asyncio.to_thread(
                    pb.collection(collection_name).get_full_list,
                    query_params={
                        "filter": (f'person = "{person_pb_id}" && scenario = "{scenario}" && year = {run_year}')
                    },
                )

                # Use session_filter to get correct attendee for multi-enrolled campers
                attendees = await asyncio.to_thread(
                    pb.collection("attendees").get_full_list,
                    query_params={
                        "filter": f'person_id = {person_cm_id} && year = {run_year} && status = "enrolled" && ({session_filter})',
                        "expand": "session",
                    },
                )

                if not attendees:
                    logger.warning(
                        f"No attendee record found for person CM ID {person_cm_id} in session(s) {ctx.related_session_ids}"
                    )
                    continue

                attendee_expand = getattr(attendees[0], "expand", {}) or {}
                session_data = (
                    attendee_expand.get("session")
                    if isinstance(attendee_expand, dict)
                    else getattr(attendee_expand, "session", None)
                )
                actual_session_cm_id_val = (
                    session_data.cm_id if session_data and hasattr(session_data, "cm_id") else None
                )
                if not actual_session_cm_id_val:
                    logger.warning(f"No session cm_id found for attendee of person CM ID {person_cm_id}")
                    continue
                actual_session_cm_id = int(actual_session_cm_id_val)

                # Use cache to resolve all PB IDs (cache handles the lookups properly)
                bunk_pb_id = await cache.get_bunk_pb_id(int(bunk_cm_id))
                session_pb_id = await cache.get_session_pb_id(actual_session_cm_id)
                bunk_plan_pb_id = await cache.get_bunk_plan_id(int(bunk_cm_id), actual_session_cm_id, run_year)

                if not all([bunk_pb_id, session_pb_id, bunk_plan_pb_id]):
                    logger.warning(
                        f"Failed to resolve PB IDs for person {person_cm_id}: "
                        f"bunk={bunk_pb_id}, session={session_pb_id}, bunk_plan={bunk_plan_pb_id}"
                    )
                    continue

                assignment_data = {
                    "scenario": scenario,
                    "person": person_pb_id,
                    "session": session_pb_id,
                    "bunk": bunk_pb_id,
                    "bunk_plan": bunk_plan_pb_id,
                    "year": run_year,
                    "assignment_locked": False,
                }
            else:
                collection_name = "bunk_assignments"

                # Use session_filter to get correct attendee for multi-enrolled campers
                attendees = await asyncio.to_thread(
                    pb.collection("attendees").get_full_list,
                    query_params={
                        "filter": f'person_id = {person_cm_id} && year = {run_year} && status = "enrolled" && ({session_filter})',
                        "expand": "session",
                    },
                )

                if not attendees:
                    logger.warning(
                        f"No attendee record found for person CM ID {person_cm_id} in session(s) {ctx.related_session_ids}"
                    )
                    continue

                attendee_expand = getattr(attendees[0], "expand", {}) or {}
                session_data = (
                    attendee_expand.get("session")
                    if isinstance(attendee_expand, dict)
                    else getattr(attendee_expand, "session", None)
                )
                actual_session_cm_id_raw = (
                    session_data.cm_id if session_data and hasattr(session_data, "cm_id") else None
                )
                if not actual_session_cm_id_raw:
                    logger.warning(f"No session cm_id found for attendee of person CM ID {person_cm_id}")
                    continue
                actual_session_cm_id = int(actual_session_cm_id_raw)

                existing = await asyncio.to_thread(
                    pb.collection(collection_name).get_full_list,
                    query_params={
                        "filter": (
                            f"person.cm_id = {person_cm_id} && "
                            f"session.cm_id = {actual_session_cm_id} && "
                            f"year = {run_year}"
                        ),
                        "expand": "person,session,bunk",
                    },
                )

                assignment_data = {
                    "person_cm_id": person_cm_id,
                    "session_cm_id": actual_session_cm_id,
                    "bunk_cm_id": bunk_cm_id,
                    "year": run_year,
                    "assigned_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
                    "assigned_by": "solver",
                }

            if existing:
                existing_record = existing[0]
                existing_id_val = existing_record.get("id") if isinstance(existing_record, dict) else existing_record.id
                existing_id = str(existing_id_val) if existing_id_val else ""
                await asyncio.to_thread(pb.collection(collection_name).update, existing_id, assignment_data)
            else:
                await asyncio.to_thread(pb.collection(collection_name).create, assignment_data)

        except Exception as e:
            logger.error(f"Failed to update person {person_cm_id_str}: {e}")

    table_name = "bunk_assignments_draft" if scenario else "bunk_assignments"
    assignments_dict: dict[str, Any] = assignments if isinstance(assignments, dict) else {}
    return {"message": f"Applied {len(assignments_dict)} assignments to {table_name}"}


# ========================================
# Multi-Session Solver
# ========================================


@router.post("/solver/run-multi-session")
async def run_multi_session_solver(
    request: MultiSessionSolverRequest, background_tasks: BackgroundTasks
) -> dict[str, Any]:
    """Run the bunking solver for multiple child sessions of a parent session."""
    # Get time limit from config if not specified in request
    time_limit = request.time_limit_per_session
    if time_limit is None:
        config = ConfigLoader()
        time_limit = config.get_int("solver.time_limit_seconds", default=60)
        logger.info(f"Using config solver time limit: {time_limit}s")

    try:
        child_sessions = await asyncio.to_thread(
            pb.collection("camp_sessions").get_full_list,
            query_params={"filter": f"parent_id = {request.parent_session_cm_id} && year = {request.year}"},
        )

        if not child_sessions:
            child_sessions = await asyncio.to_thread(
                pb.collection("camp_sessions").get_full_list,
                query_params={"filter": f"cm_id = {request.parent_session_cm_id} && year = {request.year}"},
            )

        if not child_sessions:
            raise HTTPException(
                status_code=404, detail=f"No sessions found for parent ID {request.parent_session_cm_id}"
            )

        session_groups: dict[str, list[Any]] = {}
        if request.solve_by_sex:
            for session in child_sessions:
                sex_eligible = getattr(session, "sex_eligible", "all")
                if sex_eligible not in session_groups:
                    session_groups[sex_eligible] = []
                session_groups[sex_eligible].append(session)
        else:
            session_groups["all"] = child_sessions

        run_ids: dict[str, list[dict[str, Any]]] = {}
        for sex_group, sessions in session_groups.items():
            for session in sessions:
                run_id = str(uuid4())
                session_cm_id = getattr(session, "cm_id", 0)
                session_name = getattr(session, "name", "")

                solver_runs[run_id] = {
                    "id": run_id,
                    "session_cm_id": session_cm_id,
                    "parent_session_cm_id": request.parent_session_cm_id,
                    "sex_group": sex_group,
                    "status": "pending",
                    "created_at": datetime.now(UTC),
                    "config": {
                        "respect_locks": request.respect_locks,
                        "time_limit": time_limit,
                        "parent_session_cm_id": request.parent_session_cm_id,
                        "sex_group": sex_group,
                    },
                    "scenario": request.scenario,
                }

                background_tasks.add_task(
                    run_solver_task_v2,
                    run_id,
                    session_cm_id,
                    request.year,
                    request.respect_locks,
                    time_limit,
                    request.include_analysis,
                    request.scenario,
                )

                if sex_group not in run_ids:
                    run_ids[sex_group] = []
                run_ids[sex_group].append(
                    {"run_id": run_id, "session_cm_id": session_cm_id, "session_name": session_name}
                )

        return {
            "parent_session_cm_id": request.parent_session_cm_id,
            "total_sessions": len(child_sessions),
            "solver_runs": run_ids,
            "message": f"Started solver for {len(child_sessions)} sessions",
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Multi-session solver failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ========================================
# Session Management
# ========================================


@router.post("/sessions/{session_cm_id}/clear-assignments")
async def clear_session_assignments(session_cm_id: int, request: ClearAssignmentsRequest) -> dict[str, Any]:
    """Clear all assignments for a session and its related sessions."""
    try:
        # Build session context from request (validates session exists for year)
        ctx = await build_session_context(session_cm_id, request.year, pb)
        logger.info(f"Session {session_cm_id} - Found related sessions for clearing: {ctx.related_session_ids}")

        deletions_by_session: defaultdict[int, int] = defaultdict(int)
        total_deleted = 0

        if request.scenario:
            collection_name = "bunk_assignments_draft"
            base_filter = f'scenario = "{request.scenario}"'
        else:
            collection_name = "bunk_assignments"
            base_filter = ""

        for sid in ctx.related_session_ids:
            if base_filter:
                filter_str = f"{base_filter} && session.cm_id = {sid} && year = {ctx.year}"
            else:
                filter_str = f"session.cm_id = {sid} && year = {ctx.year}"

            assignments = await asyncio.to_thread(
                pb.collection(collection_name).get_full_list, query_params={"filter": filter_str}
            )

            for assignment in assignments:
                await asyncio.to_thread(pb.collection(collection_name).delete, assignment.id)
                deletions_by_session[sid] += 1
                total_deleted += 1

        session_names = {}
        all_sessions = await asyncio.to_thread(
            pb.collection("camp_sessions").get_full_list,
            query_params={
                "filter": f"({' || '.join([f'cm_id = {sid}' for sid in ctx.related_session_ids])}) && year = {ctx.year}"
            },
        )
        for s in all_sessions:
            cm_id = getattr(s, "cm_id", 0)
            name = getattr(s, "name", "")
            session_names[cm_id] = name

        breakdown = []
        for sid, count in deletions_by_session.items():
            breakdown.append(
                {"session_cm_id": sid, "session_name": session_names.get(sid, f"Session {sid}"), "deleted_count": count}
            )

        return {
            "message": f"Cleared {total_deleted} assignments across {len(ctx.related_session_ids)} related sessions",
            "total_deleted": total_deleted,
            "scenario": request.scenario,
            "session_breakdown": breakdown,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error clearing assignments: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to clear assignments: {str(e)}")


# ========================================
# Solver Logs
# ========================================


@router.get("/solver/logs/{session_id}")
async def get_solver_logs(session_id: int, run_id: str | None = None) -> dict[str, Any]:
    """Get solver logs for a session."""
    try:
        logs_dir = Path("logs/solver")
        if not logs_dir.exists():
            raise HTTPException(status_code=404, detail="No solver logs found")

        pattern = f"session_{session_id}_solver_log_*"
        if run_id:
            pattern += f"_{run_id}.json"
        else:
            pattern += ".json"

        log_files = list(logs_dir.glob(pattern))
        if not log_files:
            raise HTTPException(status_code=404, detail=f"No logs found for session {session_id}")

        log_file = max(log_files, key=lambda f: f.stat().st_mtime)

        with open(log_file) as f:
            log_data = json.load(f)

        logs = []
        summary = log_data.get("summary", {})

        for mode, constraints in summary.get("constraints_added", {}).items():
            for constraint_type, details_list in constraints.items():
                for details in details_list:
                    logs.append(
                        {
                            "timestamp": log_data["timestamp"],
                            "level": "INFO",
                            "category": "CONSTRAINT",
                            "message": f"Added {mode} {constraint_type} constraint: {details}",
                        }
                    )

        for warning in summary.get("feasibility_warnings", []):
            logs.append(
                {"timestamp": log_data["timestamp"], "level": "WARNING", "category": "FEASIBILITY", "message": warning}
            )

        for progress in summary.get("solver_progress", []):
            logs.append(
                {"timestamp": log_data["timestamp"], "level": "INFO", "category": "SOLVER", "message": progress}
            )

        for violation_type, violations in summary.get("violations", {}).items():
            for violation in violations:
                logs.append(
                    {
                        "timestamp": log_data["timestamp"],
                        "level": "ERROR" if violation["severity"] == "error" else "WARNING",
                        "category": "VIOLATION",
                        "message": f"{violation_type}: {violation['details']}",
                    }
                )

        request_validation = summary.get("request_validation")
        if request_validation:
            summary["request_validation"] = request_validation

        return {
            "logs": logs,
            "summary": summary,
            "log_file": str(log_file.name),
            "session_id": session_id,
            "solver_run_id": log_data.get("solver_run_id"),
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error retrieving solver logs: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve solver logs")


@router.get("/solver/logs")
async def list_solver_logs() -> dict[str, list[dict[str, Any]]]:
    """List available solver log files."""
    try:
        logs_dir = Path("logs/solver")
        if not logs_dir.exists():
            return {"logs": []}

        log_files: list[dict[str, Any]] = []
        for log_file in logs_dir.glob("session_*_solver_log_*.json"):
            parts = log_file.stem.split("_")
            if len(parts) >= 3 and parts[0] == "session":
                session_id = int(parts[1])
                timestamp = "_".join(parts[4:]) if len(parts) > 4 else "unknown"

                log_files.append(
                    {
                        "filename": log_file.name,
                        "session_id": session_id,
                        "timestamp": timestamp,
                        "size": log_file.stat().st_size,
                        "modified": datetime.fromtimestamp(log_file.stat().st_mtime).isoformat(),
                    }
                )

        log_files.sort(key=lambda x: str(x["modified"]), reverse=True)

        return {"logs": log_files}

    except Exception as e:
        logger.error(f"Error listing solver logs: {e}")
        raise HTTPException(status_code=500, detail="Failed to list solver logs")

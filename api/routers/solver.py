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

import asyncio
import json
from collections import defaultdict
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pocketbase.client import ClientResponseError  # type: ignore[attr-defined]

from bunking.auth_middleware import AuthUser
from bunking.config import ConfigLoader
from bunking.logging_config import get_logger
from bunking.rbac.dependencies import require_permission
from bunking.rbac.permissions import Permission
from bunking.satisfaction.bucket import is_counted_request
from bunking.solver.impossibility import filter_immaterial_requests, validate_impossibility

from ..constants.collections import (
    ATTENDEES,
    BUNK_ASSIGNMENTS_DRAFT,
    BUNKS,
    CAMP_SESSIONS,
    SOLVER_RUNS,
)
from ..dependencies import graph_cache, pb, solver_runs
from ..schemas import (
    ClearAssignmentsRequest,
    MultiSessionSolverRequest,
    SolverRequest,
    SolverResponse,
)
from ..schemas.solver import SweepRequest, SweepResponse
from ..services.data_fetcher import fetch_session_data_v2, prepare_direct_solver_input
from ..services.id_cache import IDLookupCache
from ..services.session_context import build_session_context
from ..services.solver_runner import resolve_session_relation, run_solver_task_v2
from ..services.sweep_input_snapshot import snapshot_session_input
from ..services.sweep_registry import sweep_registry
from ..services.sweep_runner import run_sweep
from ..utils.pb_error import pb_error_to_http
from ..utils.session_metrics import get_session_from_expand

logger = get_logger(__name__)

router = APIRouter(prefix="/api", tags=["solver"])

# Strong references to in-flight sweep orchestration tasks. asyncio.create_task
# returns a weakly-held task which can be GC'd mid-flight if the handler
# function returns; storing here keeps the orchestration alive until done.
_sweep_tasks: set[asyncio.Task[None]] = set()


def _resolve_time_limit(value: int | None, default: int = 60) -> int:
    """Return the solver time limit in seconds.

    Uses the value if provided; falls back to *default* (60 s).
    No config DB lookup — the request body is the canonical source.
    """
    return value if value is not None else default


_SCENARIO_REQUIRED_DETAIL = (
    "A scenario is required: solver output applies to a scenario's draft assignments. "
    "Production bunk assignments are read-only for the solver."
)


def _require_scenario(scenario: str | None) -> str:
    """Return *scenario*, or refuse with 422 when it is missing or blank.

    The solver cannot write production. It applies to a scenario's
    ``bunk_assignments_draft`` rows and nowhere else — production bunk
    assignments are read-only for both the solver and drag/drop. A scenario-less
    run therefore has nowhere legal to land, so it is refused rather than
    repaired (kindred#2467: the old production branch built a payload the
    collection rejected, logged the failure per camper and still returned 200).

    Same rule the lodging side already encodes on ``PlacementWriteBase.scenario``
    (``frontend/src/services/lodgingApi.ts``): *"REQUIRED and non-empty. A blank
    scenario is a 422, never a write to the live plan."*
    """
    if scenario is None or not scenario.strip():
        raise HTTPException(status_code=422, detail=_SCENARIO_REQUIRED_DETAIL)
    return scenario


# ========================================
# Solver Run Endpoints
# ========================================


@router.post("/solver/run")
async def run_solver(
    request: SolverRequest,
    background_tasks: BackgroundTasks,
    user: AuthUser = Depends(require_permission(Permission.BUNKING_MANAGE)),
) -> SolverResponse:
    """Run the bunking solver for a session."""
    # Refuse before anything else: a run with no scenario can only ever be
    # applied to production, which is read-only for the solver.
    _require_scenario(request.scenario)

    # Single-flight guard: reject duplicate in-progress runs for the same session.
    # FastAPI serializes coroutines on the event loop and solver_runs is in-process,
    # so no locking is needed beyond a plain dict scan.
    for run in solver_runs.values():
        if run.get("session_cm_id") == request.session_cm_id and run.get("status") in {"pending", "running"}:
            raise HTTPException(
                status_code=409,
                detail={
                    "detail": f"Solver already running for session {request.session_cm_id}",
                    "in_progress_run_id": run["id"],
                },
            )

    run_id = str(uuid4())

    time_limit = _resolve_time_limit(request.time_limit)

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
        time_limit,
        request.scenario,
        request.debug_constraints,
        request.config,
        respect_locks=request.respect_locks,
        locked_bunk_cm_ids=request.locked_bunk_cm_ids,
    )

    return SolverResponse(run_id=run_id, status="started", message="Solver run started in background")


@router.post("/solver/run-sweep", response_model=SweepResponse, status_code=202)
async def post_run_sweep(
    request: SweepRequest,
    user: AuthUser = Depends(require_permission(Permission.BUNKING_MANAGE)),
) -> SweepResponse:
    """Kick off a sequential multi-budget benchmark sweep.

    For session-based sweeps, inputs are frozen at kickoff so each child
    runs against identical data. Returns immediately; child runs poll
    the existing /solver/run/{run_id} endpoint.
    """
    # Resolve the target session_cm_id (and scenario metadata) before doing any
    # heavy work or registering with the sweep registry — both the in-flight
    # guard and snapshotting need this.
    if request.session_cm_id is not None:
        if request.year is None:
            raise HTTPException(status_code=400, detail="year is required for session-based sweeps")
        scenario_name = None
        scenario_id = None
        session_cm_id = request.session_cm_id
        year = request.year
    else:
        if request.scenario_id is None:
            raise HTTPException(status_code=400, detail="scenario_id is required when session_cm_id is unset")
        try:
            # `expand=session` is required: saved_scenarios stores `session`
            # as a relation FK string, not as `session_cm_id`. The cm_id only
            # comes through via `expand['session'].cm_id` — mirrors the
            # frontend's `scenarioTransform.ts` and the existing /scenarios
            # routes (api/routers/scenarios.py) that pass the same expand.
            scenario_record = await asyncio.to_thread(
                pb.collection("saved_scenarios").get_one,
                request.scenario_id,
                {"expand": "session"},
            )
        except ClientResponseError as e:
            raise pb_error_to_http(e) from e
        # Other exceptions intentionally propagate to the global handler (generic 500)
        # rather than getting downgraded to a misleading 400 with raw error text.
        scenario_id = request.scenario_id
        scenario_name = getattr(scenario_record, "name", None) or request.scenario_id
        expanded = getattr(scenario_record, "expand", None) or {}
        expanded_session = expanded.get("session") if isinstance(expanded, dict) else None
        session_cm_id = int(getattr(expanded_session, "cm_id", 0)) if expanded_session is not None else 0
        year = int(getattr(scenario_record, "year", 0))
        # A malformed saved_scenarios record (missing session expand or zero
        # year) would otherwise produce session_cm_id=0/year=0 — which the
        # in-flight guard below can never match against a real run, slipping
        # past into a doomed sweep that fails later in fetch_session_data_v2.
        # Reject up front with 422.
        if session_cm_id == 0 or year == 0:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"Scenario {scenario_id} has missing or invalid session_cm_id ({session_cm_id}) or year ({year})"
                ),
            )

    # Single-flight guard: reject duplicate in-progress sweeps/runs against the
    # same session or scenario. Mirrors /solver/run and /solver/run-multi-session.
    for run in solver_runs.values():
        if run.get("status") not in {"pending", "running"}:
            continue
        if run.get("session_cm_id") == session_cm_id:
            raise HTTPException(
                status_code=409,
                detail={
                    "detail": f"Solver already running for session {session_cm_id}",
                    "in_progress_run_id": run["id"],
                },
            )
        if scenario_id is not None and run.get("scenario") == scenario_id:
            raise HTTPException(
                status_code=409,
                detail={
                    "detail": f"Sweep already running for scenario {scenario_id}",
                    "in_progress_run_id": run["id"],
                },
            )

    # Pre-create the registry entry and pending solver_runs entries BEFORE the
    # snapshot await. The await yields the event loop, which leaves a TOCTOU
    # window where a second concurrent POST passes the in-flight guard and
    # launches a duplicate sweep. Pre-creating closes that window — any later
    # request now sees the pending entries and gets 409.
    #
    # `scenario` is set on each pre-created entry so the scenario guard above
    # fires for pending sweep children too (run_solver_task_v2 only stamps it
    # post-completion, which would leave a multi-minute hole otherwise).
    sweep_id = f"sweep_{uuid4().hex[:12]}"
    run_ids = [f"run_{uuid4().hex[:12]}" for _ in request.time_budgets]
    sweep_registry.register(sweep_id)

    now = datetime.now(UTC)
    # Pre-create the in-memory entries first so the in-flight guard sees
    # them immediately on subsequent requests.
    for run_id, budget in zip(run_ids, request.time_budgets, strict=True):
        entry: dict[str, Any] = {
            "id": run_id,
            "session_cm_id": session_cm_id,
            "status": "pending",
            "created_at": now,
            "config": {
                "time_limit": budget,
                "sweep_id": sweep_id,
                "sweep_label": request.label,
            },
        }
        if scenario_id is not None:
            entry["scenario"] = scenario_id
        solver_runs[run_id] = entry

    # Also pre-create the PocketBase rows so the frontend can derive
    # "sweep in progress" state from PB items alone. Without this, a page
    # refresh during a sweep that hasn't had any child complete yet loses
    # the banner (the previous client-only `activeSweepId` was wiped on
    # remount, and PB had no rows until completion).
    created_pb_ids: list[str] = []
    try:
        session_relation_id = await resolve_session_relation(pb, session_cm_id, year)
        for run_id, budget in zip(run_ids, request.time_budgets, strict=True):
            pb_data: dict[str, Any] = {
                "run_id": run_id,
                "session": session_relation_id,
                "session_id": session_cm_id,
                "year": year,
                "status": "pending",
                "details": json.dumps(
                    {
                        "sweep_id": sweep_id,
                        "sweep_label": request.label,
                        "time_limit_seconds": budget,
                        "scenario_id_at_run": scenario_id,
                    }
                ),
            }
            if scenario_id is not None:
                pb_data["scenario"] = scenario_id
            rec = await asyncio.to_thread(pb.collection(SOLVER_RUNS).create, pb_data)
            created_pb_ids.append(rec.id)
    except Exception as e:
        # Roll back any partial PB creates and release in-memory state so the
        # sweep slot isn't permanently locked.
        for prev in created_pb_ids:
            try:
                await asyncio.to_thread(pb.collection(SOLVER_RUNS).delete, prev)
            except Exception as cleanup_err:
                logger.warning("Failed to roll back PB row %s: %s", prev, cleanup_err)
        for rid in run_ids:
            solver_runs.pop(rid, None)
        sweep_registry.release(sweep_id)
        if isinstance(e, ClientResponseError):
            raise pb_error_to_http(e) from e
        raise

    # Snapshot the input. Scenario sweeps include scenario lock_groups; both
    # paths use the same helper. On failure, undo the pre-creation so the
    # session/scenario isn't permanently locked by the in-flight guard.
    try:
        frozen_input: Any = await snapshot_session_input(
            pb, session_cm_id=session_cm_id, year=year, scenario=scenario_id
        )
    except Exception as e:
        for prev in created_pb_ids:
            try:
                await asyncio.to_thread(pb.collection(SOLVER_RUNS).delete, prev)
            except Exception as cleanup_err:
                logger.warning("Failed to roll back PB row %s: %s", prev, cleanup_err)
        for run_id in run_ids:
            solver_runs.pop(run_id, None)
        sweep_registry.release(sweep_id)
        if isinstance(e, ClientResponseError):
            raise pb_error_to_http(e) from e
        raise  # unexpected — let the global handler turn it into a generic 500

    # Fire-and-forget orchestration. Background task survives this handler's return.
    # Hold a reference to prevent the task from being garbage-collected mid-flight (RUF006).
    task = asyncio.create_task(
        run_sweep(
            sweep_id=sweep_id,
            run_ids=run_ids,
            time_budgets=request.time_budgets,
            session_cm_id=session_cm_id,
            year=year,
            scenario=scenario_id,
            scenario_name=scenario_name,
            label=request.label,
            registry=sweep_registry,
            frozen_input=frozen_input,
            pb=pb,
        )
    )
    _sweep_tasks.add(task)
    task.add_done_callback(_sweep_tasks.discard)

    return SweepResponse(sweep_id=sweep_id, run_ids=run_ids)


@router.post("/solver/run-sweep/{sweep_id}/cancel", status_code=204)
async def post_cancel_sweep(
    sweep_id: str,
    user: AuthUser = Depends(require_permission(Permission.BUNKING_MANAGE)),
) -> None:
    """Cancel an in-flight sweep. Idempotent — unknown sweep_id is a no-op."""
    sweep_registry.cancel(sweep_id)


@router.get("/solver/run/{run_id}")
async def get_solver_run(
    run_id: str, user: AuthUser = Depends(require_permission(Permission.BUNKING_MANAGE))
) -> dict[str, Any]:
    """Get status and results of a solver run."""
    if run_id not in solver_runs:
        # Try to fetch from PocketBase
        try:
            pb_run = await asyncio.to_thread(pb.collection(SOLVER_RUNS).get_one, run_id)
            return {
                "id": pb_run.id,
                "status": getattr(pb_run, "status", "unknown"),
                "results": json.loads(getattr(pb_run, "results", "{}")) if getattr(pb_run, "results", None) else None,
                "error_message": getattr(pb_run, "error_message", None),
                # Stream C: overflow_used is persisted as a PB column; surface it
                # (defaulting to 0) so the response shape matches the in-memory branch.
                "overflow_used": getattr(pb_run, "overflow_used", 0) or 0,
                # Stream D: True when break-glass relaxed the request layer to place everyone.
                "break_glass_used": getattr(pb_run, "break_glass_used", False) or False,
                # Stream B diagnostics are in-memory only; the PB-fetch path never
                # has them. Return the keys as None so the response shape matches
                # the in-memory branch below (#1656).
                "infeasibility_cause": None,
                "localization": None,
                "impossibility_report": None,
            }
        except Exception:
            raise HTTPException(status_code=404, detail="Solver run not found")

    run = solver_runs[run_id]
    return {
        "id": run["id"],
        "status": run["status"],
        "results": run.get("results"),
        "error_message": run.get("error_message"),
        # Stream C: number of bunks the solver placed at 13-cap (0 on a clean
        # 12-cap solve). The frontend gates the overflow toast on this.
        "overflow_used": run.get("overflow_used", 0),
        # Stream D: True when break-glass relaxed the request layer to place everyone.
        "break_glass_used": run.get("break_glass_used", False),
        # Stream B (#1638): structured infeasibility diagnostics (in-memory only;
        # the PB-fetch fallback above returns these as absent → null client-side).
        "infeasibility_cause": run.get("infeasibility_cause"),
        "localization": run.get("localization"),
        "impossibility_report": run.get("impossibility_report"),
    }


@router.post("/solver/pre-validate")
async def pre_validate_solver(
    request: SolverRequest, user: AuthUser = Depends(require_permission(Permission.BUNKING_MANAGE))
) -> dict[str, Any]:
    """Pre-validate solver request via shared impossibility module.

    Delegates to validate_impossibility() — the same function
    DirectBunkingSolver._validate_requests uses — so the two paths
    cannot drift from each other.

    Response shape change vs. the old endpoint:
      - statistics.unsatisfiable_requests is REMOVED
      - New top-level impossibility_report field replaces it with structured
        per-reason groupings and cluster detail.
    """
    try:
        ctx = await build_session_context(request.session_cm_id, request.year, pb)
        logger.info(f"Pre-validating solver request for session {ctx.session_cm_id} year {ctx.year}")

        # Load session data using the SAME path the solver runner uses.
        # This guarantees the impossibility check sees identical data to what the
        # solver will see at run time (same filters, same expands).
        attendees_data, bunks_data, requests_data, assignments_data, bunk_plans_data = await fetch_session_data_v2(
            request.session_cm_id, request.year, pb
        )
        solver_input = prepare_direct_solver_input(
            attendees_data,
            bunks_data,
            requests_data,
            assignments_data,
            bunk_plans_data,
        )

        config_service = ConfigLoader.get_instance()

        # --- Impossibility detection (delegates to shared predicate registry) ---
        report = validate_impossibility(solver_input, config_service)
        # Filter IMMATERIAL_PARENT entries — staff treat these as background noise,
        # not actionable signals (Group 65 #1537).
        report = filter_immaterial_requests(report)

        # --- Statistics ---
        total_capacity = sum(b.capacity for b in solver_input.bunks)
        total_requests = sum(1 for r in solver_input.requests if is_counted_request(r))
        requests_by_person: dict[int, list[Any]] = {}
        for req in solver_input.requests:
            pid = req.requester_person_cm_id
            if pid not in requests_by_person:
                requests_by_person[pid] = []
            requests_by_person[pid].append(req)

        total_campers = len(solver_input.persons)
        campers_with_requests = len(requests_by_person)
        campers_without_requests = total_campers - campers_with_requests

        # --- Gender-segmented capacity (preserved from old endpoint) ---
        # Determine AG session IDs via the attendees_data expand — same
        # source fetch_session_data_v2 used to build solver_input.persons.
        ag_session_ids: set[int] = set()
        for attendee in attendees_data:
            session = get_session_from_expand(attendee)
            if session and getattr(session, "session_type", "") == "ag":
                ag_session_ids.add(session.cm_id)

        boys_campers = 0
        girls_campers = 0
        ag_campers = 0
        for person in solver_input.persons:
            if person.session_cm_id in ag_session_ids:
                ag_campers += 1
            elif person.gender == "M":
                boys_campers += 1
            elif person.gender == "F":
                girls_campers += 1

        boys_capacity = sum(b.capacity for b in solver_input.bunks if b.gender == "M")
        girls_capacity = sum(b.capacity for b in solver_input.bunks if b.gender == "F")
        ag_capacity = sum(b.capacity for b in solver_input.bunks if b.gender in ("Mixed", "AG"))

        capacity_breakdown = {
            "boys": {"campers": boys_campers, "beds": boys_capacity, "sufficient": boys_campers <= boys_capacity},
            "girls": {"campers": girls_campers, "beds": girls_capacity, "sufficient": girls_campers <= girls_capacity},
            "ag": {"campers": ag_campers, "beds": ag_capacity, "sufficient": ag_campers <= ag_capacity},
        }

        # --- Errors / warnings ---
        errors: list[str] = []
        warnings: list[str] = []

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
            errors.append(f"Insufficient capacity: {total_campers} campers but only {total_capacity} beds available")

        if len(solver_input.bunks) == 0:
            errors.append("Session has no bunks configured.")
        if total_campers == 0:
            errors.append("Session has no campers.")

        if report.affected_campers > 0:
            warnings.append(f"{report.affected_campers} camper(s) have one or more requests that cannot be honored.")

        # --- Session breakdown (fetch session names for UI display) ---
        attendees_by_session: defaultdict[int, int] = defaultdict(int)
        for attendee in attendees_data:
            session = get_session_from_expand(attendee)
            if session and hasattr(session, "cm_id"):
                attendees_by_session[session.cm_id] += 1

        session_names: dict[int, str] = {}
        if ctx.related_session_ids:
            all_sessions = await asyncio.to_thread(
                pb.collection(CAMP_SESSIONS).get_full_list,
                query_params={
                    "filter": (
                        f"({' || '.join([f'cm_id = {sid}' for sid in ctx.related_session_ids])}) && year = {ctx.year}"
                    )
                },
            )
            for s in all_sessions:
                session_names[getattr(s, "cm_id", 0)] = getattr(s, "name", "")

        session_breakdown = [
            {
                "session_cm_id": sid,
                "session_name": session_names.get(sid, f"Session {sid}"),
                "attendee_count": count,
            }
            for sid, count in attendees_by_session.items()
        ]

        return {
            "valid": len(errors) == 0,
            "errors": errors,
            "warnings": warnings,
            "statistics": {
                "total_campers": total_campers,
                "total_bunks": len(solver_input.bunks),
                "total_capacity": total_capacity,
                "total_requests": total_requests,
                "campers_with_requests": campers_with_requests,
                "campers_without_requests": campers_without_requests,
                "capacity_breakdown": capacity_breakdown,
            },
            # Serialize the whole ImpossibilityReport dataclass in one shot so any
            # field added to the dataclass automatically flows through to the
            # frontend — a prior hand-rolled dict silently dropped by_bucket_count
            # and crashed the modal. Keep the dataclass as the single source of
            # truth for the response shape.
            "impossibility_report": asdict(report),
            "session_breakdown": session_breakdown,
            "related_sessions": ctx.related_session_ids,
        }

    except HTTPException:
        raise
    except ClientResponseError as e:
        logger.error(f"PocketBase API error in pre-validation: {e.status} - {e.data}", exc_info=True)
        raise pb_error_to_http(e)
    except Exception:
        logger.error("Pre-validation failed", exc_info=True)
        raise


@router.post("/solver/run/{run_id}/analyze")
async def analyze_solver_run(
    run_id: str, user: AuthUser = Depends(require_permission(Permission.BUNKING_MANAGE))
) -> None:
    """Analyze an existing solver run results."""
    raise HTTPException(status_code=501, detail="Analysis functionality is being reimplemented")


@router.post("/solver/apply/{run_id}")
async def apply_solver_results(
    run_id: str, user: AuthUser = Depends(require_permission(Permission.BUNKING_MANAGE))
) -> dict[str, str]:
    """Apply the results of a solver run to its scenario's draft assignments."""
    session_cm_id = None
    scenario: str | None = None

    results: dict[str, Any] = {}
    if run_id not in solver_runs:
        try:
            pb_run = await asyncio.to_thread(pb.collection(SOLVER_RUNS).get_one, run_id)
            results = json.loads(getattr(pb_run, "results", "{}") or "{}")
            session_cm_id = getattr(pb_run, "session_cm_id", None)
            if not session_cm_id and getattr(pb_run, "session", None):
                session_record = await asyncio.to_thread(
                    pb.collection(CAMP_SESSIONS).get_one, getattr(pb_run, "session", "")
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

    # Refuse before touching PocketBase. A run with no scenario has nowhere
    # legal to land — the solver does not write production.
    scenario = _require_scenario(scenario)

    assignments = results["assignments"]

    # Get year from run config, fall back to results or current year
    run_year = None
    if run_id in solver_runs:
        run_config = solver_runs[run_id].get("config", {})
        run_year = run_config.get("year")
    if not run_year and "year" in results:
        run_year = results["year"]
    if not run_year:
        run_year = datetime.now(tz=UTC).year
        logger.warning(f"apply_solver_results: No year in run config/results, using current year {run_year}")

    # Create ID cache for the run year
    cache = IDLookupCache(pb, run_year)

    # Build session context to get proper session filter (includes AG sessions)
    # This ensures we get the correct attendee record for multi-enrolled campers
    if session_cm_id is None:
        raise HTTPException(status_code=400, detail="Session ID not found in solver run")
    ctx = await build_session_context(int(session_cm_id), run_year, pb)
    session_filter = ctx.session_relation_filter

    write_failures: list[str] = []

    for person_cm_id_str, bunk_name in assignments.items():
        try:
            person_cm_id = int(person_cm_id_str)

            bunks = await asyncio.to_thread(
                pb.collection(BUNKS).get_full_list,
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

            collection_name = BUNK_ASSIGNMENTS_DRAFT
            person_pb_id = await cache.get_person_pb_id(person_cm_id)
            if not person_pb_id:
                logger.warning(f"Person with cm_id {person_cm_id} not found")
                continue

            existing = await asyncio.to_thread(
                pb.collection(collection_name).get_full_list,
                query_params={"filter": (f'person = "{person_pb_id}" && scenario = "{scenario}" && year = {run_year}')},
            )

            # Use session_filter to get correct attendee for multi-enrolled campers
            attendees = await asyncio.to_thread(
                pb.collection(ATTENDEES).get_full_list,
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

            session_data = get_session_from_expand(attendees[0])
            actual_session_cm_id_val = session_data.cm_id if session_data and hasattr(session_data, "cm_id") else None
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

            if existing:
                existing_record = existing[0]
                # getattr, not `.id` — a malformed record shape here must degrade
                # this one camper, not raise AttributeError and abort the whole
                # remaining batch. The narrowed `except` below (kindred#2467) no
                # longer catches AttributeError on purpose, so it has to be kept
                # from happening in the first place rather than caught late.
                existing_id_val = (
                    existing_record.get("id")
                    if isinstance(existing_record, dict)
                    else getattr(existing_record, "id", None)
                )
                if not existing_id_val:
                    logger.error(
                        f"Existing draft record for person {person_cm_id_str} has no usable id "
                        f"(record={existing_record!r}); treating as a write failure"
                    )
                    write_failures.append(person_cm_id_str)
                    continue
                existing_id = str(existing_id_val)
                await asyncio.to_thread(pb.collection(collection_name).update, existing_id, assignment_data)
            else:
                await asyncio.to_thread(pb.collection(collection_name).create, assignment_data)

        except (ClientResponseError, ValueError) as e:
            # Narrowed on purpose (kindred#2467). A bare `except Exception` here
            # swallowed every failed write while the endpoint still returned 200,
            # which is how a branch that could never write went unnoticed. Per-camper
            # resilience is kept — one bad row must not abandon the rest — but the
            # failures are counted and the response says so below.
            logger.error(f"Failed to apply assignment for person {person_cm_id_str}: {e}")
            write_failures.append(person_cm_id_str)

    assignments_dict: dict[str, Any] = assignments if isinstance(assignments, dict) else {}

    # Drop the matching graph cache slot so the next /social-graph request
    # rebuilds from current DB. Without this the cached NetworkX graph carries
    # the previous draft's bunk_cm_id node attrs for up to TTL (15 min) — the
    # symptom is "everyone in a big lump" because bubble grouping no longer
    # matches the active scenario's assignments.
    graph_cache.invalidate_scenario(int(session_cm_id), run_year, scenario)

    if write_failures:
        # Never report success over a failed write — see the handler above.
        raise HTTPException(
            status_code=500,
            detail=(
                f"{len(write_failures)} of {len(assignments_dict)} assignments failed to write "
                f"(applied {len(assignments_dict) - len(write_failures)}); see server logs"
            ),
        )

    return {"message": f"Applied {len(assignments_dict)} assignments to {BUNK_ASSIGNMENTS_DRAFT}"}


# ========================================
# Multi-Session Solver
# ========================================


@router.post("/solver/run-multi-session")
async def run_multi_session_solver(
    request: MultiSessionSolverRequest,
    background_tasks: BackgroundTasks,
    user: AuthUser = Depends(require_permission(Permission.BUNKING_MANAGE)),
) -> dict[str, Any]:
    """Run the bunking solver for multiple child sessions of a parent session."""
    # Same rule as /solver/run: every child run must have a scenario to land in.
    _require_scenario(request.scenario)

    time_limit = _resolve_time_limit(request.time_limit_per_session)

    try:
        child_sessions = await asyncio.to_thread(
            pb.collection(CAMP_SESSIONS).get_full_list,
            query_params={"filter": f"parent_id = {request.parent_session_cm_id} && year = {request.year}"},
        )

        if not child_sessions:
            child_sessions = await asyncio.to_thread(
                pb.collection(CAMP_SESSIONS).get_full_list,
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

        # Single-flight guard: check all child sessions before dispatching any run.
        # Reject the entire request if any child session already has a pending/running solve.
        for session in child_sessions:
            candidate_cm_id = getattr(session, "cm_id", 0)
            for run in solver_runs.values():
                if run.get("session_cm_id") == candidate_cm_id and run.get("status") in {"pending", "running"}:
                    raise HTTPException(
                        status_code=409,
                        detail={
                            "detail": f"Solver already running for session {candidate_cm_id}",
                            "in_progress_run_id": run["id"],
                        },
                    )

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
                    time_limit,
                    request.scenario,
                    respect_locks=request.respect_locks,
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
    except Exception:
        logger.error("Multi-session solver failed", exc_info=True)
        raise


# ========================================
# Session Management
# ========================================


@router.post("/sessions/{session_cm_id}/clear-assignments")
async def clear_session_assignments(
    session_cm_id: int,
    request: ClearAssignmentsRequest,
    user: AuthUser = Depends(require_permission(Permission.BUNKING_MANAGE)),
) -> dict[str, Any]:
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
            pb.collection(CAMP_SESSIONS).get_full_list,
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

        # Invalidate the graph cache for every related session — clearing
        # assignments materially changes the social graph, so any cached
        # rendering would be stale.
        for sid in ctx.related_session_ids:
            if request.scenario:
                graph_cache.invalidate_scenario(int(sid), int(ctx.year), request.scenario)
            else:
                graph_cache.invalidate_session(int(sid), int(ctx.year))

        return {
            "message": f"Cleared {total_deleted} assignments across {len(ctx.related_session_ids)} related sessions",
            "total_deleted": total_deleted,
            "scenario": request.scenario,
            "session_breakdown": breakdown,
        }

    except HTTPException:
        raise
    except Exception:
        logger.error("Error clearing assignments", exc_info=True)
        raise


# ========================================
# Solver Logs
# ========================================


@router.get("/solver/logs/{session_id}")
async def get_solver_logs(
    session_id: int, run_id: str | None = None, user: AuthUser = Depends(require_permission(Permission.BUNKING_MANAGE))
) -> dict[str, Any]:
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

        logs: list[dict[str, str]] = []
        summary = log_data.get("summary", {})

        for mode, constraints in summary.get("constraints_added", {}).items():
            for constraint_type, details_list in constraints.items():
                logs.extend(
                    {
                        "timestamp": log_data["timestamp"],
                        "level": "INFO",
                        "category": "CONSTRAINT",
                        "message": f"Added {mode} {constraint_type} constraint: {details}",
                    }
                    for details in details_list
                )

        logs.extend(
            {"timestamp": log_data["timestamp"], "level": "WARNING", "category": "FEASIBILITY", "message": warning}
            for warning in summary.get("feasibility_warnings", [])
        )

        logs.extend(
            {"timestamp": log_data["timestamp"], "level": "INFO", "category": "SOLVER", "message": progress}
            for progress in summary.get("solver_progress", [])
        )

        for violation_type, violations in summary.get("violations", {}).items():
            logs.extend(
                {
                    "timestamp": log_data["timestamp"],
                    "level": "ERROR" if violation["severity"] == "error" else "WARNING",
                    "category": "VIOLATION",
                    "message": f"{violation_type}: {violation['details']}",
                }
                for violation in violations
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
    except Exception:
        logger.error("Error retrieving solver logs", exc_info=True)
        raise


@router.get("/solver/logs")
async def list_solver_logs(
    user: AuthUser = Depends(require_permission(Permission.BUNKING_MANAGE)),
) -> dict[str, list[dict[str, Any]]]:
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
                        "modified": datetime.fromtimestamp(log_file.stat().st_mtime, tz=UTC).isoformat(),
                    }
                )

        log_files.sort(key=lambda x: str(x["modified"]), reverse=True)

        return {"logs": log_files}

    except Exception:
        logger.error("Error listing solver logs", exc_info=True)
        raise

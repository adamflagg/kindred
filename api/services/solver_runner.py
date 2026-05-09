"""
Solver Runner Service - Functions for running the bunking solver.

This service handles running solver tasks in background.
Main + AG sessions are automatically fetched together via get_related_session_ids.
"""

from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime
from typing import Any

from bunking.config import ConfigLoader
from bunking.direct_solver import DirectBunkingSolver
from bunking.logging_config import get_logger
from pocketbase import PocketBase

from ..constants.collections import SOLVER_RUNS, SUPERUSERS
from ..dependencies import pb_url, solver_runs
from ..settings import get_settings
from .data_fetcher import (
    fetch_historical_bunking,
    fetch_lock_groups,
    fetch_session_data_v2,
    prepare_direct_solver_input,
)
from .run_tagging import build_run_details, compose_minimal_run_details

logger = get_logger(__name__)


async def run_solver_task_v2(
    run_id: str,
    session_cm_id: int,
    year: int,
    time_limit: int,
    include_analysis: bool = False,
    scenario: str | None = None,
    debug_constraints: dict[str, Any] | None = None,
    config_overrides: dict[str, Any] | None = None,
    respect_locks: bool = True,
    scenario_name: str | None = None,
    sweep_id: str | None = None,
    sweep_label: str | None = None,
    frozen_input: Any = None,
) -> None:
    """Background task to run the solver with direct bunk_requests data."""
    # Minimal details available even if the run fails before tagging. Includes
    # git_sha + source_label + source_kind (no PocketBase needed) so failed
    # sweep children render the same column set as their successful siblings
    # in the impact-analysis sweep view — not blank rows alongside.
    # session_attendee_count remains None until prepare_direct_solver_input
    # runs; it is patched in below the moment that data lands.
    minimal_details: dict[str, Any] = compose_minimal_run_details(
        session_label=f"Session {session_cm_id} — {year}",
        scenario_id=scenario,
        scenario_name=scenario_name,
        sweep_id=sweep_id,
        sweep_label=sweep_label,
        time_limit_seconds=time_limit,
    )

    # Create a new PocketBase client for this background task
    task_pb = PocketBase(pb_url)
    settings = get_settings()

    try:
        # Authenticate the task-specific client
        logger.info("Authenticating task-specific PocketBase client...")
        await asyncio.to_thread(
            task_pb.collection(SUPERUSERS).auth_with_password,
            settings.pocketbase_admin_email,
            settings.pocketbase_admin_password,
        )
        logger.info("Task PocketBase client authenticated successfully")

        solver_runs[run_id]["started_at"] = datetime.now(UTC)
        solver_runs[run_id]["status"] = "running"

        # If a sweep pre-resolved inputs and froze them at sweep kickoff,
        # reuse that snapshot so each child run sees identical inputs
        # regardless of mid-sweep PB writes (sync, etc.). Otherwise resolve
        # PB freshly.
        #
        # Defensive deepcopy: this function mutates solver_input in place
        # (existing_assignments / lock_groups_data when respect_locks=False)
        # so without a copy, the frozen snapshot would be corrupted for
        # subsequent sweep children. model_copy(deep=True) is microseconds
        # for the typical session size — far cheaper than re-fetching from PB.
        if frozen_input is not None:
            logger.info(f"Reusing frozen solver input from sweep {sweep_id}")
            solver_input = frozen_input.model_copy(deep=True)
        else:
            logger.info(f"Fetching data for session CM ID {session_cm_id} year {year} scenario={scenario}")
            attendees_data, bunks_data, requests_data, assignments_data, bunk_plans_data = await fetch_session_data_v2(
                session_cm_id, year, task_pb, scenario=scenario
            )
            historical_bunking = await fetch_historical_bunking(session_cm_id, year, task_pb)
            solver_input = prepare_direct_solver_input(
                attendees_data,
                bunks_data,
                requests_data,
                assignments_data,
                bunk_plans_data,
                historical_bunking=historical_bunking,
            )

        # Fetch lock groups if running in scenario mode (skip if frozen_input
        # was passed — the sweep snapshotter is responsible for including them).
        if scenario and frozen_input is None:
            lock_groups = await fetch_lock_groups(
                scenario=scenario,
                session_cm_id=session_cm_id,
                year=year,
                pb_client=task_pb,
            )
            solver_input.lock_groups_data = lock_groups

        # If respect_locks is disabled, clear existing assignments and group locks
        # so the solver is free to reassign all campers from scratch
        if not respect_locks:
            solver_input.existing_assignments = []
            solver_input.lock_groups_data = {}
            logger.info("respect_locks=False: cleared existing assignments and group locks")

        # Run solver
        logger.info(
            f"Running direct solver with {len(solver_input.persons)} persons and {len(solver_input.requests)} requests"
        )

        # Initialize ConfigLoader for solver
        logger.info("Initializing ConfigLoader for solver")
        config_service = ConfigLoader.get_instance()

        # Apply config overrides if provided
        if config_overrides:
            logger.info(f"Applying config overrides: {config_overrides}")
            for key, value in config_overrides.items():
                logger.info(f"Setting config: {key} = {value}")
                config_service.update_config(key, value)
                actual_value = config_service.get_str(key)
                logger.info(f"Config {key} is now: {actual_value}")

        # Run solver (main + AG sessions are automatically fetched together)
        logger.info("Creating DirectBunkingSolver instance")
        if debug_constraints:
            logger.info(f"DEBUG MODE: Constraints disabled: {list(debug_constraints.keys())}")
        solver = DirectBunkingSolver(
            input_data=solver_input, config_service=config_service, debug_constraints=debug_constraints or {}
        )

        # The OR-Tools solver is synchronous and CPU-bound — running it
        # directly on the event loop blocks every other request to this
        # uvicorn worker (status polls, /health, the container HEALTHCHECK
        # probe) for the full solve duration. Offload to a thread so the
        # event loop stays responsive.
        result = await asyncio.to_thread(solver.solve, time_limit_seconds=time_limit)

        if result is None:
            # Try to identify the cause of infeasibility
            logger.warning("Solver failed - running infeasibility analysis...")
            try:
                cause = await asyncio.to_thread(solver.find_infeasibility_cause, time_limit_seconds=10)
                logger.error(f"Infeasibility analysis result: {cause}")
            except Exception as e:
                logger.error(f"Failed to run infeasibility analysis: {e}")

            raise ValueError("Solver failed to find a solution")

        # Build bunk name map for results
        bunk_cm_to_name = {b.campminder_id: b.name for b in solver_input.bunks}

        # Calculate assignments_changed by comparing existing vs new
        # Build map of existing: person_cm_id → bunk_cm_id
        existing_assignments_map = {}
        for existing in solver_input.existing_assignments:
            existing_assignments_map[existing.person_cm_id] = existing.bunk_cm_id

        # Count changes
        assignments_changed = 0
        new_assignments = 0
        for assignment in result.assignments:
            old_bunk = existing_assignments_map.get(assignment.person_cm_id)
            if old_bunk is None:
                new_assignments += 1
            elif old_bunk != assignment.bunk_cm_id:
                assignments_changed += 1

        logger.info(
            f"Solver produced {len(result.assignments)} assignments: {assignments_changed} changed, {new_assignments} new"
        )

        # Store results
        solver_runs[run_id]["status"] = "completed"
        solver_runs[run_id]["completed_at"] = datetime.now(UTC)

        # Merge calculated stats into result.stats
        stats_with_changes = {
            **(result.stats or {}),
            "assignments_changed": assignments_changed,
            "new_assignments": new_assignments,
        }

        results_data: dict[str, Any] = {
            "assignments": {
                str(assignment.person_cm_id): bunk_cm_to_name.get(assignment.bunk_cm_id, str(assignment.bunk_cm_id))
                for assignment in result.assignments
            },
            "stats": stats_with_changes,
            "satisfied_requests": {
                str(person_cm_id): request_ids for person_cm_id, request_ids in result.satisfied_requests.items()
            },
        }

        if include_analysis:
            logger.info("Analysis requested but not available with DirectBunkingSolver")
            results_data["analysis_note"] = "Analysis functionality pending reimplementation"

        solver_runs[run_id]["results"] = results_data
        solver_runs[run_id]["scenario"] = scenario

        # Compose run-tagging details (git SHA, config snapshot, source labels,
        # scenario_id_at_run, attendee count, sweep grouping). Best-effort —
        # if it fails, fall back to the minimal details computed at function entry
        # so persistence still happens with consistent keys.
        try:
            details = await build_run_details(
                pb=task_pb,
                session_label=f"Session {session_cm_id} — {year}",
                scenario_id=scenario,
                scenario_name=scenario_name,
                session_attendee_count=len(solver_input.persons),
                sweep_id=sweep_id,
                sweep_label=sweep_label,
            )
        except Exception as tag_error:
            logger.warning(f"Run tagging failed: {tag_error}")
            details = dict(minimal_details)
        details["time_limit_seconds"] = time_limit

        # Record in PocketBase
        try:
            pb_data: dict[str, Any] = {
                "run_id": run_id,
                "session": str(session_cm_id),
                "session_id": session_cm_id,
                "status": "success",
                "started_at": solver_runs[run_id]["started_at"].strftime("%Y-%m-%d %H:%M:%S.000Z"),
                "completed_at": solver_runs[run_id]["completed_at"].strftime("%Y-%m-%d %H:%M:%S.000Z"),
                "result": json.dumps(solver_runs[run_id]["results"]),
                "stats": json.dumps(stats_with_changes),
                "details": json.dumps(details),
            }
            if scenario:
                pb_data["scenario"] = scenario
            logger.debug(f"Attempting to save to PocketBase with data: {pb_data}")

            pb_record = await asyncio.to_thread(task_pb.collection(SOLVER_RUNS).create, pb_data)
            logger.info(f"Created PocketBase record: {pb_record.id}")
        except Exception as pb_error:
            logger.error(f"Failed to save to PocketBase: {type(pb_error).__name__}: {pb_error}")
            import traceback

            logger.error(f"Traceback: {traceback.format_exc()}")

        logger.info(f"Solver run {run_id} completed successfully")

    except Exception as e:
        logger.error(f"Solver run {run_id} failed: {e}", exc_info=True)
        solver_runs[run_id]["status"] = "failed"
        solver_runs[run_id]["error_message"] = str(e)
        solver_runs[run_id]["completed_at"] = datetime.now(UTC)

        # Record failure in PocketBase. Persist `details` (with sweep_id /
        # sweep_label / scenario_id_at_run / time_limit_seconds) so failed
        # sweep children group correctly with their successful siblings in
        # the impact-analysis UI rather than appearing as orphans.
        try:
            await asyncio.to_thread(
                task_pb.collection(SOLVER_RUNS).create,
                {
                    "run_id": run_id,
                    "session": str(session_cm_id),
                    "session_id": session_cm_id,
                    "status": "failed",
                    "started_at": solver_runs[run_id]
                    .get("started_at", datetime.now(UTC))
                    .strftime("%Y-%m-%d %H:%M:%S.000Z"),
                    "completed_at": solver_runs[run_id]["completed_at"].strftime("%Y-%m-%d %H:%M:%S.000Z"),
                    "error": json.dumps({"message": str(e)}),
                    "details": json.dumps(minimal_details),
                },
            )
        except Exception:  # noqa: S110 — intentional silent handling
            pass

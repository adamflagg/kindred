"""
Solver Runner Service - Functions for running the bunking solver.

This service handles running solver tasks in background.
Main + AG sessions are automatically fetched together via get_related_session_ids.
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import UTC, datetime
from typing import Any

from bunking.config import ConfigLoader
from bunking.direct_solver import DirectBunkingSolver
from pocketbase import PocketBase

from ..dependencies import pb_url, solver_runs
from ..settings import get_settings
from .data_fetcher import fetch_historical_bunking, fetch_session_data_v2, prepare_direct_solver_input

logger = logging.getLogger(__name__)


async def run_solver_task_v2(
    run_id: str,
    session_cm_id: int,
    year: int,
    respect_locks: bool,
    time_limit: int,
    include_analysis: bool = False,
    scenario: str | None = None,
    debug_constraints: dict[str, Any] | None = None,
    config_overrides: dict[str, Any] | None = None,
) -> None:
    """Background task to run the solver with direct bunk_requests data."""
    # Create a new PocketBase client for this background task
    task_pb = PocketBase(pb_url)
    settings = get_settings()

    try:
        # Authenticate the task-specific client
        logger.info("Authenticating task-specific PocketBase client...")
        await asyncio.to_thread(
            task_pb.collection("_superusers").auth_with_password,
            settings.pocketbase_admin_email,
            settings.pocketbase_admin_password,
        )
        logger.info("Task PocketBase client authenticated successfully")

        solver_runs[run_id]["started_at"] = datetime.now(UTC)
        solver_runs[run_id]["status"] = "running"

        # Fetch data (from draft table if scenario provided)
        logger.info(f"Fetching data for session CM ID {session_cm_id} year {year} scenario={scenario}")
        attendees_data, bunks_data, requests_data, assignments_data, bunk_plans_data = await fetch_session_data_v2(
            session_cm_id, year, task_pb, scenario=scenario
        )

        # Fetch historical bunking data for level progression constraint
        historical_bunking = await fetch_historical_bunking(session_cm_id, year, task_pb)

        # Prepare direct solver input
        solver_input = prepare_direct_solver_input(
            attendees_data,
            bunks_data,
            requests_data,
            assignments_data,
            bunk_plans_data,
            historical_bunking=historical_bunking,
        )

        # Apply manual locks if requested
        if not respect_locks:
            solver_input.existing_assignments = [a for a in solver_input.existing_assignments if not a.is_locked]

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

        # Run solver with time limit
        result = solver.solve(time_limit_seconds=time_limit)

        if result is None:
            # Try to identify the cause of infeasibility
            logger.warning("Solver failed - running infeasibility analysis...")
            try:
                cause = solver.find_infeasibility_cause(time_limit_seconds=10)
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

        # Record in PocketBase
        try:
            pb_data = {
                "session_cm_id": session_cm_id,
                "status": "completed",
                "started_at": solver_runs[run_id]["started_at"].strftime("%Y-%m-%d %H:%M:%S.000Z"),
                "completed_at": solver_runs[run_id]["completed_at"].strftime("%Y-%m-%d %H:%M:%S.000Z"),
                "results": json.dumps(solver_runs[run_id]["results"]),
                "config": json.dumps({"respect_locks": respect_locks, "time_limit": time_limit}),
                "scenario": scenario,  # Relation field (PocketBase ID or None)
            }
            logger.info(f"Attempting to save to PocketBase with data: {pb_data}")

            pb_record = await asyncio.to_thread(task_pb.collection("solver_runs").create, pb_data)
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

        # Record failure in PocketBase
        try:
            await asyncio.to_thread(
                task_pb.collection("solver_runs").create,
                {
                    "session_cm_id": session_cm_id,
                    "status": "failed",
                    "started_at": solver_runs[run_id]["started_at"].strftime("%Y-%m-%d %H:%M:%S.000Z"),
                    "completed_at": solver_runs[run_id]["completed_at"].strftime("%Y-%m-%d %H:%M:%S.000Z"),
                    "error_message": str(e),
                },
            )
        except Exception:
            pass

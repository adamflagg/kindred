"""Snapshot a session's solver input for sequential reuse across sweep child runs.

For session-based sweeps we resolve PB once at sweep kickoff and pass the
frozen ``DirectSolverInput`` to each child via ``run_solver_task_v2(..., frozen_input=)``.
This prevents mid-sweep PB writes (a sync, an edit) from contaminating timing
comparisons.

Mirrors the input-fetching flow in ``solver_runner.run_solver_task_v2``.
"""

from typing import Any

from bunking.models_v2 import DirectSolverInput

from .data_fetcher import (
    fetch_historical_bunking,
    fetch_lock_groups,
    fetch_session_data_v2,
    prepare_direct_solver_input,
)


async def snapshot_session_input(
    pb: Any,
    session_cm_id: int,
    year: int,
    scenario: str | None,
) -> DirectSolverInput:
    """Resolve a session into a complete DirectSolverInput suitable for in-process reuse."""
    attendees_data, bunks_data, requests_data, assignments_data, bunk_plans_data = await fetch_session_data_v2(
        session_cm_id, year, pb, scenario=scenario
    )
    historical_bunking = await fetch_historical_bunking(session_cm_id, year, pb)
    solver_input = prepare_direct_solver_input(
        attendees_data,
        bunks_data,
        requests_data,
        assignments_data,
        bunk_plans_data,
        historical_bunking=historical_bunking,
    )

    if scenario:
        lock_groups = await fetch_lock_groups(scenario=scenario, session_cm_id=session_cm_id, year=year, pb_client=pb)
        solver_input.lock_groups_data = lock_groups

    return solver_input

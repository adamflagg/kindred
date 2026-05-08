"""Sweep orchestration: run N child solver runs sequentially with shared sweep_id.

Inputs are pre-frozen at sweep kickoff (via :mod:`sweep_input_snapshot`) and
passed to each child as ``frozen_input`` so all children see identical inputs
regardless of mid-sweep PB writes.

Sequential — not parallel — so 4 budgets × 8 worker threads don't compete
for cores and contaminate walltime measurements.
"""

from __future__ import annotations

from typing import Any

from bunking.logging_config import get_logger

from .solver_runner import run_solver_task_v2
from .sweep_registry import SweepRegistry

logger = get_logger(__name__)


async def run_sweep(
    sweep_id: str,
    run_ids: list[str],
    time_budgets: list[int],
    session_cm_id: int,
    year: int,
    scenario: str | None,
    scenario_name: str | None,
    label: str | None,
    registry: SweepRegistry,
    frozen_input: Any,
) -> None:
    """Run each ``(run_id, budget)`` pair sequentially; abort remaining if cancelled.

    ``finally`` releases the sweep_id from the registry so it doesn't leak
    even if a child run raises.
    """
    if len(run_ids) != len(time_budgets):
        raise ValueError("run_ids and time_budgets must be same length")

    try:
        for run_id, budget in zip(run_ids, time_budgets):
            if registry.is_cancelled(sweep_id):
                logger.info("Sweep %s cancelled; aborting remaining runs", sweep_id)
                break
            await run_solver_task_v2(
                run_id=run_id,
                session_cm_id=session_cm_id,
                year=year,
                time_limit=budget,
                scenario=scenario,
                scenario_name=scenario_name,
                sweep_id=sweep_id,
                sweep_label=label,
                frozen_input=frozen_input,
            )
    finally:
        registry.release(sweep_id)

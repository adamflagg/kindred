"""Sweep orchestration: run N child solver runs sequentially with shared sweep_id.

Inputs are pre-frozen at sweep kickoff (via :mod:`sweep_input_snapshot`) and
passed to each child as ``frozen_input`` so all children see identical inputs
regardless of mid-sweep PB writes.

Sequential — not parallel — so 4 budgets × 8 worker threads don't compete
for cores and contaminate walltime measurements.
"""

from __future__ import annotations

import asyncio
from typing import Any

from bunking.logging_config import get_logger

from ..constants.collections import SOLVER_RUNS
from ..dependencies import solver_runs
from .solver_runner import run_solver_task_v2
from .sweep_registry import SweepRegistry

logger = get_logger(__name__)


async def _mark_remaining(run_ids: list[str], start_idx: int, status: str, pb: Any = None) -> None:
    """Transition pre-created sweep children that never launched out of 'pending'.

    The /run-sweep handler pre-creates a solver_runs entry per child so the UI
    sees the full sweep immediately. If the sweep is cancelled mid-loop or a
    child raises, those un-launched entries would otherwise sit forever in
    'pending' — visible to the impact-analysis table as ghosts.

    When ``pb`` is provided, the PocketBase row for each orphan is also
    updated so frontend refresh-recovery doesn't see stale 'pending' rows
    after a cancel/crash. PB calls are wrapped in :func:`asyncio.to_thread`
    so the blocking SDK doesn't stall the event loop. PB errors are
    swallowed: this runs in cleanup paths and must not crash the orchestrator.
    """
    for orphan in run_ids[start_idx:]:
        entry = solver_runs.get(orphan)
        if entry is None or entry.get("status") != "pending":
            continue
        entry["status"] = status
        if pb is None:
            continue
        try:
            rec = await asyncio.to_thread(pb.collection(SOLVER_RUNS).get_first_list_item, f'run_id = "{orphan}"')
            await asyncio.to_thread(pb.collection(SOLVER_RUNS).update, rec.id, {"status": status})
        except Exception as e:
            logger.warning("Failed to sync orphan %s to PocketBase: %s", orphan, e)


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
    pb: Any = None,
) -> None:
    """Run each ``(run_id, budget)`` pair sequentially; abort remaining if cancelled.

    ``finally`` releases the sweep_id from the registry so it doesn't leak
    even if a child run raises or validation fails.

    ``pb`` is forwarded to :func:`_mark_remaining` so orphaned sweep children
    have their PocketBase rows transitioned alongside the in-memory dict.
    """
    next_idx = 0
    try:
        # Validation runs inside the try so registry.release() in finally fires
        # even on a length mismatch.
        if len(run_ids) != len(time_budgets):
            raise ValueError("run_ids and time_budgets must be same length")

        for idx, (run_id, budget) in enumerate(zip(run_ids, time_budgets, strict=True)):
            next_idx = idx + 1
            if registry.is_cancelled(sweep_id):
                logger.info("Sweep %s cancelled; aborting remaining runs", sweep_id)
                await _mark_remaining(run_ids, idx, "cancelled", pb=pb)
                break
            try:
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
            except Exception:
                # Child crashed — mark un-launched siblings as failed so they
                # don't sit forever in pending, then re-raise so the caller sees it.
                await _mark_remaining(run_ids, next_idx, "failed", pb=pb)
                raise
    finally:
        registry.release(sweep_id)

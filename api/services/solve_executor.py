"""Run a CP-SAT solve (and its failure diagnostics) as one pure compute unit.

The OR-Tools arena high-water mark never returns to the OS from a long-lived
process (glibc), so every heavy solve permanently ratchets the API container's
RSS — the prod swap incident of 2026-06-12. The compute block here is designed
to execute in a throwaway spawn worker (`run_solve_in_subprocess`) that exits
after one task and hands the entire footprint back to the kernel; the
in-process path (`solve_and_diagnose`) remains available behind the
SOLVER_SUBPROCESS kill-switch.
"""

import asyncio
import multiprocessing
from collections.abc import Callable
from concurrent.futures import ProcessPoolExecutor
from concurrent.futures.process import BrokenProcessPool
from dataclasses import asdict, dataclass
from functools import partial
from typing import Any

from bunking.config import ConfigLoader, StaticConfigService
from bunking.logging_config import get_logger
from bunking.models_v2 import DirectSolverInput, DirectSolverOutput
from bunking.solver import DirectBunkingSolver
from bunking.solver.diagnostics import resolve_localization
from bunking.solver.feasibility import localize_hard_mso_infeasibility
from bunking.solver.impossibility import filter_immaterial_requests

logger = get_logger(__name__)

# Mirrors the literals previously inlined in run_solver_task_v2.
INFEASIBILITY_ANALYSIS_TIME_LIMIT_SECONDS = 10
IIS_PROBE_TIME_LIMIT_SECONDS = 5


@dataclass
class SolveOutcome:
    """Picklable bundle of everything one solve produced.

    ``result is None`` means the solve failed/was infeasible; the diagnostic
    fields are then populated on a best-effort basis (None = that analysis
    step did not run or failed — matching the legacy key-absent semantics in
    ``solver_runs``).
    """

    result: DirectSolverOutput | None
    impossibility_report: dict[str, Any] | None = None
    infeasibility_cause: str | None = None
    parent_paramount_iis: dict[str, Any] | None = None
    localization: dict[str, Any] | None = None


def solve_and_diagnose(
    solver_input: DirectSolverInput,
    time_limit: int,
    debug_constraints: dict[str, Any] | None,
    config_service: ConfigLoader,
) -> SolveOutcome:
    """Run the solver; on failure, run the full diagnostic chain.

    Pure compute: no PocketBase access, no ``solver_runs`` writes — safe to
    execute in a child process. Logic transplanted verbatim from
    run_solver_task_v2 (orchestrator-diagnosis short-circuit, impossibility
    report capture, parent_paramount IIS localization).
    """
    logger.info("Creating DirectBunkingSolver instance")
    if debug_constraints:
        logger.info(f"DEBUG MODE: Constraints disabled: {list(debug_constraints.keys())}")
    solver = DirectBunkingSolver(
        input_data=solver_input,
        config_service=config_service,
        debug_constraints=debug_constraints or {},
    )

    result = solver.solve(time_limit_seconds=time_limit)

    # Stream C: orchestrator returns an empty-assignments DirectSolverOutput
    # with infeasibility_diagnosis on INFEASIBLE (instead of None) so the
    # diagnosis travels with the result. Convert here so the failure path
    # below handles it; surface the diagnosis directly (avoids the redundant
    # find_infeasibility_cause call).
    orchestrator_diagnosis: str | None = None
    if result is not None and not result.assignments and result.infeasibility_diagnosis is not None:
        orchestrator_diagnosis = result.infeasibility_diagnosis
        result = None

    if result is not None:
        return SolveOutcome(result=result)

    outcome = SolveOutcome(result=None)
    logger.warning("Solver failed - running infeasibility analysis...")

    # Surface the already-computed impossibility report (#1638). The solver
    # holds it; immaterial-filter it to match the pre-validate surface.
    try:
        outcome.impossibility_report = asdict(filter_immaterial_requests(solver.impossibility_report))
    except Exception as e:
        logger.error(f"Failed to capture impossibility report: {e}", exc_info=True)

    try:
        if orchestrator_diagnosis is not None:
            cause = orchestrator_diagnosis
            logger.info(f"Using orchestrator-supplied diagnosis: {cause}")
        else:
            cause = solver.find_infeasibility_cause(time_limit_seconds=INFEASIBILITY_ANALYSIS_TIME_LIMIT_SECONDS)
            logger.error(f"Infeasibility analysis result: {cause}")
        outcome.infeasibility_cause = cause

        # If parent_paramount is the cause, localize the conflict to
        # specific campers (see docs/architecture/solver-internals.md).
        if isinstance(cause, str) and "parent_paramount" in cause:
            iis = localize_hard_mso_infeasibility(solver_input, config_service, IIS_PROBE_TIME_LIMIT_SECONDS)
            logger.error(f"Hard-MSO IIS localization: {iis}")
            outcome.parent_paramount_iis = iis
            # Name-resolve for the frontend (#1638).
            outcome.localization = resolve_localization(iis, solver_input.person_by_cm_id)
    except Exception as e:
        logger.error(f"Failed to run infeasibility analysis: {e}", exc_info=True)

    return outcome


class SolverProcessDiedError(RuntimeError):
    """The solver child process terminated without returning (likely OOM-killed)."""


def _child_entry(
    solver_input: DirectSolverInput,
    time_limit: int,
    debug_constraints: dict[str, Any] | None,
    config_values: dict[str, Any],
) -> SolveOutcome:
    """Top-level spawn target: rebuild config from the snapshot, solve, return."""
    config_service = StaticConfigService(config_values)
    return solve_and_diagnose(solver_input, time_limit, debug_constraints, config_service)


async def run_solve_in_subprocess(
    solver_input: DirectSolverInput,
    time_limit: int,
    debug_constraints: dict[str, Any] | None,
    config_values: dict[str, Any],
    _entry: Callable[[DirectSolverInput, int, dict[str, Any] | None, dict[str, Any]], SolveOutcome] = _child_entry,
) -> SolveOutcome:
    """Execute one solve in a fresh spawn worker that exits after the task.

    ``max_tasks_per_child=1`` IS the memory fix: the worker process dies after
    the solve, returning the CP-SAT arena high-water mark to the OS. Spawn (not
    fork): forking a threaded uvicorn process is unsafe, and max_tasks_per_child
    requires a non-fork context anyway. The ~2-4 s import cost per solve is
    noise against 30-300 s solve budgets.

    ``_entry`` is injectable for tests only — production always uses
    ``_child_entry``.
    """
    ctx = multiprocessing.get_context("spawn")
    executor = ProcessPoolExecutor(max_workers=1, max_tasks_per_child=1, mp_context=ctx)
    try:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            executor, partial(_entry, solver_input, time_limit, debug_constraints, config_values)
        )
    except BrokenProcessPool as e:
        raise SolverProcessDiedError(
            "Solver child process died before returning a result — likely OOM-killed. "
            "The API process itself is unaffected; this run is recorded as failed."
        ) from e
    finally:
        executor.shutdown(wait=False, cancel_futures=False)

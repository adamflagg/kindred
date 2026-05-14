"""
Solver Callbacks - Progress monitoring for OR-Tools CP-SAT solver.
"""

from __future__ import annotations

import time

from ortools.sat.python import cp_model

from bunking.logging_config import get_logger

from .logging import ConstraintLogger

logger = get_logger(__name__)

# Safety cap on trajectory length, shared by both capture surfaces
# (objective and best-bound). The callbacks fire on discrete *improvements*
# (realistically tens-to-low-hundreds over a 600 s solve), but a pathological
# model could fire either one far more often — cap rather than let
# `solver_runs.stats` bloat. NOT a lossy throttle: points are only dropped
# once the cap is hit, so the drift invariant (see the Tier 2 spec) holds for
# every point actually recorded.
_MAX_TRAJECTORY_POINTS = 2000


class SolverProgressCallback(cp_model.CpSolverSolutionCallback):  # type: ignore[misc]
    """Callback to log solver progress and record the objective trajectory.

    Records `(t, objective, bound)` for each improving solution. `t` is
    seconds since `start_monotonic`, a shared origin passed by the caller so
    this trajectory and `BestBoundCallback.bound_trajectory` are directly
    comparable.
    """

    def __init__(self, constraint_logger: ConstraintLogger, start_monotonic: float, debug_mode: bool = False) -> None:
        cp_model.CpSolverSolutionCallback.__init__(self)
        self.constraint_logger = constraint_logger
        self.debug_mode = debug_mode
        self.solution_count = 0
        self.start_monotonic = start_monotonic
        self.objective_trajectory: list[dict[str, float]] = []
        self.truncated = False

    def on_solution_callback(self) -> None:
        """Called when a new solution is found."""
        self.solution_count += 1
        elapsed = time.monotonic() - self.start_monotonic
        objective = self.ObjectiveValue()
        bound = self.BestObjectiveBound()
        # Cap the trajectory in lockstep with BestBoundCallback so neither
        # surface can bloat `solver_runs.stats`. Logging below is unaffected.
        if len(self.objective_trajectory) >= _MAX_TRAJECTORY_POINTS:
            self.truncated = True
        else:
            self.objective_trajectory.append({"t": elapsed, "objective": objective, "bound": bound})

        message = f"Solution #{self.solution_count} found after {elapsed:.1f}s - Objective: {objective}"
        self.constraint_logger.log_progress(message)

        # In debug mode, log more details
        if self.debug_mode and self.solution_count <= 5:
            logger.debug(f"  Best bound: {bound}")
            logger.debug(f"  Gap: {abs(objective - bound)}")


class BestBoundCallback:
    """Records the CP-SAT best-objective-bound trajectory.

    Assigned to `solver.best_bound_callback`; CP-SAT invokes it as
    `callback(bound)` on every bound improvement — independent of solution
    discovery, so it keeps sampling through an objective plateau when the
    solution callback goes quiet. Shares its monotonic clock origin with
    `SolverProgressCallback`.
    """

    def __init__(self, start_monotonic: float) -> None:
        self.start_monotonic = start_monotonic
        self.bound_trajectory: list[dict[str, float]] = []
        self.truncated = False

    def __call__(self, bound: float) -> None:
        if len(self.bound_trajectory) >= _MAX_TRAJECTORY_POINTS:
            self.truncated = True
            return
        self.bound_trajectory.append({"t": time.monotonic() - self.start_monotonic, "bound": bound})

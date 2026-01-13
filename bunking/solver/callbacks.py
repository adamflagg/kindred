"""
Solver Callbacks - Progress monitoring for OR-Tools CP-SAT solver.
"""

from __future__ import annotations

import logging
from datetime import datetime

from ortools.sat.python import cp_model

from .logging import ConstraintLogger

logger = logging.getLogger(__name__)


class SolverProgressCallback(cp_model.CpSolverSolutionCallback):
    """Callback to log solver progress in real-time."""

    def __init__(self, constraint_logger: ConstraintLogger, debug_mode: bool = False) -> None:
        cp_model.CpSolverSolutionCallback.__init__(self)
        self.constraint_logger = constraint_logger
        self.debug_mode = debug_mode
        self.solution_count = 0
        self.start_time = datetime.now()

    def on_solution_callback(self) -> None:
        """Called when a new solution is found."""
        self.solution_count += 1
        current_time = datetime.now()
        elapsed = (current_time - self.start_time).total_seconds()

        message = f"Solution #{self.solution_count} found after {elapsed:.1f}s - Objective: {self.ObjectiveValue()}"

        self.constraint_logger.log_progress(message)

        # In debug mode, log more details
        if self.debug_mode and self.solution_count <= 5:
            logger.debug(f"  Best bound: {self.BestObjectiveBound()}")
            logger.debug(f"  Gap: {abs(self.ObjectiveValue() - self.BestObjectiveBound())}")

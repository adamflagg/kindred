"""
Constraint Logger - Logging infrastructure for the solver.

Tracks constraints added, violations, and solver progress.
"""

from __future__ import annotations

import json
import logging
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


class ConstraintLogger:
    """Logger for tracking constraint decisions and violations during solving."""

    def __init__(self, debug_mode: bool = False) -> None:
        self.debug_mode = debug_mode
        self.constraints_added: dict[str, dict[str, list[str]]] = {
            "hard": defaultdict(list),
            "soft": defaultdict(list),
        }
        self.violations: dict[str, list[dict[str, str]]] = defaultdict(list)
        self.feasibility_warnings: list[str] = []
        self.solver_progress: list[str] = []

    def log_constraint(self, mode: str, constraint_type: str, details: str) -> None:
        """Log when a constraint is added to the model."""
        self.constraints_added[mode][constraint_type].append(details)
        if self.debug_mode:
            logger.debug(f"[CONSTRAINT] {mode.upper()} {constraint_type}: {details}")

    def log_feasibility_warning(self, warning: str) -> None:
        """Log potential feasibility issues."""
        self.feasibility_warnings.append(warning)
        logger.warning(f"[FEASIBILITY] {warning}")

    def log_violation(self, constraint_type: str, details: str, severity: str = "info") -> None:
        """Log constraint violations found in solution."""
        self.violations[constraint_type].append({"details": details, "severity": severity})
        if severity == "error":
            logger.error(f"[VIOLATION] {constraint_type}: {details}")
        else:
            logger.info(f"[VIOLATION] {constraint_type}: {details}")

    def log_progress(self, message: str) -> None:
        """Log solver progress."""
        self.solver_progress.append(message)
        if self.debug_mode:
            logger.debug(f"[SOLVER] {message}")

    def get_summary(self) -> dict[str, Any]:
        """Get summary of all logged information."""
        return {
            "constraints_added": dict(self.constraints_added),
            "violations": dict(self.violations),
            "feasibility_warnings": self.feasibility_warnings,
            "solver_progress": self.solver_progress,
        }

    def save_to_file(self, session_id: int, solver_run_id: str | None = None) -> str:
        """Save logs to a file and return the file path."""
        # Create logs directory if it doesn't exist
        logs_dir = Path("logs/solver")
        logs_dir.mkdir(parents=True, exist_ok=True)

        # Generate filename with timestamp
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        run_id_suffix = f"_{solver_run_id}" if solver_run_id else ""
        filename = f"session_{session_id}_solver_log_{timestamp}{run_id_suffix}.json"
        filepath = logs_dir / filename

        # Prepare log data
        log_data = {
            "timestamp": datetime.now().isoformat(),
            "session_id": session_id,
            "solver_run_id": solver_run_id,
            "debug_mode": self.debug_mode,
            "summary": self.get_summary(),
            "detailed_logs": {
                "constraints": self.constraints_added,
                "violations": self.violations,
                "feasibility_warnings": self.feasibility_warnings,
                "solver_progress": self.solver_progress,
            },
        }

        # Write to file
        with open(filepath, "w") as f:
            json.dump(log_data, f, indent=2, default=str)

        logger.info(f"Solver logs saved to {filepath}")
        return str(filepath)

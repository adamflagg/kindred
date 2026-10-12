"""
Constraint Logger - Logging infrastructure for the solver.

Tracks constraints added, violations, and solver progress.
"""

import json
import os
import re
import stat
import time
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from bunking.logging_config import get_logger

logger = get_logger(__name__)

# Run logs older than this are deleted each time a new one is written, and once
# when the API starts (api/main.py lifespan), so the off-season clears them too.
# They sit on a persisted volume outside the app's RBAC, so they must not pile up
# forever.
SOLVER_LOG_RETENTION_DAYS = 30

# Relative to the API's working directory, which is the persisted logs volume's parent.
SOLVER_LOGS_DIR = Path("logs/solver")

# Exactly what save_to_file writes: session_<id>_solver_log_<YYYYmmdd_HHMMSS>[_<run id>].json
_SOLVER_LOG_NAME = re.compile(r"session_-?\d+_solver_log_\d{8}_\d{6}(?:_[A-Za-z0-9-]+)?\.json")


def prune_solver_logs(logs_dir: Path, now: float | None = None, max_age_days: int = SOLVER_LOG_RETENTION_DAYS) -> int:
    """Delete solver run logs in ``logs_dir`` whose mtime is older than ``max_age_days``.

    Only regular files directly inside ``logs_dir`` whose name matches the run-log
    pattern are considered: symlinks, subdirectories and other files are never
    touched. Never raises -- a failure is logged by exception type and the solve
    that triggered the prune carries on. Returns the number of files deleted.
    """
    cutoff = (time.time() if now is None else now) - max_age_days * 86_400
    deleted = failed = 0
    last_error = ""
    try:
        with os.scandir(logs_dir) as entries:
            for entry in entries:
                if not _SOLVER_LOG_NAME.fullmatch(entry.name):
                    continue
                try:
                    st = entry.stat(follow_symlinks=False)
                    if not stat.S_ISREG(st.st_mode) or st.st_mtime >= cutoff:
                        continue
                    Path(entry.path).unlink()
                    deleted += 1
                except OSError as e:
                    failed += 1
                    last_error = type(e).__name__
    except FileNotFoundError:
        return 0
    except Exception as e:
        logger.warning(f"Solver log pruning failed: {type(e).__name__}")
        return deleted
    if failed:
        logger.warning(f"Solver log pruning could not delete {failed} file(s): {last_error}")
    return deleted


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
        logs_dir = SOLVER_LOGS_DIR
        logs_dir.mkdir(parents=True, exist_ok=True)

        # Generate filename with timestamp
        timestamp = datetime.now(tz=UTC).strftime("%Y%m%d_%H%M%S")
        run_id_suffix = f"_{solver_run_id}" if solver_run_id else ""
        filename = f"session_{session_id}_solver_log_{timestamp}{run_id_suffix}.json"
        filepath = logs_dir / filename

        # Prepare log data
        log_data = {
            "timestamp": datetime.now(tz=UTC).isoformat(),
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
        prune_solver_logs(logs_dir)
        return str(filepath)

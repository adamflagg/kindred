"""
Bunking Solver - OR-Tools constraint satisfaction solver for cabin assignments.

This package contains:
- DirectBunkingSolver: Main solver class for optimizing bunk assignments
- ConstraintLogger: Logging for constraint tracking
- SolverProgressCallback: Real-time solver progress monitoring
- Constraint builders: Modular constraint implementations
- Preprocessing: Friend group detection and splitting
- Solution analysis: Post-solve result analysis
"""

from .callbacks import SolverProgressCallback
from .direct_solver import DirectBunkingSolver
from .logging import ConstraintLogger
from .solution import (
    analyze_bunk_health,
    analyze_level_progressions,
    analyze_solution,
    calculate_field_level_stats,
    calculate_satisfied_requests,
    get_bunk_name,
)

__all__ = [
    "ConstraintLogger",
    "DirectBunkingSolver",
    "SolverProgressCallback",
    # Solution analysis functions
    "analyze_bunk_health",
    "analyze_level_progressions",
    "analyze_solution",
    "calculate_field_level_stats",
    "calculate_satisfied_requests",
    "get_bunk_name",
]

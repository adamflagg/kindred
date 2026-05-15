"""
Bunking Solver - OR-Tools constraint satisfaction solver for cabin assignments.

This package contains:
- DirectBunkingSolver: Main solver class for optimizing bunk assignments
- ConstraintLogger: Logging for constraint tracking
- SolverProgressCallback: Real-time solver progress monitoring
- Constraint builders: Modular constraint implementations
- Preprocessing: Friend group detection and splitting
"""

from .callbacks import SolverProgressCallback
from .direct_solver import DirectBunkingSolver
from .logging import ConstraintLogger

__all__ = [
    "ConstraintLogger",
    "DirectBunkingSolver",
    "SolverProgressCallback",
]

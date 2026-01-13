"""
Backward compatibility shim for bunking.direct_solver imports.

The solver has been moved to bunking.solver.direct_solver.
Models have been moved to bunking.models_v2.
This module re-exports everything for backward compatibility.

New code should use:
    from bunking.solver import DirectBunkingSolver
    from bunking.models_v2 import DirectBunk, DirectPerson, etc.
"""

from bunking.models_v2 import (
    DirectBunk,
    DirectBunkAssignment,
    DirectBunkRequest,
    DirectPerson,
    DirectSolverInput,
    DirectSolverOutput,
    HistoricalBunkingRecord,
)
from bunking.solver import (
    ConstraintLogger,
    DirectBunkingSolver,
    SolverProgressCallback,
)

__all__ = [
    "ConstraintLogger",
    "DirectBunk",
    "DirectBunkAssignment",
    "DirectBunkingSolver",
    "DirectBunkRequest",
    "DirectPerson",
    "DirectSolverInput",
    "DirectSolverOutput",
    "HistoricalBunkingRecord",
    "SolverProgressCallback",
]

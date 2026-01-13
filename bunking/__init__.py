"""
Bunking - Core business logic for camp bunk assignment optimization.

This package contains:
- models: Domain models (Person, Bunk, Session, etc.)
- solver: OR-Tools constraint satisfaction solver
- graph: Social graph analysis
- bunking_validator: Assignment validation
"""

# Re-export solver components for backward compatibility
# Old import: from bunking.direct_solver import DirectBunkingSolver
# New import: from bunking.solver import DirectBunkingSolver
from bunking.models_v2 import (
    DirectBunk,
    DirectBunkAssignment,
    DirectBunkRequest,
    DirectPerson,
    DirectSolverInput,
    DirectSolverOutput,
)
from bunking.solver.callbacks import SolverProgressCallback
from bunking.solver.direct_solver import DirectBunkingSolver
from bunking.solver.logging import ConstraintLogger

__all__ = [
    "ConstraintLogger",
    "DirectBunk",
    "DirectBunkAssignment",
    "DirectBunkingSolver",
    "DirectBunkRequest",
    "DirectPerson",
    "DirectSolverInput",
    "DirectSolverOutput",
    "SolverProgressCallback",
]

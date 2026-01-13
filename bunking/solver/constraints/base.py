"""
Base types and context for constraint builders.

Provides the SolverContext dataclass that holds all state needed by constraint modules.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Protocol

from ortools.sat.python import cp_model

if TYPE_CHECKING:
    from bunking.config import ConfigLoader
    from bunking.models_v2 import DirectBunk, DirectBunkRequest, DirectPerson, DirectSolverInput
    from bunking.solver.logging import ConstraintLogger


@dataclass
class SolverContext:
    """
    Shared context passed to all constraint builders.

    This encapsulates all the solver state that constraint modules need to add
    their constraints to the model.
    """

    # Core CP-SAT model
    model: cp_model.CpModel

    # Decision variables
    # assignments[(person_idx, bunk_idx)] = BoolVar (1 if person in bunk)
    assignments: dict[tuple[int, int], cp_model.IntVar]
    # person_bunk_assignment[person_idx] = IntVar (which bunk index)
    person_bunk_assignment: dict[int, cp_model.IntVar]

    # Person data
    person_ids: list[int]  # Sorted list of person CampMinder IDs
    person_idx_map: dict[int, int]  # cm_id -> idx
    persons: list[DirectPerson]  # Person objects (from input.persons)
    person_by_cm_id: dict[int, DirectPerson]  # cm_id -> DirectPerson

    # Bunk data
    bunks: list[DirectBunk]  # Sorted bunk objects
    bunk_idx_map: dict[int, int]  # cm_id -> idx

    # Request data
    requests_by_person: dict[int, list[DirectBunkRequest]]  # cm_id -> requests
    possible_requests: dict[int, list[DirectBunkRequest]]  # cm_id -> satisfiable requests
    impossible_requests: dict[int, list[DirectBunkRequest]]  # cm_id -> unsatisfiable requests

    # Full input data (for complex constraints that need more context)
    input: DirectSolverInput

    # Configuration service
    config: ConfigLoader

    # Logging
    constraint_logger: ConstraintLogger

    # Debug settings
    debug_constraints: dict[str, bool] = field(default_factory=dict)

    # Soft constraint tracking
    soft_constraint_violations: dict[str, Any] = field(default_factory=dict)

    def is_constraint_disabled(self, constraint_name: str) -> bool:
        """Check if a constraint is disabled in debug mode."""
        return self.debug_constraints.get(constraint_name, False)

    def get_person_by_idx(self, idx: int) -> DirectPerson:
        """Get person object by solver index."""
        cm_id = self.person_ids[idx]
        return self.person_by_cm_id[cm_id]

    def get_bunk_by_idx(self, idx: int) -> DirectBunk:
        """Get bunk object by solver index."""
        return self.bunks[idx]


class ConstraintBuilder(Protocol):
    """
    Protocol for constraint builder functions/classes.

    Constraint builders can be either:
    1. Functions: add_gender_constraints(ctx: SolverContext) -> None
    2. Classes with __call__: GenderConstraints()(ctx)

    Both patterns are supported - use whichever is cleaner for the constraint.
    """

    def __call__(self, ctx: SolverContext) -> None:
        """Add constraints to the model using the provided context."""
        ...


class ObjectiveBuilder(Protocol):
    """
    Protocol for objective term builders.

    Returns a list of (variable, weight) tuples to be added to the objective.
    """

    def __call__(self, ctx: SolverContext) -> list[tuple[cp_model.IntVar, int]]:
        """Build objective terms and return (variable, weight) pairs."""
        ...

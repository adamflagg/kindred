"""
Constraint builders for the bunking solver.

Each module contains constraint logic that can be added to the CP-SAT model.
"""

from .age_grade_flow import add_age_grade_flow_objective
from .age_preference import add_age_preference_penalties, add_age_preference_satisfaction_vars
from .base import ConstraintBuilder, ObjectiveBuilder, SolverContext
from .bunk_requests import add_bunk_request_satisfaction_vars
from .cabin_capacity import add_cabin_capacity_constraints, add_cabin_capacity_soft_constraint
from .cabin_occupancy import (
    add_cabin_minimum_occupancy_constraints,
    add_cabin_minimum_occupancy_soft_penalty,
)
from .grade_adjacency import add_grade_adjacency_constraints
from .grade_spread import add_grade_spread_constraints, add_grade_spread_soft_constraint

__all__ = [
    "ConstraintBuilder",
    "ObjectiveBuilder",
    "SolverContext",
    "add_age_grade_flow_objective",
    "add_age_preference_penalties",
    "add_age_preference_satisfaction_vars",
    "add_bunk_request_satisfaction_vars",
    "add_cabin_capacity_constraints",
    "add_cabin_capacity_soft_constraint",
    "add_cabin_minimum_occupancy_constraints",
    "add_cabin_minimum_occupancy_soft_penalty",
    "add_grade_adjacency_constraints",
    "add_grade_spread_constraints",
    "add_grade_spread_soft_constraint",
]

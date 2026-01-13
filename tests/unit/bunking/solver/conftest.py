"""
Shared fixtures for solver constraint unit tests.

Provides minimal SolverContext creation for fast, isolated constraint testing.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any, cast

import pytest
from ortools.sat.python import cp_model

from bunking.models_v2 import (
    DirectBunk,
    DirectBunkRequest,
    DirectPerson,
    DirectSolverInput,
)
from bunking.solver.constraints.base import SolverContext
from bunking.solver.logging import ConstraintLogger

# Type alias for config values
ConfigValue = int | float | str | bool


def is_optimal_or_feasible(status: Any) -> bool:
    """Check if solver status is optimal or feasible.

    Works around mypy comparison-overlap issue with CpSolverStatus vs ValueType.
    At runtime status is an int enum value.
    """
    # Cast to int for comparison since OR-Tools CpSolverStatus is an int-compatible enum
    int_status = cast(int, status)
    return int_status in (cp_model.OPTIMAL, cp_model.FEASIBLE)


def is_infeasible(status: Any) -> bool:
    """Check if solver status is infeasible.

    Works around mypy comparison-overlap issue with CpSolverStatus vs ValueType.
    """
    int_status = cast(int, status)
    return int_status == cp_model.INFEASIBLE


class MinimalConfigLoader:
    """Minimal config loader for constraint tests."""

    def __init__(self, overrides: dict[str, ConfigValue] | None = None):
        self._defaults: dict[str, ConfigValue] = {
            "constraint.grade_spread.mode": "soft",
            "constraint.grade_spread.max": 2,
            "constraint.grade_spread.max_spread": 2,
            "constraint.grade_spread.penalty": 3000,
            "constraint.cabin_capacity.mode": "hard",
            "constraint.cabin_capacity.max": 14,
            "constraint.cabin_capacity.standard": 12,
            "constraint.cabin_capacity.penalty": 3000,
            "constraint.grade_ratio.max_percentage": 67,
            "constraint.grade_ratio.penalty": 1000,
            "constraint.age_spread.max_months": 24,
            "constraint.age_spread.penalty": 1500,
        }
        if overrides:
            self._defaults.update(overrides)

    def get(self, key: str) -> ConfigValue | None:
        return self._defaults.get(key)

    def get_int(self, key: str, default: int = 0) -> int:
        value = self._defaults.get(key)
        if value is None:
            return default
        if isinstance(value, int):
            return value
        return int(str(value))

    def get_float(self, key: str, default: float = 0.0) -> float:
        value = self._defaults.get(key)
        if value is None:
            return default
        if isinstance(value, float | int):
            return float(value)
        return float(str(value))

    def get_bool(self, key: str, default: bool = False) -> bool:
        value = self._defaults.get(key)
        if value is None:
            return default
        if isinstance(value, bool):
            return value
        return str(value).lower() in ("true", "1", "yes", "on")

    def get_str(self, key: str, default: str = "") -> str:
        value = self._defaults.get(key)
        return str(value) if value is not None else default

    def get_constraint(self, constraint_type: str, param: str, default: int = 0) -> int:
        """Get constraint parameter value."""
        key = f"constraint.{constraint_type}.{param}"
        return self.get_int(key, default)


def create_person(
    cm_id: int,
    first_name: str,
    last_name: str,
    gender: str | None,
    grade: int,
    session_cm_id: int = 1000,
    birthdate: str = "2013-06-15",
) -> DirectPerson:
    """Create a test person with sensible defaults."""
    return DirectPerson(
        campminder_person_id=cm_id,
        first_name=first_name,
        last_name=last_name,
        gender=gender,
        grade=grade,
        birthdate=birthdate,
        session_cm_id=session_cm_id,
    )


def create_bunk(
    cm_id: int,
    name: str,
    gender: str | None,
    capacity: int = 12,
    session_cm_id: int = 1000,
) -> DirectBunk:
    """Create a test bunk with sensible defaults."""
    return DirectBunk(
        id=f"bunk-{cm_id}",
        campminder_id=cm_id,
        name=name,
        gender=gender,
        capacity=capacity,
        session_cm_id=session_cm_id,
    )


def create_request(
    request_id: str,
    requester_cm_id: int,
    requested_cm_id: int | None,
    request_type: str,
    session_cm_id: int = 1000,
    priority: int = 5,
) -> DirectBunkRequest:
    """Create a test bunk request."""
    return DirectBunkRequest(
        id=request_id,
        requester_person_cm_id=requester_cm_id,
        requested_person_cm_id=requested_cm_id,
        request_type=request_type,
        priority=priority,
        session_cm_id=session_cm_id,
        year=2025,
        confidence_score=1.0,
        status="pending",
    )


def build_solver_context(
    persons: list[DirectPerson],
    bunks: list[DirectBunk],
    requests: list[DirectBunkRequest] | None = None,
    config_overrides: dict[str, ConfigValue] | None = None,
    debug_constraints: dict[str, bool] | None = None,
) -> SolverContext:
    """
    Build a minimal SolverContext for constraint testing.

    This creates the full CP-SAT model with decision variables,
    ready to have constraints applied.
    """
    requests = requests or []
    model = cp_model.CpModel()

    # Sort and index persons
    person_ids = sorted([p.campminder_person_id for p in persons])
    person_idx_map = {cm_id: idx for idx, cm_id in enumerate(person_ids)}
    person_by_cm_id = {p.campminder_person_id: p for p in persons}

    # Sort and index bunks
    bunks_sorted = sorted(bunks, key=lambda b: b.campminder_id)
    bunk_idx_map = {b.campminder_id: idx for idx, b in enumerate(bunks_sorted)}

    # Create decision variables
    assignments: dict[tuple[int, int], cp_model.IntVar] = {}
    person_bunk_assignment: dict[int, cp_model.IntVar] = {}

    for person_idx in range(len(person_ids)):
        for bunk_idx in range(len(bunks_sorted)):
            var = model.NewBoolVar(f"assign_p{person_idx}_b{bunk_idx}")
            assignments[(person_idx, bunk_idx)] = var

        # IntVar for which bunk this person is assigned to
        person_bunk_var = model.NewIntVar(0, len(bunks_sorted) - 1, f"bunk_for_p{person_idx}")
        person_bunk_assignment[person_idx] = person_bunk_var

        # Link IntVar to BoolVars
        for bunk_idx in range(len(bunks_sorted)):
            model.Add(person_bunk_var == bunk_idx).OnlyEnforceIf(assignments[(person_idx, bunk_idx)])

    # Each person assigned to exactly one bunk
    for person_idx in range(len(person_ids)):
        model.Add(sum(assignments[(person_idx, bunk_idx)] for bunk_idx in range(len(bunks_sorted))) == 1)

    # Group requests by person
    requests_by_person: dict[int, list[DirectBunkRequest]] = defaultdict(list)
    for req in requests:
        requests_by_person[req.requester_person_cm_id].append(req)

    # Create solver input
    solver_input = DirectSolverInput(
        persons=persons,
        bunks=bunks_sorted,
        requests=requests,
        existing_assignments=[],
        historical_bunking=[],
    )

    return SolverContext(
        model=model,
        assignments=assignments,
        person_bunk_assignment=person_bunk_assignment,
        person_ids=person_ids,
        person_idx_map=person_idx_map,
        persons=persons,
        person_by_cm_id=person_by_cm_id,
        bunks=bunks_sorted,
        bunk_idx_map=bunk_idx_map,
        requests_by_person=dict(requests_by_person),
        possible_requests=dict(requests_by_person),
        impossible_requests={},
        input=solver_input,
        config=MinimalConfigLoader(config_overrides),  # type: ignore[arg-type]
        constraint_logger=ConstraintLogger(debug_mode=False),
        debug_constraints=debug_constraints or {},
        soft_constraint_violations={},
    )


@pytest.fixture
def male_camper() -> DirectPerson:
    """A male camper for testing."""
    return create_person(
        cm_id=1001,
        first_name="John",
        last_name="Doe",
        gender="M",
        grade=5,
    )


@pytest.fixture
def female_camper() -> DirectPerson:
    """A female camper for testing."""
    return create_person(
        cm_id=1002,
        first_name="Jane",
        last_name="Smith",
        gender="F",
        grade=5,
    )


@pytest.fixture
def male_bunk() -> DirectBunk:
    """A male cabin for testing."""
    return create_bunk(
        cm_id=2001,
        name="B-1",
        gender="M",
    )


@pytest.fixture
def female_bunk() -> DirectBunk:
    """A female cabin for testing."""
    return create_bunk(
        cm_id=2002,
        name="G-1",
        gender="F",
    )


@pytest.fixture
def mixed_bunk() -> DirectBunk:
    """A mixed/AG cabin for testing."""
    return create_bunk(
        cm_id=2003,
        name="AG-1",
        gender="Mixed",
    )


@pytest.fixture
def basic_context_male_female(
    male_camper: DirectPerson,
    female_camper: DirectPerson,
    male_bunk: DirectBunk,
    female_bunk: DirectBunk,
) -> SolverContext:
    """Basic context with 1 male, 1 female camper and gender-segregated bunks."""
    return build_solver_context(
        persons=[male_camper, female_camper],
        bunks=[male_bunk, female_bunk],
    )

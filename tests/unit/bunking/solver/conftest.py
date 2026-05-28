"""
Shared fixtures for solver constraint unit tests.

Provides minimal SolverContext creation for fast, isolated constraint testing.
"""

from collections import defaultdict
from typing import Any, cast

import pytest
from ortools.sat.python import cp_model

from bunking.config.errors import UnknownKeyError
from bunking.models import RequestType
from bunking.models_v2 import (
    DirectBunk,
    DirectBunkRequest,
    DirectPerson,
    DirectSolverInput,
)
from bunking.satisfaction.bucket import compute_material_request_ids
from bunking.solver.constraints.base import SolverContext
from bunking.solver.logging import ConstraintLogger

# Type alias for config values
ConfigValue = int | float | str | bool

# Fictional camper names for test rosters (CLAUDE.md: no real names in code or
# tests). Indexed by roster position so a roster of N campers gets N distinct
# fictional names. 27 entries cover the largest roster in the solver suites.
FICTIONAL_CAMPER_NAMES: list[tuple[str, str]] = [
    ("Emma", "Johnson"),
    ("Liam", "Garcia"),
    ("Olivia", "Chen"),
    ("Riley", "Sam"),
    ("Samuel", "Johnson"),
    ("Noah", "Martinez"),
    ("Ava", "Patel"),
    ("Mason", "Nguyen"),
    ("Sophia", "Kim"),
    ("Lucas", "Brown"),
    ("Isabella", "Davis"),
    ("Ethan", "Lopez"),
    ("Mia", "Wilson"),
    ("Logan", "Anderson"),
    ("Charlotte", "Thomas"),
    ("Jackson", "Taylor"),
    ("Amelia", "Moore"),
    ("Aiden", "Jackson"),
    ("Harper", "White"),
    ("Elijah", "Harris"),
    ("Evelyn", "Clark"),
    ("James", "Lewis"),
    ("Abigail", "Walker"),
    ("Benjamin", "Hall"),
    ("Emily", "Young"),
    ("Henry", "King"),
    ("Ella", "Wright"),
]


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
    return bool(int_status == cp_model.INFEASIBLE)


class MinimalConfigLoader:
    """Minimal config loader for constraint tests."""

    def __init__(self, overrides: dict[str, ConfigValue] | None = None):
        self._defaults: dict[str, ConfigValue] = {
            "constraint.cabin_capacity.mode": "hard",
            "constraint.cabin_capacity.max": 14,
            "constraint.cabin_capacity.standard": 12,
            "constraint.cabin_capacity.penalty": 3000,
            # grade_ratio.{max_percentage, penalty} + age_grade_flow.weight
            # removed in Grade Ratio Phase 2 (hardcoded constants).
            "constraint.age_spread.preferred_bonus": 0,
            "constraint.must_satisfy_one.penalty": 100000,
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

    def get_soft_constraint_weight(self, constraint_name: str) -> int:
        """Get soft constraint weight value for the given constraint.

        Mirrors ``ConfigLoader.get_soft_constraint_weight`` in production —
        keep this dict in sync so test code can't silently pass on a key
        that production now resolves to ``UnknownKeyError``.
        """
        weight_mappings: dict[str, str] = {
            # age_spread, grade_spread, must_satisfy_one, age_grade_flow, and
            # grade_cohesion all removed in Phase 2 — see ``bunking/config/loader.py``
            # for the production mapping. The mechanism (fall through to
            # ``constraint.<name>.weight`` and fail loudly) is retained.
        }
        key = weight_mappings.get(constraint_name, f"constraint.{constraint_name}.weight")
        # Mirror production: a missing key raises rather than silently returning
        # 0, so a config-key regression can't slip through a constraint test.
        if self.get(key) is None:
            raise UnknownKeyError(f"Unknown config key: '{key}'")
        return self.get_int(key)


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
    request_type: RequestType,
    session_cm_id: int = 1000,
    priority: int = 5,
) -> DirectBunkRequest:
    """Create a test bunk request."""
    return DirectBunkRequest(
        id=request_id,
        requester_person_cm_id=requester_cm_id,
        requested_person_cm_id=requested_cm_id,
        request_type=request_type.value,
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
    allow_overflow: bool = False,
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

    # Compute contextual material set (mirrors _validate_requests in the real solver).
    # Tests that want to exercise suppression can override ctx.material_request_ids
    # after calling build_solver_context.
    material_ids = compute_material_request_ids(dict(requests_by_person), impossible_request_ids=set())

    # Create solver input
    solver_input = DirectSolverInput(
        persons=persons,
        bunks=bunks_sorted,
        requests=requests,
        existing_assignments=[],
        historical_bunking=[],
        allow_overflow=allow_overflow,
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
        material_request_ids=material_ids,
    )


def build_direct_solver_input(
    persons: list[DirectPerson],
    bunks: list[DirectBunk],
    requests: list[DirectBunkRequest] | None = None,
    allow_overflow: bool = False,
) -> DirectSolverInput:
    """Build a DirectSolverInput for tests that exercise the full solver
    (DirectBunkingSolver.solve) rather than a single constraint module."""
    return DirectSolverInput(
        persons=persons,
        bunks=sorted(bunks, key=lambda b: b.campminder_id),
        requests=requests or [],
        existing_assignments=[],
        historical_bunking=[],
        allow_overflow=allow_overflow,
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


# ---------------------------------------------------------------------------
# Helpers for building material parent requests in integration tests.
# Materiality requires source_field="bunk_request_form" (MATERIAL_PARENT bucket)
# and status="resolved". For age_preference to be material the camper must have
# no other resolved-and-possible bunk_request_form BUNK_WITH/NOT_BUNK_WITH
# request (#1664 suppression rule).
# ---------------------------------------------------------------------------

_req_counter: list[int] = [0]


def _next_req_id() -> str:
    _req_counter[0] += 1
    return f"req-{_req_counter[0]:04d}"


def add_material_request(
    solver_input: DirectSolverInput,
    requester: DirectPerson,
    target: DirectPerson,
    request_type: str = "bunk_with",
) -> DirectBunkRequest:
    """Append a material-parent bunk_with/not_bunk_with request to solver_input.requests.

    source_field="bunk_request_form" makes it MATERIAL_PARENT per the registry.
    status="resolved" is required by compute_material_request_ids.
    """
    req = DirectBunkRequest(
        id=_next_req_id(),
        requester_person_cm_id=requester.campminder_person_id,
        requested_person_cm_id=target.campminder_person_id,
        request_type=request_type,
        source_field="bunk_request_form",
        status="resolved",
        session_cm_id=requester.session_cm_id,
        year=2026,
        is_first_requested=True,
    )
    solver_input.requests.append(req)
    return req


def add_material_age_preference(
    solver_input: DirectSolverInput,
    requester: DirectPerson,
    target: str,
) -> DirectBunkRequest:
    """Append a material-parent age_preference request to solver_input.requests.

    For this to be material the camper must have no other resolved+possible
    bunk_request_form BUNK_WITH/NOT_BUNK_WITH requests (the #1664 suppression
    rule). In a clean test fixture that has no prior requests for this camper,
    this request is material by default.
    """
    req = DirectBunkRequest(
        id=_next_req_id(),
        requester_person_cm_id=requester.campminder_person_id,
        requested_person_cm_id=None,
        request_type="age_preference",
        age_preference_target=target,
        source_field="bunk_request_form",
        status="resolved",
        session_cm_id=requester.session_cm_id,
        year=2026,
        is_first_requested=True,
    )
    solver_input.requests.append(req)
    return req

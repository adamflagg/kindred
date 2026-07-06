"""AG-session campers get no age-preference solver representation (#1752 follow-up).

AG cabin membership is enrollment-driven: everyone in AG session X lands in
that session's AG cabin. Preferences don't drive AG placement, so
``add_age_preference_satisfaction_vars`` must build nothing for requests from
AG-session campers — no sat var, no forcing indicators. Otherwise
``parent_paramount`` would turn an MP age_preference into a hard
must-satisfy-one constraint over per-bunk cleanliness vars that AG bunks
(unlike grade_spread/grade_adjacency/cabin_occupancy, which exempt AG bunks
per-bunk) never opt out of — risking INFEASIBLE with no diagnostic, since the
impossibility pre-check also skips AG sessions and so never records the
request as impossible.

CRITICAL SCOPING NOTE: production solves are never AG-only. A main session and
its related AG session are fetched together into ONE DirectSolverInput
(api/services/solver_runner.py: "Main + AG sessions are automatically fetched
together via get_related_session_ids"), so ``ctx.bunks`` mixes non-AG and AG
bunks. The skip must therefore be scoped per requester's own session — a
whole-solve ``is_ag_session(ctx.bunks)`` check would never fire in the
combined topology. The fixtures here use the combined main+AG shape for
exactly that reason.

The post-solve diagnostic must agree: an AG camper's unsatisfied MP
age_preference is deliberately unenforced, so it must not trip
``material_parent_unmet`` / ``mp_constraint_bug_signal`` (the "hard constraint
failed to bind" alarm).
"""

from collections.abc import Generator
from typing import Any, ClassVar
from unittest.mock import MagicMock

import pytest

from bunking.config import ConfigLoader
from bunking.models_v2 import DirectBunkAssignment
from bunking.solver.constraints.age_preference import add_age_preference_satisfaction_vars
from bunking.solver.direct_solver import DirectBunkingSolver
from tests.unit.solver.impossibility.conftest import (
    make_bunk,
    make_input,
    make_person,
    make_request,
)

AG_SESSION = 100
MAIN_SESSION = 200


class _PenaltyStubLoader:
    """Penalty accessors that read via ``ConfigLoader.get_instance()`` need a
    real-ish object (mirrors test_impossible_request_no_sat_var.py)."""

    _values: ClassVar[dict[str, int]] = {
        "constraint.cabin_minimum_occupancy.penalty": 0,
        "constraint.grade_spread.penalty": 0,
    }

    def get_int(self, key: str, default: int | None = None) -> int:
        v = self._values.get(key)
        return int(v) if v is not None else (default if default is not None else 0)

    def get_float(self, key: str, default: float | None = None) -> float:
        v = self._values.get(key)
        return float(v) if v is not None else (default if default is not None else 0.0)


@pytest.fixture
def mock_config() -> Generator[Any]:
    cfg = MagicMock()

    def _get_constraint(constraint_type: str, param: str, default: Any = None) -> Any:
        if constraint_type == "grade_spread" and param == "max_spread":
            return 2
        return default if default is not None else 0

    def _get_int(key: str, default: Any = None) -> Any:
        return default if default is not None else 0

    def _get_float(key: str, default: Any = None) -> Any:
        return default if default is not None else 0.0

    def _get_str(key: str, default: Any = None) -> Any:
        if "grade_spread.mode" in key:
            return "hard"
        return default if default is not None else ""

    def _get_bool(key: str, default: Any = None) -> Any:
        return default if default is not None else False

    def _get_priority(priority_type: str, subtype: str = "default") -> int:
        return 4

    def _get_soft_constraint_weight(constraint_name: str) -> int:
        return 0

    cfg.get_constraint.side_effect = _get_constraint
    cfg.get_int.side_effect = _get_int
    cfg.get_float.side_effect = _get_float
    cfg.get_str.side_effect = _get_str
    cfg.get_bool.side_effect = _get_bool
    cfg.get_priority.side_effect = _get_priority
    cfg.get_soft_constraint_weight.side_effect = _get_soft_constraint_weight

    with ConfigLoader.use(_PenaltyStubLoader()):  # type: ignore[arg-type]
        yield cfg


def _combined_main_ag_input(requests: list[Any]) -> Any:
    """The production topology: one solve holding a main session's non-AG bunks
    AND its related AG session's cabins (several — the #1800 shape).

    AG session 100: campers 1 (grade 6), 2 (grade 5), 3 (grade 7).
    Main session 200: campers 4 (grade 6), 5 (grade 5), 6 (grade 7).
    """
    persons = [
        make_person(1, session=AG_SESSION, gender="F", grade=6),
        make_person(2, session=AG_SESSION, gender="F", grade=5),
        make_person(3, session=AG_SESSION, gender="F", grade=7),
        make_person(4, session=MAIN_SESSION, gender="F", grade=6),
        make_person(5, session=MAIN_SESSION, gender="F", grade=5),
        make_person(6, session=MAIN_SESSION, gender="F", grade=7),
    ]
    bunks = [
        make_bunk(10, session=AG_SESSION, gender="AG", name="AG Cabin 3"),
        make_bunk(20, session=AG_SESSION, gender="AG", name="AG Cabin 4"),
        make_bunk(30, session=MAIN_SESSION, gender="F"),
        make_bunk(40, session=MAIN_SESSION, gender="F"),
    ]
    return make_input(persons, bunks, requests)


def _ag_age_req() -> Any:
    return make_request(
        "agr1",
        requester=1,
        requestee=None,
        request_type="age_preference",
        age_preference_target="younger",
        source_field="bunk_request_form",  # MATERIAL_PARENT bucket
        session=AG_SESSION,
    )


def _main_age_req() -> Any:
    return make_request(
        "mainr1",
        requester=4,
        requestee=None,
        request_type="age_preference",
        age_preference_target="younger",
        source_field="bunk_request_form",
        session=MAIN_SESSION,
    )


def test_ag_camper_in_combined_solve_builds_no_sat_vars(mock_config: Any) -> None:
    """Direct unit: in the combined main+AG solve, a request from an AG-session
    camper gets no forcing indicators and no sat var — the skip must key off the
    requester's own session, not the whole solve's bunk list."""
    ag_req = _ag_age_req()
    input_data = _combined_main_ag_input([ag_req])
    solver = DirectBunkingSolver(input_data, config_service=mock_config)
    ctx = solver._build_solver_context()

    forcing = add_age_preference_satisfaction_vars(ctx, {1: [ag_req]})

    assert forcing == {}
    assert ag_req.id not in ctx.request_satisfied_vars


def test_main_camper_in_combined_solve_still_builds_sat_vars(mock_config: Any) -> None:
    """Control: the AG skip must not over-fire — a main-session camper in the
    same combined solve still gets a sat var and forcing indicators."""
    main_req = _main_age_req()
    input_data = _combined_main_ag_input([main_req])
    solver = DirectBunkingSolver(input_data, config_service=mock_config)
    ctx = solver._build_solver_context()

    forcing = add_age_preference_satisfaction_vars(ctx, {4: [main_req]})

    assert main_req.id in forcing
    assert forcing[main_req.id] != []
    assert main_req.id in ctx.request_satisfied_vars


def test_combined_solve_no_model_vars_for_ag_request(mock_config: Any) -> None:
    """End-to-end through add_constraints (which runs parent_paramount): the AG
    camper's request leaves no ``age_req_<id>_*`` trace in the model proto,
    while the main-session camper's request still does."""
    ag_req = _ag_age_req()
    main_req = _main_age_req()
    input_data = _combined_main_ag_input([ag_req, main_req])
    solver = DirectBunkingSolver(input_data, config_service=mock_config)

    solver.add_constraints()
    solver.add_objective()

    var_names = [v.name for v in solver.model.Proto().variables]
    ag_vars = [n for n in var_names if f"age_req_{ag_req.id}" in n]
    main_vars = [n for n in var_names if f"age_req_{main_req.id}" in n]
    assert ag_vars == [], f"AG-session camper's request built solver vars: {ag_vars}"
    assert main_vars != [], "main-session camper's request lost its solver representation"


def test_standalone_ag_solve_builds_no_sat_vars(mock_config: Any) -> None:
    """The standalone all-AG shape (an AG session solved by itself) skips too."""
    ag_req = _ag_age_req()
    persons = [
        make_person(1, session=AG_SESSION, gender="F", grade=6),
        make_person(3, session=AG_SESSION, gender="F", grade=7),
    ]
    bunks = [
        make_bunk(10, session=AG_SESSION, gender="AG", name="AG Cabin 3"),
        make_bunk(20, session=AG_SESSION, gender="AG", name="AG Cabin 4"),
    ]
    solver = DirectBunkingSolver(make_input(persons, bunks, [ag_req]), config_service=mock_config)
    ctx = solver._build_solver_context()

    forcing = add_age_preference_satisfaction_vars(ctx, {1: [ag_req]})

    assert forcing == {}
    assert ag_req.id not in ctx.request_satisfied_vars


def test_unsatisfied_ag_age_pref_not_flagged_material_parent_unmet(mock_config: Any) -> None:
    """Post-solve: an AG camper whose sole MP request is an age_preference the
    final cabin roster doesn't satisfy is deliberately unenforced — it must not
    land in material_parent_unmet or trip mp_constraint_bug_signal."""
    ag_req = _ag_age_req()  # camper 1 (grade 6) wants younger
    input_data = _combined_main_ag_input([ag_req])
    solver = DirectBunkingSolver(input_data, config_service=mock_config)

    # Precondition: the AG pre-check skip classifies the request possible.
    assert [r.id for r in solver.possible_requests.get(1, [])] == ["agr1"]
    assert solver.impossible_requests.get(1, []) == []

    # Enrollment-driven placement: camper 1 shares the AG cabin with older
    # camper 3 (grade 7) → "younger" unsatisfied per the canonical predicate.
    assignments = [
        DirectBunkAssignment(person_cm_id=1, session_cm_id=AG_SESSION, bunk_cm_id=10, year=2026),
        DirectBunkAssignment(person_cm_id=2, session_cm_id=AG_SESSION, bunk_cm_id=20, year=2026),
        DirectBunkAssignment(person_cm_id=3, session_cm_id=AG_SESSION, bunk_cm_id=10, year=2026),
        DirectBunkAssignment(person_cm_id=4, session_cm_id=MAIN_SESSION, bunk_cm_id=30, year=2026),
        DirectBunkAssignment(person_cm_id=5, session_cm_id=MAIN_SESSION, bunk_cm_id=30, year=2026),
        DirectBunkAssignment(person_cm_id=6, session_cm_id=MAIN_SESSION, bunk_cm_id=40, year=2026),
    ]

    solver._check_must_satisfy_one_violations(assignments)

    material = solver.constraint_logger.violations.get("must_satisfy_one_material_parent_unmet", [])
    assert all("(ID: 1)" not in v["details"] for v in material), (
        f"AG camper falsely flagged material_parent_unmet: {material}"
    )
    assert solver.request_validation_summary["mp_constraint_bug_signal"] == 0


def test_ag_age_pref_excluded_from_rate_denominators(mock_config: Any) -> None:
    """The met/total rate metrics gate their denominators on "requests the
    solver actually has a path to satisfy" — AG age_preferences have no solver
    representation by design, so they must not drag the rates down. The
    main-session camper's request in the same solve still counts."""
    ag_req = _ag_age_req()  # camper 1 (AG, grade 6) wants younger — unenforced
    main_req = _main_age_req()  # camper 4 (main, grade 6) wants younger
    input_data = _combined_main_ag_input([ag_req, main_req])
    solver = DirectBunkingSolver(input_data, config_service=mock_config)

    # AG camper 1 shares a cabin with older camper 3 → predicate-unsatisfied.
    # Main camper 4 shares bunk 30 with younger camper 5 only → satisfied.
    assignments = [
        DirectBunkAssignment(person_cm_id=1, session_cm_id=AG_SESSION, bunk_cm_id=10, year=2026),
        DirectBunkAssignment(person_cm_id=2, session_cm_id=AG_SESSION, bunk_cm_id=20, year=2026),
        DirectBunkAssignment(person_cm_id=3, session_cm_id=AG_SESSION, bunk_cm_id=10, year=2026),
        DirectBunkAssignment(person_cm_id=4, session_cm_id=MAIN_SESSION, bunk_cm_id=30, year=2026),
        DirectBunkAssignment(person_cm_id=5, session_cm_id=MAIN_SESSION, bunk_cm_id=30, year=2026),
        DirectBunkAssignment(person_cm_id=6, session_cm_id=MAIN_SESSION, bunk_cm_id=40, year=2026),
    ]

    solver._check_must_satisfy_one_violations(assignments)

    summary = solver.request_validation_summary
    # Only the main-session request counts — in every denominator.
    assert summary["mp_requests_total"] == 1
    assert summary["mp_requests_satisfied"] == 1
    assert summary["mp_campers_total"] == 1
    assert summary["mp_campers_satisfied"] == 1
    assert summary["all_requests_total"] == 1
    assert summary["all_requests_satisfied"] == 1
    assert summary["all_campers_total"] == 1
    assert summary["all_campers_satisfied"] == 1

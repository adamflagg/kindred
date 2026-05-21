"""Phase B (Stream 3 / #1381): impossible requests must not produce req_satisfied
BoolVars in the model proto.

Before this PR, the objective builder iterated ``self.input.requests_by_person``
and created a pinned-to-0 ``req_satisfied_<id>`` BoolVar for every bunk_with
request whose pair had no valid bunks (the no-valid-bunks fallback branch in
``add_objective``). For requests already classified impossible by
``validate_impossibility``, that was wasted model bulk AND consumed a
diminishing-returns slot that should belong to a possible request.

Phase B switches the loop source to ``self.possible_requests`` (which
``_validate_requests`` populates by filtering against
``{item.request_id for item in impossibility_report.flat}``), eliminating the
pinned-to-0 var and freeing the slot.
"""

from collections.abc import Generator
from typing import Any, ClassVar
from unittest.mock import MagicMock

import pytest

from bunking.config import ConfigLoader
from bunking.solver.direct_solver import DirectBunkingSolver
from tests.unit.solver.impossibility.conftest import (
    make_bunk,
    make_input,
    make_person,
    make_request,
)


class _PenaltyStubLoader:
    """Mirrors the stub in test_satvar_unification.py — penalty accessors
    that read via ``ConfigLoader.get_instance()`` need a real-ish object."""

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


def test_cross_session_bunk_with_produces_no_sat_var(mock_config: Any) -> None:
    """A bunk_with request across sessions is classified impossible by
    ``SessionBoundaryImpossibility``. The objective builder must skip it
    entirely — no ``req_satisfied_<id>`` BoolVar should appear in the model
    proto."""
    persons = [
        make_person(1, session=1000, gender="F"),
        make_person(2, session=2000, gender="F"),  # different session — pair_no_shared_bunk / cross_session
    ]
    bunks = [
        make_bunk(100, session=1000, gender="F"),
        make_bunk(200, session=2000, gender="F"),
    ]
    impossible_req = make_request(
        "imp1",
        requester=1,
        requestee=2,
        request_type="bunk_with",
        source_field="bunk_request_form",
        session=1000,
    )
    solver = DirectBunkingSolver(make_input(persons, bunks, [impossible_req]), config_service=mock_config)

    solver.add_constraints()
    solver.add_objective()

    # The impossible request must appear in impossibility_report.flat — that's
    # the precondition for Phase B to fire.
    impossible_ids = {item.request_id for item in solver.impossibility_report.flat}
    assert "imp1" in impossible_ids, (
        "Test precondition: 'imp1' should be classified impossible by validate_impossibility"
    )

    var_names = [v.name for v in solver.model.Proto().variables]
    assert "req_satisfied_imp1" not in var_names, (
        f"Impossible request 'imp1' produced a req_satisfied BoolVar; saw {[n for n in var_names if 'imp1' in n]}"
    )


def test_possible_request_still_gets_sat_var(mock_config: Any) -> None:
    """Regression guard: switching the loop source must not drop sat vars
    for possible requests."""
    persons = [make_person(1, session=1000, gender="F"), make_person(2, session=1000, gender="F")]
    bunks = [make_bunk(100, session=1000, gender="F"), make_bunk(200, session=1000, gender="F")]
    possible_req = make_request(
        "pos1", requester=1, requestee=2, request_type="bunk_with", source_field="bunking_notes"
    )
    solver = DirectBunkingSolver(make_input(persons, bunks, [possible_req]), config_service=mock_config)

    solver.add_constraints()
    solver.add_objective()

    assert "pos1" in solver.request_satisfied_vars, "Possible request must still register in the shared sat-var map"


def test_impossible_request_does_not_consume_slot(mock_config: Any) -> None:
    """Slot-accounting guard: when a person has one impossible + two possible
    bunk_with requests, the two possible requests must claim slots 0 and 1 of
    the diminishing-returns stack (FIRST + SECOND multipliers), not slots 1
    and 2 (SECOND + THIRD). Without Phase B, the impossible request consumed
    slot 0 and the possible requests fell to slots 1 and 2.
    """
    from bunking.solver.direct_solver import (
        BASE_REQUEST_WEIGHT,
        FIRST_REQUEST_MULTIPLIER,
        SECOND_REQUEST_MULTIPLIER,
    )

    persons = [
        make_person(1, session=1000, gender="F"),
        make_person(2, session=1000, gender="F"),
        make_person(3, session=1000, gender="F"),
        make_person(4, session=2000, gender="F"),  # different session for the impossible req
    ]
    bunks = [
        make_bunk(100, session=1000, gender="F"),
        make_bunk(200, session=1000, gender="F"),
        make_bunk(300, session=2000, gender="F"),
    ]
    # Order matters: impossible request first ensures pre-fix would have given
    # it slot 0 with the possible requests pushed down to slots 1 and 2.
    requests = [
        make_request("imp1", requester=1, requestee=4, request_type="bunk_with", session=1000),
        make_request("pos_a", requester=1, requestee=2, request_type="bunk_with", session=1000),
        make_request("pos_b", requester=1, requestee=3, request_type="bunk_with", session=1000),
    ]
    solver = DirectBunkingSolver(make_input(persons, bunks, requests), config_service=mock_config)

    solver.add_constraints()
    solver.add_objective()

    impossible_ids = {item.request_id for item in solver.impossibility_report.flat}
    assert "imp1" in impossible_ids, "precondition: imp1 must be classified impossible"

    proto = solver.model.Proto()
    name_to_index = {v.name: i for i, v in enumerate(proto.variables)}
    coeff_by_var: dict[int, int] = dict(zip(proto.objective.vars, proto.objective.coeffs, strict=False))

    pos_a_coeff = coeff_by_var.get(name_to_index["req_satisfied_pos_a"])
    pos_b_coeff = coeff_by_var.get(name_to_index["req_satisfied_pos_b"])
    assert pos_a_coeff is not None, "pos_a var must appear in the objective"
    assert pos_b_coeff is not None, "pos_b var must appear in the objective"

    # CP-SAT stores Maximize objectives as their negation internally; compare
    # by magnitude. Post-#1530 the solver routes the multiplier through the
    # `(source, type)` registry — bunk_request_form × bunk_with → share_bunk_with
    # weight_key with `_WEIGHT_DEFAULTS = 1.75` (mock_config has no row, so the
    # registry default kicks in). Mutual boost doesn't apply (no reciprocal
    # direction filed). Slot-0 = base*1.75*FIRST, slot-1 = base*1.75*SECOND.
    source_multiplier = 1.75
    expected_slot0 = int(BASE_REQUEST_WEIGHT * source_multiplier * FIRST_REQUEST_MULTIPLIER)
    expected_slot1 = int(BASE_REQUEST_WEIGHT * source_multiplier * SECOND_REQUEST_MULTIPLIER)
    actual = sorted([abs(pos_a_coeff), abs(pos_b_coeff)])
    assert actual == sorted([expected_slot0, expected_slot1]), (
        f"possible requests should claim slots 0+1 (magnitudes {expected_slot0}, {expected_slot1}); "
        f"got pos_a={pos_a_coeff}, pos_b={pos_b_coeff}"
    )

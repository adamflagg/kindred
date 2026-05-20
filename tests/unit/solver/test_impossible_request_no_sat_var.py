"""Phase B (Stream 3 / #1381): impossible requests must not produce req_satisfied
BoolVars in the model proto.

Today the objective builder iterates ``self.input.requests_by_person`` and creates
a pinned-to-0 ``req_satisfied_<id>`` BoolVar for every bunk_with request whose
pair has no valid bunks (line 525 in ``add_objective``). For requests already
classified impossible by ``validate_impossibility``, this is wasted model bulk
AND consumes a diminishing-returns slot that should belong to a possible request.

Switching the loop source to ``self.possible_requests`` (which already filters
on ``{item.request_id for item in impossibility_report.flat}`` in
``_validate_requests``) eliminates the pinned-to-0 var and frees the slot.
"""

from __future__ import annotations

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

"""AG sessions get no age-preference solver representation (#1752 follow-up).

AG cabin membership is enrollment-driven: everyone in AG session X lands in
that session's AG cabin. Preferences don't drive AG placement, so
``add_age_preference_satisfaction_vars`` must build nothing for AG sessions —
no sat var, no forcing indicators. Otherwise ``parent_paramount`` would turn
an MP age_preference request into a hard must-satisfy-one constraint over
per-bunk cleanliness vars that AG bunks (unlike grade_spread/grade_adjacency/
cabin_occupancy, which exempt AG bunks per-bunk) never opt out of — risking
INFEASIBLE with no diagnostic, since the impossibility pre-check also skips
AG sessions and so never records the request as impossible.
"""

from collections.abc import Generator
from typing import Any, ClassVar
from unittest.mock import MagicMock

import pytest

from bunking.config import ConfigLoader
from bunking.solver.constraints.age_preference import add_age_preference_satisfaction_vars
from bunking.solver.direct_solver import DirectBunkingSolver
from tests.unit.solver.impossibility.conftest import (
    make_bunk,
    make_input,
    make_person,
    make_request,
)


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


def _ag_age_pref_fixture() -> tuple[Any, Any]:
    """Multi-bunk AG session (the #1800 shape: several AG cabins paired to one
    session cm_id) with an MP age_preference request that has a non-trivial
    satisfaction condition (an older peer exists for a 'younger' preference)."""
    requester = make_person(1, session=100, gender="F", grade=6)
    p_younger = make_person(2, session=100, gender="F", grade=5)
    p_older = make_person(3, session=100, gender="F", grade=7)
    req = make_request(
        "agr1",
        requester=1,
        requestee=None,
        request_type="age_preference",
        age_preference_target="younger",
        source_field="bunk_request_form",  # MATERIAL_PARENT bucket
        session=100,
    )
    bunks = [
        make_bunk(10, session=100, gender="AG", name="AG Cabin 3"),
        make_bunk(20, session=100, gender="AG", name="AG Cabin 4"),
    ]
    return make_input([requester, p_younger, p_older], bunks, [req]), req


def test_ag_session_builds_no_age_pref_sat_vars(mock_config: Any) -> None:
    """Direct unit: the helper returns no forcing indicators and registers no
    sat var for a request whose solve context is an AG session."""
    input_data, req = _ag_age_pref_fixture()
    solver = DirectBunkingSolver(input_data, config_service=mock_config)
    ctx = solver._build_solver_context()

    forcing = add_age_preference_satisfaction_vars(ctx, {1: [req]})

    assert forcing == {}
    assert req.id not in ctx.request_satisfied_vars


def test_ag_session_mp_age_pref_produces_no_model_vars(mock_config: Any) -> None:
    """End-to-end through add_constraints (which runs parent_paramount): no
    ``age_req_<id>_*`` variable may appear in the model proto for an AG
    session — the request has no solver representation at all."""
    input_data, req = _ag_age_pref_fixture()
    solver = DirectBunkingSolver(input_data, config_service=mock_config)

    solver.add_constraints()
    solver.add_objective()

    var_names = [v.name for v in solver.model.Proto().variables]
    age_vars = [n for n in var_names if f"age_req_{req.id}" in n]
    assert age_vars == [], f"AG session built age-preference solver vars: {age_vars}"


def test_non_ag_session_still_builds_age_pref_sat_vars(mock_config: Any) -> None:
    """Control: the AG guard must not over-fire — a regular session's MP
    age_preference request still gets its sat var and forcing indicators."""
    requester = make_person(1, session=100, gender="F", grade=6)
    p_younger = make_person(2, session=100, gender="F", grade=5)
    p_older = make_person(3, session=100, gender="F", grade=7)
    req = make_request(
        "agr2",
        requester=1,
        requestee=None,
        request_type="age_preference",
        age_preference_target="younger",
        source_field="bunk_request_form",
        session=100,
    )
    bunks = [
        make_bunk(10, session=100, gender="F"),
        make_bunk(20, session=100, gender="F"),
    ]
    input_data = make_input([requester, p_younger, p_older], bunks, [req])
    solver = DirectBunkingSolver(input_data, config_service=mock_config)
    ctx = solver._build_solver_context()

    forcing = add_age_preference_satisfaction_vars(ctx, {1: [req]})

    assert req.id in forcing
    assert forcing[req.id] != []
    assert req.id in ctx.request_satisfied_vars

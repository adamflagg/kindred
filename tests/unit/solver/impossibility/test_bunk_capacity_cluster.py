"""BunkCapacityImpossibility: bunk_with cluster larger than any bunk."""

from __future__ import annotations

from dataclasses import replace

from bunking.solver.constraints.cabin_capacity import BunkCapacityImpossibility
from bunking.solver.impossibility import _build_context

from .conftest import make_bunk, make_input, make_person

PREDICATE = BunkCapacityImpossibility()


def test_small_cluster_fits_is_not_impossible(mock_config):
    persons = [make_person(i, session=100, gender="F", grade=4) for i in range(1, 6)]
    bunks = [make_bunk(10, session=100, gender="F", capacity=12)]
    input_data = make_input(persons, bunks, [])
    ctx = _build_context(input_data, mock_config)
    component = {1, 2, 3, 4, 5}
    ctx_c = replace(ctx, bunk_with_components=[component])

    assert PREDICATE.check_cluster(component, ctx_c) is None


def test_oversize_cluster_is_impossible(mock_config):
    """13 same-gender same-grade campers all reciprocally bunk_with > 12-cap bunk."""
    persons = [make_person(i, session=100, gender="F", grade=4) for i in range(1, 14)]
    bunks = [make_bunk(10, session=100, gender="F", capacity=12)]
    input_data = make_input(persons, bunks, [])
    ctx = _build_context(input_data, mock_config)
    component = set(range(1, 14))
    ctx_c = replace(ctx, bunk_with_components=[component])

    reason = PREDICATE.check_cluster(component, ctx_c)
    assert reason is not None
    assert reason.code == "cluster_capacity"
    assert reason.detail["component_size"] == 13
    assert reason.detail["max_bunk_capacity"] == 12


def test_cluster_capacity_uses_session_bunks_only(mock_config):
    """Bunks in OTHER sessions don't count toward capacity."""
    persons = [make_person(i, session=100, gender="F", grade=4) for i in range(1, 14)]
    bunks = [
        make_bunk(10, session=100, gender="F", capacity=12),
        make_bunk(11, session=200, gender="F", capacity=20),  # other session
    ]
    input_data = make_input(persons, bunks, [])
    ctx = _build_context(input_data, mock_config)
    component = set(range(1, 14))
    ctx_c = replace(ctx, bunk_with_components=[component])

    reason = PREDICATE.check_cluster(component, ctx_c)
    assert reason is not None  # 13 > 12, the bunk in session 200 doesn't help

"""TargetNotInSolverImpossibility: bunk_with/not_bunk_with to a non-roster requestee."""

from __future__ import annotations

from bunking.solver.impossibility import _build_context

from .conftest import make_bunk, make_input, make_person


def test_build_context_populates_roster_cm_ids(mock_config):
    """roster_cm_ids is the frozenset of every person cm_id in the input."""
    p1 = make_person(1, session=100)
    p2 = make_person(2, session=100)
    input_data = make_input([p1, p2], [make_bunk(10, session=100)], [])

    ctx = _build_context(input_data, mock_config)

    assert ctx.roster_cm_ids == frozenset({1, 2})
    assert isinstance(ctx.roster_cm_ids, frozenset)

"""Convergence: pre_validate_solver and _validate_requests agree per input."""

from __future__ import annotations

from bunking.solver.direct_solver import DirectBunkingSolver
from bunking.solver.impossibility import validate_impossibility

from .conftest import make_bunk, make_input, make_person, make_request


def test_validate_impossibility_matches_solver_classification(mock_config):
    """For the same input, the standalone validator and the solver's internal
    pass must classify the same requests as impossible.

    Lynchpin test for the single-source-of-truth claim.
    """
    p1 = make_person(1, session=100, gender="F", grade=3)
    p2 = make_person(2, session=100, gender="F", grade=5)  # grade gap -> impossible
    p3 = make_person(3, session=100, gender="F", grade=4)
    p4 = make_person(4, session=200, gender="F", grade=4)  # different session
    bunks = [
        make_bunk(10, session=100, gender="F", capacity=12),
        make_bunk(11, session=200, gender="F", capacity=12),
    ]
    requests = [
        make_request("r1", requester=1, requestee=2, session=100),  # grade_compatibility
        make_request("r2", requester=3, requestee=4, session=100),  # cross_session
        make_request("r3", requester=1, requestee=3, session=100),  # consecutive, OK
    ]
    input_data = make_input([p1, p2, p3, p4], bunks, requests)

    standalone_report = validate_impossibility(input_data, mock_config)
    standalone_ids = {item.request_id for item in standalone_report.flat}

    solver = DirectBunkingSolver(input_data, mock_config)
    solver_ids: set[str] = set()
    for reqs in solver.impossible_requests.values():
        solver_ids.update(r.id for r in reqs)

    assert standalone_ids == solver_ids, f"Drift detected. Standalone: {standalone_ids}. Solver: {solver_ids}."
    # Sanity: at least the grade_compatibility (r1) and cross_session (r2) hit
    assert "r1" in standalone_ids
    assert "r2" in standalone_ids
    # r3 is feasible (consecutive grades)
    assert "r3" not in standalone_ids

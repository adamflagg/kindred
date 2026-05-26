from bunking.models_v2 import DirectBunkRequest, DirectSolverInput
from bunking.solver.constraints.locked_bunks import cross_boundary_request_ids


def _req(req_id: str, requester: int, requested: int, request_type: str = "bunk_with") -> DirectBunkRequest:
    return DirectBunkRequest(
        id=req_id,
        requester_person_cm_id=requester,
        requested_person_cm_id=requested,
        request_type=request_type,
        session_cm_id=1000001,
        year=2026,
    )


def test_detects_request_targeting_a_locked_camper():
    # Movable 1002 wants to bunk with 1001, who is frozen in a locked cabin -> unmeetable.
    inp = DirectSolverInput(
        persons=[],
        requests=[_req("r1", requester=1002, requested=1001)],
        bunks=[],
        locked_bunks={2001: [1001]},
    )
    assert cross_boundary_request_ids(inp) == ["r1"]


def test_no_locked_bunks_returns_empty():
    inp = DirectSolverInput(
        persons=[],
        requests=[_req("r1", requester=1002, requested=1001)],
        bunks=[],
        locked_bunks={},
    )
    assert cross_boundary_request_ids(inp) == []


def test_target_not_locked_is_not_flagged():
    # Target 1003 is NOT in a locked cabin -> meetable -> not cross-boundary.
    inp = DirectSolverInput(
        persons=[],
        requests=[_req("r1", requester=1002, requested=1003)],
        bunks=[],
        locked_bunks={2001: [1001]},
    )
    assert cross_boundary_request_ids(inp) == []


def test_not_bunk_with_request_is_not_flagged():
    # A not_bunk_with request toward a locked camper is not a "couldn't bunk together" case.
    inp = DirectSolverInput(
        persons=[],
        requests=[_req("r1", requester=1002, requested=1001, request_type="not_bunk_with")],
        bunks=[],
        locked_bunks={2001: [1001]},
    )
    assert cross_boundary_request_ids(inp) == []


def test_locked_requester_is_not_flagged():
    # If the requester is ALSO locked (frozen), it's not a movable cross-boundary case.
    inp = DirectSolverInput(
        persons=[],
        requests=[_req("r1", requester=1001, requested=1002)],
        bunks=[],
        locked_bunks={2001: [1001, 1002]},
    )
    assert cross_boundary_request_ids(inp) == []

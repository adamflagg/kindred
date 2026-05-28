from api.schemas.solver import SolverRequest


def test_run_request_partial_defaults():
    req = SolverRequest(session_cm_id=1000001, year=2026)
    assert req.locked_bunk_cm_ids == []


def test_run_request_accepts_partial_fields():
    req = SolverRequest(session_cm_id=1000001, year=2026, locked_bunk_cm_ids=[2001, 2002])
    assert req.locked_bunk_cm_ids == [2001, 2002]

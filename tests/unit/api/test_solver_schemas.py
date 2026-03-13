from api.schemas.solver import MultiSessionSolverRequest, SolverRequest


def test_solver_request_has_respect_locks_field():
    """SolverRequest should accept respect_locks parameter, defaulting to True."""
    req = SolverRequest(session_cm_id=1000001, year=2025)
    assert req.respect_locks is True


def test_solver_request_respect_locks_false():
    req = SolverRequest(session_cm_id=1000001, year=2025, respect_locks=False)
    assert req.respect_locks is False


def test_multi_session_solver_request_has_respect_locks_field():
    req = MultiSessionSolverRequest(parent_session_cm_id=1000001, year=2025)
    assert req.respect_locks is True

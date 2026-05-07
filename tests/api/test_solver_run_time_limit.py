"""Tests for solver time limit resolution — verifies dead config DB lookup is removed."""

from api.routers.solver import _resolve_time_limit
from api.schemas.solver import SolverRequest


def test_request_time_limit_takes_precedence():
    req = SolverRequest(session_cm_id=1, year=2025, time_limit=120)
    assert _resolve_time_limit(req) == 120


def test_missing_time_limit_uses_hardcoded_default():
    req = SolverRequest(session_cm_id=1, year=2025, time_limit=None)
    assert _resolve_time_limit(req) == 60


def test_no_config_lookup_for_time_limit(monkeypatch):
    """Ensure we never query 'solver.time_limit_seconds' from config DB."""
    from bunking.config.loader import ConfigLoader

    queries = []
    real_get = ConfigLoader.get_instance().get_int

    def tracking_get(key, default=None):
        queries.append(key)
        return real_get(key, default=default)

    monkeypatch.setattr(ConfigLoader.get_instance(), "get_int", tracking_get)
    req = SolverRequest(session_cm_id=1, year=2025, time_limit=None)
    _resolve_time_limit(req)
    assert "solver.time_limit_seconds" not in queries

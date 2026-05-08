"""Tests for solver time limit resolution — verifies dead config DB lookup is removed."""

from api.routers.solver import _resolve_time_limit


def test_request_time_limit_takes_precedence():
    assert _resolve_time_limit(120) == 120


def test_missing_time_limit_uses_hardcoded_default():
    assert _resolve_time_limit(None) == 60

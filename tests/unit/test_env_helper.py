"""Tests for the shared env-truthiness helper (#1620)."""

import pytest

from tests._env import is_truthy_env


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("true", True),
        ("True", True),
        ("TRUE", True),
        (" true ", True),
        ("1", True),
        ("yes", True),
        ("on", True),
        ("false", False),
        ("False", False),
        ("0", False),
        ("no", False),
        ("off", False),
        ("", False),
        ("anything", False),
    ],
)
def test_is_truthy_env_values(monkeypatch, raw, expected):
    monkeypatch.setenv("X_GATE", raw)
    assert is_truthy_env("X_GATE") is expected


def test_is_truthy_env_unset_default_false(monkeypatch):
    monkeypatch.delenv("X_GATE", raising=False)
    assert is_truthy_env("X_GATE") is False


def test_is_truthy_env_unset_default_true(monkeypatch):
    """Skip-when-unset sites (sync smoke/CLI) pass default='true'."""
    monkeypatch.delenv("X_GATE", raising=False)
    assert is_truthy_env("X_GATE", default="true") is True

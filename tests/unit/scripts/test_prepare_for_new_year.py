"""Tests for the prepare_for_new_year script."""

from datetime import datetime

import pytest

from scripts.prepare_for_new_year import load_env_config


def test_load_env_config_uses_numeric_season_id(monkeypatch: pytest.MonkeyPatch) -> None:
    """A numeric CAMPMINDER_SEASON_ID should be used as the year."""
    monkeypatch.setenv("CAMPMINDER_SEASON_ID", "2031")
    monkeypatch.setenv("CAMPMINDER_API_KEY", "test-key")
    monkeypatch.setenv("CAMPMINDER_PRIMARY_KEY", "test-primary")
    monkeypatch.setenv("CAMPMINDER_CLIENT_ID", "test-client")
    monkeypatch.setenv("HISTORICAL_YEARS", "[]")

    config = load_env_config()

    assert config is not None
    assert config["season_id"] == 2031
    assert config["active_year"] == 2031


def test_load_env_config_falls_back_to_calendar_year_when_season_id_is_blank(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A blank CAMPMINDER_SEASON_ID should fall back to calendar year, not raise."""
    monkeypatch.setenv("CAMPMINDER_SEASON_ID", "")
    monkeypatch.setenv("CAMPMINDER_API_KEY", "test-key")
    monkeypatch.setenv("CAMPMINDER_PRIMARY_KEY", "test-primary")
    monkeypatch.setenv("CAMPMINDER_CLIENT_ID", "test-client")
    monkeypatch.setenv("HISTORICAL_YEARS", "[]")

    before = datetime.now().year
    config = load_env_config()
    after = datetime.now().year

    assert config is not None
    # Window for midnight rollover: the run must not flake across 31 Dec.
    assert config["season_id"] in {before, after}
    assert config["active_year"] in {before, after}


def test_load_env_config_falls_back_to_calendar_year_when_season_id_is_non_numeric(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A non-numeric CAMPMINDER_SEASON_ID should fall back to calendar year, not raise."""
    monkeypatch.setenv("CAMPMINDER_SEASON_ID", "abc")
    monkeypatch.setenv("CAMPMINDER_API_KEY", "test-key")
    monkeypatch.setenv("CAMPMINDER_PRIMARY_KEY", "test-primary")
    monkeypatch.setenv("CAMPMINDER_CLIENT_ID", "test-client")
    monkeypatch.setenv("HISTORICAL_YEARS", "[]")

    before = datetime.now().year
    config = load_env_config()
    after = datetime.now().year

    assert config is not None
    # Window for midnight rollover: the run must not flake across 31 Dec.
    assert config["season_id"] in {before, after}
    assert config["active_year"] in {before, after}


def test_load_env_config_falls_back_to_calendar_year_when_season_id_is_unset(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No CAMPMINDER_SEASON_ID (unset) should fall back to calendar year."""
    monkeypatch.delenv("CAMPMINDER_SEASON_ID", raising=False)
    monkeypatch.setenv("CAMPMINDER_API_KEY", "test-key")
    monkeypatch.setenv("CAMPMINDER_PRIMARY_KEY", "test-primary")
    monkeypatch.setenv("CAMPMINDER_CLIENT_ID", "test-client")
    monkeypatch.setenv("HISTORICAL_YEARS", "[]")

    before = datetime.now().year
    config = load_env_config()
    after = datetime.now().year

    assert config is not None
    # Window for midnight rollover: the run must not flake across 31 Dec.
    assert config["season_id"] in {before, after}
    assert config["active_year"] in {before, after}

"""The legacy Python CampMinder client follows the Oct 15 season rule, not the calendar year.

Clock frozen at 2026-11-01: the calendar says 2026, the rule says 2027.
"""

from datetime import UTC, datetime
from pathlib import Path

import pytest

from campminder.client import get_current_season, load_config_from_env, load_config_from_file


@pytest.fixture(autouse=True)
def _frozen(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CAMPMINDER_SEASON_ID", raising=False)
    monkeypatch.setenv("CAMPMINDER_API_KEY", "k")
    monkeypatch.setenv("CAMPMINDER_SUBSCRIPTION_KEY", "s")
    monkeypatch.setenv("CAMPMINDER_PRIMARY_KEY", "s")
    monkeypatch.setenv("CAMPMINDER_CLIENT_ID", "1")
    monkeypatch.setattr("api.services.camp_calendar._utcnow", lambda: datetime(2026, 11, 1, 12, tzinfo=UTC))


def test_get_current_season_follows_the_rule() -> None:
    assert get_current_season() == 2027


def test_the_override_still_wins(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CAMPMINDER_SEASON_ID", "2031")
    assert get_current_season() == 2031


def test_load_config_from_env_follows_the_rule() -> None:
    cfg = load_config_from_env()
    assert cfg is not None
    assert cfg.season_id == 2027


def test_load_config_from_file_env_path_follows_the_rule(tmp_path: Path) -> None:
    cfg = load_config_from_file(str(tmp_path / "none.json"))
    assert cfg is not None
    assert cfg.season_id == 2027


def test_load_config_from_file_json_path_follows_the_rule(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.delenv("CAMPMINDER_API_KEY")
    f = tmp_path / "c.json"
    f.write_text('{"api_key": "a", "subscription_key": "b", "client_id": 1}')
    cfg = load_config_from_file(str(f))
    assert cfg is not None
    assert cfg.season_id == 2027

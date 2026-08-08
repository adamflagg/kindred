"""Tests for the confirm_lodging_units script."""

from datetime import datetime
from typing import Any

import pytest

from scripts.dev.confirm_lodging_units import main


def _drive_main(monkeypatch: pytest.MonkeyPatch, extra: list[str]) -> list[int]:
    """Run `main` with the network stubbed and report the year it fetched.

    The `--year` default is resolved by argparse inside `main`, so the only
    faithful way to see it is to let `main` run and watch what reaches the
    _units function. A helper tested in isolation would prove the year is
    computed, not that the parser hands it to `_units` — which is the half
    that breaks.
    """
    seen: list[int] = []

    def fake_auth(_base: str, _identity: str, _password: str) -> str:
        return "tok"

    def fake_units(_base: str, _token: str, year: int) -> list[dict[str, Any]]:
        seen.append(year)
        return []

    monkeypatch.setattr("scripts.dev.confirm_lodging_units._auth", fake_auth)
    monkeypatch.setattr("scripts.dev.confirm_lodging_units._units", fake_units)

    rc = main(["--password", "x", *extra])
    assert rc == 0
    return seen


def test_the_year_defaults_to_the_campminder_season_env_var(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CAMPMINDER_SEASON_ID", "2031")
    assert _drive_main(monkeypatch, []) == [2031]


def test_the_year_falls_back_to_the_calendar_year_when_the_env_is_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    """No season configured means the clock, not a hardcoded year."""
    monkeypatch.delenv("CAMPMINDER_SEASON_ID", raising=False)
    before = datetime.now().year
    seen = _drive_main(monkeypatch, [])
    # A window, not an equality: the run must not flake across midnight on 31 Dec.
    assert seen[0] in {before, datetime.now().year}


def test_an_explicit_year_flag_beats_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    """The operator's flag is the whole reason the season is not read directly."""
    monkeypatch.setenv("CAMPMINDER_SEASON_ID", "2031")
    assert _drive_main(monkeypatch, ["--year", "2033"]) == [2033]


def test_the_year_falls_back_to_calendar_year_when_season_id_is_blank(monkeypatch: pytest.MonkeyPatch) -> None:
    """A blank CAMPMINDER_SEASON_ID (empty string) should fall back to calendar year, not raise."""
    monkeypatch.setenv("CAMPMINDER_SEASON_ID", "")
    before = datetime.now().year
    seen = _drive_main(monkeypatch, [])
    assert seen[0] in {before, datetime.now().year}


def test_the_year_falls_back_to_calendar_year_when_season_id_is_non_numeric(monkeypatch: pytest.MonkeyPatch) -> None:
    """A non-numeric CAMPMINDER_SEASON_ID should fall back to calendar year, not raise."""
    monkeypatch.setenv("CAMPMINDER_SEASON_ID", "abc")
    before = datetime.now().year
    seen = _drive_main(monkeypatch, [])
    assert seen[0] in {before, datetime.now().year}

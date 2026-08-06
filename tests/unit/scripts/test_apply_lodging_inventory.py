"""The apply script must never mix two seasons' unit rows."""

import json
from datetime import datetime
from pathlib import Path
from typing import Any

import pytest

from scripts.dev.apply_lodging_inventory import main, plan_updates


def test_plan_updates_matches_within_one_year() -> None:
    """`have` holds one year's rows; a unit absent from it is absent, not stale."""
    want = [{"code": "test-unit-a", "has_fridge": True}]
    have: dict[str, dict[str, Any]] = {}  # the 2027 fetch found nothing
    plan = plan_updates(want, have)
    assert plan.absent == ["test-unit-a"]
    assert plan.updates == []


def test_fetch_units_filters_by_year(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    class FakeResponse:
        status_code = 200

        def json(self) -> dict[str, object]:
            return {"items": [], "totalPages": 1}

        def raise_for_status(self) -> None:
            return None

    def fake_get(url: str, **kwargs: object) -> FakeResponse:
        captured["params"] = kwargs.get("params")
        return FakeResponse()

    monkeypatch.setattr("scripts.dev.apply_lodging_inventory.requests.get", fake_get)

    from scripts.dev.apply_lodging_inventory import _fetch_units

    _fetch_units("http://127.0.0.1:8090", "token", 2027)

    params = captured["params"]
    assert isinstance(params, dict)
    assert "year = 2027" in str(params.get("filter", ""))


def _drive_main(monkeypatch: pytest.MonkeyPatch, tmp_path: Path, extra: list[str]) -> list[int]:
    """Run `main` with the network stubbed and report the year it fetched.

    The `--year` default is resolved by argparse inside `main`, so the only
    faithful way to see it is to let `main` run and watch what reaches the
    fetch. A helper tested in isolation would prove the year is computed, not
    that the parser hands it to `_fetch_units` — which is the half that breaks.
    """
    seen: list[int] = []

    def fake_fetch(_base: str, _token: str, year: int) -> dict[str, dict[str, Any]]:
        seen.append(year)
        return {}

    monkeypatch.setattr("scripts.dev.apply_lodging_inventory._auth", lambda *_a, **_k: "tok")
    monkeypatch.setattr("scripts.dev.apply_lodging_inventory._fetch_units", fake_fetch)

    # The real registry is a symlink into the private kindred-local repo and is
    # absent in CI, so the test brings its own empty one.
    registry = tmp_path / "lodging_registry.json"
    registry.write_text(json.dumps({"units": []}))

    rc = main(["--registry", str(registry), "--password", "x", *extra])
    assert rc == 0
    return seen


def test_the_year_defaults_to_the_campminder_season_env_var(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("CAMPMINDER_SEASON_ID", "2031")
    assert _drive_main(monkeypatch, tmp_path, []) == [2031]


def test_the_year_falls_back_to_the_calendar_year_when_the_env_is_unset(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """No season configured means the clock, not a hardcoded year."""
    monkeypatch.delenv("CAMPMINDER_SEASON_ID", raising=False)
    before = datetime.now().year
    seen = _drive_main(monkeypatch, tmp_path, [])
    # A window, not an equality: the run must not flake across midnight on 31 Dec.
    assert seen[0] in {before, datetime.now().year}


def test_an_explicit_year_flag_beats_the_environment(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """The operator's flag is the whole reason the season is not read directly."""
    monkeypatch.setenv("CAMPMINDER_SEASON_ID", "2031")
    assert _drive_main(monkeypatch, tmp_path, ["--year", "2033"]) == [2033]

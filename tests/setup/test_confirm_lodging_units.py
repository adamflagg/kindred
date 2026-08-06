"""Tests for scripts/dev/confirm_lodging_units.py.

The only thing worth pinning here is the guard. `is_confirmed` asserts that a
human has checked a specific cabin; setting it in bulk on a real database tells
staff that 93 cabins were verified when none were, and the roster's fit check
would then judge housing needs against amenity columns nobody filled in.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any

import pytest

_SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "dev" / "confirm_lodging_units.py"
_spec = importlib.util.spec_from_file_location("confirm_lodging_units", _SCRIPT)
assert _spec is not None
assert _spec.loader is not None
confirm = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = confirm
_spec.loader.exec_module(confirm)


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1:8090",
        "http://localhost:8090",
        "http://127.0.0.1:8468",
    ],
)
def test_loopback_urls_are_local(url: str) -> None:
    assert confirm.is_local(url) is True


@pytest.mark.parametrize(
    "url",
    [
        "https://camp.example.org",
        "http://192.168.1.50:8090",
        "http://pocketbase.internal:8090",
    ],
)
def test_everything_else_is_not_local(url: str) -> None:
    assert confirm.is_local(url) is False


def test_a_remote_url_is_refused_without_the_explicit_flag() -> None:
    rc = confirm.main(["--url", "https://camp.example.org", "--apply", "--password", "x"])
    assert rc == 2


class _StubResponse:
    """A single empty page, which is all these tests need to see the params."""

    @staticmethod
    def raise_for_status() -> None:
        return None

    @staticmethod
    def json() -> dict[str, Any]:
        return {"items": [], "totalPages": 1}


def test_the_unit_fetch_asks_for_one_season(monkeypatch: pytest.MonkeyPatch) -> None:
    """The year filter is the whole point, not a convenience.

    `lodging_units` holds one row per unit per year since 1500000141, so after a
    roll-forward an unfiltered page-through returns EVERY season. `--apply`
    would then flip `is_confirmed` on a prior season's registry — the one whose
    roster has already been judged against it — and `--undo` would clear it.
    Same hazard `apply_lodging_inventory._fetch_units` documents.
    """
    seen: list[dict[str, Any]] = []

    def fake_get(_url: str, **kwargs: Any) -> _StubResponse:
        seen.append(dict(kwargs.get("params") or {}))
        return _StubResponse()

    monkeypatch.setattr(confirm.requests, "get", fake_get)
    confirm._units("http://127.0.0.1:8090", "tok", 2027)

    assert seen, "no request was made"
    assert seen[0].get("filter") == "year = 2027"


def test_main_confirms_only_the_season_it_was_given(monkeypatch: pytest.MonkeyPatch) -> None:
    """A `--year` that never reaches the fetch is the same bug with a flag on it."""
    asked: list[int] = []

    def fake_units(_base: str, _token: str, year: int) -> list[dict[str, Any]]:
        asked.append(year)
        return []

    monkeypatch.setattr(confirm, "_auth", lambda *_args, **_kwargs: "tok")
    monkeypatch.setattr(confirm, "_units", fake_units)

    rc = confirm.main(["--url", "http://127.0.0.1:8090", "--password", "x", "--year", "2027"])

    assert rc == 0
    assert asked == [2027]


def test_a_missing_password_is_refused_rather_than_prompting() -> None:
    rc = confirm.main(["--url", "http://127.0.0.1:8090", "--password", ""])
    assert rc == 2

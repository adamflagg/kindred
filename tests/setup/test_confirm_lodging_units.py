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


def test_a_missing_password_is_refused_rather_than_prompting() -> None:
    rc = confirm.main(["--url", "http://127.0.0.1:8090", "--password", ""])
    assert rc == 2

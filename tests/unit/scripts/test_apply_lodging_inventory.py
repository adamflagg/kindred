"""The apply script must never mix two seasons' unit rows."""

from typing import Any

import pytest

from scripts.dev.apply_lodging_inventory import plan_updates


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

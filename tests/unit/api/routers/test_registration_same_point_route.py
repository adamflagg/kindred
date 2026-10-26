"""The /registration route reads a comparison year at the same point (decision 7, PR 7)."""

from datetime import date
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from api.dependencies import metrics_cache
from bunking.auth_middleware import AuthUser


def _user() -> AuthUser:
    return AuthUser(username="staff", email="staff@example.com", display_name="Staff", groups=[], is_admin=True)


async def _call(calls: list[dict[str, Any]], today: date, **params: Any) -> None:
    from api.routers import metrics

    async def fake_calculate(year: int, *args: Any, **kw: Any) -> Any:
        calls.append({"year": year, "args": args, **kw})
        return MagicMock()

    with (
        patch("api.routers.metrics._create_repository", return_value=object()),
        patch("api.routers.metrics.RegistrationService") as svc_cls,
        patch("api.routers.metrics.get_camp_today", return_value=today),
    ):
        svc_cls.return_value.calculate_registration = fake_calculate
        await metrics.get_registration_metrics(
            **{
                "year": 2025,
                "session_types": "main,embedded,ag,quest",
                "statuses": "enrolled",
                "session_cm_id": None,
                "duration": None,
                "same_point_of": None,
                "same_point_all_year": False,
                "user": _user(),
                **params,
            }
        )


@pytest.mark.asyncio
async def test_route_forwards_same_point_of_and_camp_today() -> None:
    metrics_cache.invalidate_all()
    calls: list[dict[str, Any]] = []

    await _call(calls, date(2026, 3, 2), same_point_of=2026)

    assert calls[0]["same_point_of"] == 2026
    assert calls[0]["today"] == date(2026, 3, 2)


@pytest.mark.asyncio
async def test_same_point_cache_key_moves_with_the_camp_day() -> None:
    """The same-point read changes every camp day, so yesterday's cached answer must not serve today."""
    metrics_cache.invalidate_all()
    calls: list[dict[str, Any]] = []

    await _call(calls, date(2026, 3, 2), same_point_of=2026)
    await _call(calls, date(2026, 3, 2), same_point_of=2026)
    await _call(calls, date(2026, 3, 3), same_point_of=2026)
    await _call(calls, date(2026, 3, 3))

    assert len(calls) == 3  # the repeat on 3-02 is cached; a new day and a plain read are not


@pytest.mark.asyncio
async def test_same_point_rejects_other_statuses() -> None:
    metrics_cache.invalidate_all()

    with pytest.raises(HTTPException) as exc:
        await _call([], date(2026, 3, 2), same_point_of=2026, statuses="waitlisted")

    assert exc.value.status_code == 422


@pytest.mark.asyncio
async def test_route_forwards_all_year_and_keys_the_cache_by_it() -> None:
    """Today's read (PM-8 A) is the same day all year: its own cache entry, beside the live-only one."""
    metrics_cache.invalidate_all()
    calls: list[dict[str, Any]] = []

    await _call(calls, date(2026, 3, 2), same_point_of=2026, same_point_all_year=True)
    await _call(calls, date(2026, 3, 2), same_point_of=2026)

    assert len(calls) == 2
    assert calls[0]["all_year"] is True
    assert calls[1]["all_year"] is False


@pytest.mark.asyncio
async def test_all_year_needs_same_point_of() -> None:
    metrics_cache.invalidate_all()

    with pytest.raises(HTTPException) as exc:
        await _call([], date(2026, 3, 2), same_point_all_year=True)

    assert exc.value.status_code == 422

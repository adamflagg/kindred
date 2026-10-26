"""The /cancellations and /waitlist routes read a comparison year against a season (PM-8 A)."""

from datetime import date
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from api.dependencies import metrics_cache
from bunking.auth_middleware import AuthUser


def _user() -> AuthUser:
    return AuthUser(username="staff", email="staff@example.com", display_name="Staff", groups=[], is_admin=True)


ROUTES = {
    "cancellations": ("CancellationService", "calculate_cancellations", "get_cancellation_metrics"),
    "waitlist": ("WaitlistService", "calculate_waitlist", "get_waitlist_metrics"),
}


async def _call(route: str, calls: list[dict[str, Any]], today: date, **params: Any) -> None:
    from api.routers import metrics

    service_name, method, handler = ROUTES[route]

    async def fake_calculate(*args: Any, **kw: Any) -> Any:
        calls.append(kw)
        return MagicMock()

    with (
        patch("api.routers.metrics._create_repository", return_value=object()),
        patch(f"api.routers.metrics.{service_name}") as svc_cls,
        patch("api.routers.metrics.get_camp_today", return_value=today),
    ):
        setattr(svc_cls.return_value, method, fake_calculate)
        await getattr(metrics, handler)(
            **{
                "year": 2025,
                "session_types": "main,embedded,ag,quest",
                "session_cm_id": None,
                "duration": None,
                "same_point_of": None,
                "user": _user(),
                **params,
            }
        )


@pytest.mark.asyncio
@pytest.mark.parametrize("route", sorted(ROUTES))
async def test_route_forwards_same_point_of_and_camp_today(route: str) -> None:
    metrics_cache.invalidate_all()
    calls: list[dict[str, Any]] = []

    await _call(route, calls, date(2026, 3, 2), same_point_of=2026)

    assert calls[0]["same_point_of"] == 2026
    assert calls[0]["today"] == date(2026, 3, 2)


@pytest.mark.asyncio
@pytest.mark.parametrize("route", sorted(ROUTES))
async def test_same_point_cache_key_moves_with_the_camp_day(route: str) -> None:
    metrics_cache.invalidate_all()
    calls: list[dict[str, Any]] = []

    await _call(route, calls, date(2026, 3, 2), same_point_of=2026)
    await _call(route, calls, date(2026, 3, 2), same_point_of=2026)
    await _call(route, calls, date(2026, 3, 3), same_point_of=2026)
    await _call(route, calls, date(2026, 3, 3))

    assert len(calls) == 3  # the repeat on 3-02 is cached; a new day and a plain read are not
    assert calls[1]["today"] == date(2026, 3, 3)
    assert calls[-1]["same_point_of"] is None

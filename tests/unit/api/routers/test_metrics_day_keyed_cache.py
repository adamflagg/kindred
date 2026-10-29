"""Velocity and forecast read the camp day (velocity's partial week, forecast's week-relative point), so their cached
responses are keyed by it. Since the sync notify stopped clearing metrics_cache on jobs that write no metrics table,
a sync no longer clears them at the 9 a.m. camp-day boundary by accident."""

from datetime import date
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from api.dependencies import metrics_cache
from bunking.auth_middleware import AuthUser


def _user() -> AuthUser:
    return AuthUser(username="staff", email="staff@example.com", display_name="Staff", groups=[], is_admin=True)


async def _velocity(metrics: Any) -> Any:
    return await metrics.get_velocity(
        year=2027,
        compare_years=None,
        session_cm_id=None,
        session_types=None,
        split_by_gender=False,
        gender_basis="field",
        metric="enrollment",
        duration=None,
        user=_user(),
    )


async def _forecast(metrics: Any) -> Any:
    return await metrics.get_forecast(
        year=2027, session_types=None, session_cm_id=None, day_offset=None, duration=None, user=_user()
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("read", "service", "method"),
    [(_velocity, "VelocityService", "get_velocity"), (_forecast, "ForecastService", "calculate_forecast")],
)
async def test_a_new_camp_day_is_a_new_cache_entry_computed_for_that_day(read: Any, service: str, method: str) -> None:
    from api.routers import metrics

    metrics_cache.invalidate_all()
    days = iter([date(2027, 2, 9), date(2027, 2, 9), date(2027, 2, 10)])
    with (
        patch("api.routers.metrics._create_repository", return_value=object()),
        patch("api.routers.metrics.get_camp_today", side_effect=lambda: next(days)),
        patch(f"api.routers.metrics.{service}") as svc_cls,
    ):
        svc = MagicMock()
        setattr(svc, method, AsyncMock(side_effect=lambda **kw: MagicMock()))
        svc_cls.return_value = svc
        await read(metrics)
        await read(metrics)  # same camp day: served from the cache
        await read(metrics)  # the next camp day: computed again
    calls = getattr(svc, method).await_args_list
    assert [c.kwargs["today"] for c in calls] == [date(2027, 2, 9), date(2027, 2, 10)]
    metrics_cache.invalidate_all()

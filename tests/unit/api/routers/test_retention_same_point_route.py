"""The /retention and /retention-trends routes read the same point last year (#3207 PR 11, decision 7)."""

from datetime import date
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from api.dependencies import metrics_cache
from bunking.auth_middleware import AuthUser


def _user() -> AuthUser:
    return AuthUser(username="staff", email="staff@example.com", display_name="Staff", groups=[], is_admin=True)


async def _retention(calls: list[dict[str, Any]], today: date, **params: Any) -> None:
    from api.routers import metrics

    async def fake_calculate(**kw: Any) -> Any:
        calls.append(kw)
        return MagicMock()

    with (
        patch("api.routers.metrics._create_repository", return_value=object()),
        patch("api.routers.metrics.RetentionService") as svc_cls,
        patch("api.routers.metrics.get_camp_today", return_value=today),
    ):
        svc_cls.return_value.calculate_retention = fake_calculate
        await metrics.get_retention_metrics(
            **{
                "base_year": 2024,
                "compare_year": 2025,
                "session_types": None,
                "session_cm_id": None,
                "duration": None,
                "include_teen_pipeline": False,
                "same_point_of": None,
                "user": _user(),
                **params,
            }
        )


async def _trends(calls: list[dict[str, Any]], today: date) -> None:
    from api.routers import metrics

    async def fake_calculate(**kw: Any) -> Any:
        calls.append(kw)
        return MagicMock()

    with (
        patch("api.routers.metrics._create_repository", return_value=object()),
        patch("api.routers.metrics.RetentionTrendsService") as svc_cls,
        patch("api.routers.metrics.get_camp_today", return_value=today),
    ):
        svc_cls.return_value.calculate_retention_trends = fake_calculate
        await metrics.get_retention_trends(
            current_year=2026,
            num_years=5,
            session_types=None,
            session_cm_id=None,
            duration=None,
            include_teen_pipeline=False,
            user=_user(),
        )


@pytest.mark.asyncio
async def test_retention_forwards_same_point_of_and_camp_today() -> None:
    metrics_cache.invalidate_all()
    calls: list[dict[str, Any]] = []

    await _retention(calls, date(2026, 3, 2), same_point_of=2026)

    assert calls[0]["same_point_of"] == 2026
    assert calls[0]["today"] == date(2026, 3, 2)


@pytest.mark.asyncio
async def test_retention_same_point_cache_key_moves_with_the_camp_day() -> None:
    metrics_cache.invalidate_all()
    calls: list[dict[str, Any]] = []

    await _retention(calls, date(2026, 3, 2), same_point_of=2026)
    await _retention(calls, date(2026, 3, 2), same_point_of=2026)
    await _retention(calls, date(2026, 3, 3), same_point_of=2026)

    assert len(calls) == 2  # the repeat on 3-02 is cached; a new camp day is not


@pytest.mark.asyncio
async def test_trends_always_ask_for_the_same_point_series_on_the_camp_day() -> None:
    metrics_cache.invalidate_all()
    calls: list[dict[str, Any]] = []

    await _trends(calls, date(2026, 3, 2))
    await _trends(calls, date(2026, 3, 2))
    await _trends(calls, date(2026, 3, 3))

    assert calls[0]["same_point"] is True
    assert calls[0]["today"] == date(2026, 3, 2)
    assert len(calls) == 2

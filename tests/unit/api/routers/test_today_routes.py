"""The Analytics Today routes (#3207 PR 8) pass the scope to the service and cache per camp day."""

from datetime import date
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from api.dependencies import metrics_cache
from bunking.auth_middleware import AuthUser


def _user() -> AuthUser:
    return AuthUser(username="staff", email="staff@example.com", display_name="Staff", groups=[], is_admin=True)


@pytest.mark.asyncio
async def test_today_sessions_forwards_the_scope() -> None:
    from api.routers import metrics

    metrics_cache.invalidate_all()
    with (
        patch("api.routers.metrics._create_repository", return_value=object()),
        patch("api.routers.metrics.get_camp_today", return_value=date(2027, 2, 9)),
        patch("api.routers.metrics.TodayService") as svc_cls,
    ):
        svc = MagicMock()
        svc.session_fill = AsyncMock(return_value=MagicMock())
        svc_cls.return_value = svc
        await metrics.get_today_sessions(
            year=2027, session_types="main,ag", session_cm_id=1000200, duration=None, user=_user()
        )

    svc.session_fill.assert_awaited_once_with(
        2027, ["main", "ag"], session_cm_id=1000200, duration=None, today=date(2027, 2, 9)
    )


@pytest.mark.asyncio
async def test_today_recent_forwards_the_scope() -> None:
    from api.routers import metrics

    metrics_cache.invalidate_all()
    with (
        patch("api.routers.metrics._create_repository", return_value=object()),
        patch("api.routers.metrics.get_camp_today", return_value=date(2027, 2, 9)),
        patch("api.routers.metrics.TodayService") as svc_cls,
    ):
        svc = MagicMock()
        svc.recent_signups = AsyncMock(return_value=MagicMock())
        svc_cls.return_value = svc
        await metrics.get_today_recent(
            year=2027, session_types=None, session_cm_id=None, duration="2-week", user=_user()
        )

    svc.recent_signups.assert_awaited_once()
    args, kwargs = svc.recent_signups.await_args
    assert args[0] == 2027
    assert kwargs == {"session_cm_id": None, "duration": "2-week", "today": date(2027, 2, 9)}


@pytest.mark.asyncio
async def test_today_reads_are_cached_per_camp_day() -> None:
    """The same-point read and the 7-day window both move every camp day, so the day is in the key."""
    from api.routers import metrics

    metrics_cache.invalidate_all()
    calls: list[Any] = []

    async def fake_session_fill(year: int, *args: Any, **kwargs: Any) -> Any:
        calls.append(kwargs["today"])
        return MagicMock()

    with (
        patch("api.routers.metrics._create_repository", return_value=object()),
        patch("api.routers.metrics.TodayService") as svc_cls,
        patch("api.routers.metrics.get_camp_today") as today,
    ):
        svc_cls.return_value.session_fill = fake_session_fill
        today.return_value = date(2027, 2, 9)
        await metrics.get_today_sessions(year=2027, session_types=None, session_cm_id=None, duration=None, user=_user())
        await metrics.get_today_sessions(year=2027, session_types=None, session_cm_id=None, duration=None, user=_user())
        today.return_value = date(2027, 2, 10)
        await metrics.get_today_sessions(year=2027, session_types=None, session_cm_id=None, duration=None, user=_user())

    assert calls == [date(2027, 2, 9), date(2027, 2, 10)]

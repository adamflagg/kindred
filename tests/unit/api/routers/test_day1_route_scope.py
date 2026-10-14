"""The /registration/day1 route passes the session pick and duration to the service (#3208)."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bunking.auth_middleware import AuthUser


def _user() -> AuthUser:
    return AuthUser(username="staff", email="staff@example.com", display_name="Staff", groups=[], is_admin=True)


@pytest.mark.asyncio
async def test_day1_route_forwards_session_cm_id_and_duration() -> None:
    from api.routers import metrics

    metrics.metrics_cache.invalidate_all()
    with (
        patch("api.routers.metrics._create_repository", return_value=object()),
        patch("api.routers.metrics.Day1Service") as svc_cls,
    ):
        svc = MagicMock()
        svc.get_day1 = AsyncMock(return_value=MagicMock())
        svc_cls.return_value = svc

        await metrics.get_day1(year=2026, session_types="main,ag", session_cm_id=1378702, duration=None, user=_user())

    svc.get_day1.assert_awaited_once_with(2026, session_types=["main", "ag"], session_cm_id=1378702, duration=None)


@pytest.mark.asyncio
async def test_day1_route_cache_key_distinguishes_session_and_duration() -> None:
    from api.routers import metrics

    metrics.metrics_cache.invalidate_all()
    calls: list[dict] = []

    async def fake_get_day1(year, **kw):
        calls.append(kw)
        return MagicMock()

    with (
        patch("api.routers.metrics._create_repository", return_value=object()),
        patch("api.routers.metrics.Day1Service") as svc_cls,
    ):
        svc_cls.return_value.get_day1 = fake_get_day1
        await metrics.get_day1(year=2026, session_types=None, session_cm_id=1, duration=None, user=_user())
        await metrics.get_day1(year=2026, session_types=None, session_cm_id=2, duration=None, user=_user())
        await metrics.get_day1(year=2026, session_types=None, session_cm_id=None, duration="1-week", user=_user())

    assert len(calls) == 3

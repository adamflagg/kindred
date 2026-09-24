"""Pins that the session-availability router builds its repository via the
shared ``_create_repository()`` factory instead of constructing
``MetricsRepository(pb)`` directly.

Cache-gap audit row 2 (`docs/plans/2026-09-23-ww-triage/cache-gap-audit.md`,
LOCAL ONLY -- gitignored, so absent from a fresh clone): this was the one
metrics endpoint still on the PocketBase HTTP path (measured 1614ms), while
its siblings in metrics.py already used
``_create_repository()`` for the direct-SQL route (measured 82ms).
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bunking.auth_middleware import AuthUser


def _fake_user() -> AuthUser:
    return AuthUser(username="staff", email="staff@example.com", display_name="Staff", groups=[], is_admin=True)


@pytest.mark.asyncio
async def test_session_availability_uses_create_repository() -> None:
    """The router must build its repository via the metrics module's factory."""
    from api.routers import session_availability

    sentinel_repo = object()

    with (
        patch(
            "api.routers.session_availability._create_repository",
            return_value=sentinel_repo,
        ) as mock_factory,
        patch("api.routers.session_availability.SessionAvailabilityService") as mock_service_cls,
    ):
        mock_service = MagicMock()
        mock_service.calculate_availability = AsyncMock(return_value=object())
        mock_service_cls.return_value = mock_service

        await session_availability.get_session_availability(
            year=2026,
            session_types="main,embedded,ag,quest",
            session_cm_id=None,
            duration=None,
            user=_fake_user(),
        )

        mock_factory.assert_called_once()
        mock_service_cls.assert_called_once_with(sentinel_repo)


@pytest.mark.asyncio
async def test_session_availability_shares_metrics_factory() -> None:
    """The imported factory must be the same object metrics.py's endpoints use.

    Guards against a copy/fork of `_create_repository` drifting from the
    METRICS_SQL_ENABLED behavior the other 7 metrics endpoints rely on.
    """
    from api.routers import metrics, session_availability

    # getattr (not a direct attribute access) sidesteps mypy's
    # --no-implicit-reexport check on this private, re-exported name.
    assert getattr(session_availability, "_create_repository") is getattr(  # noqa: B009
        metrics, "_create_repository"
    )

"""Tests for PocketBase auth token periodic refresh.

The refresh mechanism should:
- Create a background task that periodically calls authenticate_pb()
- Be cancellable without errors
- Survive authentication failures (log error, continue loop)
"""

import asyncio
from unittest.mock import AsyncMock, patch

import pytest


@pytest.fixture
def _mock_settings():
    """Skip PB auth for import."""
    with patch.dict("os.environ", {"SKIP_PB_AUTH": "true"}):
        yield


@pytest.mark.usefixtures("_mock_settings")
class TestStartPbTokenRefresh:
    """Tests for start_pb_token_refresh()."""

    @pytest.mark.asyncio
    async def test_calls_authenticate_pb_after_interval(self):
        """The refresh task calls authenticate_pb() after the interval elapses."""
        from api.dependencies import start_pb_token_refresh

        with patch("api.dependencies.authenticate_pb", new_callable=AsyncMock) as mock_auth:
            # Use a tiny interval so the test runs fast
            task = await start_pb_token_refresh(interval_seconds=0.05)

            # Wait long enough for at least one refresh cycle
            await asyncio.sleep(0.15)

            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task

            assert mock_auth.call_count >= 1

    @pytest.mark.asyncio
    async def test_task_is_cancellable(self):
        """The refresh task can be cancelled cleanly."""
        from api.dependencies import start_pb_token_refresh

        with patch("api.dependencies.authenticate_pb", new_callable=AsyncMock):
            task = await start_pb_token_refresh(interval_seconds=60)

            assert not task.done()
            task.cancel()

            with pytest.raises(asyncio.CancelledError):
                await task

            assert task.cancelled()

    @pytest.mark.asyncio
    async def test_survives_auth_failure(self):
        """The task keeps running after an authentication failure."""
        from api.dependencies import start_pb_token_refresh

        call_count = 0

        async def flaky_auth():
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise ConnectionError("PocketBase unreachable")
            # Succeed on subsequent calls

        with patch("api.dependencies.authenticate_pb", side_effect=flaky_auth):
            task = await start_pb_token_refresh(interval_seconds=0.05)

            # Wait for at least 2 cycles (first fails, second succeeds)
            await asyncio.sleep(0.2)

            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task

            # Should have been called at least twice — survived the first failure
            assert call_count >= 2

"""Tests for the PocketBase superuser auth probe.

The probe loop should:
- Run every PB_AUTH_PROBE_INTERVAL_SECONDS (about a minute), not hourly: a
  rotated superuser token is answered as a guest's request, which on an
  auth-ruled collection is 200 with no items, so nothing else notices it
- Call probe_pb_auth(), which renews a live token with auth-refresh and falls
  back to a full password auth when that fails
- Be cancellable without errors
- Survive probe failures (log, continue loop)
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


@pytest.fixture
def _mock_settings():
    """Skip PB auth for import."""
    with patch.dict("os.environ", {"SKIP_PB_AUTH": "true"}):
        yield


@pytest.mark.usefixtures("_mock_settings")
class TestStartPbTokenRefresh:
    """Tests for start_pb_token_refresh()."""

    def test_default_interval_is_about_a_minute(self):
        import inspect

        from api import dependencies

        assert dependencies.PB_AUTH_PROBE_INTERVAL_SECONDS <= 60
        default = inspect.signature(dependencies.start_pb_token_refresh).parameters["interval_seconds"].default
        assert default is None or default == dependencies.PB_AUTH_PROBE_INTERVAL_SECONDS

    @pytest.mark.asyncio
    async def test_default_interval_comes_from_the_module_constant(self):
        """Tests shrink the constant; the loop must read it rather than a baked-in default."""
        from api import dependencies

        with (
            patch.object(dependencies, "PB_AUTH_PROBE_INTERVAL_SECONDS", 0.05),
            patch("api.dependencies.probe_pb_auth", new_callable=AsyncMock) as mock_probe,
        ):
            task = await dependencies.start_pb_token_refresh()
            loop = asyncio.get_running_loop()
            deadline = loop.time() + 5.0
            while mock_probe.call_count < 1 and loop.time() < deadline:
                await asyncio.sleep(0.01)
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task

        assert mock_probe.call_count >= 1

    @pytest.mark.asyncio
    async def test_calls_probe_after_interval(self):
        """The loop probes the token after the interval elapses."""
        from api.dependencies import start_pb_token_refresh

        with patch("api.dependencies.probe_pb_auth", new_callable=AsyncMock) as mock_probe:
            task = await start_pb_token_refresh(interval_seconds=0.05)

            loop = asyncio.get_running_loop()
            deadline = loop.time() + 5.0
            while mock_probe.call_count < 1 and loop.time() < deadline:
                await asyncio.sleep(0.01)

            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task

            assert mock_probe.call_count >= 1

    @pytest.mark.asyncio
    async def test_task_is_cancellable(self):
        """The refresh task can be cancelled cleanly."""
        from api.dependencies import start_pb_token_refresh

        with patch("api.dependencies.probe_pb_auth", new_callable=AsyncMock):
            task = await start_pb_token_refresh(interval_seconds=60)

            assert not task.done()
            task.cancel()

            with pytest.raises(asyncio.CancelledError):
                await task

            assert task.cancelled()

    @pytest.mark.asyncio
    async def test_survives_probe_failure(self):
        """The task keeps running after a probe (and its fallback re-auth) fails."""
        from api.dependencies import start_pb_token_refresh

        call_count = 0

        async def flaky_probe():
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise ConnectionError("PocketBase unreachable")

        with patch("api.dependencies.probe_pb_auth", side_effect=flaky_probe):
            task = await start_pb_token_refresh(interval_seconds=0.05)

            # Poll for the second cycle rather than sleeping a fixed wall-clock
            # budget: under a loaded xdist run the loop can be starved.
            loop = asyncio.get_running_loop()
            deadline = loop.time() + 5.0
            while call_count < 2 and loop.time() < deadline:
                await asyncio.sleep(0.01)

            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task

            assert call_count >= 2


@pytest.mark.usefixtures("_mock_settings")
class TestProbePbAuth:
    @pytest.mark.asyncio
    async def test_probe_refreshes_or_reauthenticates_the_global_client(self):
        from api import dependencies

        fake_pb = MagicMock()
        with patch.object(dependencies, "pb", fake_pb):
            await dependencies.probe_pb_auth()

        fake_pb.refresh_or_reauthenticate.assert_called_once_with()

    @pytest.mark.asyncio
    async def test_probe_failure_propagates_for_the_loop_to_log(self):
        from api import dependencies

        fake_pb = MagicMock()
        fake_pb.refresh_or_reauthenticate.side_effect = ConnectionError("PocketBase unreachable")
        with patch.object(dependencies, "pb", fake_pb), pytest.raises(ConnectionError):
            await dependencies.probe_pb_auth()


@pytest.mark.usefixtures("_mock_settings")
class TestClientsRecoverFromRotation:
    """Every superuser client the api owns goes through the one retry choke point."""

    def test_global_client_is_a_superuser_client(self):
        from api.dependencies import pb
        from api.services.pb_superuser_client import SuperuserPocketBase

        assert isinstance(pb, SuperuserPocketBase)

    def test_task_clients_are_superuser_clients(self):
        from api.dependencies import create_task_pb_client
        from api.services.pb_superuser_client import SuperuserPocketBase

        first = create_task_pb_client()
        second = create_task_pb_client()
        assert isinstance(first, SuperuserPocketBase)
        assert first is not second  # still isolated per task

    @pytest.mark.asyncio
    async def test_authenticate_task_pb_uses_the_client_auth(self):
        from api.dependencies import authenticate_task_pb

        task_pb = MagicMock()
        await authenticate_task_pb(task_pb)
        task_pb.authenticate.assert_called_once_with()

    @pytest.mark.asyncio
    async def test_authenticate_pb_uses_the_client_auth(self):
        from api import dependencies

        fake_pb = MagicMock()
        with patch.object(dependencies, "pb", fake_pb):
            await dependencies.authenticate_pb()
        fake_pb.authenticate.assert_called_once_with()

    @pytest.mark.asyncio
    async def test_solver_task_builds_its_client_through_the_factory(self):
        """The solver background task used to construct a bare PocketBase client of its own."""
        from api.dependencies import solver_runs
        from api.services import solver_runner

        class StopError(Exception):
            pass

        run_id = "run-reauth-wiring"
        solver_runs[run_id] = {"status": "pending"}
        try:
            with (
                patch.object(solver_runner, "create_task_pb_client", return_value=MagicMock()) as factory,
                patch.object(solver_runner, "authenticate_task_pb", AsyncMock(side_effect=StopError())) as auth,
                patch.object(solver_runner, "_persist_run_record", AsyncMock()),
            ):
                await solver_runner.run_solver_task_v2(run_id, 1000001, 2026, 5)
            factory.assert_called_once_with()
            auth.assert_awaited_once_with(factory.return_value)
        finally:
            solver_runs.pop(run_id, None)

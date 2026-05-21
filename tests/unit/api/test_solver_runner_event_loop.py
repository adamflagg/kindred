"""Tests that the synchronous CPU-bound solver does not block the event loop.

Regression guard for the production incident where POST /api/solver/run
returned a job UUID immediately but the actual solve ran on the asyncio
event loop, starving GET /api/solver/run/{uuid}, GET /health, and the
container HEALTHCHECK probe — which surfaced as Cloudflare 524s on the
frontend's status poll.

The fix is to offload `solver.solve(...)` (and the failure-path
`solver.find_infeasibility_cause(...)`) to a worker thread via
`asyncio.to_thread` so the event loop stays responsive while the solver
runs.
"""

import asyncio
import time
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import api.services.solver_runner as sr_module
from bunking.models_v2 import DirectSolverInput


def _build_mock_result() -> MagicMock:
    result = MagicMock()
    result.assignments = []
    result.stats = {"status": "OPTIMAL", "solve_time": 0.0}
    result.satisfied_requests = {}
    return result


def _patches(mock_runs: dict[str, dict[str, object]], solver_input: DirectSolverInput) -> list[Any]:
    return [
        patch.object(sr_module, "fetch_session_data_v2", new_callable=AsyncMock, return_value=([], [], [], [], [])),
        patch.object(sr_module, "fetch_historical_bunking", new_callable=AsyncMock, return_value=[]),
        patch.object(sr_module, "prepare_direct_solver_input", return_value=solver_input),
        patch.object(sr_module, "ConfigLoader"),
        patch.object(sr_module, "DirectBunkingSolver"),
        patch.object(sr_module, "PocketBase"),
        patch.object(sr_module, "get_settings"),
        patch.object(sr_module, "solver_runs", mock_runs),
    ]


@pytest.mark.asyncio
async def test_solver_solve_does_not_block_event_loop() -> None:
    """A sync `solver.solve()` call must not block other async tasks.

    Simulates the production bug by mocking `DirectBunkingSolver.solve` to
    do `time.sleep(SOLVE_DURATION)` (a real blocking call). A ticker
    coroutine running concurrently records timestamps each time it is
    scheduled. We then count only ticks whose timestamps fall inside the
    [solve_start, solve_end] window. If `solver.solve` runs on the event
    loop (the bug), zero ticks land in that window. If it is offloaded
    via `asyncio.to_thread` (the fix), the ticker runs freely throughout.
    """
    solve_duration = 0.5
    tick_interval = 0.05
    # Theoretical max ticks during the solve window is solve_duration / tick_interval.
    # We require a small fraction of that — enough to unambiguously distinguish a
    # fully blocked loop (0 ticks) from a free one, while leaving plenty of slack
    # for slow / single-core CI runners where event-loop scheduling jitter could
    # otherwise compress the observable window.
    min_expected_ticks_during_solve = 3

    solver_input = DirectSolverInput(persons=[], requests=[], bunks=[])
    mock_runs: dict[str, dict[str, object]] = {"test_run": {}}

    solve_start = 0.0
    solve_end = 0.0

    def blocking_solve(**_kwargs: object) -> MagicMock:
        nonlocal solve_start, solve_end
        solve_start = time.monotonic()
        time.sleep(solve_duration)
        solve_end = time.monotonic()
        return _build_mock_result()

    patches = _patches(mock_runs, solver_input)
    contexts = [p.start() for p in patches]
    try:
        (
            _mock_fetch,
            _mock_hist,
            _mock_prep,
            mock_cfg,
            mock_solver_cls,
            mock_pb_cls,
            mock_settings,
            _solver_runs_patch,
        ) = contexts

        mock_cfg.get_instance.return_value = MagicMock()

        mock_solver = MagicMock()
        mock_solver.solve.side_effect = blocking_solve
        mock_solver_cls.return_value = mock_solver

        mock_pb = MagicMock()
        mock_pb.collection.return_value.create.return_value = MagicMock(id="rec_1")
        mock_pb_cls.return_value = mock_pb

        mock_settings.return_value = MagicMock(
            pocketbase_admin_email="admin@camp.local",
            pocketbase_admin_password="pass",
        )

        tick_timestamps: list[float] = []
        ticker_started = asyncio.Event()

        async def ticker() -> None:
            ticker_started.set()
            while True:
                await asyncio.sleep(tick_interval)
                tick_timestamps.append(time.monotonic())

        ticker_task = asyncio.create_task(ticker())
        await ticker_started.wait()

        try:
            await sr_module.run_solver_task_v2(
                run_id="test_run",
                session_cm_id=1,
                year=2026,
                time_limit=60,
            )
        finally:
            ticker_task.cancel()
            try:
                await ticker_task
            except asyncio.CancelledError:
                pass

        assert mock_solver.solve.called, "Mocked solver.solve was never invoked"
        assert solve_start > 0, "blocking_solve did not record solve_start"
        assert solve_end > solve_start, "blocking_solve did not record solve_end after solve_start"

        ticks_during_solve = [t for t in tick_timestamps if solve_start <= t <= solve_end]
        assert len(ticks_during_solve) >= min_expected_ticks_during_solve, (
            f"Event loop appears blocked during sync solver: only {len(ticks_during_solve)} ticks "
            f"observed during the {solve_duration}s blocking solve window "
            f"(expected >= {min_expected_ticks_during_solve}). solver.solve() must be offloaded "
            f"via asyncio.to_thread(). Total ticks across full test: {len(tick_timestamps)}."
        )
    finally:
        for p in patches:
            p.stop()

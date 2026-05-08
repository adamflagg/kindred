"""TDD tests for sweep orchestration."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from api.services.sweep_registry import SweepRegistry
from api.services.sweep_runner import run_sweep


@pytest.mark.asyncio
async def test_runs_each_budget_sequentially_with_sweep_id() -> None:
    registry = SweepRegistry()
    registry.register("sw_1")
    invoked: list[tuple[str, int]] = []

    async def fake_run(run_id: str, session_cm_id: int, year: int, time_limit: int, **kwargs: object) -> None:
        invoked.append((run_id, time_limit))

    with patch("api.services.sweep_runner.run_solver_task_v2", side_effect=fake_run):
        await run_sweep(
            sweep_id="sw_1",
            run_ids=["r1", "r2", "r3", "r4"],
            time_budgets=[30, 60, 180, 300],
            session_cm_id=2,
            year=2026,
            scenario=None,
            scenario_name=None,
            label="my-bench",
            registry=registry,
            frozen_input=MagicMock(),
        )

    assert invoked == [("r1", 30), ("r2", 60), ("r3", 180), ("r4", 300)]


@pytest.mark.asyncio
async def test_aborts_remaining_runs_when_cancelled_between() -> None:
    registry = SweepRegistry()
    registry.register("sw_1")
    invoked: list[str] = []

    async def fake_run(run_id: str, **kwargs: object) -> None:
        invoked.append(run_id)
        if run_id == "r1":
            registry.cancel("sw_1")

    with patch("api.services.sweep_runner.run_solver_task_v2", side_effect=fake_run):
        await run_sweep(
            sweep_id="sw_1",
            run_ids=["r1", "r2", "r3", "r4"],
            time_budgets=[30, 60, 180, 300],
            session_cm_id=2,
            year=2026,
            scenario=None,
            scenario_name=None,
            label=None,
            registry=registry,
            frozen_input=MagicMock(),
        )

    assert invoked == ["r1"]


@pytest.mark.asyncio
async def test_releases_registry_entry_when_done() -> None:
    registry = SweepRegistry()
    registry.register("sw_1")

    async def fake_run(*args: object, **kwargs: object) -> None:
        return None

    with patch("api.services.sweep_runner.run_solver_task_v2", side_effect=fake_run):
        await run_sweep(
            sweep_id="sw_1",
            run_ids=["r1"],
            time_budgets=[30],
            session_cm_id=2,
            year=2026,
            scenario=None,
            scenario_name=None,
            label=None,
            registry=registry,
            frozen_input=MagicMock(),
        )

    # Entry cleared so registry doesn't leak across sweeps
    assert registry.is_cancelled("sw_1") is False
    assert "sw_1" not in registry._sweeps


@pytest.mark.asyncio
async def test_releases_registry_entry_even_on_exception() -> None:
    """Cleanup must happen in finally so a child-run exception doesn't leak state."""
    registry = SweepRegistry()
    registry.register("sw_1")

    async def fake_run(*args: object, **kwargs: object) -> None:
        raise RuntimeError("simulated child failure")

    with patch("api.services.sweep_runner.run_solver_task_v2", side_effect=fake_run):
        with pytest.raises(RuntimeError):
            await run_sweep(
                sweep_id="sw_1",
                run_ids=["r1"],
                time_budgets=[30],
                session_cm_id=2,
                year=2026,
                scenario=None,
                scenario_name=None,
                label=None,
                registry=registry,
                frozen_input=MagicMock(),
            )

    assert "sw_1" not in registry._sweeps


def test_run_ids_and_time_budgets_must_be_same_length() -> None:
    """Defensive: mismatched lengths is a programming bug — fail loudly."""
    import asyncio

    registry = SweepRegistry()
    registry.register("sw_1")

    async def call() -> None:
        await run_sweep(
            sweep_id="sw_1",
            run_ids=["r1", "r2"],
            time_budgets=[30],  # length mismatch
            session_cm_id=2,
            year=2026,
            scenario=None,
            scenario_name=None,
            label=None,
            registry=registry,
            frozen_input=MagicMock(),
        )

    with pytest.raises(ValueError, match="same length"):
        asyncio.run(call())


def test_releases_registry_entry_on_length_mismatch() -> None:
    """Validation failure must release the registry entry — otherwise it leaks forever."""
    import asyncio

    registry = SweepRegistry()
    registry.register("sw_leak")

    async def call() -> None:
        await run_sweep(
            sweep_id="sw_leak",
            run_ids=["r1", "r2"],
            time_budgets=[30],  # mismatch
            session_cm_id=2,
            year=2026,
            scenario=None,
            scenario_name=None,
            label=None,
            registry=registry,
            frozen_input=MagicMock(),
        )

    with pytest.raises(ValueError, match="same length"):
        asyncio.run(call())

    # The registry must NOT still hold the sweep_id after a validation failure.
    assert "sw_leak" not in registry._sweeps


@pytest.mark.asyncio
async def test_marks_remaining_run_ids_cancelled_when_sweep_cancelled() -> None:
    """When sweep is cancelled mid-loop, the un-launched pre-created run_ids
    must be moved out of 'pending' so they don't show as ghosts in the debug UI."""
    registry = SweepRegistry()
    registry.register("sw_cancel")

    # Mock solver_runs state pre-populated with all four pending entries
    # (mirrors what /solver/run-sweep does before scheduling run_sweep).
    fake_solver_runs: dict[str, dict[str, object]] = {
        "r1": {"id": "r1", "status": "pending"},
        "r2": {"id": "r2", "status": "pending"},
        "r3": {"id": "r3", "status": "pending"},
        "r4": {"id": "r4", "status": "pending"},
    }

    async def fake_run(run_id: str, **kwargs: object) -> None:
        # First child cancels the sweep, marking the rest as orphaned-pending without our fix.
        if run_id == "r1":
            registry.cancel("sw_cancel")

    with (
        patch("api.services.sweep_runner.run_solver_task_v2", side_effect=fake_run),
        patch("api.services.sweep_runner.solver_runs", fake_solver_runs),
    ):
        await run_sweep(
            sweep_id="sw_cancel",
            run_ids=["r1", "r2", "r3", "r4"],
            time_budgets=[30, 60, 180, 300],
            session_cm_id=2,
            year=2026,
            scenario=None,
            scenario_name=None,
            label=None,
            registry=registry,
            frozen_input=MagicMock(),
        )

    # r1 ran (its status is updated by run_solver_task_v2, which is mocked,
    # so we don't assert on r1). r2/r3/r4 must NOT remain "pending".
    for unstarted in ("r2", "r3", "r4"):
        assert fake_solver_runs[unstarted]["status"] == "cancelled", (
            f"{unstarted} should be 'cancelled', got {fake_solver_runs[unstarted]['status']!r}"
        )


@pytest.mark.asyncio
async def test_marks_remaining_run_ids_failed_when_child_raises() -> None:
    """When a child run raises, remaining un-launched run_ids must transition
    out of 'pending' so they don't sit forever in the debug UI."""
    registry = SweepRegistry()
    registry.register("sw_err")

    fake_solver_runs: dict[str, dict[str, object]] = {
        "r1": {"id": "r1", "status": "pending"},
        "r2": {"id": "r2", "status": "pending"},
        "r3": {"id": "r3", "status": "pending"},
    }

    async def fake_run(run_id: str, **kwargs: object) -> None:
        if run_id == "r2":
            raise RuntimeError("simulated child crash")

    with (
        patch("api.services.sweep_runner.run_solver_task_v2", side_effect=fake_run),
        patch("api.services.sweep_runner.solver_runs", fake_solver_runs),
    ):
        with pytest.raises(RuntimeError):
            await run_sweep(
                sweep_id="sw_err",
                run_ids=["r1", "r2", "r3"],
                time_budgets=[30, 60, 180],
                session_cm_id=2,
                year=2026,
                scenario=None,
                scenario_name=None,
                label=None,
                registry=registry,
                frozen_input=MagicMock(),
            )

    # r3 (un-launched) must NOT remain "pending".
    assert fake_solver_runs["r3"]["status"] == "failed", (
        f"r3 should be 'failed', got {fake_solver_runs['r3']['status']!r}"
    )

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

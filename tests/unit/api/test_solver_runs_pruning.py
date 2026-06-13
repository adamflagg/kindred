"""Bounded retention for the in-memory solver_runs dict.

Every completed/failed run used to stay in the module-level dict forever —
unbounded growth in a long-lived API process (prod swap incident 2026-06-12).
prune_solver_runs caps terminal entries; in-flight runs are never evicted
(single-flight guards and frontend polling depend on them).
"""

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest

from api.dependencies import MAX_TERMINAL_SOLVER_RUNS, prune_solver_runs, solver_runs


@pytest.fixture(autouse=True)
def _clean_solver_runs() -> Iterator[None]:
    solver_runs.clear()
    yield
    solver_runs.clear()


def _seed(n_terminal: int, n_running: int = 0) -> None:
    base = datetime(2026, 6, 1, tzinfo=UTC)
    for i in range(n_terminal):
        solver_runs[f"t{i}"] = {"status": "completed", "completed_at": base + timedelta(minutes=i)}
    for i in range(n_running):
        solver_runs[f"r{i}"] = {"status": "running"}


class TestPruneSolverRuns:
    def test_under_cap_no_eviction(self) -> None:
        _seed(MAX_TERMINAL_SOLVER_RUNS)
        assert prune_solver_runs() == 0
        assert len(solver_runs) == MAX_TERMINAL_SOLVER_RUNS

    def test_over_cap_evicts_oldest_terminal_first(self) -> None:
        _seed(MAX_TERMINAL_SOLVER_RUNS + 3)
        assert prune_solver_runs() == 3
        assert "t0" not in solver_runs
        assert "t1" not in solver_runs
        assert "t2" not in solver_runs
        assert f"t{MAX_TERMINAL_SOLVER_RUNS + 2}" in solver_runs

    def test_in_flight_never_evicted(self) -> None:
        _seed(MAX_TERMINAL_SOLVER_RUNS + 2, n_running=5)
        prune_solver_runs()
        running = [r for r in solver_runs.values() if r["status"] == "running"]
        assert len(running) == 5

    def test_pending_never_evicted(self) -> None:
        _seed(MAX_TERMINAL_SOLVER_RUNS + 1)
        solver_runs["p0"] = {"status": "pending"}
        prune_solver_runs()
        assert "p0" in solver_runs

    def test_failed_counts_as_terminal(self) -> None:
        _seed(MAX_TERMINAL_SOLVER_RUNS)
        solver_runs["f0"] = {"status": "failed", "completed_at": datetime(2026, 1, 1, tzinfo=UTC)}
        assert prune_solver_runs() == 1
        assert "f0" not in solver_runs  # oldest terminal entry

    def test_missing_completed_at_treated_as_oldest(self) -> None:
        _seed(MAX_TERMINAL_SOLVER_RUNS)
        solver_runs["weird"] = {"status": "completed"}
        prune_solver_runs()
        assert "weird" not in solver_runs

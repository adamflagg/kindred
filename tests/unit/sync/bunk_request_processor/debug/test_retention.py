"""Tests for pipeline debug retention policy."""

from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock

from bunking.sync.bunk_request_processor.debug.retention import MAX_AGE_DAYS, MAX_RUNS, cleanup_old_runs


class TestRetentionPolicy:
    def test_max_runs_constant(self):
        assert MAX_RUNS == 50

    def test_max_age_days_constant(self):
        assert MAX_AGE_DAYS == 30

    def test_no_cleanup_under_limit(self):
        """No cleanup when under both limits."""
        pb = MagicMock()
        # 10 runs, all recent, none pinned
        runs = [_make_run(f"run_{i}", pinned=False, age_days=1) for i in range(10)]
        pb.collection.return_value.get_full_list.return_value = runs
        cleanup_old_runs(pb)
        # Should not delete anything
        pb.collection.return_value.delete.assert_not_called()

    def test_pinned_runs_exempt(self):
        """Pinned runs are never deleted even if old."""
        pb = MagicMock()
        runs = [_make_run("old_pinned", pinned=True, age_days=60)]
        pb.collection.return_value.get_full_list.return_value = runs
        cleanup_old_runs(pb)
        pb.collection.return_value.delete.assert_not_called()

    def test_old_unpinned_runs_deleted(self):
        """Unpinned runs older than MAX_AGE_DAYS are deleted."""
        pb = MagicMock()
        old_run = _make_run("old_run", pinned=False, age_days=45)
        recent_run = _make_run("recent_run", pinned=False, age_days=5)
        pb.collection.return_value.get_full_list.side_effect = [
            # First call: get all runs
            [recent_run, old_run],
            # Second call: get traces for the old run
            [],
        ]
        result = cleanup_old_runs(pb)
        assert result == 1

    def test_count_based_cleanup(self):
        """When unpinned count exceeds MAX_RUNS, oldest are deleted."""
        pb = MagicMock()
        # Create MAX_RUNS + 5 unpinned runs, all recent (no time-based deletion)
        runs = [_make_run(f"run_{i}", pinned=False, age_days=1) for i in range(MAX_RUNS + 5)]
        # First call returns all runs; subsequent calls return empty trace lists
        pb.collection.return_value.get_full_list.side_effect = [runs] + [[] for _ in range(5)]
        result = cleanup_old_runs(pb)
        assert result == 5

    def test_returns_zero_for_empty(self):
        """Returns 0 when there are no runs."""
        pb = MagicMock()
        pb.collection.return_value.get_full_list.return_value = []
        result = cleanup_old_runs(pb)
        assert result == 0

    def test_mixed_pinned_and_unpinned(self):
        """Pinned runs excluded from count; only unpinned count matters."""
        pb = MagicMock()
        pinned_runs = [_make_run(f"pinned_{i}", pinned=True, age_days=1) for i in range(20)]
        unpinned_runs = [_make_run(f"unpinned_{i}", pinned=False, age_days=1) for i in range(10)]
        all_runs = pinned_runs + unpinned_runs
        pb.collection.return_value.get_full_list.return_value = all_runs
        result = cleanup_old_runs(pb)
        # 10 unpinned is under MAX_RUNS, so no deletion
        assert result == 0


def _make_run(run_id: str, pinned: bool = False, age_days: int = 0) -> MagicMock:
    run = MagicMock()
    run.id = f"id_{run_id}"
    run.run_id = run_id
    run.pinned = pinned
    created = datetime.now(UTC) - timedelta(days=age_days)
    run.created = created.isoformat()
    return run

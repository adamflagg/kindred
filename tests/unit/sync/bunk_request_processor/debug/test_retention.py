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
        pb = _make_pb_mock(
            expired_runs=[],
            unpinned_runs=[_make_run(f"run_{i}", pinned=False, age_days=1) for i in range(10)],
            total_count=10,
        )
        cleanup_old_runs(pb)
        # Should not delete anything (no traces or run deletes)
        _assert_no_deletes(pb)

    def test_pinned_runs_exempt(self):
        """Pinned runs are never deleted even if old."""
        pb = _make_pb_mock(
            expired_runs=[],  # expired query filters pinned=false, so pinned won't appear
            unpinned_runs=[],
            total_count=1,  # 1 pinned run total
        )
        cleanup_old_runs(pb)
        _assert_no_deletes(pb)

    def test_old_unpinned_runs_deleted(self):
        """Unpinned runs older than MAX_AGE_DAYS are deleted."""
        old_run = _make_run("old_run", pinned=False, age_days=45)
        recent_run = _make_run("recent_run", pinned=False, age_days=5)

        pb = _make_pb_mock(
            expired_runs=[old_run],
            unpinned_runs=[recent_run, old_run],
            total_count=2,
            trace_results={old_run.run_id: []},
        )
        result = cleanup_old_runs(pb)
        assert result == 1

    def test_count_based_cleanup(self):
        """When unpinned count exceeds MAX_RUNS, oldest are deleted."""
        # Create MAX_RUNS + 5 unpinned runs, all recent (no time-based deletion)
        runs = [_make_run(f"run_{i}", pinned=False, age_days=1) for i in range(MAX_RUNS + 5)]

        pb = _make_pb_mock(
            expired_runs=[],
            unpinned_runs=runs,
            total_count=MAX_RUNS + 5,
            # Last 5 runs (oldest) should be deleted; provide empty trace lists for them
            trace_results={runs[i].run_id: [] for i in range(MAX_RUNS, MAX_RUNS + 5)},
        )
        result = cleanup_old_runs(pb)
        assert result == 5

    def test_returns_zero_for_empty(self):
        """Returns 0 when there are no runs."""
        pb = _make_pb_mock(expired_runs=[], unpinned_runs=[], total_count=0)
        result = cleanup_old_runs(pb)
        assert result == 0

    def test_mixed_pinned_and_unpinned(self):
        """Pinned runs excluded from count; only unpinned count matters."""
        unpinned_runs = [_make_run(f"unpinned_{i}", pinned=False, age_days=1) for i in range(10)]

        pb = _make_pb_mock(
            expired_runs=[],
            unpinned_runs=unpinned_runs,
            total_count=30,  # 20 pinned + 10 unpinned
        )
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


def _make_pb_mock(
    expired_runs: list[MagicMock],
    unpinned_runs: list[MagicMock],
    total_count: int,
    trace_results: dict[str, list[MagicMock]] | None = None,
) -> MagicMock:
    """Build a PB mock that responds correctly to the new targeted-query retention logic.

    cleanup_old_runs makes these calls (keyed on method + filter; order-agnostic):
    1. get_list(1, 1, query_params={trigger='upload'})           -> page.items = [] (no upload runs)
    2. get_full_list(filter='pinned = false && created < ...')   -> expired_runs
    3. get_full_list(filter='pinned = false', sort='-created')   -> unpinned_runs
    4. get_list(1, 1)  (no query_params)                         -> page.total_items = total_count
    5. For each run to delete: get_full_list(filter='run_id = "..."') -> traces
    """
    pb = MagicMock()
    trace_results = trace_results or {}

    # Track per-collection call sequences
    runs_collection = MagicMock()
    traces_collection = MagicMock()

    def collection_router(name: str) -> MagicMock:
        if name == "debug_pipeline_runs":
            return runs_collection
        elif name == "debug_pipeline_traces":
            return traces_collection
        return MagicMock()

    pb.collection.side_effect = collection_router

    # get_full_list calls: keyed on filter string so call order doesn't matter
    def runs_get_full_list(query_params: dict[str, str] | None = None, **kwargs: object) -> list[MagicMock]:
        f = (query_params or {}).get("filter", "")
        # Time-based expired query
        if "created <" in f:
            return expired_runs
        # All-unpinned query (count-based)
        return unpinned_runs

    runs_collection.get_full_list.side_effect = runs_get_full_list

    # get_list calls: newest-upload single-row fetch (has query_params) vs total-count fetch
    def runs_get_list(
        page: int = 1, per_page: int = 30, query_params: dict[str, str] | None = None, **kwargs: object
    ) -> MagicMock:
        f = (query_params or {}).get("filter", "")
        page_result = MagicMock()
        if "trigger" in f and "upload" in f:
            page_result.items = []  # no upload runs in most tests
        else:
            page_result.total_items = total_count
            page_result.items = []
        return page_result

    runs_collection.get_list.side_effect = runs_get_list

    # Trace lookups for runs being deleted
    def traces_full_list(query_params: dict[str, str] | None = None, **kwargs: object) -> list[MagicMock]:
        if query_params and "filter" in query_params:
            filter_str = query_params["filter"]
            for run_id, traces in trace_results.items():
                if run_id in filter_str:
                    return traces
        return []

    traces_collection.get_full_list.side_effect = traces_full_list

    return pb


def _assert_no_deletes(pb: MagicMock) -> None:
    """Assert no delete calls were made on any collection."""
    for c in [pb.collection("debug_pipeline_runs"), pb.collection("debug_pipeline_traces")]:
        if hasattr(c, "delete"):
            c.delete.assert_not_called()

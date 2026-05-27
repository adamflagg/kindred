"""Tests that the newest upload run is exempt from retention deletion.

The per-session "what's new" summary reads the latest trigger='upload' run.
Even if many scheduled runs push the upload run past MAX_RUNS or MAX_AGE_DAYS,
the single most-recent upload run must be preserved.
"""

from typing import Any
from unittest.mock import MagicMock

from bunking.sync.bunk_request_processor.debug.retention import MAX_RUNS, cleanup_old_runs


def _run(rid: str, created: str, trigger: str = "scheduled", pinned: bool = False) -> MagicMock:
    r = MagicMock()
    r.id = rid
    r.run_id = rid  # retention code uses run.run_id for trace lookups
    r.created = created
    r.trigger = trigger
    r.pinned = pinned
    return r


def _make_pb(
    expired_runs: list[MagicMock],
    unpinned_runs: list[MagicMock],
    total_count: int,
    newest_upload: MagicMock | None,
) -> tuple[MagicMock, list[str]]:
    """Build a PB mock wired to the real cleanup_old_runs query structure.

    The mock is keyed on method + filter, so call order is irrelevant.

    - debug_pipeline_runs.get_list(1, 1, query_params={trigger='upload'})
        -> page whose .items is [newest_upload] (or [] when no upload runs)
    - debug_pipeline_runs.get_list(1, 1)  (no query_params)
        -> page whose .total_items is total_count (pinned-count estimation)
    - debug_pipeline_runs.get_full_list(filter='... created < ...')  -> expired_runs
    - debug_pipeline_runs.get_full_list(filter='pinned = false')     -> unpinned_runs
    - debug_pipeline_traces.get_full_list(...)                       -> [] (no traces)
    """
    pb = MagicMock()
    deleted: list[str] = []

    runs_col = MagicMock()
    traces_col = MagicMock()

    def collection_router(name: str) -> MagicMock:
        if name == "debug_pipeline_runs":
            return runs_col
        if name == "debug_pipeline_traces":
            return traces_col
        return MagicMock()

    pb.collection.side_effect = collection_router

    def runs_get_full_list(query_params: dict[str, Any] | None = None, **kwargs: object) -> list[MagicMock]:
        f = (query_params or {}).get("filter", "")
        # Time-based expired query
        if "created <" in f:
            return expired_runs
        # All-unpinned query (count-based)
        return unpinned_runs

    runs_col.get_full_list.side_effect = runs_get_full_list

    def runs_get_list(
        page: int = 1, per_page: int = 30, query_params: dict[str, Any] | None = None, **kwargs: object
    ) -> MagicMock:
        f = (query_params or {}).get("filter", "")
        page_result = MagicMock()
        if "trigger" in f and "upload" in f:
            # Newest-upload single-row fetch
            page_result.items = [newest_upload] if newest_upload else []
        else:
            # Total-count fetch (no query_params)
            page_result.total_items = total_count
            page_result.items = []
        return page_result

    runs_col.get_list.side_effect = runs_get_list

    # Track deletes
    runs_col.delete.side_effect = lambda rid: deleted.append(rid)
    traces_col.get_full_list.return_value = []  # no traces to worry about

    return pb, deleted


class TestNewestUploadRunExemption:
    def test_newest_upload_run_exempt_from_count_trim(self) -> None:
        """Upload run survives even when 60 newer scheduled runs push it past MAX_RUNS."""
        # upload run is older; 60 scheduled runs are all newer
        upload = _run("upload-old", "2026-05-01T00:00:00Z", trigger="upload")
        scheduled = [_run(f"s{i}", f"2026-05-{2 + i:02d}T00:00:00Z") for i in range(60)]

        # unpinned sorted newest-first: scheduled (newest) ... upload (oldest)
        all_unpinned = list(reversed(scheduled)) + [upload]  # newest first
        total = len(all_unpinned)  # 61 runs, all unpinned

        pb, deleted = _make_pb(
            expired_runs=[],
            unpinned_runs=all_unpinned,
            total_count=total,
            newest_upload=upload,
        )

        cleanup_old_runs(pb)

        assert "upload-old" not in deleted, "The newest upload run must be exempt from count-based deletion"
        # The 11 oldest scheduled runs (beyond MAX_RUNS=50 after upload is protected)
        # should be deleted; upload itself is safe
        assert len(deleted) > 0, "Some scheduled runs should still be pruned"

    def test_only_newest_upload_run_is_exempt(self) -> None:
        """Older upload runs are NOT exempt — only the single most-recent one is."""
        # Two upload runs: one newer, one older
        newer_upload = _run("upload-new", "2026-05-20T00:00:00Z", trigger="upload")
        older_upload = _run("upload-old", "2026-05-01T00:00:00Z", trigger="upload")
        scheduled = [_run(f"s{i}", f"2026-05-{21 + i:02d}T00:00:00Z") for i in range(60)]

        # sorted newest-first
        all_unpinned = list(reversed(scheduled)) + [newer_upload, older_upload]
        total = len(all_unpinned)

        pb, deleted = _make_pb(
            expired_runs=[],
            unpinned_runs=all_unpinned,
            total_count=total,
            newest_upload=newer_upload,  # only newer_upload is exempt
        )

        cleanup_old_runs(pb)

        # Newer upload is protected
        assert "upload-new" not in deleted, "The newest upload run must not be deleted"
        # Older upload should be pruneable (it's beyond MAX_RUNS=50)
        assert "upload-old" in deleted, "Older upload runs beyond MAX_RUNS should be pruned"

    def test_exempt_still_applies_when_no_upload_runs_exist(self) -> None:
        """cleanup_old_runs works normally when there are no upload runs at all."""
        scheduled = [_run(f"s{i}", f"2026-05-{1 + i:02d}T00:00:00Z") for i in range(MAX_RUNS + 5)]
        all_unpinned = list(reversed(scheduled))  # newest first
        total = len(all_unpinned)

        pb, deleted = _make_pb(
            expired_runs=[],
            unpinned_runs=all_unpinned,
            total_count=total,
            newest_upload=None,
        )

        result = cleanup_old_runs(pb)
        assert result == 5, "5 excess scheduled runs should be deleted"

    def test_newest_upload_run_exempt_from_time_based_trim(self) -> None:
        """Upload run is exempt even when it's old enough to be time-pruned."""
        # An upload run that is 45 days old (past MAX_AGE_DAYS=30)
        old_upload = _run("upload-ancient", "2026-04-01T00:00:00Z", trigger="upload")
        scheduled_recent = [_run(f"s{i}", f"2026-05-{1 + i:02d}T00:00:00Z") for i in range(10)]

        all_unpinned = list(reversed(scheduled_recent)) + [old_upload]
        total = len(all_unpinned)

        pb, deleted = _make_pb(
            expired_runs=[old_upload],  # time-based filter would normally catch it
            unpinned_runs=all_unpinned,
            total_count=total,
            newest_upload=old_upload,  # but it's the newest (only) upload run
        )

        cleanup_old_runs(pb)

        assert "upload-ancient" not in deleted, "The newest upload run must be exempt from time-based deletion too"

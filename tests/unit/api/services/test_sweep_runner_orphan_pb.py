"""_mark_remaining updates orphaned sweep children in PocketBase.

When a sweep is cancelled mid-loop or a child crashes, sibling runs that
were pre-created (status='pending') but never launched must transition to
'cancelled' or 'failed' both in the in-memory ``solver_runs`` dict AND in
the PocketBase ``solver_runs`` collection. Otherwise refresh-recovery
shows ghost pending rows forever.
"""

from unittest.mock import MagicMock, patch

import pytest

import api.services.sweep_runner as sweep_runner_module


class TestMarkRemainingPbSync:
    @pytest.mark.asyncio
    async def test_updates_pb_rows_for_pending_orphans(self) -> None:
        """Each orphan with in-memory status='pending' also gets its PB row updated."""
        mock_runs: dict[str, dict[str, object]] = {
            "run_a": {"status": "success"},  # already finished — must NOT be touched
            "run_b": {"status": "pending"},  # orphan — should transition
            "run_c": {"status": "pending"},  # orphan — should transition
        }
        run_ids = ["run_a", "run_b", "run_c"]

        mock_pb = MagicMock()
        mock_pb.collection.return_value.get_first_list_item.side_effect = [
            MagicMock(id="pb_b"),
            MagicMock(id="pb_c"),
        ]

        with patch.object(sweep_runner_module, "solver_runs", mock_runs):
            await sweep_runner_module._mark_remaining(run_ids, start_idx=1, status="cancelled", pb=mock_pb)

        update_calls = mock_pb.collection.return_value.update.call_args_list
        assert len(update_calls) == 2, f"expected 2 PB updates, got {len(update_calls)}"
        # Each update sets status='cancelled'
        for call in update_calls:
            assert call.args[1].get("status") == "cancelled", call.args[1]
        # In-memory dict is updated too (preserve existing behavior)
        assert mock_runs["run_b"]["status"] == "cancelled"
        assert mock_runs["run_c"]["status"] == "cancelled"
        # Already-settled run untouched
        assert mock_runs["run_a"]["status"] == "success"

    @pytest.mark.asyncio
    async def test_swallows_pb_errors_so_orchestration_continues(self) -> None:
        """A PB hiccup during orphan cleanup must not propagate — the
        orchestration loop is in a finally block and we don't want to crash it."""
        mock_runs: dict[str, dict[str, object]] = {"run_x": {"status": "pending"}}
        mock_pb = MagicMock()
        mock_pb.collection.return_value.get_first_list_item.side_effect = RuntimeError("pb down")

        with patch.object(sweep_runner_module, "solver_runs", mock_runs):
            # Should not raise
            await sweep_runner_module._mark_remaining(["run_x"], start_idx=0, status="failed", pb=mock_pb)

        # In-memory still flips so the API's in-flight guard releases
        assert mock_runs["run_x"]["status"] == "failed"

    @pytest.mark.asyncio
    async def test_pb_optional_for_backwards_compat(self) -> None:
        """Calling without a pb arg keeps the legacy in-memory-only behavior."""
        mock_runs: dict[str, dict[str, object]] = {"run_y": {"status": "pending"}}
        with patch.object(sweep_runner_module, "solver_runs", mock_runs):
            await sweep_runner_module._mark_remaining(["run_y"], start_idx=0, status="failed")
        assert mock_runs["run_y"]["status"] == "failed"

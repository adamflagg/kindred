"""Sweep child runs UPDATE the pre-created PB row rather than CREATE a new one.

The /run-sweep handler pre-creates one solver_runs row per child with
status='pending' so the UI sees the sweep banner from kickoff (survives page
refresh). When the child finishes, run_solver_task_v2 must update that same
row (looked up by run_id) — creating a fresh row would duplicate the sweep
child in the runs table and orphan the original pending row forever.

Solo solver runs (sweep_id=None) keep the existing CREATE behavior since no
pre-created row exists for them.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, _patch, patch

import pytest

import api.services.solver_runner as sr_module
from bunking.models_v2 import DirectSolverInput


@pytest.fixture
def mock_solver_input() -> DirectSolverInput:
    return DirectSolverInput(persons=[], requests=[], bunks=[])


def _patches() -> dict[str, _patch[Any]]:
    return {
        "fetch_session_data_v2": patch.object(sr_module, "fetch_session_data_v2", new_callable=AsyncMock),
        "fetch_historical_bunking": patch.object(sr_module, "fetch_historical_bunking", new_callable=AsyncMock),
        "prepare_direct_solver_input": patch.object(sr_module, "prepare_direct_solver_input"),
        "fetch_lock_groups": patch.object(sr_module, "fetch_lock_groups", new_callable=AsyncMock),
        "ConfigLoader": patch.object(sr_module, "ConfigLoader"),
        "DirectBunkingSolver": patch.object(sr_module, "DirectBunkingSolver"),
        "PocketBase": patch.object(sr_module, "PocketBase"),
        "get_settings": patch.object(sr_module, "get_settings"),
    }


def _configure_pb(mocks: dict[str, Any], *, found_record_id: str | None) -> MagicMock:
    """Return a configured PocketBase mock.

    If `found_record_id` is provided, get_first_list_item returns a record
    with that id (simulating a pre-created sweep row found by run_id filter).
    """
    mock_pb = MagicMock()
    mock_pb.collection.return_value.auth_with_password.return_value = {}
    mock_pb.collection.return_value.create.return_value = MagicMock(id="created_xyz")
    mock_pb.collection.return_value.update.return_value = MagicMock(id=found_record_id or "updated_xyz")
    if found_record_id is not None:
        mock_pb.collection.return_value.get_first_list_item.return_value = MagicMock(id=found_record_id)
    else:
        from pocketbase.client import ClientResponseError  # type: ignore[attr-defined]

        # SDK raises 404 when no record matches the filter
        mock_pb.collection.return_value.get_first_list_item.side_effect = ClientResponseError(
            url="x", status=404, data={}
        )
    mocks["PocketBase"].return_value = mock_pb
    return mock_pb


def _configure_solver(mocks: dict[str, Any], solver_input: DirectSolverInput, succeeds: bool = True) -> None:
    mocks["fetch_session_data_v2"].return_value = ([], [], [], [], [])
    mocks["fetch_historical_bunking"].return_value = []
    mocks["prepare_direct_solver_input"].return_value = solver_input
    mocks["ConfigLoader"].get_instance.return_value = MagicMock()
    mock_solver = MagicMock()
    if succeeds:
        result = MagicMock()
        result.assignments = []
        result.stats = {"status": "OPTIMAL", "solve_time": 5.0}
        result.satisfied_requests = {}
        mock_solver.solve.return_value = result
    else:
        mock_solver.solve.side_effect = ValueError("solver blew up")
    mocks["DirectBunkingSolver"].return_value = mock_solver
    mocks["get_settings"].return_value = MagicMock(
        pocketbase_admin_email="admin@camp.local", pocketbase_admin_password="pass"
    )


class TestSweepChildUpdatesPreCreatedRow:
    @pytest.mark.asyncio
    async def test_sweep_success_updates_existing_row(self, mock_solver_input: DirectSolverInput) -> None:
        """When sweep_id is set, the pre-created row is updated, not duplicated."""
        mock_runs: dict[str, dict[str, object]] = {"sweep_child_1": {"status": "pending"}}
        patches = _patches()
        with (
            patch.object(sr_module, "solver_runs", mock_runs),
            patches["fetch_session_data_v2"] as m1,
            patches["fetch_historical_bunking"] as m2,
            patches["prepare_direct_solver_input"] as m3,
            patches["fetch_lock_groups"] as m4,
            patches["ConfigLoader"] as m5,
            patches["DirectBunkingSolver"] as m6,
            patches["PocketBase"] as m7,
            patches["get_settings"] as m8,
        ):
            mocks = {
                "fetch_session_data_v2": m1,
                "fetch_historical_bunking": m2,
                "prepare_direct_solver_input": m3,
                "fetch_lock_groups": m4,
                "ConfigLoader": m5,
                "DirectBunkingSolver": m6,
                "PocketBase": m7,
                "get_settings": m8,
            }
            mock_pb = _configure_pb(mocks, found_record_id="pre_created_pb_id")
            _configure_solver(mocks, mock_solver_input, succeeds=True)

            await sr_module.run_solver_task_v2(
                run_id="sweep_child_1",
                session_cm_id=1000001,
                year=2026,
                time_limit=60,
                sweep_id="sweep_abc123",
            )

            update_calls = mock_pb.collection.return_value.update.call_args_list
            create_calls = mock_pb.collection.return_value.create.call_args_list
            assert len(update_calls) == 1, f"expected 1 update, got {len(update_calls)}: {update_calls}"
            assert len(create_calls) == 0, (
                f"expected no creates for sweep child, got {len(create_calls)}: {create_calls}"
            )
            # Update targets the pre-created PB record id, with status='success'
            args = update_calls[0].args
            assert args[0] == "pre_created_pb_id", f"update target id: {args[0]}"
            payload = args[1]
            assert payload.get("status") == "success", payload

    @pytest.mark.asyncio
    async def test_sweep_failure_updates_existing_row(self, mock_solver_input: DirectSolverInput) -> None:
        """When sweep_id is set and the solver raises, update the pre-created row to 'failed'."""
        mock_runs: dict[str, dict[str, object]] = {"sweep_child_2": {"status": "pending"}}
        patches = _patches()
        with (
            patch.object(sr_module, "solver_runs", mock_runs),
            patches["fetch_session_data_v2"] as m1,
            patches["fetch_historical_bunking"] as m2,
            patches["prepare_direct_solver_input"] as m3,
            patches["fetch_lock_groups"] as m4,
            patches["ConfigLoader"] as m5,
            patches["DirectBunkingSolver"] as m6,
            patches["PocketBase"] as m7,
            patches["get_settings"] as m8,
        ):
            mocks = {
                "fetch_session_data_v2": m1,
                "fetch_historical_bunking": m2,
                "prepare_direct_solver_input": m3,
                "fetch_lock_groups": m4,
                "ConfigLoader": m5,
                "DirectBunkingSolver": m6,
                "PocketBase": m7,
                "get_settings": m8,
            }
            mock_pb = _configure_pb(mocks, found_record_id="pre_created_pb_id_2")
            _configure_solver(mocks, mock_solver_input, succeeds=False)

            await sr_module.run_solver_task_v2(
                run_id="sweep_child_2",
                session_cm_id=1000001,
                year=2026,
                time_limit=60,
                sweep_id="sweep_xyz789",
            )

            update_calls = mock_pb.collection.return_value.update.call_args_list
            create_calls = mock_pb.collection.return_value.create.call_args_list
            assert len(update_calls) == 1, f"expected 1 update on failure, got {len(update_calls)}"
            assert len(create_calls) == 0, "no fresh row should be created for sweep child failure"
            payload = update_calls[0].args[1]
            assert payload.get("status") == "failed", payload

    @pytest.mark.asyncio
    async def test_solo_run_still_creates(self, mock_solver_input: DirectSolverInput) -> None:
        """Solo (non-sweep) runs keep the existing CREATE behavior."""
        mock_runs: dict[str, dict[str, object]] = {"solo_run": {"status": "pending"}}
        patches = _patches()
        with (
            patch.object(sr_module, "solver_runs", mock_runs),
            patches["fetch_session_data_v2"] as m1,
            patches["fetch_historical_bunking"] as m2,
            patches["prepare_direct_solver_input"] as m3,
            patches["fetch_lock_groups"] as m4,
            patches["ConfigLoader"] as m5,
            patches["DirectBunkingSolver"] as m6,
            patches["PocketBase"] as m7,
            patches["get_settings"] as m8,
        ):
            mocks = {
                "fetch_session_data_v2": m1,
                "fetch_historical_bunking": m2,
                "prepare_direct_solver_input": m3,
                "fetch_lock_groups": m4,
                "ConfigLoader": m5,
                "DirectBunkingSolver": m6,
                "PocketBase": m7,
                "get_settings": m8,
            }
            mock_pb = _configure_pb(mocks, found_record_id=None)
            _configure_solver(mocks, mock_solver_input, succeeds=True)

            await sr_module.run_solver_task_v2(
                run_id="solo_run",
                session_cm_id=1000001,
                year=2026,
                time_limit=60,
                sweep_id=None,
            )

            create_calls = mock_pb.collection.return_value.create.call_args_list
            update_calls = mock_pb.collection.return_value.update.call_args_list
            assert len(create_calls) == 1, f"solo run must CREATE, got {len(create_calls)}"
            assert len(update_calls) == 0, f"solo run must not UPDATE, got {len(update_calls)}"

    @pytest.mark.asyncio
    async def test_non_404_lookup_error_re_raises_without_create(self, mock_solver_input: DirectSolverInput) -> None:
        """A transient lookup failure (e.g. 503) must NOT fall through to CREATE.

        The bare-except fallback would silently write a duplicate solver_runs row
        if the pre-created row actually exists but the lookup glitched. Narrowing
        the handler to 404-only ensures transient errors propagate so the orchestrator
        sees them.
        """
        from pocketbase.client import ClientResponseError  # type: ignore[attr-defined]

        mock_runs: dict[str, dict[str, object]] = {"sweep_child_x": {"status": "pending"}}
        patches = _patches()
        with (
            patch.object(sr_module, "solver_runs", mock_runs),
            patches["fetch_session_data_v2"] as m1,
            patches["fetch_historical_bunking"] as m2,
            patches["prepare_direct_solver_input"] as m3,
            patches["fetch_lock_groups"] as m4,
            patches["ConfigLoader"] as m5,
            patches["DirectBunkingSolver"] as m6,
            patches["PocketBase"] as m7,
            patches["get_settings"] as m8,
        ):
            mocks = {
                "fetch_session_data_v2": m1,
                "fetch_historical_bunking": m2,
                "prepare_direct_solver_input": m3,
                "fetch_lock_groups": m4,
                "ConfigLoader": m5,
                "DirectBunkingSolver": m6,
                "PocketBase": m7,
                "get_settings": m8,
            }
            mock_pb = MagicMock()
            mock_pb.admins.auth_with_password = MagicMock(return_value=MagicMock(token="t"))
            mock_pb.collection.return_value.get_first_list_item.side_effect = ClientResponseError(
                url="x", status=503, data={}
            )
            mock_pb.collection.return_value.create.return_value = MagicMock(id="should_not_happen")
            m7.return_value = mock_pb
            _configure_solver(mocks, mock_solver_input, succeeds=True)

            # _persist_run_record propagates the 503 — the outer try/except in
            # run_solver_task_v2 logs it and the task completes without persisting.
            # Critical behavior: CREATE must NOT happen (would produce a duplicate
            # row if the lookup actually succeeded server-side).
            await sr_module.run_solver_task_v2(
                run_id="sweep_child_x",
                session_cm_id=1000001,
                year=2026,
                time_limit=60,
                sweep_id="sweep_xyz",
            )

            create_calls = mock_pb.collection.return_value.create.call_args_list
            assert len(create_calls) == 0, (
                f"non-404 lookup error must NOT fall through to CREATE, got {len(create_calls)}: {create_calls}"
            )

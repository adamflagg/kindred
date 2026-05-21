"""Sweep child runs share a pre-resolved frozen_input by reference.

If a child run mutates that input in place (e.g. respect_locks=False clears
existing_assignments + lock_groups_data), subsequent children would see a
corrupted snapshot. solver_runner must defensively copy frozen_input before
any mutation so all sweep children see identical inputs as the spec promises.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import api.services.solver_runner as sr_module
from bunking.models_v2 import (
    DirectBunkAssignment,
    DirectSolverInput,
)


def _frozen_with_state() -> DirectSolverInput:
    return DirectSolverInput(
        persons=[],
        requests=[],
        bunks=[],
        existing_assignments=[
            DirectBunkAssignment(person_cm_id=1, session_cm_id=1000001, bunk_cm_id=900, year=2026),
            DirectBunkAssignment(person_cm_id=2, session_cm_id=1000001, bunk_cm_id=900, year=2026),
        ],
        lock_groups_data={"g1": [1, 2, 3]},
    )


def _patch_solver_pipeline():
    """Patch the solver pipeline so we can drive it without OR-Tools.

    Returns a context-manager dict; caller is responsible for `with` chaining.
    """
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


@pytest.mark.asyncio
async def test_frozen_input_not_mutated_when_respect_locks_false() -> None:
    """When respect_locks=False the runner clears existing_assignments + lock_groups_data
    on the solver_input. With a frozen_input passed in by reference, that mutation
    would propagate to subsequent sweep children — the runner must defensively copy."""
    frozen = _frozen_with_state()
    mock_runs: dict[str, dict[str, object]] = {"t1": {"status": "pending"}}
    patches = _patch_solver_pipeline()

    with (
        patches["fetch_session_data_v2"],
        patches["fetch_historical_bunking"],
        patches["prepare_direct_solver_input"],
        patches["fetch_lock_groups"],
        patches["ConfigLoader"] as cfg,
        patches["DirectBunkingSolver"] as solver_cls,
        patches["PocketBase"] as pb_cls,
        patches["get_settings"] as settings,
        patch.object(sr_module, "solver_runs", mock_runs),
    ):
        cfg.get_instance.return_value = MagicMock()
        mock_pb = MagicMock()
        mock_pb.collection.return_value.auth_with_password.return_value = {}
        mock_pb.collection.return_value.create.return_value = MagicMock(id="pb_rec")
        pb_cls.return_value = mock_pb
        settings.return_value = MagicMock(pocketbase_admin_email="x", pocketbase_admin_password="x")

        # Make solver "succeed" trivially
        mock_solver = MagicMock()
        mock_result = MagicMock()
        mock_result.assignments = []
        mock_result.stats = {"status": "OPTIMAL"}
        mock_result.satisfied_requests = {}
        mock_solver.solve.return_value = mock_result
        solver_cls.return_value = mock_solver

        await sr_module.run_solver_task_v2(
            run_id="t1",
            session_cm_id=1000001,
            year=2026,
            time_limit=30,
            respect_locks=False,
            frozen_input=frozen,
        )

    # frozen_input must NOT have been mutated — subsequent sweep children must
    # still see the original existing_assignments and lock_groups_data.
    assert len(frozen.existing_assignments) == 2, (
        f"frozen_input.existing_assignments was mutated by the run "
        f"(expected 2 entries, got {len(frozen.existing_assignments)})"
    )
    assert frozen.lock_groups_data == {"g1": [1, 2, 3]}, (
        f"frozen_input.lock_groups_data was mutated by the run (got {frozen.lock_groups_data})"
    )

"""Tests for solver_runner PocketBase record saving.

Verifies that run_solver_task_v2 saves correct field names and values
to the solver_runs PocketBase collection on both success and failure paths.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import api.services.solver_runner as sr_module
from bunking.models_v2 import DirectSolverInput


class TestSolverRunnerPocketBaseSave:
    """Test that solver_runner saves correct data to solver_runs collection."""

    @pytest.fixture
    def mock_solver_input(self):
        """Create a minimal DirectSolverInput."""
        return DirectSolverInput(
            persons=[],
            requests=[],
            bunks=[],
        )

    def _setup_mocks(self, mock_solver_input, solver_succeeds=True):
        """Return a context manager stack with all required mocks."""
        mock_runs: dict[str, dict[str, object]] = {}
        patches = {
            "fetch_session_data_v2": patch.object(sr_module, "fetch_session_data_v2", new_callable=AsyncMock),
            "fetch_historical_bunking": patch.object(sr_module, "fetch_historical_bunking", new_callable=AsyncMock),
            "prepare_direct_solver_input": patch.object(sr_module, "prepare_direct_solver_input"),
            "fetch_lock_groups": patch.object(sr_module, "fetch_lock_groups", new_callable=AsyncMock),
            "ConfigLoader": patch.object(sr_module, "ConfigLoader"),
            "DirectBunkingSolver": patch.object(sr_module, "DirectBunkingSolver"),
            "PocketBase": patch.object(sr_module, "PocketBase"),
            "get_settings": patch.object(sr_module, "get_settings"),
            "solver_runs": patch.object(sr_module, "solver_runs", mock_runs),
        }
        return patches, mock_runs

    def _configure_mocks(self, mocks, mock_solver_input, solver_succeeds=True):
        """Configure mock return values."""
        mocks["fetch_session_data_v2"].return_value = ([], [], [], [], [])
        mocks["fetch_historical_bunking"].return_value = []
        mocks["prepare_direct_solver_input"].return_value = mock_solver_input

        mock_pb_instance = MagicMock()
        mock_pb_instance.collection.return_value.auth_with_password.return_value = {}
        mock_pb_instance.collection.return_value.create.return_value = MagicMock(id="pb_record_123")
        mocks["PocketBase"].return_value = mock_pb_instance

        mock_config = MagicMock()
        mocks["ConfigLoader"].get_instance.return_value = mock_config

        mock_solver = MagicMock()
        if solver_succeeds:
            mock_result = MagicMock()
            mock_result.assignments = []
            mock_result.stats = {"status": "OPTIMAL", "solve_time": 5.0}
            mock_result.satisfied_requests = {}
            mock_solver.solve.return_value = mock_result
        else:
            mock_solver.solve.side_effect = ValueError("Solver failed to find a solution")
        mocks["DirectBunkingSolver"].return_value = mock_solver

        mocks["get_settings"].return_value = MagicMock(
            pocketbase_admin_email="admin@camp.local",
            pocketbase_admin_password="pass",
        )

        return mock_pb_instance

    @pytest.mark.asyncio
    async def test_success_path_sends_run_id(self, mock_solver_input):
        """run_id field must be sent (required by schema)."""
        patches, mock_runs = self._setup_mocks(mock_solver_input)

        with (
            patches["fetch_session_data_v2"] as m1,
            patches["fetch_historical_bunking"] as m2,
            patches["prepare_direct_solver_input"] as m3,
            patches["fetch_lock_groups"] as m4,
            patches["ConfigLoader"] as m5,
            patches["DirectBunkingSolver"] as m6,
            patches["PocketBase"] as m7,
            patches["get_settings"] as m8,
            patches["solver_runs"],
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
            mock_pb = self._configure_mocks(mocks, mock_solver_input)
            mock_runs["test_run"] = {"status": "pending"}

            await sr_module.run_solver_task_v2(
                run_id="test_run",
                session_cm_id=100,
                year=2026,
                time_limit=60,
            )

            # Get the data passed to collection().create()
            create_calls = mock_pb.collection.return_value.create.call_args_list
            assert len(create_calls) == 1
            pb_data = create_calls[0][0][0]
            assert "run_id" in pb_data
            assert pb_data["run_id"] == "test_run"

    @pytest.mark.asyncio
    async def test_success_path_sends_session_field(self, mock_solver_input):
        """Schema field is 'session' (relation to camp_sessions), not 'session_cm_id'."""
        patches, mock_runs = self._setup_mocks(mock_solver_input)

        with (
            patches["fetch_session_data_v2"] as m1,
            patches["fetch_historical_bunking"] as m2,
            patches["prepare_direct_solver_input"] as m3,
            patches["fetch_lock_groups"] as m4,
            patches["ConfigLoader"] as m5,
            patches["DirectBunkingSolver"] as m6,
            patches["PocketBase"] as m7,
            patches["get_settings"] as m8,
            patches["solver_runs"],
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
            mock_pb = self._configure_mocks(mocks, mock_solver_input)
            # Wire a known PB id so resolve_session_relation returns it
            fake_session = MagicMock()
            fake_session.id = "camp_sessions_pb_id_xyz"
            mock_pb.collection.return_value.get_first_list_item.return_value = fake_session
            mock_runs["test_run"] = {"status": "pending"}

            await sr_module.run_solver_task_v2(
                run_id="test_run",
                session_cm_id=100,
                year=2026,
                time_limit=60,
            )

            pb_data = mock_pb.collection.return_value.create.call_args_list[0][0][0]
            assert "session" in pb_data
            assert "session_cm_id" not in pb_data
            # session is now a PB relation id resolved from camp_sessions
            assert pb_data["session"] == "camp_sessions_pb_id_xyz"

    @pytest.mark.asyncio
    async def test_success_path_sends_status_success(self, mock_solver_input):
        """Schema enum allows 'success', not 'completed'."""
        patches, mock_runs = self._setup_mocks(mock_solver_input)

        with (
            patches["fetch_session_data_v2"] as m1,
            patches["fetch_historical_bunking"] as m2,
            patches["prepare_direct_solver_input"] as m3,
            patches["fetch_lock_groups"] as m4,
            patches["ConfigLoader"] as m5,
            patches["DirectBunkingSolver"] as m6,
            patches["PocketBase"] as m7,
            patches["get_settings"] as m8,
            patches["solver_runs"],
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
            mock_pb = self._configure_mocks(mocks, mock_solver_input)
            mock_runs["test_run"] = {"status": "pending"}

            await sr_module.run_solver_task_v2(
                run_id="test_run",
                session_cm_id=100,
                year=2026,
                time_limit=60,
            )

            pb_data = mock_pb.collection.return_value.create.call_args_list[0][0][0]
            assert pb_data["status"] == "success"

    @pytest.mark.asyncio
    async def test_success_path_sends_result_field(self, mock_solver_input):
        """Schema field is 'result' (singular), not 'results'."""
        patches, mock_runs = self._setup_mocks(mock_solver_input)

        with (
            patches["fetch_session_data_v2"] as m1,
            patches["fetch_historical_bunking"] as m2,
            patches["prepare_direct_solver_input"] as m3,
            patches["fetch_lock_groups"] as m4,
            patches["ConfigLoader"] as m5,
            patches["DirectBunkingSolver"] as m6,
            patches["PocketBase"] as m7,
            patches["get_settings"] as m8,
            patches["solver_runs"],
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
            mock_pb = self._configure_mocks(mocks, mock_solver_input)
            mock_runs["test_run"] = {"status": "pending"}

            await sr_module.run_solver_task_v2(
                run_id="test_run",
                session_cm_id=100,
                year=2026,
                time_limit=60,
            )

            pb_data = mock_pb.collection.return_value.create.call_args_list[0][0][0]
            assert "result" in pb_data
            assert "results" not in pb_data

    @pytest.mark.asyncio
    async def test_success_path_sends_details_not_config(self, mock_solver_input):
        """Schema field is 'details' (json), not 'config'."""
        patches, mock_runs = self._setup_mocks(mock_solver_input)

        with (
            patches["fetch_session_data_v2"] as m1,
            patches["fetch_historical_bunking"] as m2,
            patches["prepare_direct_solver_input"] as m3,
            patches["fetch_lock_groups"] as m4,
            patches["ConfigLoader"] as m5,
            patches["DirectBunkingSolver"] as m6,
            patches["PocketBase"] as m7,
            patches["get_settings"] as m8,
            patches["solver_runs"],
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
            mock_pb = self._configure_mocks(mocks, mock_solver_input)
            mock_runs["test_run"] = {"status": "pending"}

            await sr_module.run_solver_task_v2(
                run_id="test_run",
                session_cm_id=100,
                year=2026,
                time_limit=60,
            )

            pb_data = mock_pb.collection.return_value.create.call_args_list[0][0][0]
            assert "details" in pb_data
            assert "config" not in pb_data

    @pytest.mark.asyncio
    async def test_success_path_sends_session_id_as_number(self, mock_solver_input):
        """Schema has 'session_id' (number) for the CM ID."""
        patches, mock_runs = self._setup_mocks(mock_solver_input)

        with (
            patches["fetch_session_data_v2"] as m1,
            patches["fetch_historical_bunking"] as m2,
            patches["prepare_direct_solver_input"] as m3,
            patches["fetch_lock_groups"] as m4,
            patches["ConfigLoader"] as m5,
            patches["DirectBunkingSolver"] as m6,
            patches["PocketBase"] as m7,
            patches["get_settings"] as m8,
            patches["solver_runs"],
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
            mock_pb = self._configure_mocks(mocks, mock_solver_input)
            mock_runs["test_run"] = {"status": "pending"}

            await sr_module.run_solver_task_v2(
                run_id="test_run",
                session_cm_id=100,
                year=2026,
                time_limit=60,
            )

            pb_data = mock_pb.collection.return_value.create.call_args_list[0][0][0]
            assert "session_id" in pb_data
            assert pb_data["session_id"] == 100

    @pytest.mark.asyncio
    async def test_success_path_sends_year(self, mock_solver_input):
        """year field must be written to PB on success path (required by schema)."""
        patches, mock_runs = self._setup_mocks(mock_solver_input)

        with (
            patches["fetch_session_data_v2"] as m1,
            patches["fetch_historical_bunking"] as m2,
            patches["prepare_direct_solver_input"] as m3,
            patches["fetch_lock_groups"] as m4,
            patches["ConfigLoader"] as m5,
            patches["DirectBunkingSolver"] as m6,
            patches["PocketBase"] as m7,
            patches["get_settings"] as m8,
            patches["solver_runs"],
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
            mock_pb = self._configure_mocks(mocks, mock_solver_input)
            mock_runs["test_run"] = {"status": "pending"}

            await sr_module.run_solver_task_v2(
                run_id="test_run",
                session_cm_id=100,
                year=2026,
                time_limit=60,
            )

            pb_data = mock_pb.collection.return_value.create.call_args_list[0][0][0]
            assert "year" in pb_data, "year must be present in pb_data (required by schema)"
            assert pb_data["year"] == 2026

    @pytest.mark.asyncio
    async def test_failure_path_sends_correct_fields(self, mock_solver_input):
        """Error path must also use correct field names and status='failed'."""
        patches, mock_runs = self._setup_mocks(mock_solver_input)

        with (
            patches["fetch_session_data_v2"] as m1,
            patches["fetch_historical_bunking"] as m2,
            patches["prepare_direct_solver_input"] as m3,
            patches["fetch_lock_groups"] as m4,
            patches["ConfigLoader"] as m5,
            patches["DirectBunkingSolver"] as m6,
            patches["PocketBase"] as m7,
            patches["get_settings"] as m8,
            patches["solver_runs"],
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
            mock_pb = self._configure_mocks(mocks, mock_solver_input, solver_succeeds=False)
            # Wire a known PB id so resolve_session_relation returns it
            fake_session = MagicMock()
            fake_session.id = "camp_sessions_pb_id_xyz"
            mock_pb.collection.return_value.get_first_list_item.return_value = fake_session
            mock_runs["test_run"] = {"status": "pending"}

            await sr_module.run_solver_task_v2(
                run_id="test_run",
                session_cm_id=100,
                year=2026,
                time_limit=60,
            )

            pb_data = mock_pb.collection.return_value.create.call_args_list[0][0][0]
            assert pb_data["run_id"] == "test_run"
            # session is now a PB relation id resolved from camp_sessions
            assert pb_data["session"] == "camp_sessions_pb_id_xyz"
            assert pb_data["session_id"] == 100
            assert pb_data["status"] == "failed"
            assert "session_cm_id" not in pb_data
            assert "year" in pb_data, "year must be present in failure pb_data (required by schema)"
            assert pb_data["year"] == 2026

    @pytest.mark.asyncio
    async def test_failure_path_sends_error_as_json(self, mock_solver_input):
        """Error should go to 'error' field (json), not 'error_message' (doesn't exist)."""
        patches, mock_runs = self._setup_mocks(mock_solver_input)

        with (
            patches["fetch_session_data_v2"] as m1,
            patches["fetch_historical_bunking"] as m2,
            patches["prepare_direct_solver_input"] as m3,
            patches["fetch_lock_groups"] as m4,
            patches["ConfigLoader"] as m5,
            patches["DirectBunkingSolver"] as m6,
            patches["PocketBase"] as m7,
            patches["get_settings"] as m8,
            patches["solver_runs"],
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
            mock_pb = self._configure_mocks(mocks, mock_solver_input, solver_succeeds=False)
            mock_runs["test_run"] = {"status": "pending"}

            await sr_module.run_solver_task_v2(
                run_id="test_run",
                session_cm_id=100,
                year=2026,
                time_limit=60,
            )

            pb_data = mock_pb.collection.return_value.create.call_args_list[0][0][0]
            assert "error" in pb_data
            assert "error_message" not in pb_data

    @pytest.mark.asyncio
    async def test_failure_before_started_at_does_not_crash(self, mock_solver_input):
        """When auth fails before started_at is set, failure path must not KeyError.

        The KeyError on started_at is currently swallowed by the inner except clause,
        which means the PocketBase failure record is never saved. The fix must ensure
        started_at has a fallback so the PB save succeeds.
        """
        patches, mock_runs = self._setup_mocks(mock_solver_input)

        with (
            patches["fetch_session_data_v2"] as m1,
            patches["fetch_historical_bunking"] as m2,
            patches["prepare_direct_solver_input"] as m3,
            patches["fetch_lock_groups"] as m4,
            patches["ConfigLoader"] as m5,
            patches["DirectBunkingSolver"] as m6,
            patches["PocketBase"] as m7,
            patches["get_settings"] as m8,
            patches["solver_runs"],
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
            mock_pb = self._configure_mocks(mocks, mock_solver_input)
            # Make auth raise BEFORE started_at is set
            mock_pb.collection.return_value.auth_with_password.side_effect = ConnectionError("Auth failed")
            mock_runs["test_run"] = {"status": "pending"}

            # Should NOT raise KeyError
            await sr_module.run_solver_task_v2(
                run_id="test_run",
                session_cm_id=100,
                year=2026,
                time_limit=60,
            )

        assert mock_runs["test_run"]["status"] == "failed"
        assert "Auth failed" in str(mock_runs["test_run"]["error_message"])
        # The PocketBase failure record must be saved (KeyError on started_at must not prevent this)
        create_calls = mock_pb.collection.return_value.create.call_args_list
        assert len(create_calls) == 1, "PocketBase failure record must be saved even when auth fails"
        pb_data = create_calls[0][0][0]
        assert pb_data["status"] == "failed"
        assert "started_at" in pb_data


class TestFailedRunPersistsDetails:
    """Failed runs must persist sweep grouping metadata so they appear in the
    impact-analysis UI alongside their successful siblings — not as orphans.
    """

    @pytest.fixture
    def mock_solver_input(self):
        return DirectSolverInput(persons=[], requests=[], bunks=[])

    def _setup_for_failure(self):
        mock_runs: dict[str, dict[str, object]] = {}
        patches = {
            "fetch_session_data_v2": patch.object(sr_module, "fetch_session_data_v2", new_callable=AsyncMock),
            "fetch_historical_bunking": patch.object(sr_module, "fetch_historical_bunking", new_callable=AsyncMock),
            "prepare_direct_solver_input": patch.object(sr_module, "prepare_direct_solver_input"),
            "fetch_lock_groups": patch.object(sr_module, "fetch_lock_groups", new_callable=AsyncMock),
            "ConfigLoader": patch.object(sr_module, "ConfigLoader"),
            "DirectBunkingSolver": patch.object(sr_module, "DirectBunkingSolver"),
            "PocketBase": patch.object(sr_module, "PocketBase"),
            "get_settings": patch.object(sr_module, "get_settings"),
            "solver_runs": patch.object(sr_module, "solver_runs", mock_runs),
        }
        return patches, mock_runs

    @pytest.mark.asyncio
    async def test_failure_path_persists_details_with_sweep_metadata(self, mock_solver_input):
        """Failed sweep child runs must carry sweep_id + sweep_label + scenario + time_limit_seconds
        so they group correctly in the impact-analysis sweep view."""
        patches, mock_runs = self._setup_for_failure()

        with (
            patches["fetch_session_data_v2"] as m1,
            patches["fetch_historical_bunking"] as m2,
            patches["prepare_direct_solver_input"] as m3,
            patches["fetch_lock_groups"],
            patches["ConfigLoader"] as m5,
            patches["DirectBunkingSolver"] as m6,
            patches["PocketBase"] as m7,
            patches["get_settings"] as m8,
            patches["solver_runs"],
        ):
            m1.return_value = ([], [], [], [], [])
            m2.return_value = []
            m3.return_value = mock_solver_input
            mock_pb_instance = MagicMock()
            mock_pb_instance.collection.return_value.auth_with_password.return_value = {}
            mock_pb_instance.collection.return_value.create.return_value = MagicMock(id="pb_record")
            mock_pb_instance.collection.return_value.update.return_value = MagicMock(id="pb_record")
            # Sweep children have a pre-created row found by run_id filter and updated in place
            mock_pb_instance.collection.return_value.get_first_list_item.return_value = MagicMock(id="pre_created_id")
            m7.return_value = mock_pb_instance
            m5.get_instance.return_value = MagicMock()
            mock_solver = MagicMock()
            mock_solver.solve.side_effect = ValueError("simulated solver failure")
            m6.return_value = mock_solver
            m8.return_value = MagicMock(pocketbase_admin_email="x", pocketbase_admin_password="x")

            mock_runs["sweep_child"] = {"status": "pending"}

            await sr_module.run_solver_task_v2(
                run_id="sweep_child",
                session_cm_id=1000001,
                year=2026,
                time_limit=180,
                scenario="scen-X",
                scenario_name="my-scenario",
                sweep_id="sweep_abc",
                sweep_label="post-cleanup",
            )

        # Sweep child uses UPDATE on the pre-created row, not CREATE
        update_calls = mock_pb_instance.collection.return_value.update.call_args_list
        assert len(update_calls) == 1, "Failure path must persist a PB record (via update for sweep child)"
        pb_data = update_calls[0].args[1]
        assert pb_data["status"] == "failed"
        # Failure record must include details so the failed run groups correctly
        assert "details" in pb_data, "Failed run must persist details for impact-analysis grouping"
        import json

        details = json.loads(pb_data["details"])
        assert details["sweep_id"] == "sweep_abc"
        assert details["sweep_label"] == "post-cleanup"
        assert details["scenario_id_at_run"] == "scen-X"
        assert details["time_limit_seconds"] == 180

    @pytest.mark.asyncio
    async def test_success_fallback_uses_time_limit_seconds_key(self, mock_solver_input):
        """When build_run_details fails on the success path, the fallback details
        must use the canonical 'time_limit_seconds' key — not the legacy 'time_limit'."""
        patches, mock_runs = self._setup_for_failure()

        with (
            patches["fetch_session_data_v2"] as m1,
            patches["fetch_historical_bunking"] as m2,
            patches["prepare_direct_solver_input"] as m3,
            patches["fetch_lock_groups"],
            patches["ConfigLoader"] as m5,
            patches["DirectBunkingSolver"] as m6,
            patches["PocketBase"] as m7,
            patches["get_settings"] as m8,
            patches["solver_runs"],
            patch.object(sr_module, "build_run_details", side_effect=RuntimeError("tagging boom")),
        ):
            m1.return_value = ([], [], [], [], [])
            m2.return_value = []
            m3.return_value = mock_solver_input
            mock_pb_instance = MagicMock()
            mock_pb_instance.collection.return_value.auth_with_password.return_value = {}
            mock_pb_instance.collection.return_value.create.return_value = MagicMock(id="pb_record")
            m7.return_value = mock_pb_instance
            m5.get_instance.return_value = MagicMock()
            mock_solver = MagicMock()
            mock_result = MagicMock()
            mock_result.assignments = []
            mock_result.stats = {"status": "OPTIMAL"}
            mock_result.satisfied_requests = {}
            mock_solver.solve.return_value = mock_result
            m6.return_value = mock_solver
            m8.return_value = MagicMock(pocketbase_admin_email="x", pocketbase_admin_password="x")

            mock_runs["t1"] = {"status": "pending"}

            await sr_module.run_solver_task_v2(
                run_id="t1",
                session_cm_id=1000002,
                year=2026,
                time_limit=45,
            )

        pb_data = mock_pb_instance.collection.return_value.create.call_args_list[0][0][0]
        import json

        details = json.loads(pb_data["details"])
        assert "time_limit_seconds" in details
        assert details["time_limit_seconds"] == 45
        # Legacy key must not coexist — there's no reason to carry both.
        assert "time_limit" not in details, (
            "Fallback details must use canonical time_limit_seconds, not the legacy time_limit key"
        )

    @pytest.mark.asyncio
    async def test_failure_path_persists_git_sha_and_source_label(self, mock_solver_input):
        """Failed sweep children must carry git_sha + source_label + source_kind
        so the impact-analysis UI can render the same columns for failed and
        successful runs (otherwise failed-row columns are blank, breaking
        same-row alignment in the table).

        These three fields don't require PocketBase access — git_sha is cached
        at process start, and source_label/source_kind are pure derivations of
        session label + scenario_id — so they must be present even when the
        run fails before tagging.
        """
        patches, mock_runs = self._setup_for_failure()

        with (
            patches["fetch_session_data_v2"] as m1,
            patches["fetch_historical_bunking"] as m2,
            patches["prepare_direct_solver_input"] as m3,
            patches["fetch_lock_groups"],
            patches["ConfigLoader"] as m5,
            patches["DirectBunkingSolver"] as m6,
            patches["PocketBase"] as m7,
            patches["get_settings"] as m8,
            patches["solver_runs"],
            # Pin git_sha so the assertion is deterministic
            patch("api.services.run_tagging.get_git_sha", return_value="deadbeef"),
        ):
            m1.return_value = ([], [], [], [], [])
            m2.return_value = []
            m3.return_value = mock_solver_input
            mock_pb_instance = MagicMock()
            mock_pb_instance.collection.return_value.auth_with_password.return_value = {}
            mock_pb_instance.collection.return_value.create.return_value = MagicMock(id="pb_record")
            mock_pb_instance.collection.return_value.update.return_value = MagicMock(id="pb_record")
            # Sweep children have a pre-created row found by run_id filter and updated in place
            mock_pb_instance.collection.return_value.get_first_list_item.return_value = MagicMock(id="pre_created_id")
            m7.return_value = mock_pb_instance
            m5.get_instance.return_value = MagicMock()
            mock_solver = MagicMock()
            mock_solver.solve.side_effect = ValueError("simulated solver failure")
            m6.return_value = mock_solver
            m8.return_value = MagicMock(pocketbase_admin_email="x", pocketbase_admin_password="x")

            mock_runs["sweep_child"] = {"status": "pending"}

            await sr_module.run_solver_task_v2(
                run_id="sweep_child",
                session_cm_id=1000001,
                year=2026,
                time_limit=180,
                scenario="scen-X",
                scenario_name="my-scenario",
                sweep_id="sweep_abc",
                sweep_label="post-cleanup",
            )

        # Sweep child uses UPDATE on the pre-created row, not CREATE
        update_calls = mock_pb_instance.collection.return_value.update.call_args_list
        assert len(update_calls) == 1
        pb_data = update_calls[0].args[1]
        assert pb_data["status"] == "failed"

        import json

        details = json.loads(pb_data["details"])
        assert details.get("git_sha") == "deadbeef", f"Failure-path details must include git_sha; got {details!r}"
        assert details.get("source_kind") == "scenario", (
            f"Failure-path details must include source_kind='scenario'; got {details!r}"
        )
        assert "my-scenario" in (details.get("source_label") or ""), (
            f"Failure-path details must include source_label with scenario name; got {details!r}"
        )

    @pytest.mark.asyncio
    async def test_failure_path_production_run_has_production_source_kind(self, mock_solver_input):
        """A failed production (non-scenario) run must report source_kind='production'."""
        patches, mock_runs = self._setup_for_failure()

        with (
            patches["fetch_session_data_v2"] as m1,
            patches["fetch_historical_bunking"] as m2,
            patches["prepare_direct_solver_input"] as m3,
            patches["fetch_lock_groups"],
            patches["ConfigLoader"] as m5,
            patches["DirectBunkingSolver"] as m6,
            patches["PocketBase"] as m7,
            patches["get_settings"] as m8,
            patches["solver_runs"],
            patch("api.services.run_tagging.get_git_sha", return_value="cafef00d"),
        ):
            m1.return_value = ([], [], [], [], [])
            m2.return_value = []
            m3.return_value = mock_solver_input
            mock_pb_instance = MagicMock()
            mock_pb_instance.collection.return_value.auth_with_password.return_value = {}
            mock_pb_instance.collection.return_value.create.return_value = MagicMock(id="pb_record")
            m7.return_value = mock_pb_instance
            m5.get_instance.return_value = MagicMock()
            mock_solver = MagicMock()
            mock_solver.solve.side_effect = ValueError("boom")
            m6.return_value = mock_solver
            m8.return_value = MagicMock(pocketbase_admin_email="x", pocketbase_admin_password="x")

            mock_runs["prod_run"] = {"status": "pending"}

            await sr_module.run_solver_task_v2(
                run_id="prod_run",
                session_cm_id=1000001,
                year=2026,
                time_limit=60,
                # No scenario → production
            )

        pb_data = mock_pb_instance.collection.return_value.create.call_args_list[0][0][0]
        import json

        details = json.loads(pb_data["details"])
        assert details.get("source_kind") == "production"
        assert details.get("git_sha") == "cafef00d"

    @pytest.mark.asyncio
    async def test_failure_path_uses_short_session_label(self, mock_solver_input):
        """Failure-path source_label must use the short `S{cm_id}` shape so failed
        sweep children align visually with successful siblings in the impact-analysis
        UI. Successful runs produce labels like "S2 · Production" via build_run_details
        → _lookup_session_short_name; the failure path runs before PocketBase auth and
        can't fetch the session name, so it falls back to the same `S{cm_id}` form that
        _lookup_session_short_name emits on lookup failure.
        """
        patches, mock_runs = self._setup_for_failure()

        with (
            patches["fetch_session_data_v2"] as m1,
            patches["fetch_historical_bunking"] as m2,
            patches["prepare_direct_solver_input"] as m3,
            patches["fetch_lock_groups"],
            patches["ConfigLoader"] as m5,
            patches["DirectBunkingSolver"] as m6,
            patches["PocketBase"] as m7,
            patches["get_settings"] as m8,
            patches["solver_runs"],
        ):
            m1.return_value = ([], [], [], [], [])
            m2.return_value = []
            m3.return_value = mock_solver_input
            mock_pb_instance = MagicMock()
            mock_pb_instance.collection.return_value.auth_with_password.return_value = {}
            mock_pb_instance.collection.return_value.create.return_value = MagicMock(id="pb_record")
            m7.return_value = mock_pb_instance
            m5.get_instance.return_value = MagicMock()
            mock_solver = MagicMock()
            mock_solver.solve.side_effect = ValueError("boom")
            m6.return_value = mock_solver
            m8.return_value = MagicMock(pocketbase_admin_email="x", pocketbase_admin_password="x")

            mock_runs["prod_run"] = {"status": "pending"}

            await sr_module.run_solver_task_v2(
                run_id="prod_run",
                session_cm_id=1000001,
                year=2026,
                time_limit=60,
            )

        pb_data = mock_pb_instance.collection.return_value.create.call_args_list[0][0][0]
        import json

        details = json.loads(pb_data["details"])
        assert details["source_label"] == "S1000001 · Production", (
            f"Failure-path label must be short (S<cm_id>) to align with successful siblings; got {details['source_label']!r}"
        )

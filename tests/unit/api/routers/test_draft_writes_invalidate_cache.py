"""Cache invalidation contract for every ``bunk_assignments_draft`` writer.

Each writer that mutates ``bunk_assignments_draft`` must invalidate the matching
scenario-scoped graph cache slot immediately. Without this, the
``GraphCacheManager`` serves a stale graph (TTL 15 min) keyed under
``session_{session_cm_id}_{year}_{scenario_id}`` after a solver re-run and
apply, so the social-graph view shows campers grouped by the previous
draft state — exactly the "big lump" symptom reported on the May 7 scenario.

Writers covered:
  * POST   /api/solver/apply/{run_id}                 (scenario only — kindred#2467
    made a scenario-less apply a 422, so there is no production case left to cover;
    the refusal itself lives in test_solver_never_writes_production.py)
  * POST   /api/sessions/{cm_id}/clear-assignments    (scenario + prod)
  * POST   /api/scenarios/{id}/clear
  * DELETE /api/scenarios/{id}
  * PUT    /api/scenarios/{id}/assignments
  * POST   /api/scenarios                             (copy from prod / from another scenario)

Each test patches ``graph_cache`` and verifies the appropriate invalidation
method is called with the expected arguments. The full PocketBase write path
is mocked at the boundary — these are unit-level contract tests.
"""

import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

test_dir = Path(__file__).resolve().parent
project_root = test_dir.parent.parent.parent.parent
sys.path.insert(0, str(project_root))

from bunking.auth_middleware import AuthUser, get_current_user
from bunking.rbac.permissions import ALL_PERMISSIONS

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _admin() -> AuthUser:
    user = AuthUser(
        username="TestAdmin",
        email="test@example.com",
        display_name="Test Admin",
        groups=["admin"],
        is_admin=True,
    )
    user.permissions = set(ALL_PERMISSIONS)
    return user


def _build_session_context_stub(session_cm_id: int = 1235404, year: int = 2026) -> Any:
    """Return a SessionContext-shaped stub with the fields apply paths read."""
    ctx = MagicMock()
    ctx.session_cm_id = session_cm_id
    ctx.year = year
    ctx.session_pb_id = "sess_pb"
    ctx.session_relation_filter = f"session.cm_id = {session_cm_id}"
    ctx.related_session_ids = [session_cm_id]
    ctx.id_cache = MagicMock()
    ctx.id_cache.get_person_pb_id = AsyncMock(return_value="person_pb")
    ctx.id_cache.get_bunk_pb_id = AsyncMock(return_value="bunk_pb")
    ctx.id_cache.get_session_pb_id = AsyncMock(return_value="sess_pb")
    ctx.id_cache.get_bunk_plan_id = AsyncMock(return_value="bp_pb")
    return ctx


# ---------------------------------------------------------------------------
# /api/solver/apply/{run_id}
# ---------------------------------------------------------------------------


class TestApplySolverResultsInvalidatesCache:
    """The user-reported case: solver re-run + apply must drop the stale graph."""

    def _run_apply(
        self,
        *,
        scenario: str | None,
        session_cm_id: int = 1235404,
        year: int = 2026,
        expected_status: int = 200,
    ) -> MagicMock:
        from api.dependencies import solver_runs
        from api.routers.solver import router

        run_id = "run-test-1"
        solver_runs.clear()
        solver_runs[run_id] = {
            "id": run_id,
            "status": "completed",
            "session_cm_id": session_cm_id,
            "scenario": scenario,
            "config": {"year": year},
            "results": {"assignments": {}},  # empty — no upsert work, focus is the cache call
        }

        mock_cache = MagicMock()
        mock_pb = MagicMock()

        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[get_current_user] = _admin

        ctx = _build_session_context_stub(session_cm_id, year)
        with (
            patch("api.routers.solver.pb", mock_pb),
            patch("api.routers.solver.graph_cache", mock_cache),
            patch("api.routers.solver.build_session_context", AsyncMock(return_value=ctx)),
        ):
            client = TestClient(app)
            resp = client.post(f"/api/solver/apply/{run_id}")
            assert resp.status_code == expected_status, f"{resp.status_code}: {resp.text}"

        solver_runs.clear()
        return mock_cache

    def test_scenario_apply_invalidates_scenario_slot(self) -> None:
        """Apply with a scenario must invalidate that scenario's cache slot."""
        cache = self._run_apply(scenario="scn_abc123")
        cache.invalidate_scenario.assert_called_once_with(1235404, 2026, "scn_abc123")
        # Don't broadly nuke the prod or session-wide cache in scenario mode.
        cache.invalidate_session.assert_not_called()

    def test_prod_apply_is_refused_and_invalidates_nothing(self) -> None:
        """Apply without a scenario is refused (kindred#2467), so nothing is dropped.

        This used to assert a session-slot invalidation, because the endpoint took
        an ``else`` branch that tried to write the production ``bunk_assignments``
        table. The owner's rule is that production is read-only for the solver, so
        that branch is gone and the apply is a 422 — with no write, there is no
        stale cache slot to drop.
        """
        cache = self._run_apply(scenario=None, expected_status=422)
        cache.invalidate_session.assert_not_called()
        cache.invalidate_scenario.assert_not_called()


# ---------------------------------------------------------------------------
# /api/sessions/{cm_id}/clear-assignments
# ---------------------------------------------------------------------------


class TestClearSessionAssignmentsInvalidatesCache:
    """Clearing a scenario's draft assignments must drop the matching cache slot.

    Production is out of reach here — kindred#2473: a scenario-less clear is
    refused with a 422 before any PocketBase call, so there is no production
    cache slot to invalidate any more.
    """

    def _run(self, *, scenario: str | None) -> MagicMock:
        from api.routers.solver import router

        mock_cache = MagicMock()
        mock_pb = MagicMock()
        # No assignments to delete — focus is the cache call after the loop.
        mock_pb.collection.return_value.get_full_list.return_value = []

        ctx = _build_session_context_stub(1235404, 2026)

        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[get_current_user] = _admin

        with (
            patch("api.routers.solver.pb", mock_pb),
            patch("api.routers.solver.graph_cache", mock_cache),
            patch("api.routers.solver.build_session_context", AsyncMock(return_value=ctx)),
        ):
            body: dict[str, Any] = {"year": 2026, "session_cm_id": 1235404}
            if scenario is not None:
                body["scenario"] = scenario
            client = TestClient(app, raise_server_exceptions=False)
            resp = client.post("/api/sessions/1235404/clear-assignments", json=body)

        return mock_cache, resp  # type: ignore[return-value]

    def test_scenario_clear_invalidates_scenario_slot(self) -> None:
        cache, resp = self._run(scenario="scn_abc123")
        assert resp.status_code == 200, f"{resp.status_code}: {resp.text}"
        cache.invalidate_scenario.assert_called_once_with(1235404, 2026, "scn_abc123")

    def test_prod_clear_is_refused_and_invalidates_nothing(self) -> None:
        """kindred#2473: production is read-only for the solver, same as writes.

        This was ``test_prod_clear_invalidates_session_slot`` before #2473 — it
        asserted the old production behaviour (200 + session-slot invalidation).
        It now asserts the refusal and that nothing is invalidated, since there
        is no write (or delete) to go stale. Spec change, not a test bent to
        fit the code, mirroring what #2471 did to this same file's apply-side
        counterpart.
        """
        cache, resp = self._run(scenario=None)
        assert resp.status_code == 422, f"Expected a refusal, got {resp.status_code}: {resp.text}"
        cache.invalidate_session.assert_not_called()
        cache.invalidate_scenario.assert_not_called()


# ---------------------------------------------------------------------------
# /api/scenarios/{id}/clear
# ---------------------------------------------------------------------------


class TestClearScenarioInvalidatesCache:
    def test_clear_scenario_invalidates_scenario_slot(self) -> None:
        from api.routers.scenarios import router

        # The clear path expands `session` so it can read cm_id for invalidation.
        # A real PocketBase Record keeps the bare relation id on `.session` and
        # puts the resolved record under `.expand["session"]` (Record.load) --
        # this mock matches that shape rather than putting the resolved record
        # directly on `.session`, which no real response ever does.
        camp_session = SimpleNamespace(id="sess_pb", cm_id=1235404, session_type="main")
        scenario_pb_with_session = SimpleNamespace(
            id="scn_abc", name="May 7", session="sess_pb", expand={"session": camp_session}
        )

        mock_cache = MagicMock()
        mock_pb = MagicMock()
        # First .get_one returns the scenario record
        mock_pb.collection.return_value.get_one.return_value = scenario_pb_with_session
        # No drafts — empty list of records to delete
        mock_pb.collection.return_value.get_full_list.return_value = []

        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[get_current_user] = _admin

        # ClearScenarioRequest expects {year, session_cm_id?}
        body = {"year": 2026}
        with (
            patch("api.routers.scenarios.pb", mock_pb),
            patch("api.routers.scenarios.graph_cache", mock_cache),
        ):
            client = TestClient(app)
            resp = client.post("/api/scenarios/scn_abc/clear", json=body)
            assert resp.status_code == 200, f"{resp.status_code}: {resp.text}"

        mock_cache.invalidate_scenario.assert_called_once_with(1235404, 2026, "scn_abc")


# ---------------------------------------------------------------------------
# DELETE /api/scenarios/{id}
# ---------------------------------------------------------------------------


class TestDeleteScenarioInvalidatesCache:
    def test_delete_scenario_invalidates_scenario_slot(self) -> None:
        from api.routers.scenarios import router

        camp_session = SimpleNamespace(id="sess_pb", cm_id=1235404, year=2026)
        scenario_pb = SimpleNamespace(
            id="scn_abc",
            name="May 7",
            session="sess_pb",
            expand={"session": camp_session},
            year=2026,
        )

        mock_cache = MagicMock()
        mock_pb = MagicMock()
        mock_pb.collection.return_value.get_one.return_value = scenario_pb
        mock_pb.collection.return_value.get_full_list.return_value = []

        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[get_current_user] = _admin

        with (
            patch("api.routers.scenarios.pb", mock_pb),
            patch("api.routers.scenarios.graph_cache", mock_cache),
        ):
            client = TestClient(app)
            resp = client.delete("/api/scenarios/scn_abc")
            assert resp.status_code == 200, f"{resp.status_code}: {resp.text}"

        mock_cache.invalidate_scenario.assert_called_once_with(1235404, 2026, "scn_abc")


# ---------------------------------------------------------------------------
# PUT /api/scenarios/{id}/assignments
# ---------------------------------------------------------------------------


class TestUpdateScenarioAssignmentInvalidatesCache:
    def test_update_assignment_invalidates_scenario_slot(self) -> None:
        from api.routers.scenarios import router

        camp_session = SimpleNamespace(id="sess_pb", cm_id=1235404, year=2026)
        scenario_pb = SimpleNamespace(
            id="scn_abc",
            name="May 7",
            session=camp_session,
            expand={"session": camp_session},
        )
        person_pb = SimpleNamespace(id="person_pb", cm_id=12345)
        bunk_pb = SimpleNamespace(id="bunk_pb", cm_id=4276)
        bunk_plan_pb = SimpleNamespace(id="bp_pb")

        mock_cache = MagicMock()
        mock_pb = MagicMock()

        # PB calls in order: scenarios.get_one, persons.get_full_list,
        # bunk_assignments_draft.get_full_list (existing check), bunks.get_full_list,
        # bunk_plans.get_full_list, bunk_assignments_draft.create
        # Use side-effect-driven mock to return different things per collection.
        def collection_factory(name: str) -> MagicMock:
            mock = MagicMock()
            if name == "saved_scenarios":
                mock.get_one.return_value = scenario_pb
            elif name == "persons":
                mock.get_full_list.return_value = [person_pb]
            elif name == "bunks":
                mock.get_full_list.return_value = [bunk_pb]
            elif name == "bunk_plans":
                mock.get_full_list.return_value = [bunk_plan_pb]
            elif name == "bunk_assignments_draft":
                mock.get_full_list.return_value = []  # no existing
                mock.create.return_value = MagicMock()
            return mock

        mock_pb.collection.side_effect = collection_factory

        ctx = _build_session_context_stub(1235404, 2026)

        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[get_current_user] = _admin

        body = {
            "person_id": 12345,
            "bunk_id": 4276,
            "session_cm_id": 1235404,
            "year": 2026,
        }
        with (
            patch("api.routers.scenarios.pb", mock_pb),
            patch("api.routers.scenarios.graph_cache", mock_cache),
            patch("api.routers.scenarios.build_session_context", AsyncMock(return_value=ctx)),
        ):
            client = TestClient(app)
            resp = client.put("/api/scenarios/scn_abc/assignments", json=body)
            assert resp.status_code == 200, f"{resp.status_code}: {resp.text}"

        mock_cache.invalidate_scenario.assert_called_once_with(1235404, 2026, "scn_abc")


# ---------------------------------------------------------------------------
# POST /api/scenarios (copy path)
# ---------------------------------------------------------------------------


class TestCreateScenarioInvalidatesCache:
    """When a new scenario is created and seeded from prod or another scenario,
    invalidate that new scenario's cache slot. This is defensive — a brand-new
    scenario shouldn't have any cached graph yet, but invalidating costs ~µs
    and prevents a poisoned slot if the slug is reused after an earlier delete."""

    def test_create_scenario_with_copy_invalidates_new_slot(self) -> None:
        from api.routers.scenarios import router

        new_scenario_pb = SimpleNamespace(
            id="scn_new",
            name="May 8",
            session_cm_id=1235404,
            session="sess_pb",
            year=2026,
            description="",
            created_by="system",
            is_active=True,
        )

        mock_cache = MagicMock()
        mock_pb = MagicMock()
        mock_pb.collection.return_value.create.return_value = new_scenario_pb
        mock_pb.collection.return_value.get_full_list.return_value = []  # no source assignments

        ctx = _build_session_context_stub(1235404, 2026)

        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[get_current_user] = _admin

        body = {
            "name": "May 8",
            "session_cm_id": 1235404,
            "year": 2026,
            "should_copy_from_production": True,
        }
        with (
            patch("api.routers.scenarios.pb", mock_pb),
            patch("api.routers.scenarios.graph_cache", mock_cache),
            patch("api.routers.scenarios.build_session_context", AsyncMock(return_value=ctx)),
        ):
            client = TestClient(app)
            resp = client.post("/api/scenarios", json=body)
            assert resp.status_code == 200, f"{resp.status_code}: {resp.text}"

        mock_cache.invalidate_scenario.assert_called_once_with(1235404, 2026, "scn_new")

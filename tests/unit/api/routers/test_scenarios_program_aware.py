"""POST/GET /api/scenarios and /api/scenarios/{id}/clear -- program-aware, no phantom columns.

kindred#2021. `saved_scenarios` carries a real `session` **relation** to
`camp_sessions` (pb_migrations/1500000021_saved_scenarios.js:39-43, plus
idx_saved_scenarios_session) but the router used to write `session_cm_id`
and `created_by` onto the create payload -- columns that do not exist on the
collection, so PocketBase silently dropped them -- and `list_scenarios`
filtered on that same nonexistent column, which can only ever match zero
rows. This suite pins the fix: `session_cm_id` is read from the expanded
relation everywhere, never written, and `list_scenarios` filters through it.

The owner's actual, functional requirement (issue comment, 2026-08-08) is
program parity: create a blank scenario, copy from production, or copy from
another scenario, for BOTH summer and weekend, through one backend path.
Summer's existing bunk_assignments / bunk_assignments_draft copy must not
regress; a weekend session (session_type in WEEKEND_SESSION_TYPES) routes
the same three choices through LodgingWriteService instead, which reads
lodging_assignments / lodging_assignments_draft.

`clear_scenario` gets the same treatment: it used to delete ONLY
bunk_assignments_draft rows unconditionally, so calling it against a
weekend scenario reported "Cleared 0 assignments" -- true in the sense that
zero bunk_assignments_draft rows exist for a weekend, and useless in every
other sense, because it deleted nothing from lodging_assignments_draft
either. That is the bug this issue is titled after.
"""

from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from bunking.auth_middleware import AuthUser, get_current_user
from bunking.rbac.permissions import ALL_PERMISSIONS


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


def _ctx(
    *,
    session_type: str = "main",
    session_cm_id: int = 1235404,
    year: int = 2026,
    session_pb_id: str = "sess_pb",
) -> Any:
    """A SessionContext-shaped stub -- same shape as
    test_draft_writes_invalidate_cache.py's _build_session_context_stub, plus
    session_type, which is the field this suite's program branch reads."""
    ctx = MagicMock()
    ctx.session_cm_id = session_cm_id
    ctx.session_type = session_type
    ctx.year = year
    ctx.session_pb_id = session_pb_id
    ctx.session_relation_filter = f"session.cm_id = {session_cm_id}"
    ctx.related_session_ids = [session_cm_id]
    ctx.id_cache = MagicMock()
    ctx.id_cache.get_person_pb_id = AsyncMock(return_value="person_pb")
    ctx.id_cache.get_bunk_pb_id = AsyncMock(return_value="bunk_pb")
    ctx.id_cache.get_session_pb_id = AsyncMock(return_value="sess_pb")
    ctx.id_cache.get_bunk_plan_id = AsyncMock(return_value="bp_pb")
    return ctx


def _build_app() -> FastAPI:
    from api.routers.scenarios import router

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = _admin
    return app


def _rec(**kwargs: Any) -> SimpleNamespace:
    return SimpleNamespace(**kwargs)


# ---------------------------------------------------------------------------
# No phantom columns
# ---------------------------------------------------------------------------


class TestCreateScenarioWritesNoPhantomColumns:
    def test_create_does_not_write_session_cm_id_or_created_by(self) -> None:
        mock_pb = MagicMock()
        mock_pb.collection.return_value.create.return_value = _rec(
            id="scn_new", name="May 8", is_active=True, description=""
        )
        mock_pb.collection.return_value.get_full_list.return_value = []  # no source assignments

        app = _build_app()
        body = {"name": "May 8", "session_cm_id": 1235404, "year": 2026, "copy_from_production": False}
        with (
            patch("api.routers.scenarios.pb", mock_pb),
            patch("api.routers.scenarios.graph_cache", MagicMock()),
            patch("api.routers.scenarios.build_session_context", AsyncMock(return_value=_ctx())),
        ):
            resp = TestClient(app).post("/api/scenarios", json=body)
        assert resp.status_code == 200, resp.text

        create_call = mock_pb.collection.return_value.create.call_args
        written = create_call[0][0]
        assert "session_cm_id" not in written
        assert "created_by" not in written
        assert written["session"] == "sess_pb"

    def test_response_session_cm_id_comes_from_the_validated_context_not_the_record(self) -> None:
        """The created PB record never carries session_cm_id (no such
        column) -- the response value has to come from `ctx`, which
        build_session_context already validated against the relation."""
        mock_pb = MagicMock()
        mock_pb.collection.return_value.create.return_value = _rec(
            id="scn_new", name="May 8", is_active=True, description=""
        )
        mock_pb.collection.return_value.get_full_list.return_value = []

        app = _build_app()
        body = {"name": "May 8", "session_cm_id": 1235404, "year": 2026, "copy_from_production": False}
        with (
            patch("api.routers.scenarios.pb", mock_pb),
            patch("api.routers.scenarios.graph_cache", MagicMock()),
            patch("api.routers.scenarios.build_session_context", AsyncMock(return_value=_ctx())),
        ):
            resp = TestClient(app).post("/api/scenarios", json=body)
        assert resp.status_code == 200, resp.text
        assert resp.json()["session_cm_id"] == 1235404


class TestListScenariosFiltersThroughTheRelation:
    def test_the_pb_filter_names_the_relation_not_a_bare_column(self) -> None:
        mock_pb = MagicMock()
        mock_pb.collection.return_value.get_full_list.return_value = []

        app = _build_app()
        with (
            patch("api.routers.scenarios.pb", mock_pb),
            patch("api.routers.scenarios.build_session_context", AsyncMock(return_value=_ctx())),
        ):
            resp = TestClient(app).get("/api/scenarios?session_id=1235404&year=2026")
        assert resp.status_code == 200, resp.text

        query_params = mock_pb.collection.return_value.get_full_list.call_args.kwargs["query_params"]
        assert "session_cm_id" not in query_params["filter"]
        assert "session.cm_id = 1235404" in query_params["filter"]

    def test_session_cm_id_in_the_response_comes_from_the_expanded_relation(self) -> None:
        mock_pb = MagicMock()
        # A real PocketBase Record keeps the bare relation id on `.session`
        # and the resolved record only under `.expand["session"]` -- see
        # `_expanded_session`'s docstring in api/routers/scenarios.py.
        session_record = _rec(id="sess_pb", cm_id=1235404)
        mock_pb.collection.return_value.get_full_list.return_value = [
            _rec(
                id="scn_1",
                name="Plan A",
                session="sess_pb",
                expand={"session": session_record},
                year=2026,
                is_active=True,
                description="",
            )
        ]

        app = _build_app()
        with (
            patch("api.routers.scenarios.pb", mock_pb),
            patch("api.routers.scenarios.build_session_context", AsyncMock(return_value=_ctx())),
        ):
            resp = TestClient(app).get("/api/scenarios?session_id=1235404&year=2026")
        assert resp.status_code == 200, resp.text
        assert resp.json()[0]["session_cm_id"] == 1235404


# ---------------------------------------------------------------------------
# Program-aware creation
# ---------------------------------------------------------------------------


class TestSummerCreationIsUnchanged:
    """Pins the EXISTING summer behaviour before it moves onto a
    program-aware branch -- a session_type this surface does not recognise
    as weekend must keep copying bunk_assignments, exactly as it does today.
    """

    def test_summer_copy_from_production_reads_bunk_assignments(self) -> None:
        mock_pb = MagicMock()
        mock_pb.collection.return_value.create.side_effect = [
            _rec(id="scn_new", name="May 8", is_active=True, description=""),  # saved_scenarios
            _rec(id="draft_1"),  # bunk_assignments_draft
        ]
        person = _rec(id="person_pb", cm_id=5001, expand=None)
        session_rec = _rec(id="sess_pb", cm_id=1235404, expand=None)
        bunk = _rec(id="bunk_pb", cm_id=42, expand=None)
        assignment = _rec(
            id="assign_1",
            person="person_pb",
            bunk="bunk_pb",
            session="sess_pb",
            year=2026,
            expand={"person": person, "session": session_rec, "bunk": bunk},
        )
        plan = _rec(id="plan_1", cm_id=7, expand={"bunk": bunk, "session": session_rec})
        mock_pb.collection.return_value.get_full_list.side_effect = [
            [assignment],  # bunk_assignments
            [plan],  # bunk_plans
        ]

        app = _build_app()
        body = {"name": "May 8", "session_cm_id": 1235404, "year": 2026, "should_copy_from_production": True}
        with (
            patch("api.routers.scenarios.pb", mock_pb),
            patch("api.routers.scenarios.graph_cache", MagicMock()),
            patch("api.routers.scenarios.build_session_context", AsyncMock(return_value=_ctx(session_type="main"))),
        ):
            resp = TestClient(app).post("/api/scenarios", json=body)
        assert resp.status_code == 200, resp.text

        # The 2nd .create call is the draft row -- BUNK_ASSIGNMENTS_DRAFT, never lodging.
        draft_call = mock_pb.collection.call_args_list[-1]
        assert draft_call[0][0] == "bunk_assignments_draft"

    def test_a_weekend_session_never_touches_bunk_assignments(self) -> None:
        """The other half of program-awareness: a weekend create must not
        fall into summer's branch and read bunk_assignments (which would
        silently copy zero rows -- exactly the bug this issue exists to fix)."""
        mock_pb = MagicMock()
        mock_pb.collection.return_value.create.return_value = _rec(
            id="scn_new", name="Family Weekend", is_active=True, description=""
        )

        mock_write_service = MagicMock()
        mock_write_service.copy_from_mirror = AsyncMock(return_value=_rec(copied=3, skipped=0))

        app = _build_app()
        body = {
            "name": "Family Weekend",
            "session_cm_id": 2000001,
            "year": 2026,
            "should_copy_from_production": True,
        }
        with (
            patch("api.routers.scenarios.pb", mock_pb),
            patch("api.routers.scenarios.graph_cache", MagicMock()),
            patch(
                "api.routers.scenarios.build_session_context",
                AsyncMock(return_value=_ctx(session_type="family", session_cm_id=2000001)),
            ),
            patch("api.routers.scenarios.LodgingWriteService", return_value=mock_write_service),
        ):
            resp = TestClient(app).post("/api/scenarios", json=body)
        assert resp.status_code == 200, resp.text

        # Only one .create call -- the scenario itself. Nothing named
        # bunk_assignments_draft was ever created.
        created_collections = [call.args[0] for call in mock_pb.collection.call_args_list]
        assert "bunk_assignments_draft" not in created_collections
        assert "bunk_assignments" not in created_collections


class TestWeekendCreationRoutesThroughLodgingWriteService:
    def test_copy_from_production_calls_copy_from_mirror_with_the_new_scenario_id(self) -> None:
        mock_pb = MagicMock()
        mock_pb.collection.return_value.create.return_value = _rec(
            id="scn_new", name="Family Weekend", is_active=True, description=""
        )
        mock_write_service = MagicMock()
        mock_write_service.copy_from_mirror = AsyncMock(return_value=_rec(copied=5, skipped=1))

        app = _build_app()
        body = {
            "name": "Family Weekend",
            "session_cm_id": 2000001,
            "year": 2026,
            "should_copy_from_production": True,
        }
        with (
            patch("api.routers.scenarios.pb", mock_pb),
            patch("api.routers.scenarios.graph_cache", MagicMock()),
            patch(
                "api.routers.scenarios.build_session_context",
                AsyncMock(return_value=_ctx(session_type="family", session_cm_id=2000001)),
            ),
            patch("api.routers.scenarios.LodgingWriteService", return_value=mock_write_service),
        ):
            resp = TestClient(app).post("/api/scenarios", json=body)
        assert resp.status_code == 200, resp.text

        mock_write_service.copy_from_mirror.assert_awaited_once()
        sent = mock_write_service.copy_from_mirror.call_args[0][0]
        assert sent.scenario == "scn_new"
        assert sent.session_cm_id == 2000001
        assert sent.year == 2026

    def test_copy_from_scenario_calls_copy_scenario_to_scenario(self) -> None:
        mock_pb = MagicMock()
        mock_pb.collection.return_value.create.return_value = _rec(
            id="scn_new", name="Family Weekend Option B", is_active=True, description=""
        )
        mock_write_service = MagicMock()
        mock_write_service.copy_scenario_to_scenario = AsyncMock(return_value=_rec(copied=5, skipped=0))

        app = _build_app()
        body = {
            "name": "Family Weekend Option B",
            "session_cm_id": 2000001,
            "year": 2026,
            "copy_from_scenario": "scn_source",
        }
        with (
            patch("api.routers.scenarios.pb", mock_pb),
            patch("api.routers.scenarios.graph_cache", MagicMock()),
            patch(
                "api.routers.scenarios.build_session_context",
                AsyncMock(return_value=_ctx(session_type="adult", session_cm_id=2000001)),
            ),
            patch("api.routers.scenarios.LodgingWriteService", return_value=mock_write_service),
        ):
            resp = TestClient(app).post("/api/scenarios", json=body)
        assert resp.status_code == 200, resp.text

        mock_write_service.copy_scenario_to_scenario.assert_awaited_once_with(
            year=2026, session_cm_id=2000001, from_scenario="scn_source", to_scenario="scn_new"
        )

    def test_a_blank_weekend_scenario_calls_neither_copy(self) -> None:
        mock_pb = MagicMock()
        mock_pb.collection.return_value.create.return_value = _rec(
            id="scn_new", name="Blank", is_active=True, description=""
        )
        mock_write_service = MagicMock()
        mock_write_service.copy_from_mirror = AsyncMock()
        mock_write_service.copy_scenario_to_scenario = AsyncMock()

        app = _build_app()
        body = {
            "name": "Blank",
            "session_cm_id": 2000001,
            "year": 2026,
            "copy_from_production": False,
        }
        with (
            patch("api.routers.scenarios.pb", mock_pb),
            patch("api.routers.scenarios.graph_cache", MagicMock()),
            patch(
                "api.routers.scenarios.build_session_context",
                AsyncMock(return_value=_ctx(session_type="family", session_cm_id=2000001)),
            ),
            patch("api.routers.scenarios.LodgingWriteService", return_value=mock_write_service),
        ):
            resp = TestClient(app).post("/api/scenarios", json=body)
        assert resp.status_code == 200, resp.text

        mock_write_service.copy_from_mirror.assert_not_called()
        mock_write_service.copy_scenario_to_scenario.assert_not_called()


class TestSummerCopyFromScenarioCarriesLockedGroups:
    """kindred#1046, ported server-side. The frontend's client-side
    copyScenarioToScenario used to copy locked_groups + locked_group_members
    after copying assignments; moving creation onto POST /api/scenarios must
    not silently drop that, or every scenario copy loses its friend groups."""

    def test_copy_from_scenario_copies_locked_groups_and_members(self) -> None:
        mock_pb = MagicMock()
        new_scenario = _rec(id="scn_new", name="Option B", is_active=True, description="")
        new_group = _rec(id="group_new")
        mock_pb.collection.return_value.create.side_effect = [
            new_scenario,  # saved_scenarios
            new_group,  # locked_groups
            _rec(id="member_new"),  # locked_group_members
        ]
        source_group = _rec(id="group_src", name="Cabin crew", color="#fff", session="sess_pb", year=2026)
        source_member = _rec(id="member_src", group="group_src", attendee="attendee_1")
        mock_pb.collection.return_value.get_full_list.side_effect = [
            [],  # bunk_assignments_draft (copy_from_scenario source, empty for this test)
            [source_group],  # locked_groups
            [source_member],  # locked_group_members
        ]

        app = _build_app()
        body = {
            "name": "Option B",
            "session_cm_id": 1235404,
            "year": 2026,
            "copy_from_scenario": "scn_source",
        }
        with (
            patch("api.routers.scenarios.pb", mock_pb),
            patch("api.routers.scenarios.graph_cache", MagicMock()),
            patch(
                "api.routers.scenarios.build_session_context",
                AsyncMock(return_value=_ctx(session_type="main")),
            ),
        ):
            resp = TestClient(app).post("/api/scenarios", json=body)
        assert resp.status_code == 200, resp.text

        created_collections = [call.args[0] for call in mock_pb.collection.call_args_list]
        assert "locked_groups" in created_collections
        assert "locked_group_members" in created_collections

        group_create_call = mock_pb.collection.return_value.create.call_args_list[1]
        assert group_create_call[0][0]["scenario"] == "scn_new"
        member_create_call = mock_pb.collection.return_value.create.call_args_list[2]
        assert member_create_call[0][0]["group"] == "group_new"
        assert member_create_call[0][0]["attendee"] == "attendee_1"

    def test_copy_from_production_does_not_copy_locked_groups(self) -> None:
        """Matches the frontend comment this replaces: "Production-source
        copies are skipped via the callsite" -- there is no prior scenario to
        carry locked groups FROM."""
        mock_pb = MagicMock()
        mock_pb.collection.return_value.create.return_value = _rec(
            id="scn_new", name="Fresh from prod", is_active=True, description=""
        )
        mock_pb.collection.return_value.get_full_list.return_value = []

        app = _build_app()
        body = {
            "name": "Fresh from prod",
            "session_cm_id": 1235404,
            "year": 2026,
            "should_copy_from_production": True,
        }
        with (
            patch("api.routers.scenarios.pb", mock_pb),
            patch("api.routers.scenarios.graph_cache", MagicMock()),
            patch(
                "api.routers.scenarios.build_session_context",
                AsyncMock(return_value=_ctx(session_type="main")),
            ),
        ):
            resp = TestClient(app).post("/api/scenarios", json=body)
        assert resp.status_code == 200, resp.text

        created_collections = [call.args[0] for call in mock_pb.collection.call_args_list]
        assert "locked_groups" not in created_collections


# ---------------------------------------------------------------------------
# /api/scenarios/{id}/clear -- program-aware
# ---------------------------------------------------------------------------


class TestClearScenarioIsProgramAware:
    """The bug this issue is titled after: clear_scenario deleted ONLY
    bunk_assignments_draft rows, unconditionally. Against a weekend scenario
    that reports "Cleared 0" every time, whether or not the scenario holds
    placements -- success, with nothing deleted."""

    def test_weekend_clear_deletes_lodging_assignments_draft_not_bunk(self) -> None:
        weekend_session = _rec(id="sess_pb", cm_id=2000001, session_type="family")
        scenario = _rec(id="scn_1", name="Family Weekend", session="sess_pb", expand={"session": weekend_session})
        placement = _rec(id="placement_1")

        mock_pb = MagicMock()
        mock_pb.collection.return_value.get_one.return_value = scenario
        mock_pb.collection.return_value.get_full_list.return_value = [placement]

        app = _build_app()
        with (
            patch("api.routers.scenarios.pb", mock_pb),
            patch("api.routers.scenarios.graph_cache", MagicMock()),
        ):
            resp = TestClient(app).post("/api/scenarios/scn_1/clear", json={"year": 2026})
        assert resp.status_code == 200, resp.text
        assert "Cleared 1" in resp.json()["message"]

        collections_touched = {call.args[0] for call in mock_pb.collection.call_args_list}
        assert "lodging_assignments_draft" in collections_touched
        assert "bunk_assignments_draft" not in collections_touched

        delete_call = mock_pb.collection.return_value.delete.call_args
        assert delete_call[0][0] == "placement_1"

    def test_weekend_clear_with_no_placements_reports_zero_honestly(self) -> None:
        """Before the fix this already said "Cleared 0" -- for the wrong
        reason (it never looked at the right table). After the fix it still
        says "Cleared 0" when the weekend scenario really is empty, which is
        the same string for a different, now-correct, reason."""
        weekend_session = _rec(id="sess_pb", cm_id=2000001, session_type="adult")
        scenario = _rec(id="scn_1", name="Adult Weekend", session="sess_pb", expand={"session": weekend_session})

        mock_pb = MagicMock()
        mock_pb.collection.return_value.get_one.return_value = scenario
        mock_pb.collection.return_value.get_full_list.return_value = []

        app = _build_app()
        with (
            patch("api.routers.scenarios.pb", mock_pb),
            patch("api.routers.scenarios.graph_cache", MagicMock()),
        ):
            resp = TestClient(app).post("/api/scenarios/scn_1/clear", json={"year": 2026})
        assert resp.status_code == 200, resp.text
        assert "Cleared 0" in resp.json()["message"]

    def test_summer_clear_still_deletes_bunk_assignments_draft(self) -> None:
        """Pins the EXISTING behaviour: a session_type this surface does not
        recognise as weekend must keep clearing bunk_assignments_draft."""
        summer_session = _rec(id="sess_pb", cm_id=1235404, session_type="main")
        scenario = _rec(id="scn_1", name="May 7", session="sess_pb", expand={"session": summer_session})
        assignment = _rec(id="assign_1")

        mock_pb = MagicMock()
        mock_pb.collection.return_value.get_one.return_value = scenario
        mock_pb.collection.return_value.get_full_list.return_value = [assignment]

        app = _build_app()
        with (
            patch("api.routers.scenarios.pb", mock_pb),
            patch("api.routers.scenarios.graph_cache", MagicMock()),
        ):
            resp = TestClient(app).post("/api/scenarios/scn_1/clear", json={"year": 2026})
        assert resp.status_code == 200, resp.text

        collections_touched = {call.args[0] for call in mock_pb.collection.call_args_list}
        assert "bunk_assignments_draft" in collections_touched
        assert "lodging_assignments_draft" not in collections_touched

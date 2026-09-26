"""Board notes x scenarios (spec §4).

Creating a scenario FROM ANOTHER SCENARIO copies the source's plan-only notes
to the new scenario, once, for both programs, inside create_scenario's
rollback try -- so a failed copy deletes the new scenario (and PocketBase
cascades anything already written). Blank and from-production creations copy
nothing: standard notes already show in every scenario. Clearing a scenario
and pushing/unpushing write-ins never touch notes. Fictional data throughout.
"""

import inspect
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from bunking.auth_middleware import AuthUser, get_current_user
from bunking.rbac.permissions import ALL_PERMISSIONS


def _admin() -> AuthUser:
    user = AuthUser(
        username="TestAdmin", email="test@example.com", display_name="Test Admin", groups=["admin"], is_admin=True
    )
    user.permissions = set(ALL_PERMISSIONS)
    return user


def _ctx(session_type: str) -> Any:
    ctx = MagicMock()
    ctx.session_cm_id = 1000001
    ctx.session_type = session_type
    ctx.year = 2026
    ctx.session_pb_id = "sess_pb"
    ctx.related_session_ids = [1000001]
    return ctx


def _app() -> FastAPI:
    from api.routers.scenarios import router

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = _admin
    return app


def _create(body: dict[str, Any], *, session_type: str, notes: MagicMock, seed_error: Exception | None = None) -> Any:
    pb = MagicMock()
    pb.collection.return_value.create.return_value = SimpleNamespace(
        id="scn_new", name="Option B", is_active=True, description=""
    )
    pb.collection.return_value.get_one.return_value = SimpleNamespace(id="scn_source")
    pb.collection.return_value.get_full_list.return_value = []
    summer = MagicMock()
    summer.seed_summer_scenario = AsyncMock(side_effect=seed_error)
    with (
        patch("api.routers.scenarios.pb", pb),
        patch("api.routers.scenarios.graph_cache", MagicMock()),
        patch("api.routers.scenarios.build_session_context", AsyncMock(return_value=_ctx(session_type))),
        patch("api.routers.scenarios._seed_weekend_scenario", AsyncMock(side_effect=seed_error, return_value=0)),
        patch("api.routers.scenarios.SummerScenarioWriteService", return_value=summer),
        patch("api.routers.scenarios.SubjectNoteService", return_value=notes),
    ):
        response = TestClient(_app(), raise_server_exceptions=False).post(
            "/api/scenarios", json={"name": "Option B", "session_cm_id": 1000001, "year": 2026, **body}
        )
    return response, pb


def _notes(**kwargs: Any) -> MagicMock:
    notes = MagicMock()
    notes.copy_plan_notes = AsyncMock(**kwargs)
    return notes


@pytest.mark.parametrize("session_type", ["main", "family", "adult"])
def test_copy_from_scenario_copies_plan_notes_to_the_new_scenario(session_type: str) -> None:
    notes = _notes(return_value=2)
    response, _ = _create({"copy_from_scenario": "scn_source"}, session_type=session_type, notes=notes)
    assert response.status_code == 200, response.text
    notes.copy_plan_notes.assert_awaited_once_with("scn_source", "scn_new")


@pytest.mark.parametrize("body", [{"copy_from_production": False}, {"copy_from_production": True}, {}])
def test_blank_and_production_creations_copy_no_notes(body: dict[str, Any]) -> None:
    notes = _notes(return_value=0)
    response, _ = _create(body, session_type="family", notes=notes)
    assert response.status_code == 200, response.text
    notes.copy_plan_notes.assert_not_awaited()


def test_a_failed_note_copy_deletes_the_new_scenario() -> None:
    notes = _notes(side_effect=RuntimeError("pb down mid-copy"))
    response, pb = _create({"copy_from_scenario": "scn_source"}, session_type="main", notes=notes)
    assert response.status_code == 500
    pb.collection.return_value.delete.assert_called_once_with("scn_new")


def test_a_seeding_failure_never_reaches_the_note_copy() -> None:
    notes = _notes(return_value=0)
    response, pb = _create(
        {"copy_from_scenario": "scn_source"}, session_type="main", notes=notes, seed_error=RuntimeError("seed")
    )
    assert response.status_code == 500
    notes.copy_plan_notes.assert_not_awaited()
    pb.collection.return_value.delete.assert_called_once_with("scn_new")


def test_clearing_a_scenario_never_touches_subject_notes() -> None:
    pb = MagicMock()
    pb.collection.return_value.get_one.return_value = SimpleNamespace(
        id="scn_1", expand={"session": SimpleNamespace(id="sess_pb", cm_id=1000005, session_type="family")}
    )
    pb.collection.return_value.get_full_list.return_value = []
    with patch("api.routers.scenarios.pb", pb), patch("api.routers.scenarios.graph_cache", MagicMock()):
        response = TestClient(_app()).post("/api/scenarios/scn_1/clear", json={"year": 2026})
    assert response.status_code == 200, response.text
    assert "subject_notes" not in [call.args[0] for call in pb.collection.call_args_list]


def test_push_and_unpush_never_name_subject_notes() -> None:
    """The push ledger is a write-in replay contract that carries no prose (spec §4)."""
    import api.services.lodging_repository as repository
    import api.services.lodging_write_service as write_service

    for module in (write_service, repository):
        source = inspect.getsource(module)
        assert "SUBJECT_NOTES" not in source, module.__name__
        assert "subject_notes" not in source, module.__name__

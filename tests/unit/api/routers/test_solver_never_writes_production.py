"""The solver never writes production bunk assignments (kindred#2467).

Production is read-only for the solver: solver output lands in a scenario's
``bunk_assignments_draft`` rows and nowhere else. The lodging side already
encodes the same rule — ``PlacementWriteBase.scenario`` in
``frontend/src/services/lodgingApi.ts``: *"REQUIRED and non-empty. A blank
scenario is a 422, never a write to the live plan."*

These tests pin the **class**, not the instance. Before #2467, applying a
scenario-less run took an ``else`` branch that tried to create a
``bunk_assignments`` row with a payload whose only real column was ``year``;
the write failed validation, a bare ``except Exception`` swallowed it, and the
endpoint returned 200 having written nothing. The fix is not a better payload —
a *working* production write is the defect. So the assertions here are:

  * no mutation ever reaches ``bunk_assignments`` from the solver apply path,
  * a scenario-less run is refused with a 4xx at apply time,
  * a scenario-less run is refused at creation time,
  * ``apply_solver_results`` does not so much as name the production collection,
  * a swallowed write failure can no longer return success.

A payload-shape test would pass the moment someone "fixed" the production
branch into a working write, which is the outcome being prevented.
"""

import ast
import inspect
import textwrap
from collections.abc import Iterator
from contextlib import contextmanager
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pocketbase.client import ClientResponseError  # type: ignore[attr-defined]

from bunking.auth_middleware import AuthUser, get_current_user
from bunking.rbac.permissions import ALL_PERMISSIONS

PRODUCTION_COLLECTION = "bunk_assignments"
DRAFT_COLLECTION = "bunk_assignments_draft"

SESSION_CM_ID = 1235404
YEAR = 2026
PERSON_CM_ID = 60001
BUNK_CM_ID = 4276
BUNK_NAME = "Bunk 7"


class _MalformedExistingRecord:
    """Neither a dict with an "id" key nor an object exposing ``.id``.

    Stands in for whatever shape PocketBase could plausibly hand back that
    the ``isinstance(existing_record, dict)`` branch in ``apply_solver_results``
    does not anticipate (kindred#2471 follow-up review finding).
    """


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


class RecordingPB:
    """PocketBase client stand-in that records every mutating call by collection.

    ``mutations`` holds ``(collection_name, method)`` for each create/update/
    delete, which is what the class guard asserts on — the *target* of the
    write, never the payload's shape.
    """

    def __init__(
        self,
        *,
        lists: dict[str, list[Any]] | None = None,
        records: dict[str, Any] | None = None,
        write_error: Exception | None = None,
    ) -> None:
        self.mutations: list[tuple[str, str]] = []
        self._lists = lists or {}
        self._records = records or {}
        self._write_error = write_error

    def collection(self, name: str) -> MagicMock:
        col = MagicMock(name=f"collection({name})")
        col.get_full_list.return_value = self._lists.get(name, [])
        if name in self._records:
            col.get_one.return_value = self._records[name]

        def _mutate(method: str) -> Any:
            def _inner(*_args: Any, **_kwargs: Any) -> Any:
                self.mutations.append((name, method))
                if self._write_error is not None:
                    raise self._write_error
                return MagicMock()

            return _inner

        col.create.side_effect = _mutate("create")
        col.update.side_effect = _mutate("update")
        col.delete.side_effect = _mutate("delete")
        return col

    def mutated(self, collection_name: str) -> list[tuple[str, str]]:
        return [m for m in self.mutations if m[0] == collection_name]


def _session_context_stub() -> Any:
    ctx = MagicMock()
    ctx.session_cm_id = SESSION_CM_ID
    ctx.year = YEAR
    ctx.session_pb_id = "sess_pb"
    ctx.session_relation_filter = f"session.cm_id = {SESSION_CM_ID}"
    ctx.related_session_ids = [SESSION_CM_ID]
    return ctx


def _id_cache_stub() -> MagicMock:
    cache = MagicMock()
    cache.get_person_pb_id = AsyncMock(return_value="person_pb")
    cache.get_bunk_pb_id = AsyncMock(return_value="bunk_pb")
    cache.get_session_pb_id = AsyncMock(return_value="sess_pb")
    cache.get_bunk_plan_id = AsyncMock(return_value="bp_pb")
    return cache


def _pb_with_one_assignable_camper(**kwargs: Any) -> RecordingPB:
    """A PB stand-in where every lookup the apply loop makes succeeds.

    The loop must get all the way to the write for the guard to mean anything:
    a lookup that bails early would make "no production write" vacuously true.
    """
    bunk = SimpleNamespace(id="bunk_pb", cm_id=BUNK_CM_ID, name=BUNK_NAME, year=YEAR)
    attendee = SimpleNamespace(
        id="att_pb",
        person_id=PERSON_CM_ID,
        year=YEAR,
        expand={"session": SimpleNamespace(id="sess_pb", cm_id=SESSION_CM_ID)},
    )
    lists: dict[str, list[Any]] = {"bunks": [bunk], "attendees": [attendee]}
    lists.update(kwargs.pop("lists", {}))
    return RecordingPB(lists=lists, **kwargs)


@contextmanager
def _apply_client(pb: RecordingPB, runs: dict[str, Any], cache: MagicMock) -> Iterator[TestClient]:
    from api.routers.solver import router

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = _admin

    with (
        patch("api.routers.solver.pb", pb),
        patch("api.routers.solver.solver_runs", runs),
        patch("api.routers.solver.graph_cache", cache),
        patch("api.routers.solver.IDLookupCache", MagicMock(return_value=_id_cache_stub())),
        patch("api.routers.solver.build_session_context", AsyncMock(return_value=_session_context_stub())),
    ):
        yield TestClient(app, raise_server_exceptions=False)


def _completed_run(scenario: str | None) -> dict[str, Any]:
    return {
        "id": "run-2467",
        "status": "completed",
        "session_cm_id": SESSION_CM_ID,
        "scenario": scenario,
        "config": {"year": YEAR},
        "results": {"assignments": {str(PERSON_CM_ID): BUNK_NAME}},
    }


@contextmanager
def _run_client(runs: dict[str, Any]) -> Iterator[TestClient]:
    from api.routers.solver import router

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = _admin

    child_session = SimpleNamespace(id="sess_pb", cm_id=SESSION_CM_ID, name="Session 1", sex_eligible="all")

    with (
        patch("api.routers.solver.pb", RecordingPB(lists={"camp_sessions": [child_session]})),
        patch("api.routers.solver.solver_runs", runs),
        patch("api.routers.solver.run_solver_task_v2"),
    ):
        yield TestClient(app, raise_server_exceptions=False)


# ---------------------------------------------------------------------------
# The class guard: no write to bunk_assignments, ever
# ---------------------------------------------------------------------------


class TestSolverNeverWritesProduction:
    def test_apply_without_scenario_never_touches_production(self) -> None:
        """The architectural rule. Not "the payload is well formed" — *no write at all*."""
        pb = _pb_with_one_assignable_camper()
        runs = {"run-2467": _completed_run(scenario=None)}

        with _apply_client(pb, runs, MagicMock()) as client:
            client.post("/api/solver/apply/run-2467")

        assert pb.mutated(PRODUCTION_COLLECTION) == [], (
            f"Solver apply mutated {PRODUCTION_COLLECTION}: {pb.mutated(PRODUCTION_COLLECTION)}. "
            "Production is read-only for the solver — output belongs in a scenario draft."
        )

    def test_apply_with_scenario_never_touches_production(self) -> None:
        """The scenario path is the legal one and must stay inside the draft table."""
        pb = _pb_with_one_assignable_camper()
        runs = {"run-2467": _completed_run(scenario="scn_abc123")}

        with _apply_client(pb, runs, MagicMock()) as client:
            resp = client.post("/api/solver/apply/run-2467")

        assert resp.status_code == 200, f"{resp.status_code}: {resp.text}"
        assert pb.mutated(PRODUCTION_COLLECTION) == []
        assert pb.mutated(DRAFT_COLLECTION), "The scenario apply must still write the draft table"

    def test_apply_function_never_names_the_production_collection(self) -> None:
        """Secondary tripwire: re-adding a production write means naming the table.

        Both spellings count — the literal and the ``BUNK_ASSIGNMENTS`` constant
        from ``api/constants/collections.py``.

        This is a cheap, fast source-level check, and it is foolable: a
        module-level alias for the production collection (e.g. ``_ALIAS =
        BUNK_ASSIGNMENTS`` referenced inside the function) walks past this
        AST scan without ever naming ``BUNK_ASSIGNMENTS`` or the literal
        directly. The load-bearing coverage is the *behavioral* tests above
        (``test_apply_without_scenario_never_touches_production`` and
        ``test_apply_with_scenario_never_touches_production``), which assert
        against a ``RecordingPB`` and catch a bypass like that regardless of
        how the write got there. Do not simplify this suite down to just this
        AST check — it only catches the naive re-introduction.
        """
        from api.routers.solver import apply_solver_results

        tree = ast.parse(textwrap.dedent(inspect.getsource(apply_solver_results)))
        offenders: list[str] = []
        for node in ast.walk(tree):
            if (
                isinstance(node, ast.Constant)
                and isinstance(node.value, str)
                and PRODUCTION_COLLECTION in node.value
                and DRAFT_COLLECTION not in node.value
            ):
                offenders.append(node.value)
            if isinstance(node, ast.Name) and node.id == "BUNK_ASSIGNMENTS":
                offenders.append(node.id)

        assert offenders == [], (
            f"apply_solver_results names the production collection: {offenders}. "
            "Solver output applies to a scenario; production is read-only."
        )


# ---------------------------------------------------------------------------
# Refusal at apply time
# ---------------------------------------------------------------------------


class TestApplyRefusesWithoutScenario:
    def test_in_memory_run_without_scenario_is_refused(self) -> None:
        pb = _pb_with_one_assignable_camper()
        runs = {"run-2467": _completed_run(scenario=None)}

        with _apply_client(pb, runs, MagicMock()) as client:
            resp = client.post("/api/solver/apply/run-2467")

        assert resp.status_code == 422, f"Expected a refusal, got {resp.status_code}: {resp.text}"
        assert "scenario" in resp.text.lower()
        assert pb.mutations == [], f"A refused apply must write nothing: {pb.mutations}"

    def test_stored_run_without_scenario_is_refused(self) -> None:
        """Runs already in PocketBase reach apply through the other branch."""
        stored = SimpleNamespace(
            id="run-stored",
            results=f'{{"assignments": {{"{PERSON_CM_ID}": "{BUNK_NAME}"}}, "year": {YEAR}}}',
            session_cm_id=SESSION_CM_ID,
            session="sess_pb",
            scenario="",
        )
        pb = _pb_with_one_assignable_camper(records={"solver_runs": stored})

        with _apply_client(pb, {}, MagicMock()) as client:
            resp = client.post("/api/solver/apply/run-stored")

        assert resp.status_code == 422, f"Expected a refusal, got {resp.status_code}: {resp.text}"
        assert pb.mutations == [], f"A refused apply must write nothing: {pb.mutations}"

    def test_refused_apply_does_not_invalidate_the_graph_cache(self) -> None:
        """Nothing changed, so nothing should be dropped from the cache."""
        pb = _pb_with_one_assignable_camper()
        cache = MagicMock()
        runs = {"run-2467": _completed_run(scenario=None)}

        with _apply_client(pb, runs, cache) as client:
            client.post("/api/solver/apply/run-2467")

        cache.invalidate_session.assert_not_called()
        cache.invalidate_scenario.assert_not_called()


# ---------------------------------------------------------------------------
# Refusal at run creation
# ---------------------------------------------------------------------------


class TestRunCreationRequiresScenario:
    @pytest.mark.parametrize("scenario", [None, "", "   "])
    def test_run_solver_without_scenario_is_refused(self, scenario: str | None) -> None:
        body: dict[str, Any] = {"session_cm_id": SESSION_CM_ID, "year": YEAR}
        if scenario is not None:
            body["scenario"] = scenario

        with _run_client({}) as client:
            resp = client.post("/api/solver/run", json=body)

        assert resp.status_code == 422, f"Expected a refusal, got {resp.status_code}: {resp.text}"
        assert "scenario" in resp.text.lower()

    def test_run_solver_with_scenario_still_starts(self) -> None:
        """The refusal must not swallow the legal path."""
        runs: dict[str, Any] = {}
        with _run_client(runs) as client:
            resp = client.post(
                "/api/solver/run",
                json={"session_cm_id": SESSION_CM_ID, "year": YEAR, "scenario": "scn_abc123"},
            )

        assert resp.status_code == 200, f"{resp.status_code}: {resp.text}"
        assert len(runs) == 1

    def test_multi_session_run_without_scenario_is_refused(self) -> None:
        with _run_client({}) as client:
            resp = client.post(
                "/api/solver/run-multi-session",
                json={"parent_session_cm_id": 100, "year": YEAR},
            )

        assert resp.status_code == 422, f"Expected a refusal, got {resp.status_code}: {resp.text}"
        assert "scenario" in resp.text.lower()

    def test_multi_session_run_with_scenario_still_starts(self) -> None:
        runs: dict[str, Any] = {}
        with _run_client(runs) as client:
            resp = client.post(
                "/api/solver/run-multi-session",
                json={"parent_session_cm_id": 100, "year": YEAR, "scenario": "scn_abc123"},
            )

        assert resp.status_code == 200, f"{resp.status_code}: {resp.text}"
        assert len(runs) == 1


# ---------------------------------------------------------------------------
# A swallowed write failure must not report success
# ---------------------------------------------------------------------------


class TestApplyDoesNotSwallowWriteFailures:
    def test_draft_write_failure_is_not_reported_as_success(self) -> None:
        pb = _pb_with_one_assignable_camper(write_error=ClientResponseError("boom", status=400))
        runs = {"run-2467": _completed_run(scenario="scn_abc123")}

        with _apply_client(pb, runs, MagicMock()) as client:
            resp = client.post("/api/solver/apply/run-2467")

        assert pb.mutated(DRAFT_COLLECTION), "The write must have been attempted"
        assert resp.status_code >= 400, (
            f"A failed write returned {resp.status_code}: {resp.text}. "
            "Reporting success over a swallowed write failure is how #2467 stayed invisible."
        )

    def test_malformed_existing_draft_record_is_counted_not_raised(self) -> None:
        """A malformed *existing*-record shape must degrade this camper, not raise
        AttributeError and abort the whole remaining batch.

        ``existing_record.id`` on a shape that is neither a dict nor an object
        exposing ``.id`` raises AttributeError. The narrowed
        ``except (ClientResponseError, ValueError)`` added for kindred#2467 does
        not catch AttributeError on purpose — so if the malformed shape reaches
        that line, the exception escapes the per-camper try/except entirely and
        this app (which registers no global exception handler of its own) falls
        through to Starlette's bare 500, distinguishable from the endpoint's own
        controlled failure response by its plain-text body and content type.
        """
        pb = _pb_with_one_assignable_camper(lists={"bunk_assignments_draft": [_MalformedExistingRecord()]})
        runs = {"run-2467": _completed_run(scenario="scn_abc123")}

        with _apply_client(pb, runs, MagicMock()) as client:
            resp = client.post("/api/solver/apply/run-2467")

        assert resp.status_code == 500, (
            f"Expected the endpoint's own failure response, got {resp.status_code}: {resp.text}"
        )
        assert resp.headers["content-type"].startswith("application/json"), (
            f"Got content-type {resp.headers.get('content-type')!r} body {resp.text!r}. "
            "A non-JSON 500 means AttributeError escaped the per-camper try/except and aborted "
            "the batch instead of being counted as a write failure."
        )
        assert "assignments failed to write" in resp.text
        assert pb.mutated(PRODUCTION_COLLECTION) == []
        assert pb.mutated(DRAFT_COLLECTION) == [], "The malformed existing record must never be written through"

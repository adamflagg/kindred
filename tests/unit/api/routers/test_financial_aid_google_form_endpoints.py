"""Adult aid Google Form routes (adult-aid form design PR 2): Link…, Ignore…, link candidates, Mark Reviewed and
Pull now. Every one is financial_aid.casework; each write reaches the service with the caller's email and then
rebuilds the season's intake. Pull now asks PocketBase, as FastAPI's superuser, to run the form job: PocketBase's own
sync route is bunking.manage-gated, which Camperships staff may not hold.

Also pinned here: no response schema on the Camperships router carries POC, race/ethnicity or gender identity, and
the respondent email is only on the link-candidates schema.

Builds a bare FastAPI app rather than importing api.main (it poisons auth for the whole xdist run). Fictional ids."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.schemas.financial_aid_form_intake import (
    FormChangeReviewedOut,
    FormResponseActionOut,
    LinkCandidateOut,
    LinkCandidatesOut,
)
from api.services.financial_aid_casework_service import CaseworkValidationError
from bunking.auth_middleware import AuthUser, get_current_user
from bunking.rbac.permissions import Permission
from tests.unit.rbac.permission_personas import (
    PERSONA_FINANCE,
    PERSONA_REGISTRAR,
    assert_persona_access,
    assert_requires_permission,
    persona_user,
)

RECORD = "abc123def456789"
REQUEST = "req000000000001"
BASE = "/api/financial-aid/intake/2027/form-responses"
ACTION = FormResponseActionOut(
    id=RECORD,
    response_id="resp-1",
    match_status="staff",
    person_cm_id=1000091,
    household_cm_id=1000009,
    linked_by="registrar@example.com",
    linked_at="2026-11-06 10:00:00.000Z",
)
CANDIDATES = LinkCandidatesOut(
    id=RECORD,
    response_id="resp-1",
    respondent_email="rachel@example.com",
    name_typed="Rachel Garcia",
    candidates=[
        LinkCandidateOut(person_cm_id=1000091, household_cm_id=1000009, signals=["name"], camper_name="Rachel Garcia")
    ],
)
REVIEWED = FormChangeReviewedOut(request_id=REQUEST, reviewed_by="registrar@example.com", reviewed_at="2026-12-11")

ROUTES: list[tuple[str, str, dict[str, Any] | None]] = [
    ("POST", f"{BASE}/{RECORD}/link", {"person_cm_id": 1000091, "reason": "nickname"}),
    ("POST", f"{BASE}/{RECORD}/ignore", {"kind": "test"}),
    ("GET", f"{BASE}/{RECORD}/candidates", None),
    ("POST", f"{BASE}/pull", None),
    ("POST", f"/api/financial-aid/requests/2027/form-changes/{REQUEST}/review", None),
]


def _stub() -> MagicMock:
    stub = MagicMock()
    stub.link = AsyncMock(return_value=ACTION)
    stub.ignore = AsyncMock(return_value=ACTION.model_copy(update={"match_status": "ignored"}))
    stub.link_candidates = AsyncMock(return_value=CANDIDATES)
    stub.review_form_change = AsyncMock(return_value=REVIEWED)
    return stub


@contextmanager
def _client(
    user: AuthUser, stub: MagicMock, rebuild: AsyncMock | None = None, pull: AsyncMock | None = None
) -> Iterator[TestClient]:
    from api.routers import financial_aid

    app = FastAPI()
    app.include_router(financial_aid.router)
    app.dependency_overrides[get_current_user] = lambda: user
    with (
        patch.object(financial_aid, "_form_responses", return_value=stub),
        patch.object(financial_aid, "_rebuild_intake", rebuild or AsyncMock(return_value=True)),
        patch.object(financial_aid, "_pull_google_form", pull or AsyncMock(return_value={"status": "started"})),
    ):
        yield TestClient(app)


@pytest.mark.parametrize(("method", "url", "body"), ROUTES)
def test_every_form_response_route_needs_casework(method: str, url: str, body: Any) -> None:
    from api.routers import financial_aid

    with (
        patch.object(financial_aid, "_form_responses", return_value=_stub()),
        patch.object(financial_aid, "_rebuild_intake", AsyncMock(return_value=True)),
        patch.object(financial_aid, "_pull_google_form", AsyncMock(return_value={"status": "started"})),
    ):
        assert_persona_access(
            financial_aid.router, method, url, allowed={PERSONA_REGISTRAR, PERSONA_FINANCE}, json=body
        )


def test_every_form_response_handler_declares_casework() -> None:
    from api.routers import financial_aid as r

    for endpoint in (
        r.link_form_response,
        r.ignore_form_response,
        r.get_form_response_candidates,
        r.pull_google_form,
        r.review_form_change,
    ):
        assert_requires_permission(endpoint, Permission.FINANCIAL_AID_CASEWORK)


def test_link_reaches_the_service_with_the_callers_email_then_rebuilds() -> None:
    stub, rebuild = _stub(), AsyncMock(return_value=True)
    user = persona_user(PERSONA_REGISTRAR)
    with _client(user, stub, rebuild) as client:
        response = client.post(f"{BASE}/{RECORD}/link", json={"person_cm_id": 1000091, "reason": "nickname"})
    assert response.status_code == 200
    assert response.json()["match_status"] == "staff"
    stub.link.assert_awaited_once_with(2027, RECORD, 1000091, "nickname", user.email)
    rebuild.assert_awaited_once_with(2027)


def test_ignore_reaches_the_service_then_rebuilds_and_maps_a_refusal_to_422() -> None:
    stub, rebuild = _stub(), AsyncMock(return_value=True)
    user = persona_user(PERSONA_FINANCE)
    with _client(user, stub, rebuild) as client:
        body = {"kind": "other", "reason": "A test entry"}
        assert client.post(f"{BASE}/{RECORD}/ignore", json=body).status_code == 200
        assert client.post(f"{BASE}/{RECORD}/ignore", json={"kind": "spam"}).status_code == 422
    stub.ignore.assert_awaited_once_with(2027, RECORD, "other", "A test entry", user.email)
    rebuild.assert_awaited_once_with(2027)

    refused = _stub()
    refused.ignore = AsyncMock(side_effect=CaseworkValidationError("a reason is required"))
    with _client(user, refused) as client:
        assert client.post(f"{BASE}/{RECORD}/ignore", json={"kind": "other", "reason": ""}).status_code == 422


def test_ignore_and_link_start_a_form_pull_so_the_job_re_picks_the_supersede() -> None:
    """The Go job's supersede rule is per person+weekend: ignoring (or linking) a response changes which one is
    newest, so the pull runs now rather than at the next hourly tick."""
    stub, pull = _stub(), AsyncMock(return_value={"status": "started"})
    with _client(persona_user(PERSONA_REGISTRAR), stub, pull=pull) as client:
        assert client.post(f"{BASE}/{RECORD}/ignore", json={"kind": "test"}).status_code == 200
        pull.assert_awaited_once_with(2027)
        body = {"person_cm_id": 1000091, "reason": "nickname"}
        assert client.post(f"{BASE}/{RECORD}/link", json=body).status_code == 200
    assert pull.await_count == 2


def test_a_failed_pull_does_not_fail_the_ignore_or_link() -> None:
    stub = _stub()
    pull = AsyncMock(side_effect=RuntimeError("pocketbase unreachable"))
    with _client(persona_user(PERSONA_REGISTRAR), stub, pull=pull) as client:
        assert client.post(f"{BASE}/{RECORD}/ignore", json={"kind": "test"}).status_code == 200
        link = {"person_cm_id": 1000091, "reason": "nickname"}
        assert client.post(f"{BASE}/{RECORD}/link", json=link).status_code == 200
    assert pull.await_count == 2


def test_a_refused_ignore_starts_no_pull() -> None:
    refused, pull = _stub(), AsyncMock(return_value={"status": "started"})
    refused.ignore = AsyncMock(side_effect=CaseworkValidationError("a reason is required"))
    with _client(persona_user(PERSONA_FINANCE), refused, pull=pull) as client:
        assert client.post(f"{BASE}/{RECORD}/ignore", json={"kind": "other", "reason": ""}).status_code == 422
    pull.assert_not_awaited()


def test_the_candidates_read_rebuilds_nothing() -> None:
    stub, rebuild = _stub(), AsyncMock(return_value=True)
    with _client(persona_user(PERSONA_REGISTRAR), stub, rebuild) as client:
        response = client.get(f"{BASE}/{RECORD}/candidates")
        searched = client.get(f"{BASE}/{RECORD}/candidates", params={"q": "Liam Garcia"})
    assert (response.status_code, searched.status_code) == (200, 200)
    assert response.json()["respondent_email"] == "rachel@example.com"
    assert [c.args for c in stub.link_candidates.await_args_list] == [(2027, RECORD, ""), (2027, RECORD, "Liam Garcia")]
    rebuild.assert_not_awaited()


def test_mark_reviewed_reaches_the_service_then_rebuilds() -> None:
    stub, rebuild = _stub(), AsyncMock(return_value=True)
    user = persona_user(PERSONA_REGISTRAR)
    with _client(user, stub, rebuild) as client:
        response = client.post(f"/api/financial-aid/requests/2027/form-changes/{REQUEST}/review")
    assert response.status_code == 200
    stub.review_form_change.assert_awaited_once_with(2027, REQUEST, user.email)
    rebuild.assert_awaited_once_with(2027)


def test_pull_now_asks_pocketbase_for_the_season() -> None:
    pull = AsyncMock(return_value={"status": "started"})
    with _client(persona_user(PERSONA_REGISTRAR), _stub(), pull=pull) as client:
        response = client.post(f"{BASE}/pull")
    assert (response.status_code, response.json()) == (202, {"status": "started"})
    pull.assert_awaited_once_with(2027)


@pytest.mark.asyncio
async def test_the_pull_goes_to_pocketbases_own_form_job_route_as_the_superuser() -> None:
    from api.routers import financial_aid

    client = MagicMock()
    client.send = MagicMock(return_value={"status": "started"})
    with patch.object(financial_aid, "pb", client):
        await financial_aid._pull_google_form(2027)
    path, options = client.send.call_args.args
    assert path == "/api/custom/sync/aid-google-form-responses"
    assert options["method"] == "POST"
    assert options["params"] == {"year": 2027}


@pytest.mark.asyncio
async def test_a_pull_while_the_form_job_is_already_running_is_started_not_an_error() -> None:
    # PocketBase answers 409 when the job is running ("Sync already in progress"): the form is being read now, which
    # is what Pull now asked for, so a second click is not a server error.
    from pocketbase.client import ClientResponseError  # type: ignore[attr-defined]

    from api.routers import financial_aid

    client = MagicMock()
    client.send = MagicMock(side_effect=ClientResponseError("Sync already in progress", status=409))
    with patch.object(financial_aid, "pb", client):
        await financial_aid._pull_google_form(2027)

    client.send = MagicMock(side_effect=ClientResponseError("boom", status=500))
    with patch.object(financial_aid, "pb", client), pytest.raises(ClientResponseError):
        await financial_aid._pull_google_form(2027)


def _schema_properties(schema: dict[str, Any]) -> set[str]:
    return set((schema.get("properties") or {}).keys())


def test_no_camperships_response_schema_carries_sensitive_form_answers() -> None:
    from api.routers import financial_aid

    app = FastAPI()
    app.include_router(financial_aid.router)
    schemas = app.openapi()["components"]["schemas"]
    for name, schema in schemas.items():
        properties = _schema_properties(schema)
        assert not properties & {"poc", "race_ethnicity", "gender_identity"}, name
        if name != "LinkCandidatesOut":
            assert "respondent_email" not in properties, name
    # A candidate's CampMinder contact rides only on Link…'s dialog, never on the Form intake list.
    assert not _schema_properties(schemas["FormCandidateOut"]) & {"email", "birthdate"}

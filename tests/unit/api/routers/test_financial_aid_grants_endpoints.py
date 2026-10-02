"""Grants endpoints (sub-project 6-core): the permission matrix over SP2's personas, and the
service-error mapping. Builds a bare FastAPI app (SP2's persona_client) rather than importing
api.main, which poisons auth for xdist. Task 2 adds the directory routes; Tasks 3, 6, 7 and 8
extend ROUTES and _stub."""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.schemas.financial_aid_grants import CommitmentOut, GrantorOut, GrantorsResponse, GrantsResponse, PlaceGrantsOut
from api.services.financial_aid_grants_service import GrantorInUseError, GrantorKeyTakenError, GrantorStateError
from api.services.financial_aid_ledger_service import FinancialAidNotFoundError, FinancialAidValidationError
from bunking.auth_middleware import AuthUser, get_current_user
from bunking.financial_aid.change_log import CONFLICT_MESSAGE, AidWriteConflictError
from bunking.rbac.permissions import Permission
from tests.unit.rbac.permission_personas import (
    PERSONA_DEVELOPMENT,
    PERSONA_FINANCE,
    PERSONA_REGISTRAR,
    PERSONAS,
    persona_client,
    persona_user,
)

VIEW, CASEWORK = Permission.FINANCIAL_AID_VIEW, Permission.FINANCIAL_AID_CASEWORK
GRANTORS = Permission.FINANCIAL_AID_GRANTORS

GRANTOR = GrantorOut(
    key="regional_fund",
    name="Regional Fund",
    aliases=[],
    full_coverage=False,
    covers_canteen="unknown",
    pays_after_camp_aid=False,
    eligibility="",
    contacts="",
    retired_at="",
    descriptions=[],
)
GRANTOR_BODY = {"key": "regional_fund", "name": "Regional Fund", "note": "New grantor"}
SAVE_BODY = {"name": "Regional Fund", "note": "Finance review"}
RETIRE_BODY = {"reason": "Merged into the regional fund's new name"}
PLACE_BODY = {"placements": [{"transaction_cm_id": 9001, "person_cm_id": 1001}]}

COMMITMENT = CommitmentOut(
    id="com000000000001",
    year=2031,
    grantor_key="regional_fund",
    household_cm_id=100,
    person_cm_id=1001,
    session_cm_id=0,
    program_family="summer",
    amount=750.0,
    committed_on="2031-01-20",
    status="open",
    withdrawn_at="",
    note="",
)
COMMITMENT_BODY = {
    "grantor_key": "regional_fund",
    "household_cm_id": 100,
    "person_cm_id": 1001,
    "amount": "750",
    "committed_on": "2031-01-20",
}

# (method, url, json body, permission required, success status)
# `needs` is one permission, or a tuple of any-of permissions (owner ruling 2026-10-01: the grantor list).
ROUTES: list[tuple[str, str, dict[str, Any] | None, str | tuple[str, ...], int]] = [
    ("GET", "/api/financial-aid/grantors", None, (VIEW, GRANTORS), 200),
    ("GET", "/api/financial-aid/grantors?include_retired=true", None, (VIEW, GRANTORS), 200),
    ("GET", "/api/financial-aid/grantors?year=2031", None, (VIEW, GRANTORS), 200),
    ("POST", "/api/financial-aid/grantors", GRANTOR_BODY, GRANTORS, 201),
    ("PUT", "/api/financial-aid/grantors/regional_fund", SAVE_BODY, GRANTORS, 200),
    ("POST", "/api/financial-aid/grantors/regional_fund/retire", RETIRE_BODY, GRANTORS, 200),
    ("POST", "/api/financial-aid/grantors/regional_fund/unretire", RETIRE_BODY, GRANTORS, 200),
    ("GET", "/api/financial-aid/grants/2031", None, VIEW, 200),
    ("POST", "/api/financial-aid/grants/2031/placements", PLACE_BODY, CASEWORK, 200),
    ("POST", "/api/financial-aid/grants/2031/commitments", COMMITMENT_BODY, CASEWORK, 201),
    ("PUT", "/api/financial-aid/grants/2031/commitments/com000000000001", COMMITMENT_BODY, CASEWORK, 200),
    (
        "POST",
        "/api/financial-aid/grants/2031/commitments/com000000000001/withdraw",
        {"reason": "Declined"},
        CASEWORK,
        200,
    ),
]


def _client(persona: str = PERSONA_FINANCE) -> TestClient:
    from api.routers.financial_aid import router

    return persona_client(router, persona)


def _stub() -> Any:
    service = patch("api.routers.financial_aid.GrantsService").start().return_value
    service.list_grantors = AsyncMock(return_value=GrantorsResponse(grantors=[GRANTOR]))
    service.create_grantor = AsyncMock(return_value=GRANTOR)
    service.save_grantor = AsyncMock(return_value=GRANTOR)
    service.retire_grantor = AsyncMock(
        return_value=GRANTOR.model_copy(update={"retired_at": "2031-02-01 10:00:00.000Z"})
    )
    service.unretire_grantor = AsyncMock(return_value=GRANTOR)
    service.read = AsyncMock(
        return_value=GrantsResponse(year=2031, grants=[], needs_camper=[], unmapped=[], waiting=[], expected=[])
    )
    # Slice 3 ask 10: GET /grants/{year} reads through GrantsRegisterService; it serves the same stubbed read.
    patch("api.routers.financial_aid.GrantsRegisterService").start().return_value.read = service.read
    service.place = AsyncMock(return_value=PlaceGrantsOut(year=2031, placed=1, unchanged=0, operation_id="o" * 15))
    service.create_commitment = AsyncMock(return_value=COMMITMENT)
    service.save_commitment = AsyncMock(return_value=COMMITMENT)
    service.withdraw_commitment = AsyncMock(return_value=COMMITMENT)
    return service


@pytest.fixture(autouse=True)
def _stop_patches() -> Any:
    yield
    patch.stopall()


@pytest.mark.parametrize("persona", sorted(PERSONAS))
@pytest.mark.parametrize(("method", "url", "body", "needs", "ok"), ROUTES)
def test_permission_matrix(
    persona: str, method: str, url: str, body: dict[str, Any] | None, needs: str | tuple[str, ...], ok: int
) -> None:
    _stub()
    response = _client(persona).request(method, url, json=body)
    accepted = (needs,) if isinstance(needs, str) else needs
    expected = ok if any(n in PERSONAS[persona] for n in accepted) else 403
    assert response.status_code == expected, (persona, method, url, response.text)


@pytest.mark.parametrize(
    ("method", "url", "body", "needs", "ok"),
    [r for r in ROUTES if GRANTORS not in ((r[3],) if isinstance(r[3], str) else r[3])],
)
def test_development_reaches_no_family_level_grants_route(
    method: str, url: str, body: dict[str, Any] | None, needs: str | tuple[str, ...], ok: int
) -> None:
    """D57: development sees aggregates only, never a family's grants. The directory's writes are the one
    exception (owner ruling 2026-10-01: financial_aid.grantors), proven below."""
    _stub()
    assert _client(PERSONA_DEVELOPMENT).request(method, url, json=body).status_code == 403


GRANTOR_WRITES = [r for r in ROUTES if r[3] == GRANTORS]
GRANTOR_READS = [r for r in ROUTES if r[3] == (VIEW, GRANTORS)]


@pytest.mark.parametrize("persona", [PERSONA_DEVELOPMENT, "grantors_only"])
@pytest.mark.parametrize(("method", "url", "body", "needs", "ok"), GRANTOR_READS)
def test_grantors_without_view_read_the_grantor_list(
    persona: str, method: str, url: str, body: dict[str, Any] | None, needs: Any, ok: int
) -> None:
    """Owner ruling 2026-10-01: financial_aid.grantors alone reads the list it edits, contacts included."""
    _stub()
    if persona == "grantors_only":
        from api.routers.financial_aid import router

        app = FastAPI()
        app.include_router(router)
        user = persona_user(PERSONA_DEVELOPMENT)
        user.permissions = {GRANTORS}
        app.dependency_overrides[get_current_user] = lambda: user
        client = TestClient(app, raise_server_exceptions=False)
    else:
        assert VIEW not in PERSONAS[persona]
        client = _client(persona)
    assert client.request(method, url, json=body).status_code == ok


def test_the_grantor_writes_are_create_save_retire_and_unretire() -> None:
    assert [(m, u.rsplit("/", 1)[-1]) for m, u, *_ in GRANTOR_WRITES] == [
        ("POST", "grantors"),
        ("PUT", "regional_fund"),
        ("POST", "retire"),
        ("POST", "unretire"),
    ]


@pytest.mark.parametrize("persona", [PERSONA_DEVELOPMENT, PERSONA_FINANCE])
@pytest.mark.parametrize(("method", "url", "body", "needs", "ok"), GRANTOR_WRITES)
def test_development_and_finance_edit_the_directory(
    persona: str, method: str, url: str, body: dict[str, Any] | None, needs: str, ok: int
) -> None:
    """Owner ruling 2026-10-01: create, save, retire (and unretire) are financial_aid.grantors, which the
    development and finance roles hold; finance keeps it through this permission, not through rules."""
    _stub()
    assert _client(persona).request(method, url, json=body).status_code == ok


@pytest.mark.parametrize(("method", "url", "body", "needs", "ok"), GRANTOR_WRITES)
def test_the_registrar_cannot_edit_the_directory(
    method: str, url: str, body: dict[str, Any] | None, needs: str, ok: int
) -> None:
    _stub()
    assert _client(PERSONA_REGISTRAR).request(method, url, json=body).status_code == 403


@pytest.mark.parametrize(("method", "url", "body", "needs", "ok"), GRANTOR_WRITES)
def test_rules_alone_no_longer_edits_the_directory(
    method: str, url: str, body: dict[str, Any] | None, needs: str, ok: int
) -> None:
    from api.routers.financial_aid import router

    _stub()
    user = persona_user(PERSONA_FINANCE)
    user.permissions = {VIEW, Permission.FINANCIAL_AID_RULES}
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: user
    response = TestClient(app, raise_server_exceptions=False).request(method, url, json=body)
    assert response.status_code == 403


@pytest.mark.parametrize(("method", "url", "body", "needs", "ok"), GRANTOR_WRITES)
def test_an_admin_edits_the_directory_without_the_permission(
    method: str, url: str, body: dict[str, Any] | None, needs: str, ok: int
) -> None:
    from api.routers.financial_aid import router

    _stub()
    admin = AuthUser(username="admin", email="admin@example.com", display_name="Admin", groups=[], is_admin=True)
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: admin
    assert TestClient(app, raise_server_exceptions=False).request(method, url, json=body).status_code == ok


def test_the_directory_hides_retired_grantors_unless_asked() -> None:
    service = _stub()
    client = _client()
    assert client.get("/api/financial-aid/grantors").status_code == 200
    assert service.list_grantors.call_args.kwargs == {"include_retired": False}
    assert client.get("/api/financial-aid/grantors", params={"include_retired": "true"}).status_code == 200
    assert service.list_grantors.call_args.kwargs == {"include_retired": True}


def test_a_retire_reaches_the_service_with_its_reason_and_actor() -> None:
    service = _stub()
    response = _client(PERSONA_DEVELOPMENT).post("/api/financial-aid/grantors/regional_fund/retire", json=RETIRE_BODY)
    assert response.status_code == 200
    assert response.json()["retired_at"] == "2031-02-01 10:00:00.000Z"
    key, body, actor = service.retire_grantor.call_args.args
    assert key == "regional_fund"
    assert body.reason == RETIRE_BODY["reason"]
    assert actor == persona_user(PERSONA_DEVELOPMENT).email


@pytest.mark.parametrize("action", ["retire", "unretire"])
@pytest.mark.parametrize("reason", ["", "   "])
def test_a_retire_or_unretire_needs_a_reason(action: str, reason: str) -> None:
    service = _stub()
    url = f"/api/financial-aid/grantors/regional_fund/{action}"
    assert _client().post(url, json={"reason": reason}).status_code == 422
    assert _client().post(url, json={}).status_code == 422
    assert not service.retire_grantor.called
    assert not service.unretire_grantor.called


def test_a_grantor_still_in_use_is_a_409_that_says_what_to_fix() -> None:
    service = _stub()
    service.retire_grantor = AsyncMock(
        side_effect=GrantorInUseError("Regional Fund", descriptions=2, grants=1),
    )
    response = _client().post("/api/financial-aid/grantors/regional_fund/retire", json=RETIRE_BODY)
    assert response.status_code == 409
    detail = response.json()["detail"]
    assert detail["descriptions"] == 2
    assert detail["grants"] == 1
    assert "2 CampMinder descriptions" in detail["message"]
    assert "1 open grant" in detail["message"]


@pytest.mark.parametrize("action", ["retire", "unretire"])
def test_retiring_twice_or_unretiring_an_active_grantor_is_a_409(action: str) -> None:
    service = _stub()
    setattr(service, f"{action}_grantor", AsyncMock(side_effect=GrantorStateError("Regional Fund is already retired")))
    response = _client().post(f"/api/financial-aid/grantors/regional_fund/{action}", json=RETIRE_BODY)
    assert response.status_code == 409
    assert response.json()["detail"] == "Regional Fund is already retired"


def test_retiring_an_unknown_grantor_is_a_404() -> None:
    service = _stub()
    service.retire_grantor = AsyncMock(side_effect=FinancialAidNotFoundError("grantor 'nobody' not found"))
    assert _client().post("/api/financial-aid/grantors/nobody/retire", json=RETIRE_BODY).status_code == 404


def test_the_actor_is_the_callers_email() -> None:
    service = _stub()
    client = _client()
    client.post("/api/financial-aid/grantors", json=GRANTOR_BODY)
    client.put("/api/financial-aid/grantors/regional_fund", json=SAVE_BODY)
    client.post("/api/financial-aid/grants/2031/placements", json=PLACE_BODY)
    email = persona_user(PERSONA_FINANCE).email
    assert service.create_grantor.call_args.args[1] == email
    assert service.save_grantor.call_args.args[2] == email
    assert service.place.call_args.args[2] == email


@pytest.mark.parametrize(
    ("error", "status"),
    [
        (FinancialAidNotFoundError("no grantor"), 404),
        (GrantorKeyTakenError("taken"), 409),
        (FinancialAidValidationError("bad"), 422),
    ],
)
def test_service_refusals_map_to_404_409_and_422(error: Exception, status: int) -> None:
    service = _stub()
    service.create_grantor = AsyncMock(side_effect=error)
    assert _client().post("/api/financial-aid/grantors", json=GRANTOR_BODY).status_code == status


def test_a_grantor_note_is_required() -> None:
    _stub()
    body = {k: v for k, v in GRANTOR_BODY.items() if k != "note"}
    assert _client().post("/api/financial-aid/grantors", json=body).status_code == 422


def test_a_year_out_of_range_is_422() -> None:
    _stub()
    assert _client().get("/api/financial-aid/grants/1999").status_code == 422


def test_a_withdrawal_needs_a_reason() -> None:
    _stub()
    url = "/api/financial-aid/grants/2031/commitments/com000000000001/withdraw"
    assert _client().post(url, json={"reason": "  "}).status_code == 422


def test_a_grantor_that_pays_after_camp_aid_reaches_the_service() -> None:
    """D143: the pays-after fact is accepted on create and save, and only for a full-coverage grantor."""
    service = _stub()
    client = _client()
    body = {**GRANTOR_BODY, "full_coverage": True, "pays_after_camp_aid": True}
    assert client.post("/api/financial-aid/grantors", json=body).status_code == 201
    assert service.create_grantor.call_args.args[0].pays_after_camp_aid is True
    save = {**SAVE_BODY, "full_coverage": True, "pays_after_camp_aid": True}
    assert client.put("/api/financial-aid/grantors/regional_fund", json=save).status_code == 200
    assert service.save_grantor.call_args.args[1].pays_after_camp_aid is True
    partial = {**GRANTOR_BODY, "pays_after_camp_aid": True}
    assert client.post("/api/financial-aid/grantors", json=partial).status_code == 422


@pytest.mark.parametrize(
    ("method", "url", "body", "service_method"),
    [
        ("POST", "/api/financial-aid/grantors", GRANTOR_BODY, "create_grantor"),
        ("PUT", "/api/financial-aid/grantors/regional_fund", SAVE_BODY, "save_grantor"),
        ("POST", "/api/financial-aid/grants/2031/placements", PLACE_BODY, "place"),
        ("POST", "/api/financial-aid/grants/2031/commitments", COMMITMENT_BODY, "create_commitment"),
    ],
)
def test_a_grants_write_that_lost_a_race_is_409_in_g6s_words(
    method: str, url: str, body: dict[str, Any], service_method: str
) -> None:
    """Slice 3 PR-B: a race is G6's conflict (nothing written; reload), never a 422 or a 500."""
    service = _stub()
    setattr(
        service, service_method, AsyncMock(side_effect=AidWriteConflictError(collection="aid_grantors", record_id=""))
    )
    response = _client().request(method, url, json=body)
    assert (response.status_code, response.json()["detail"]) == (409, CONFLICT_MESSAGE)


def test_the_directory_counts_a_season_only_when_asked() -> None:
    service = _stub()
    client = _client()
    assert client.get("/api/financial-aid/grantors", params={"year": "2031"}).status_code == 200
    assert service.list_grantors.call_args.kwargs == {"include_retired": False, "year": 2031}
    assert client.get("/api/financial-aid/grantors", params={"year": "1999"}).status_code == 422

"""Money > To place endpoints (campership SP11-rest): the permission matrix over SP2's personas (D58:
placing and leaving are casework; D104: Reclassify is rules), the error mapping and the naming guard
(spec §5.6). Builds a bare FastAPI app (SP2's persona_client) rather than importing api.main, which poisons
auth for xdist."""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from pydantic import BaseModel

import api.schemas.financial_aid_to_place as schemas
from api.schemas.financial_aid_to_place import PlaceOut, ToPlaceResponse, ToPlaceWriteOut
from api.services.financial_aid_decisions_service import DecisionNotFoundError, DecisionRefusedError
from bunking.financial_aid.change_log import CONFLICT_MESSAGE, AidWriteConflictError
from bunking.rbac.permissions import Permission
from tests.unit.rbac.permission_personas import PERSONA_FINANCE, PERSONAS, persona_client, persona_user

VIEW, CASEWORK, RULES = (
    Permission.FINANCIAL_AID_VIEW,
    Permission.FINANCIAL_AID_CASEWORK,
    Permission.FINANCIAL_AID_RULES,
)
REQ = "reqemma00000001"
BASE = "/api/financial-aid/money/2031/to-place"
PLACE = {"parts": [{"request_id": REQ, "amount": "1500"}]}
WRITE = ToPlaceWriteOut(year=2031, transaction_cm_id=9001, written=1, operation_id="o" * 15)

# (method, url, json body, any of these permissions, success status)
ROUTES: list[tuple[str, str, dict[str, Any] | None, tuple[str, ...], int]] = [
    ("GET", BASE, None, (VIEW,), 200),
    ("GET", f"{BASE}?household_cm_id=1000001", None, (VIEW,), 200),
    ("POST", f"{BASE}/9001/place", PLACE, (CASEWORK,), 200),
    ("POST", f"{BASE}/place", {"lines": [{"transaction_cm_id": 9001, **PLACE}]}, (CASEWORK,), 200),
    ("POST", f"{BASE}/9001/leave", {"note": "Pays it in June"}, (CASEWORK,), 200),
    ("DELETE", f"{BASE}/9001/leave?reason=Left%20by%20mistake", None, (CASEWORK,), 200),
    (
        "POST",
        f"{BASE}/9001/reclassify",
        {"source_key": "summer program grant", "reason": "Outside grant"},
        (RULES,),
        200,
    ),
]


def _client(persona: str = PERSONA_FINANCE) -> TestClient:
    from api.routers.financial_aid import router

    return persona_client(router, persona)


def _stub() -> Any:
    service = patch("api.routers.financial_aid.ToPlaceService").start().return_value
    service.read = AsyncMock(return_value=ToPlaceResponse(year=2031, open_count=0, open_total=0, groups=[]))
    placed = PlaceOut(year=2031, operation_id="o" * 15, placed=[9001], ticked=[], left_to_tick=[])
    service.place = AsyncMock(return_value=placed)
    service.place_lines = AsyncMock(return_value=placed)
    for name in ("leave", "reopen", "reclassify"):
        setattr(service, name, AsyncMock(return_value=WRITE))
    return service


@pytest.fixture(autouse=True)
def _stop_patches() -> Any:
    yield
    patch.stopall()


@pytest.mark.parametrize("persona", sorted(PERSONAS))
@pytest.mark.parametrize(("method", "url", "body", "needs", "ok"), ROUTES)
def test_permission_matrix(
    persona: str, method: str, url: str, body: dict[str, Any] | None, needs: tuple[str, ...], ok: int
) -> None:
    _stub()
    response = _client(persona).request(method, url, json=body)
    expected = ok if set(needs) & set(PERSONAS[persona]) else 403
    assert response.status_code == expected, (persona, method, url, response.text)


def test_the_routes_pass_the_line_the_body_and_the_callers_email() -> None:
    service = _stub()
    client = _client()
    email = persona_user(PERSONA_FINANCE).email
    client.get(f"{BASE}?household_cm_id=1000001")
    assert service.read.call_args.args == (2031,)
    assert service.read.call_args.kwargs == {"household_cm_id": 1000001}
    client.post(f"{BASE}/9001/place", json=PLACE)
    year, txn, body, actor = service.place.call_args.args
    assert (year, txn, [p.request_id for p in body.parts], actor) == (2031, 9001, [REQ], email)
    client.post(f"{BASE}/place", json={"lines": [{"transaction_cm_id": 9001, **PLACE}], "note": "March reposts"})
    year, bulk, actor = service.place_lines.call_args.args
    assert (year, [ln.transaction_cm_id for ln in bulk.lines], bulk.note, actor) == (
        2031,
        [9001],
        "March reposts",
        email,
    )
    client.delete(f"{BASE}/9001/leave?reason=Left%20by%20mistake")
    assert service.reopen.call_args.args == (2031, 9001, "Left by mistake", email)


# Each write's route in ROUTES, by the service method it calls.
_WRITES = {"place": 2, "place_lines": 3, "leave": 4, "reopen": 5, "reclassify": 6}


@pytest.mark.parametrize(
    ("error", "status"),
    [
        (DecisionNotFoundError("no live camp-aid line"), 404),
        (DecisionRefusedError("already on a request"), 422),
        (AidWriteConflictError(collection="aid_attribution_overrides", record_id=""), 409),
    ],
)
@pytest.mark.parametrize("method", sorted(_WRITES))
def test_service_refusals_map_to_404_422_and_409(method: str, error: Exception, status: int) -> None:
    """A lost race (a double click, two staff, a stale rules read) is G6's 409 with its wording, never a 500."""
    service = _stub()
    setattr(service, method, AsyncMock(side_effect=error))
    verb, url, body, _, _ = ROUTES[_WRITES[method]]
    response = _client().request(verb, url, json=body)
    assert response.status_code == status
    if status == 409:
        assert response.json()["detail"] == CONFLICT_MESSAGE


@pytest.mark.parametrize(
    "body",
    [
        {"parts": []},
        {"parts": [{"request_id": REQ, "amount": "0"}]},
        {"parts": [{"request_id": REQ, "amount": "10.005"}]},
        {"parts": [{"request_id": "not-an-id", "amount": "10"}]},
        {"parts": [{"request_id": REQ, "amount": "10"}, {"request_id": REQ, "amount": "20"}]},
    ],
)
def test_a_malformed_placement_is_422(body: dict[str, Any]) -> None:
    _stub()
    assert _client().post(f"{BASE}/9001/place", json=body).status_code == 422


def test_a_bulk_placement_naming_a_line_twice_is_422() -> None:
    _stub()
    line = {"transaction_cm_id": 9001, **PLACE}
    assert _client().post(f"{BASE}/place", json={"lines": [line, line]}).status_code == 422


def test_a_blank_note_or_reason_is_422() -> None:
    _stub()
    client = _client()
    assert client.post(f"{BASE}/9001/leave", json={"note": "  "}).status_code == 422
    assert client.delete(f"{BASE}/9001/leave?reason=%20").status_code == 422
    assert client.post(f"{BASE}/9001/reclassify", json={"source_key": "x", "reason": " "}).status_code == 422


def test_no_to_place_field_is_named_awarded_or_total_awards_granted() -> None:
    """Spec §5.6's naming guard: no money here is finance's "awarded" (D80) or development's all-money total (D87)."""
    models = [
        m
        for m in vars(schemas).values()
        if isinstance(m, type) and issubclass(m, BaseModel) and m.__module__ == schemas.__name__
    ]
    assert len(models) >= 10
    for model in models:
        for name, info in model.model_fields.items():
            text = f"{name} {info.description or ''}".lower()
            assert "awarded" not in text, (model.__name__, name)
            assert "awards granted" not in text, (model.__name__, name)

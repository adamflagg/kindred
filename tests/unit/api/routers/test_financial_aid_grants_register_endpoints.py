"""GET /grants/{year} (campership slice 3, ask 10): Grants' read names each share's round, so it is served by
GrantsRegisterService over the grants service. Builds a bare FastAPI app (SP2's persona_client) rather than
importing api.main, which poisons auth for xdist."""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from api.schemas.financial_aid_grants import GrantRowOut, GrantsResponse, RequestShareOut
from tests.unit.rbac.permission_personas import PERSONA_REGISTRAR, persona_client

ROW = GrantRowOut(
    kind="ledger",
    transaction_cm_id=9001,
    commitment_id="",
    household_cm_id=1000001,
    family_name="The Johnson Family",
    person_cm_id=1000011,
    camper_name="Emma Johnson",
    camper_basis="ledger",
    session_cm_id=1000101,
    session_name="Session 2",
    program_family="summer",
    grantor_key="regional_fund",
    grantor_name="Regional Fund",
    description="Regional Grant",
    source_family="other_outside",
    funder_type="outside",
    amount=500.0,
    recorded_on="2031-02-10",
    is_reversed=False,
    reversal_date="",
    cancelled=False,
    counts=True,
    fulfils_commitment_id="",
    requests=[
        RequestShareOut(request_id="reqemma00000001", amount=500.0, offsets="round", round=1, round_amount=1000.0)
    ],
)
PLAIN_ROW = ROW.model_copy(update={"requests": [RequestShareOut(request_id="reqemma00000001", amount=500.0)]})
PRICED = GrantsResponse(year=2031, grants=[ROW], needs_camper=[], unmapped=[], waiting=[], expected=[])
PLAIN = GrantsResponse(year=2031, grants=[PLAIN_ROW], needs_camper=[], unmapped=[], waiting=[], expected=[])
URL = "/api/financial-aid/grants/2031"


@pytest.fixture(autouse=True)
def _stop_patches() -> Any:
    yield
    patch.stopall()


def _services() -> tuple[Any, Any]:
    from api.routers.financial_aid import router  # noqa: F401  (import before patching its names)

    grants = patch("api.routers.financial_aid.GrantsService").start()
    grants.return_value.read = AsyncMock(return_value=PLAIN)
    built = patch("api.routers.financial_aid.GrantsRegisterService").start()
    built.return_value.read = AsyncMock(return_value=PRICED)
    return grants, built


@pytest.mark.parametrize("query", ["", "?offsets=true"])
def test_the_grants_read_names_the_round_each_share_offsets(query: str) -> None:
    from api.routers.financial_aid import router

    grants, built = _services()
    response = persona_client(router, PERSONA_REGISTRAR).get(URL + query)
    assert response.status_code == 200
    built.return_value.read.assert_awaited_once_with(2031)
    grants.return_value.read.assert_not_awaited()
    assert built.call_args.args[0] is grants.return_value  # over the grants service: one register load
    assert response.json()["grants"][0]["requests"] == [
        {"request_id": "reqemma00000001", "amount": 500.0, "offsets": "round", "round": 1, "round_amount": 1000.0}
    ]


def test_offsets_false_skips_the_pricing_and_reads_the_plain_grants() -> None:
    """The commitment edit's own refetch (useFreshAidGrants, staleTime 0) needs the stored fields, not the offsets, so
    it must not pay a season's pricing each time it opens or saves."""
    from api.routers.financial_aid import router

    grants, built = _services()
    response = persona_client(router, PERSONA_REGISTRAR).get(URL + "?offsets=false")
    assert response.status_code == 200
    grants.return_value.read.assert_awaited_once_with(2031)
    built.return_value.read.assert_not_awaited()
    assert response.json()["grants"][0]["requests"] == [
        {"request_id": "reqemma00000001", "amount": 500.0, "offsets": None, "round": None, "round_amount": None}
    ]


def test_a_malformed_offsets_flag_is_422() -> None:
    from api.routers.financial_aid import router

    _services()
    assert persona_client(router, PERSONA_REGISTRAR).get(URL + "?offsets=maybe").status_code == 422

"""Grants › Grantors' "grants / $ this season" (campership slice 3 back-end PR-B, ask 5; spec §8.2; D55, D74,
D87; owner question 3's default). Fictional only."""

from __future__ import annotations

from dataclasses import replace
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from api.schemas.financial_aid_grants import GrantorSeasonOut
from tests.unit.api.services.decisions_fakes import grant_row
from tests.unit.api.services.test_financial_aid_grants_service import _grantor, _repo, _service

EMMA = "reqemma00000001"


@pytest.fixture(autouse=True)
def _stop_patches() -> Any:
    yield
    patch.stopall()


def _season_rows() -> list[Any]:
    """Regional Fund this season: two live lines (one still waiting for its camper), a reversed line, a commitment."""
    return [
        grant_row(EMMA, "700"),
        replace(grant_row(EMMA, "300"), transaction_cm_id=9002, person_cm_id=0, counts=False, requests=()),
        replace(grant_row(EMMA, "500"), transaction_cm_id=9003, is_reversed=True, counts=False),
        replace(grant_row(EMMA, "250"), kind="commitment", transaction_cm_id=0, commitment_id="com000000000001"),
    ]


@pytest.mark.asyncio
async def test_with_a_season_each_grantor_carries_its_live_grant_lines() -> None:
    """A reversed line is out (D74); a commitment isn't in CampMinder yet; a line waiting for its camper is in."""
    grantors = [_grantor(), _grantor(id="gra000000000002", key="valley_fund", name="Valley Fund", aliases=[])]
    service, _ = _service(_repo(grantors=grantors))
    register = patch.object(service, "register_rows", AsyncMock(return_value=_season_rows())).start()
    out = await service.list_grantors(year=2031)
    assert [(g.key, g.season) for g in out.grantors] == [
        ("regional_fund", GrantorSeasonOut(year=2031, count=2, amount=1000.0)),
        ("valley_fund", GrantorSeasonOut(year=2031, count=0, amount=0.0)),
    ]
    register.assert_awaited_once_with(2031)


@pytest.mark.asyncio
async def test_without_a_season_the_directory_reads_no_register() -> None:
    """Today and the pickers list grantors too, and must not load the register for it."""
    service, _ = _service(_repo(grantors=[_grantor()]))
    register = patch.object(service, "register_rows", AsyncMock(return_value=_season_rows())).start()
    out = await service.list_grantors()
    assert [g.season for g in out.grantors] == [None]
    register.assert_not_awaited()

"""D170: Rounds & budget's "CampMinder aid on no request" line, 2026 only. Fictional throughout."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

import pytest

import api.services.financial_aid_decisions_service as service_module
from api.schemas.financial_aid_decisions import AidOnNoRequestOut, BudgetResponse
from tests.unit.api.services.decisions_fakes import EMMA, FakeDecisionsStore, seed_line, seed_request
from tests.unit.api.services.financial_aid_fakes import YEAR
from tests.unit.api.services.test_financial_aid_decisions_service import _service

SUMMER = 1000101  # the fixture's summer session (camp_pool)


@dataclass(frozen=True)
class Link:
    household_cm_id: int
    family_key: str
    excluded: bool = False


@pytest.fixture
def d170_season(monkeypatch: pytest.MonkeyPatch) -> None:
    """The fixture season stands in for 2026, the one season D170 shows the line for."""
    monkeypatch.setattr(service_module, "CAMPMINDER_AID_ON_NO_REQUEST_YEARS", frozenset({YEAR}))


def camp(budget: BudgetResponse) -> AidOnNoRequestOut | None:
    return next(p for p in budget.pools if p.pool == "camp_pool").below.campminder_aid_off_requests


def test_the_line_is_for_2026_only() -> None:
    assert frozenset({2026}) == service_module.CAMPMINDER_AID_ON_NO_REQUEST_YEARS


@pytest.mark.asyncio
@pytest.mark.usefixtures("d170_season")
async def test_campminder_aid_on_a_family_with_no_request_is_shown_and_never_counted() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    before = await _service(store).budget(YEAR)
    seed_line(store, 59000001, "900", household=1000002, person=0, session=SUMMER)
    budget = await _service(store).budget(YEAR)
    assert camp(budget) == AidOnNoRequestOut(amount=900.0, families=1)
    assert budget.total.below.campminder_aid_off_requests == AidOnNoRequestOut(amount=900.0, families=1)
    assert budget.total.total.remaining == before.total.total.remaining
    assert budget.total.total.posted == before.total.total.posted


@pytest.mark.asyncio
@pytest.mark.usefixtures("d170_season")
async def test_money_on_the_familys_own_request_is_not_on_the_line() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_line(store, 59000001, "900", household=1000001, person=0, session=SUMMER)
    budget = await _service(store).budget(YEAR)
    assert budget.total.below.campminder_aid_off_requests == AidOnNoRequestOut(amount=0.0, families=0)


@pytest.mark.asyncio
@pytest.mark.usefixtures("d170_season")
async def test_a_linked_households_request_takes_the_money() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_line(store, 59000001, "900", household=1000002, person=0, session=SUMMER)
    store.links = [Link(1000001, "fam-a"), Link(1000002, "fam-a")]
    budget = await _service(store).budget(YEAR)
    assert budget.total.below.campminder_aid_off_requests == AidOnNoRequestOut(amount=0.0, families=0)


@pytest.mark.asyncio
async def test_another_season_has_no_line() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_line(store, 59000001, "900", household=1000002, person=0, session=SUMMER)
    budget = await _service(store).budget(YEAR)
    assert budget.total.below.campminder_aid_off_requests is None
    assert camp(budget) is None


@pytest.mark.asyncio
@pytest.mark.usefixtures("d170_season")
async def test_a_past_date_has_no_line() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_line(store, 59000001, "900", household=1000002, person=0, session=SUMMER)
    budget = await _service(store).budget(YEAR, as_of=date(YEAR, 3, 1))  # T0 is Mar 9: today reads live
    assert budget.total.below.campminder_aid_off_requests is None

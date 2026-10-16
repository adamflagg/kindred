"""D170: Rounds & budget's "CampMinder aid on no request" line, 2026 and every season from 2027. Fictional throughout."""

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
    """The fixture season stands in for a season D170 shows the line for."""
    monkeypatch.setattr(service_module, "shows_aid_on_no_request", lambda year: year == YEAR)


def camp(budget: BudgetResponse) -> AidOnNoRequestOut | None:
    return next(p for p in budget.pools if p.pool == "camp_pool").below.campminder_aid_off_requests


def test_the_line_is_for_2026_and_every_season_from_2027() -> None:
    """Owner #48 (2026-10-15): 2026 stays, every later season shows it, nothing before 2026."""
    shows = service_module.shows_aid_on_no_request
    assert [shows(y) for y in (2024, 2025, 2026, 2027, 2030)] == [False, False, True, True, True]


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
async def test_a_2027_season_has_the_line_without_any_patching() -> None:
    """Owner #48: the fixture season is 2027, and the real rule shows it."""
    assert YEAR == 2027
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_line(store, 59000001, "900", household=1000002, person=0, session=SUMMER)
    budget = await _service(store).budget(YEAR)
    assert camp(budget) == AidOnNoRequestOut(amount=900.0, families=1)
    assert budget.total.below.campminder_aid_off_requests == AidOnNoRequestOut(amount=900.0, families=1)


@pytest.mark.asyncio
@pytest.mark.usefixtures("d170_season")
async def test_a_past_date_has_no_line() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_line(store, 59000001, "900", household=1000002, person=0, session=SUMMER)
    budget = await _service(store).budget(YEAR, as_of=date(YEAR, 3, 1))  # T0 is Mar 9: today reads live
    assert budget.total.below.campminder_aid_off_requests is None

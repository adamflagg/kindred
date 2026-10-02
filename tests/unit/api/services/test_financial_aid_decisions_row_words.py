"""Read 3 of the slice 1 screens: each round's stage words, and why an appeal can't be keyed, on the grid row
itself, in the server's own words, so the frontend's mirrors of them can go. Fictional only."""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, date, datetime
from decimal import Decimal

import pytest

import api.schemas.financial_aid_decisions as schemas
from api.schemas.financial_aid_decisions import AskIn, CancellationIn
from api.services.financial_aid_decisions_service import CANCELLED_IN_KINDRED, DecisionRefusedError
from bunking.financial_aid.rules.schema import AidRules
from tests.unit.api.services.decisions_fakes import (
    ACTOR,
    FakeDecisionsStore,
    FakeRules,
    approved,
    log_seeded,
    seed_request,
)
from tests.unit.api.services.financial_aid_fakes import YEAR, intake_rules
from tests.unit.api.services.test_financial_aid_decisions_service import EMMA, _posted, _service
from tests.unit.bunking.financial_aid.fixtures import with_levers

SEEDED = datetime(2027, 2, 1, 18, 0, tzinfo=UTC)


def _appeal() -> AskIn:
    """Built inside the test: AskIn refuses a future day, and the autouse fixture moves today past it."""
    return AskIn(round=2, amount=Decimal(400), asked_on=date(2027, 4, 1))


@pytest.fixture(autouse=True)
def _today_is_after_the_fictional_dates(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(schemas, "today", lambda: date(2027, 12, 31))


@pytest.mark.asyncio
async def test_every_round_carries_its_stage_words() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _posted(store, EMMA, 1, "1500")
    (row,) = (await _service(store).grid(YEAR)).rows
    assert [(r.status, r.status_label) for r in row.rounds] == [("posted", "Posted")]


@pytest.mark.asyncio
async def test_an_appeal_before_round_1_is_posted_is_refused_on_the_row_in_the_writes_words() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    service = _service(store)
    (row,) = (await service.grid(YEAR)).rows
    with pytest.raises(DecisionRefusedError) as refused:
        await service.key_ask(EMMA, _appeal(), ACTOR)
    assert row.appeal_refusal == str(refused.value)
    assert row.appeal_refusal.startswith("An appeal answers a posted offer")


@pytest.mark.asyncio
async def test_once_round_1_is_posted_the_appeal_can_be_keyed() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _posted(store, EMMA, 1, "1500")
    (row,) = (await _service(store).grid(YEAR)).rows
    assert row.appeal_refusal is None


@pytest.mark.asyncio
async def test_a_request_cancelled_in_kindred_says_reopen_it_first() -> None:
    """Round 1 is posted, so only the cancellation stands in the appeal's way."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _posted(store, EMMA, 1, "1500")
    service = _service(store)
    await service.set_cancellation(EMMA, CancellationIn(cancelled=True, reason="medical"), ACTOR)
    (row,) = (await service.grid(YEAR)).rows
    assert row.appeal_refusal == CANCELLED_IN_KINDRED


@pytest.mark.asyncio
async def test_a_kindred_cancellation_outranks_an_unposted_round_1_as_in_key_ask() -> None:
    """The order is key_ask's: _live (the cancellation) before _ask_refusal (Round 1 not posted)."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    service = _service(store)
    await service.set_cancellation(EMMA, CancellationIn(cancelled=True, reason="medical"), ACTOR)
    (row,) = (await service.grid(YEAR)).rows
    with pytest.raises(DecisionRefusedError) as refused:
        await service.key_ask(EMMA, _appeal(), ACTOR)
    assert row.appeal_refusal == str(refused.value) == CANCELLED_IN_KINDRED


@pytest.mark.asyncio
async def test_a_withdrawn_request_is_refused_in_the_writes_words() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA, status="withdrawn")
    service = _service(store)
    (row,) = (await service.grid(YEAR)).rows
    with pytest.raises(DecisionRefusedError) as refused:
        await service.key_ask(EMMA, _appeal(), ACTOR)
    assert row.appeal_refusal == str(refused.value) == "a withdrawn request takes no new asks or amounts"


@pytest.mark.asyncio
async def test_a_past_read_carries_no_appeal_refusal() -> None:
    """Nothing is keyed into the past, and the refusal reads the cancellation a past date doesn't rebuild."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    log_seeded(store, SEEDED)
    (row,) = (await _service(store).grid(YEAR, as_of=date(2027, 3, 1))).rows
    assert row.appeal_refusal is None


@pytest.mark.asyncio
async def test_an_unmatched_request_names_its_candidate_sessions() -> None:
    """Session not settled (§6.2): the candidates intake recorded, named from the season's sessions, "Session <id>"
    for one the season lacks (the frontend's Decision 28 fallback, now the server's)."""
    store = FakeDecisionsStore()
    request = seed_request(store, EMMA)
    store.requests[EMMA] = replace(
        request,
        status="unmatched_session",
        session_cm_id=0,
        flags=({"code": "unmatched_session", "detail": {"candidates": [1000101, 1000199, 1000101]}},),
    )
    (row,) = (await _service(store).grid(YEAR)).rows
    assert [(c.session_cm_id, c.name) for c in row.session_candidates] == [
        (1000101, "Session 2"),
        (1000199, "Session 1000199"),
    ]


@pytest.mark.asyncio
async def test_a_settled_request_lists_no_candidates_even_if_its_old_flag_stays() -> None:
    store = FakeDecisionsStore()
    request = seed_request(store, EMMA)
    store.requests[EMMA] = replace(request, flags=({"code": "unmatched_session", "detail": {"candidates": [1000101]}},))
    (row,) = (await _service(store).grid(YEAR)).rows
    assert row.session_candidates == []


@pytest.mark.asyncio
async def test_a_row_names_its_programs_campminder_description() -> None:
    """§6.2 Needs an offer: "the CampMinder description to use (per program from 2027)"; Decision 7."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    rules = with_levers(intake_rules(), {"programs.summer.campminder_description": "Summer financial assistance"})
    (row,) = (await _service(store, FakeRules(approved(rules))).grid(YEAR)).rows
    assert row.campminder_description == "Summer financial assistance"


@pytest.mark.asyncio
async def test_a_program_naming_no_description_leaves_it_empty() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    (row,) = (await _service(store).grid(YEAR)).rows
    assert row.campminder_description is None


def test_a_rules_document_from_before_the_field_still_loads() -> None:
    doc = intake_rules().model_dump(mode="json")
    del doc["programs"]["summer"]["campminder_description"]
    assert AidRules.model_validate(doc).programs["summer"].campminder_description == ""

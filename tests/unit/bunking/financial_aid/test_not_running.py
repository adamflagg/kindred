"""A session finance marks not running this season (spec §7): its live requests are on hold, unreleasable, and a
posted round stands. Exercises the lever "cost.not_running_session_cm_ids". Fictional throughout."""

from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from bunking.financial_aid.calculator import CalcResult, calculate
from bunking.financial_aid.decisions import (
    NO_HOLDS,
    RequestToPrice,
    RoundState,
    fold_holds,
    price_request,
    releasable,
    with_holds,
)
from bunking.financial_aid.decisions.budget import Count, season_budget
from bunking.financial_aid.decisions.holds import HoldEvent
from bunking.financial_aid.rules import AidRules
from tests.unit.bunking.financial_aid.fixtures import app, fictional_rules, req, with_lever

NOT_RUNNING = "cost.not_running_session_cm_ids"
MESSAGE = "This session is not running this season: cancel the request or move it to a session that runs"


def _codes(result: CalcResult) -> list[tuple[str, str]]:
    return [(i.code, i.severity) for i in result.issues]


def test_a_request_on_a_not_running_session_is_on_hold() -> None:
    rules = with_lever(fictional_rules(), NOT_RUNNING, [1000102])
    result = calculate(app(), req(), rules)  # req() is session 1000102
    assert ("session_not_running", "hold") in _codes(result)
    assert next(i for i in result.issues if i.code == "session_not_running").message == MESSAGE


def test_an_ag_request_whose_parent_is_not_running_is_on_hold_too() -> None:
    rules = with_lever(fictional_rules(), NOT_RUNNING, [1000101])
    result = calculate(app(), req(session_cm_id=1000199, ag_parent_cm_id=1000101), rules)
    assert ("session_not_running", "hold") in _codes(result)


def test_a_request_with_no_income_on_a_not_running_session_is_still_on_hold() -> None:
    """Review Focus 1's sibling: the hold comes before the income step can return."""
    rules = with_lever(fictional_rules(), NOT_RUNNING, [1000102])
    result = calculate(app(prior_year_gross=None, current_year_gross=None), req(), rules)
    assert ("session_not_running", "hold") in _codes(result)


def test_a_running_session_is_untouched() -> None:
    rules = with_lever(fictional_rules(), NOT_RUNNING, [1000101])
    assert "session_not_running" not in {i.code for i in calculate(app(), req(), rules).issues}


def test_the_hold_cannot_be_released() -> None:
    issue = next(
        i
        for i in calculate(app(), req(), with_lever(fictional_rules(), NOT_RUNNING, [1000102])).issues
        if i.code == "session_not_running"
    )
    assert not releasable(issue)


def test_a_stored_document_without_the_list_loads_with_none_listed() -> None:
    """Spec §16 A2, the loader: every stored season predates the field."""
    data = fictional_rules().model_dump(mode="json")
    data["cost"].pop("not_running_session_cm_ids", None)
    assert AidRules.model_validate(data).cost.not_running_session_cm_ids == []


def _item(**overrides: Any) -> RequestToPrice:
    fields: dict[str, Any] = {
        "request_id": "req-emma",
        "household_cm_id": 1000001,
        "live": True,
        "application": app(),
        "request": req(),
        "blocked": "",
        "issues": (),
        "rounds": {},
        "r1_ask": Decimal(4000),
    }
    return RequestToPrice(**{**fields, **overrides})


def test_a_not_running_requests_unposted_round_is_held_and_leaves_needs_an_offer() -> None:
    rules = with_lever(fictional_rules(), NOT_RUNNING, [1000102])
    priced = price_request(with_holds(_item(), NO_HOLDS), rules)
    view = priced.view(1)
    assert view is not None
    assert view.status == "held"
    camp = next(p for p in season_budget([priced], rules, outside_grants={}).pools if p.pool == "camp_pool")
    assert (camp.rounds[1].needs_offer, camp.below.held) == (Decimal(0), Count(1, 1))


def test_a_posted_round_on_a_not_running_session_stands() -> None:
    rules = with_lever(fictional_rules(), NOT_RUNNING, [1000102])
    posted = RoundState(
        round=1, posted=True, locked_amount=Decimal(3000), snapshot={"pool": "camp_pool", "counts_toward_budget": True}
    )
    priced = price_request(with_holds(_item(rounds={1: posted}), NO_HOLDS), rules)
    view = priced.view(1)
    assert view is not None
    assert (view.status, view.locked) == ("posted", Decimal(3000))


def test_a_release_event_never_lifts_it() -> None:
    rules = with_lever(fictional_rules(), NOT_RUNNING, [1000102])
    released = HoldEvent(
        id="hev0001",
        request_id="req-emma",
        kind="release",
        code="session_not_running",
        created=datetime(2031, 12, 1, tzinfo=UTC),
        note="tried",
        actor="registrar@example.com",
    )
    priced = price_request(with_holds(_item(), fold_holds([released])["req-emma"]), rules)
    assert [h.code for h in priced.holds] == ["session_not_running"]

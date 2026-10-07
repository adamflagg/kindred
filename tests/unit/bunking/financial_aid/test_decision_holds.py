"""Hold releases and manual holds folded from aid_hold_events, and what pricing makes of them
(follow-up 3b). Fictional throughout. The fixture's default request prices Round 1 at 3,000."""

from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

from bunking.financial_aid.calculator import CalcIssue
from bunking.financial_aid.decisions import (
    MANUAL_HOLD,
    NO_HOLDS,
    HoldEvent,
    HoldEventKind,
    RequestToPrice,
    RoundState,
    fold_holds,
    price_request,
    releasable,
    with_holds,
)
from tests.unit.bunking.financial_aid.fixtures import app, fictional_rules, req

RULES = fictional_rules()
T0 = datetime(2031, 12, 1, 17, 0, tzinfo=UTC)
NOTE = "Called the family: the income is right"
PLACEHOLDER = CalcIssue(code="placeholder_income", severity="hold", message="Placeholder income", step="quality")


def ev(
    kind: HoldEventKind,
    code: str = "placeholder_income",
    *,
    hour: int = 0,
    request: str = "req-emma",
    note: str = NOTE,
) -> HoldEvent:
    return HoldEvent(
        id=f"hev{hour:04d}{kind}",
        request_id=request,
        kind=kind,
        code=code,
        created=T0 + timedelta(hours=hour),
        note=note,
        actor="registrar@example.com",
    )


def item(**overrides: Any) -> RequestToPrice:
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


def test_no_events_is_no_hold_state() -> None:
    assert fold_holds([]) == {}


def test_a_release_records_its_note_who_and_when() -> None:
    state = fold_holds([ev("release")])["req-emma"]
    release = state.released["placeholder_income"]
    assert (release.note, release.released_by, release.released_at) == (NOTE, "registrar@example.com", T0)
    assert state.released_codes() == frozenset({"placeholder_income"})


def test_a_release_keeps_what_it_was_released_against() -> None:
    fact = {"message": "Placeholder income", "step": "quality", "application": {"prior_year_gross": "500"}}
    event = HoldEvent(
        id="hev1", request_id="req-emma", kind="release", code="placeholder_income", created=T0, fact=fact
    )
    assert fold_holds([event])["req-emma"].released["placeholder_income"].fact == fact


def test_unreleasing_puts_the_hold_back_and_a_later_release_wins() -> None:
    assert fold_holds([ev("release", hour=0), ev("unrelease", hour=1)])["req-emma"].released == {}
    again = fold_holds([ev("release", hour=0), ev("unrelease", hour=1), ev("release", hour=2, note="Tax return seen")])
    assert again["req-emma"].released["placeholder_income"].note == "Tax return seen"


def test_a_manual_hold_keeps_its_latest_reason_until_lifted() -> None:
    placed = [
        ev("place", MANUAL_HOLD, hour=0, note="Waiting on the tax return"),
        ev("place", MANUAL_HOLD, hour=1, note="Waiting on the school letter"),
    ]
    state = fold_holds(placed)["req-emma"]
    assert state.manual is not None
    assert (state.manual.reason, state.manual.placed_at) == ("Waiting on the school letter", T0 + timedelta(hours=1))
    assert fold_holds([*placed, ev("lift", MANUAL_HOLD, hour=2, note="Letter arrived")])["req-emma"].manual is None


def test_as_of_folds_only_what_was_recorded_by_then() -> None:
    events = [ev("release", hour=0), ev("unrelease", hour=5)]
    assert "placeholder_income" in fold_holds(events, as_of=T0 + timedelta(hours=1))["req-emma"].released
    assert fold_holds(events)["req-emma"].released == {}
    assert fold_holds(events, as_of=T0 - timedelta(hours=1)) == {}


def test_events_apply_in_recorded_order_whatever_order_they_arrive_in() -> None:
    assert fold_holds([ev("unrelease", hour=3), ev("release", hour=0)])["req-emma"].released == {}


def test_hold_state_is_kept_per_request() -> None:
    state = fold_holds([ev("release", request="req-emma"), ev("place", MANUAL_HOLD, hour=1, request="req-liam")])
    assert set(state) == {"req-emma", "req-liam"}
    assert state["req-liam"].released == {}
    assert state["req-emma"].manual is None


def test_a_released_hold_no_longer_stops_the_offer() -> None:
    held = price_request(with_holds(item(issues=(PLACEHOLDER,)), NO_HOLDS), RULES).view(1)
    assert held is not None
    assert held.status == "held"
    released = price_request(with_holds(item(issues=(PLACEHOLDER,)), fold_holds([ev("release")])["req-emma"]), RULES)
    r1 = released.view(1)
    assert r1 is not None
    assert (r1.status, r1.decided) == ("needs_offer", Decimal(3000))
    assert released.holds == ()


def test_a_manual_hold_stops_the_offer_with_its_reason() -> None:
    state = fold_holds([ev("place", MANUAL_HOLD, note="Waiting on the tax return")])["req-emma"]
    priced = price_request(with_holds(item(), state), RULES)
    r1 = priced.view(1)
    assert r1 is not None
    assert r1.status == "held"
    assert [(h.code, h.severity, h.message) for h in priced.holds] == [
        (MANUAL_HOLD, "hold", "Waiting on the tax return")
    ]


def test_a_manual_hold_leaves_a_posted_round_as_it_is() -> None:
    posted = RoundState(
        round=1,
        posted=True,
        locked_amount=Decimal(3000),
        locked_at=T0,
        snapshot={"pool": "camp_pool", "counts_toward_budget": True},
    )
    appeal = RoundState(round=2, ask=Decimal(99999))
    state = fold_holds([ev("place", MANUAL_HOLD, note="Waiting on the tax return")])["req-emma"]
    priced = price_request(with_holds(item(rounds={1: posted, 2: appeal}), state), RULES)
    assert [(v.round, v.status) for v in priced.rounds] == [(1, "posted"), (2, "held")]


def test_a_release_of_a_hold_that_clears_only_when_fixed_never_lifts_it() -> None:
    above = CalcIssue(code="award_above_cost", severity="hold", message="Above cost", step="quality")
    state = fold_holds([ev("release", "award_above_cost")])["req-emma"]  # written directly: the service refuses it
    assert state.released_codes() == frozenset()
    priced = price_request(with_holds(item(issues=(above,)), state), RULES)
    assert [h.code for h in priced.holds] == ["award_above_cost"]


def test_which_holds_a_release_can_lift() -> None:
    assert releasable(PLACEHOLDER)
    assert releasable(CalcIssue(code="duplicate_survivor_withdrawn", severity="hold", message="x"))
    assert not releasable(CalcIssue(code="ask_above_cost", severity="warn", message="x"))
    assert not releasable(CalcIssue(code="income_missing", severity="needs_input", message="x"))
    for code in (
        "award_above_cost",
        "household_income_conflict",
        "payer_shares_incomplete",
        "awaiting_approved_rules",
        "unmatched_session",
        "session_not_running",
        "no_approved_rules",
        "not_priceable",
        MANUAL_HOLD,
    ):
        assert not releasable(CalcIssue(code=code, severity="hold", message="x")), code


def test_as_of_is_inclusive_of_an_event_recorded_at_that_instant() -> None:
    events = [ev("release", hour=1)]
    assert "placeholder_income" in fold_holds(events, as_of=T0 + timedelta(hours=1))["req-emma"].released

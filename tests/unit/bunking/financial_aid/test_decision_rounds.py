"""The aid_decisions history folded into per-round state (sub-project 10a). Fictional throughout."""

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

from bunking.financial_aid.decisions import DecisionEvent, EventKind, RoundState, fold_rounds, needs_finance
from tests.unit.bunking.financial_aid.fixtures import fictional_rules, with_lever

T0 = datetime(2031, 3, 1, 17, 0, tzinfo=UTC)


def ev(kind: EventKind, round_: int = 1, *, hour: int = 0, request: str = "req-emma", **fields: Any) -> DecisionEvent:
    return DecisionEvent(
        id=f"ev{hour:04d}{kind}{round_}",
        request_id=request,
        round=round_,
        kind=kind,
        created=T0 + timedelta(hours=hour),
        **fields,
    )


def test_no_events_is_no_rounds() -> None:
    assert fold_rounds([]) == {}


def test_the_latest_ask_wins_and_keeps_its_day() -> None:
    rounds = fold_rounds(
        [
            ev("ask", 2, hour=0, amount=Decimal(500), effective_on=date(2031, 3, 20)),
            ev("ask", 2, hour=1, amount=Decimal(400), effective_on=date(2031, 3, 22)),
        ]
    )
    state = rounds["req-emma"][2]
    assert (state.ask, state.asked_on) == (Decimal(400), date(2031, 3, 22))


def test_a_post_locks_the_round_with_its_amount_version_and_snapshot() -> None:
    state = fold_rounds(
        [
            ev(
                "post",
                1,
                amount=Decimal(3000),
                effective_on=date(2031, 3, 9),
                lock_source="tick",
                rules_version=2,
                snapshot={"pool": "camp_pool"},
            )
        ]
    )["req-emma"][1]
    assert state.posted
    assert state.locked_amount == Decimal(3000)
    assert (state.locked_at, state.posted_on, state.rules_version) == (T0, date(2031, 3, 9), 2)
    assert state.snapshot == {"pool": "camp_pool"}


def test_undoing_a_post_clears_the_lock_and_the_accepted_tick() -> None:
    state = fold_rounds(
        [
            ev("post", 1, hour=0, amount=Decimal(3000)),
            ev("accept", 1, hour=1),
            ev("unaccept", 1, hour=2),
            ev("unpost", 1, hour=3),
        ]
    )["req-emma"][1]
    assert state == RoundState(round=1)


def test_the_accepted_tick_records_when() -> None:
    state = fold_rounds([ev("post", 1, hour=0, amount=Decimal(3000)), ev("accept", 1, hour=2)])["req-emma"][1]
    assert state.accepted
    assert state.accepted_at == T0 + timedelta(hours=2)


def test_as_of_folds_only_what_was_recorded_by_then() -> None:
    events = [ev("post", 1, hour=0, amount=Decimal(3000)), ev("accept", 1, hour=5)]
    state = fold_rounds(events, as_of=T0 + timedelta(hours=1))["req-emma"][1]
    assert state.posted
    assert not state.accepted


def test_events_apply_in_recorded_order_whatever_order_they_arrive_in() -> None:
    events = [ev("unpost", 1, hour=3), ev("post", 1, hour=0, amount=Decimal(3000))]
    assert not fold_rounds(events)["req-emma"][1].posted


def test_a_round_3_amount_above_the_limit_waits_then_finance_answers() -> None:
    keyed = ev("award", 3, hour=0, amount=Decimal(900), needs_approval=True)
    assert fold_rounds([keyed])["req-emma"][3].approval == "pending"
    assert fold_rounds([keyed, ev("approve", 3, hour=1)])["req-emma"][3].approval == "approved"
    assert fold_rounds([keyed, ev("refuse", 3, hour=1)])["req-emma"][3].approval == "refused"
    rekeyed = ev("award", 3, hour=2, amount=Decimal(300), needs_approval=False)
    state = fold_rounds([keyed, ev("refuse", 3, hour=1), rekeyed])["req-emma"][3]
    assert (state.award, state.approval) == (Decimal(300), "not_needed")


def test_discretionary_money_is_kept_apart_from_the_round_3_amount() -> None:
    state = fold_rounds(
        [
            ev("award", 3, hour=0, amount=Decimal(300)),
            ev("award", 3, hour=1, amount=Decimal(250), decision_type="discretionary"),
        ]
    )["req-emma"][3]
    assert (state.award, state.discretionary, state.discretionary_type) == (
        Decimal(300),
        Decimal(250),
        "discretionary",
    )


def test_rounds_are_kept_per_request_and_round() -> None:
    rounds = fold_rounds(
        [
            ev("post", 1, amount=Decimal(3000), request="req-emma"),
            ev("ask", 2, hour=1, amount=Decimal(400), request="req-emma"),
            ev("post", 1, amount=Decimal(1200), request="req-liam"),
        ]
    )
    assert set(rounds) == {"req-emma", "req-liam"}
    assert set(rounds["req-emma"]) == {1, 2}
    assert rounds["req-liam"][1].locked_amount == Decimal(1200)


def test_every_round_3_amount_waits_for_finance_when_the_season_sets_no_limit() -> None:
    rules = fictional_rules()
    assert rules.round3.registrar_limit is None
    assert needs_finance(Decimal(1), rules)


def test_the_registrars_limit_is_a_rules_setting() -> None:
    rules = with_lever(fictional_rules(), "round3.registrar_limit", "400")
    assert not needs_finance(Decimal(400), rules)
    assert needs_finance(Decimal(401), rules)


# --- the CampMinder axis (owner ruling 2026-09-30): a Posted tick counts from its CampMinder post day ---

CUT = T0 + timedelta(hours=1)  # the recorded cut: the end of D
D = date(2031, 3, 1)  # the as-of day; T0 falls on it


def _backdated_post(hour: int, on: date | None = D) -> DecisionEvent:
    """A tick keyed after the cut whose CampMinder post day is `on`."""
    return ev("post", 1, hour=hour, amount=Decimal(3000), effective_on=on)


def test_a_tick_recorded_after_the_cut_counts_from_its_campminder_post_day() -> None:
    events = [_backdated_post(hour=48)]
    assert fold_rounds(events, as_of=CUT, posted_by=D)["req-emma"][1].posted
    assert fold_rounds(events, as_of=CUT) == {}  # the recorded axis never sees it


def test_a_tick_posted_in_campminder_after_the_day_does_not_count() -> None:
    events = [_backdated_post(hour=48, on=D + timedelta(days=1))]
    assert fold_rounds(events, as_of=CUT, posted_by=D) == {}


def test_a_tick_with_no_campminder_post_day_keeps_the_recorded_cut() -> None:
    assert fold_rounds([_backdated_post(hour=48, on=None)], as_of=CUT, posted_by=D) == {}


def test_a_back_dated_tick_later_undone_by_a_person_does_not_count() -> None:
    """The ruling: an undo of a back-dated tick applies whenever it was recorded, up to now. The tick
    was a mistake, and its undo is necessarily recorded after the cut too."""
    events = [_backdated_post(hour=48), ev("unpost", 1, hour=72)]
    assert fold_rounds(events, as_of=CUT, posted_by=D) == {}


def test_a_back_dated_tick_undone_then_ticked_again_back_dated_counts_once_as_the_standing_tick() -> None:
    events = [
        _backdated_post(hour=48),
        ev("unpost", 1, hour=50),
        ev("post", 1, hour=52, amount=Decimal(2500), effective_on=D),
    ]
    state = fold_rounds(events, as_of=CUT, posted_by=D)["req-emma"][1]
    assert (state.posted, state.locked_amount) == (True, Decimal(2500))


def test_a_tick_recorded_by_the_cut_and_undone_after_it_still_counts_on_both_axes() -> None:
    """The CampMinder axis only adds back-dated ticks to the recorded cut; what the recorded axis showed
    on D stays shown."""
    events = [ev("post", 1, hour=0, amount=Decimal(3000), effective_on=D), ev("unpost", 1, hour=72)]
    assert fold_rounds(events, as_of=CUT)["req-emma"][1].posted
    assert fold_rounds(events, as_of=CUT, posted_by=D)["req-emma"][1].posted


def test_an_accept_recorded_after_the_cut_has_no_campminder_day_and_keeps_the_recorded_cut() -> None:
    events = [_backdated_post(hour=48), ev("accept", 1, hour=50)]
    state = fold_rounds(events, as_of=CUT, posted_by=D)["req-emma"][1]
    assert (state.posted, state.accepted) == (True, False)


def test_decisions_and_asks_recorded_after_the_cut_stay_out_on_the_campminder_axis() -> None:
    events = [
        ev("ask", 2, hour=48, amount=Decimal(500), effective_on=D),
        ev("award", 3, hour=48, amount=Decimal(900), needs_approval=True),
    ]
    assert fold_rounds(events, as_of=CUT, posted_by=D) == {}


def test_a_back_dated_re_tick_on_a_posted_round_does_not_inherit_the_old_acceptance() -> None:
    """Fix round 1: posted and accepted by the cut, then unaccepted, undone and re-ticked back-dated after
    it. The new tick supersedes the old offer; the family accepted the old amount, not this one."""
    events = [
        ev("post", 1, hour=0, amount=Decimal(3000), effective_on=D),
        ev("accept", 1, hour=1),  # both recorded by the cut (hour 1 is the cut itself)
        ev("unaccept", 1, hour=48),
        ev("unpost", 1, hour=49),
        ev("post", 1, hour=50, amount=Decimal(2500), effective_on=D),
    ]
    state = fold_rounds(events, as_of=CUT, posted_by=D)["req-emma"][1]
    assert (state.posted, state.locked_amount, state.accepted, state.accepted_at) == (True, Decimal(2500), False, None)


def test_a_round_remembers_who_ticked_it_and_forgets_on_undo() -> None:
    """Slice 1's receipt label (§4.7): "locked Mar 9 by <the person>'s Posted tick"."""
    posted = fold_rounds([ev("post", 1, amount=Decimal(3000), lock_source="tick", actor="registrar@example.com")])
    assert posted["req-emma"][1].posted_by == "registrar@example.com"
    undone = fold_rounds(
        [
            ev("post", 1, hour=0, amount=Decimal(3000), lock_source="tick", actor="registrar@example.com"),
            ev("unpost", 1, hour=1, actor="registrar@example.com"),
        ]
    )
    assert undone["req-emma"][1].posted_by == ""


def test_a_round_3_amount_names_who_decided_it_finance_once_it_approves() -> None:
    """§4.7: staff-decided money names who decided it; above the registrar's limit that is finance (D79)."""
    keyed = fold_rounds([ev("award", 3, amount=Decimal(900), needs_approval=True, actor="registrar@example.com")])
    assert keyed["req-emma"][3].decided_by == "registrar@example.com"
    approved = fold_rounds(
        [
            ev("award", 3, hour=0, amount=Decimal(900), needs_approval=True, actor="registrar@example.com"),
            ev("approve", 3, hour=1, actor="finance@example.com"),
        ]
    )
    assert approved["req-emma"][3].decided_by == "finance@example.com"

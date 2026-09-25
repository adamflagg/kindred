"""Which grants count toward the offset, and how incentives meet aid. The offset's
effect on Round 1 is tested through calculate() in test_round1.py."""

from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import pytest

from bunking.financial_aid.calculator.grants import grants_offset, incentive_adjustments
from tests.unit.bunking.financial_aid.fixtures import fictional_rules, req, with_lever

DECIDED = datetime(2031, 3, 1, tzinfo=UTC)
LATE = "2031-04-01T00:00:00Z"
EARLY = "2031-02-01T00:00:00Z"


def _grant(amount: str, state: str = "committed", recorded_at: str | None = None) -> dict[str, Any]:
    return {"amount": amount, "state": state, "recorded_at": recorded_at}


def test_committed_grants_sum_for_an_offset_program() -> None:
    amount, issues, step = grants_offset(req(grants_applicable=[_grant("600"), _grant("400")]), fictional_rules())
    assert (amount, issues, step.key) == (Decimal(1000), [], "grants")


def test_a_program_outside_offset_programs_ignores_grants() -> None:
    request = req(program_key="bmitzvah", session_cm_id=1000301, grants_applicable=[_grant("1000")])
    amount, _, step = grants_offset(request, fictional_rules())
    assert amount == Decimal(0)
    assert "bmitzvah" in (step.note or "")
    rules = with_lever(fictional_rules(), "grants.offset_programs", ["summer", "quest", "bmitzvah"])
    assert grants_offset(request, rules)[0] == Decimal(1000)


def test_count_when_received_ignores_committed_grants() -> None:
    rules = with_lever(fictional_rules(), "grants.count_when", "received")
    request = req(grants_applicable=[_grant("600"), _grant("400", "received")])
    assert grants_offset(request, rules)[0] == Decimal(400)


@pytest.mark.parametrize(
    ("policy", "counted", "codes"),
    [("ignore", "400", []), ("flag", "400", ["late_grant"]), ("recalculate", "1000", [])],
)
def test_the_late_grant_policy(policy: str, counted: str, codes: list[str]) -> None:
    rules = with_lever(fictional_rules(), "grants.late_grant_policy", policy)
    request = req(
        r1_decided_at=DECIDED, grants_applicable=[_grant("600", recorded_at=LATE), _grant("400", recorded_at=EARLY)]
    )
    amount, issues, _ = grants_offset(request, rules)
    assert amount == Decimal(counted)
    assert [i.code for i in issues] == codes


def test_nothing_is_late_before_round_1_is_decided_or_without_a_date() -> None:
    rules = with_lever(fictional_rules(), "grants.late_grant_policy", "ignore")
    assert grants_offset(req(grants_applicable=[_grant("600", recorded_at=LATE)]), rules)[0] == Decimal(600)
    assert grants_offset(req(r1_decided_at=DECIDED, grants_applicable=[_grant("600")]), rules)[0] == Decimal(600)


@pytest.mark.parametrize(
    ("mode", "expected"), [("ignore", (0, 0)), ("reduce_cost", (500, 0)), ("reduce_award", (0, 500))]
)
def test_incentive_modes(mode: str, expected: tuple[int, int]) -> None:
    rules = with_lever(fictional_rules(), "grants.incentives.new_family.mode", mode)
    reduce_cost, reduce_award, issues = incentive_adjustments(
        req(incentives=[{"key": "new_family", "amount": "500"}]), rules
    )
    assert (reduce_cost, reduce_award) == (Decimal(expected[0]), Decimal(expected[1]))
    assert issues == []


def test_an_unknown_incentive_warns_and_changes_nothing() -> None:
    reduce_cost, reduce_award, issues = incentive_adjustments(
        req(incentives=[{"key": "mystery", "amount": "500"}]), fictional_rules()
    )
    assert (reduce_cost, reduce_award) == (Decimal(0), Decimal(0))
    assert [(i.code, i.severity) for i in issues] == [("unknown_incentive", "warn")]

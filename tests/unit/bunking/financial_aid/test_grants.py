"""Which grants count toward the offset, and how incentives meet aid. The offset's
effect on Round 1 is tested through calculate() in test_round1.py."""

from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import pytest

from bunking.financial_aid.calculator.grants import (
    grant_round,
    grants_offset,
    grants_since_round1,
    incentive_adjustments,
)
from bunking.financial_aid.calculator.inputs import GrantInput
from tests.unit.bunking.financial_aid.fixtures import fictional_rules, req, with_lever, with_levers

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


def test_the_late_grant_flag_is_information_only() -> None:
    # A late grant never reduces an award already offered (spec section 2 item 17), so the
    # flag must not invite finance to recalculate one.
    request = req(r1_decided_at=DECIDED, grants_applicable=[_grant("600", recorded_at=LATE)])
    (issue,) = grants_offset(request, fictional_rules())[1]
    assert (issue.code, issue.severity) == ("late_grant", "warn")
    assert "recalculate" not in issue.message
    assert "stands" in issue.message


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


# --- when a grant became known (slice 3 ask 10: the Register's classifier; D116, D139, D43) ------------------------

APPEAL = datetime(2031, 4, 15, tzinfo=UTC)  # the appeal's decision (Round 2 posted)
EARLY_AT = datetime(2031, 2, 1, tzinfo=UTC)
LATE_AT = datetime(2031, 4, 1, tzinfo=UTC)  # after Round 1's decision (DECIDED), before the appeal's
AFTER_APPEAL_AT = datetime(2031, 5, 1, tzinfo=UTC)
AFTER_APPEAL = "2031-05-01T00:00:00Z"


def _input(recorded_at: datetime | None, state: str = "committed") -> GrantInput:
    return GrantInput(amount=Decimal(500), state=state, recorded_at=recorded_at)


@pytest.mark.parametrize(
    ("recorded", "r1", "r2", "expected"),
    [
        (None, DECIDED, None, "round_1"),  # no date: never late
        (EARLY_AT, DECIDED, None, "round_1"),  # known before Round 1's decision
        (LATE_AT, None, None, "round_1"),  # Round 1 not decided yet: nothing is after it
        (LATE_AT, DECIDED, None, "after_round_1"),  # after Round 1's decision, no appeal decided
        (LATE_AT, DECIDED, APPEAL, "after_round_1"),  # after Round 1's, before the appeal's decision
        (AFTER_APPEAL_AT, DECIDED, APPEAL, "after_appeal"),  # after both
    ],
)
def test_the_round_a_grant_counts_in(
    recorded: datetime | None, r1: datetime | None, r2: datetime | None, expected: str
) -> None:
    request = req(r1_decided_at=r1, r2_decided_at=r2)
    assert grant_round(_input(recorded), request, fictional_rules()) == expected


@pytest.mark.parametrize("policy", ["ignore", "flag", "recalculate"])
def test_a_grant_recorded_after_a_posted_round_1_is_after_it_whatever_the_late_grant_policy(policy: str) -> None:
    """D43: a posted amount stands. `recalculate` re-prices Round 1 only while it is open; the classifier does not read
    the policy, so a grant recorded after Round 1's decision is after_round_1 (and after the appeal's, after_appeal)."""
    rules = with_lever(fictional_rules(), "grants.late_grant_policy", policy)
    request = req(r1_decided_at=DECIDED, r2_decided_at=APPEAL)
    assert grant_round(_input(LATE_AT), request, rules) == "after_round_1"
    assert grant_round(_input(AFTER_APPEAL_AT), request, rules) == "after_appeal"


def test_count_when_received_waits_for_receipt_and_a_program_the_rules_do_not_offset_has_no_round() -> None:
    request = req(r1_decided_at=DECIDED, r2_decided_at=APPEAL)
    received = with_lever(fictional_rules(), "grants.count_when", "received")
    assert grant_round(_input(EARLY_AT), request, received) == "not_received"
    assert grant_round(_input(EARLY_AT, "received"), request, received) == "round_1"
    other = req(program_key="bmitzvah", session_cm_id=1000301, r1_decided_at=DECIDED)
    assert grant_round(_input(EARLY_AT), other, fictional_rules()) == "not_offset_program"


_CELLS = [
    (state, at) for state in ("committed", "received") for at in (None, EARLY, LATE, AFTER_APPEAL)
]  # eight grants: 1, 2, 4 … 128 dollars, so a sum names exactly which grants it holds


@pytest.mark.parametrize("count_when", ["committed", "received"])
@pytest.mark.parametrize("policy", ["ignore", "flag", "recalculate"])
@pytest.mark.parametrize("program", ["summer", "bmitzvah"])
@pytest.mark.parametrize("r2", [None, APPEAL])
@pytest.mark.parametrize("r1", [None, DECIDED])
def test_the_classifier_agrees_with_the_untouched_sums_over_the_whole_grid(
    r1: datetime | None, r2: datetime | None, program: str, policy: str, count_when: str
) -> None:
    """Not circular: grants_offset and grants_since_round1 are the OLD functions, this PR does not edit them, and the
    expected figures are written out here from the classifier's names. `recalculate` is the one policy that changes
    what Round 1 sums (it counts every counted grant there), and it is spelled out below."""
    rules = with_levers(fictional_rules(), {"grants.late_grant_policy": policy, "grants.count_when": count_when})
    extra = {"session_cm_id": 1000301} if program == "bmitzvah" else {}
    request = req(
        program_key=program,
        r1_decided_at=r1,
        r2_decided_at=r2,
        grants_applicable=[_grant(str(2**i), state, at) for i, (state, at) in enumerate(_CELLS)],
        **extra,
    )
    named = [(g.amount, grant_round(g, request, rules)) for g in request.grants_applicable]

    def total(*which: str) -> Decimal:
        return sum((amount for amount, found in named if found in which), Decimal(0))

    def count(*which: str) -> int:
        return sum(1 for _, found in named if found in which)

    late = ("after_round_1", "after_appeal")
    recalculating = policy == "recalculate"
    amount, issues, step = grants_offset(request, rules)
    assert amount == (total("round_1", *late) if recalculating else total("round_1"))
    assert grants_since_round1(request, rules) == (Decimal(0) if recalculating else total("after_round_1"))
    assert step.inputs.get("late_left_out", 0) == (0 if recalculating else count(*late))
    assert len(issues) == (count(*late) if policy == "flag" else 0)

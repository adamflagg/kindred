"""Reports › Statistics (clean spec §9.2; §9.7 RPT-5, RPT-9, RPT-10, RPT-22, RPT-23; D72, D80, D129–D131) over
fictional received requests (report_fixtures): the camp table's tiers, three families. Fictional only."""

from __future__ import annotations

from decimal import Decimal

from bunking.financial_aid.reports.facts import ReportRequest
from bunking.financial_aid.reports.statistics import (
    NO_REASON,
    CancelledRow,
    RoundChip,
    StatisticsRow,
    outcomes,
    recipients_cancelled,
    statistics,
    tier_appeals,
)
from tests.unit.bunking.financial_aid.fixtures import fictional_rules, with_levers
from tests.unit.bunking.financial_aid.report_fixtures import req, rnd

RULES = fictional_rules()


def _tier(rows: tuple[StatisticsRow, ...], tier: int | None) -> StatisticsRow:
    return next(row for row in rows if row.tier == tier)


def test_a_tier_row_counts_received_apps_and_awards_only_the_live() -> None:
    """D72 apps (cancelled included, D131) against D80 awarded (Posted, live requests only, D129)."""
    table = statistics(
        [
            req("reqemma00000001", rnd(1, ask="4000", posted="1500")),
            req("reqliam00000001", rnd(1, ask="2000", posted="1000"), household=1000002),
            req("reqnoah00000001", rnd(1, ask="3000", posted="900"), household=1000003, standing="cancelled"),
        ],
        RULES,
        table="camp",
        round_=1,
    )
    two = _tier(table.rows, 2)
    assert (two.apps, two.cancelled, two.asked, two.asks) == (3, 1, Decimal(9000), 3)
    assert two.average_ask == Decimal("3000.00")
    assert (two.amount, two.awarded_count, two.average_award) == (Decimal(2500), 2, Decimal("1250.00"))
    # % of ask divides by the LIVE requests' asks: the cancelled 3,000 leaves with its award.
    assert (two.live_asked, two.pct_of_ask) == (Decimal(6000), Decimal("41.7"))
    assert (two.income_from, two.income_to, two.fee_pct) == (Decimal(40001), Decimal(80000), Decimal(75))


def test_every_tier_of_the_rules_is_a_row_and_no_tier_only_when_a_request_has_none() -> None:
    table = statistics([req("reqemma00000001", rnd(1, ask="4000", posted="1500"))], RULES, table="camp", round_=1)
    assert [row.tier for row in table.rows] == [1, 2, 3, 4, 5, 6]
    empty = _tier(table.rows, 1)
    assert (empty.apps, empty.amount, empty.average_ask, empty.pct_of_ask) == (0, Decimal(0), None, None)
    untiered = statistics([req("reqemma00000001", rnd(1, ask="4000", tier=None))], RULES, table="camp", round_=1)
    assert [row.tier for row in untiered.rows][-1] is None
    assert _tier(untiered.rows, None).apps == 1


def test_the_totals_row_is_the_rows_summed() -> None:
    requests = [
        req("reqemma00000001", rnd(1, ask="4000", posted="1500")),
        req("reqliam00000001", rnd(1, ask="2000", posted="600", tier=4), household=1000002),
        req("reqnoah00000001", rnd(1, ask="1000", tier=None), household=1000003),
    ]
    table = statistics(requests, RULES, table="camp", round_=1)
    assert table.total.apps == sum(row.apps for row in table.rows) == 3
    assert table.total.amount == sum((row.amount for row in table.rows), Decimal(0)) == Decimal(2100)
    assert table.total.asked == Decimal(7000)
    assert table.total.tier is None
    assert table.total.income_from is None
    assert table.total.fee_pct is None


def test_a_clawed_back_round_and_a_zero_posting_are_not_awarded() -> None:
    """D54: a clawback's money is no longer awarded. A $0 posting is no award (D80's count: with a posted award)."""
    table = statistics(
        [
            req("reqemma00000001", rnd(1, ask="4000", posted="1500", clawed_back=True)),
            req("reqliam00000001", rnd(1, ask="2000", posted="0"), household=1000002),
        ],
        RULES,
        table="camp",
        round_=1,
    )
    two = _tier(table.rows, 2)
    assert (two.amount, two.awarded_count, two.average_award) == (Decimal(0), 0, None)


def test_the_decided_basis_adds_decided_not_yet_offered_and_breaks_it_out() -> None:
    """D130, RPT-5: one basis at a time; the decided part is labelled apart, never called awarded."""
    requests = [
        req("reqemma00000001", rnd(1, ask="4000", posted="1500")),
        req("reqliam00000001", rnd(1, ask="2000", decided="1000"), household=1000002),
    ]
    posted = _tier(statistics(requests, RULES, table="camp", round_=1).rows, 2)
    both = _tier(statistics(requests, RULES, table="camp", round_=1, basis="posted_and_decided").rows, 2)
    assert (posted.amount, posted.decided, posted.awarded_count, posted.decided_count) == (
        Decimal(1500),
        Decimal(0),
        1,
        0,
    )
    assert (both.amount, both.decided, both.awarded_count, both.decided_count) == (Decimal(2500), Decimal(1000), 1, 1)
    # The average award stays awarded ÷ the awarded count: decided money is never called awarded (D130).
    assert both.average_award == posted.average_award == Decimal("1500.00")


def test_percent_of_ask_with_grants_adds_the_live_requests_grants_on_round_1_only() -> None:
    requests = [
        req("reqemma00000001", rnd(1, ask="4000", posted="1500"), rnd(2, ask="800", posted="300"), grants="500")
    ]
    round1 = _tier(statistics(requests, RULES, table="camp", round_=1).rows, 2)
    assert (round1.grants, round1.pct_of_ask_with_grants) == (Decimal(500), Decimal("50.0"))
    round2 = _tier(statistics(requests, RULES, table="camp", round_=2).rows, 2)
    assert (round2.grants, round2.pct_of_ask_with_grants) == (None, None)
    every = statistics(requests, RULES, table="camp", round_=None).total
    # Owner A2/A5 (2026-10-09): All rounds is Development's need, max(4,000, 1,500 + 800) = 4,000, not the 4,800 sum
    # (no cost known, so nothing is capped: need as typed); % of ask divides by the same 4,000.
    assert (every.asked, every.amount, every.pct_of_ask) == (Decimal(4000), Decimal(1800), Decimal("45.0"))
    assert every.asked_as_typed == Decimal(4800)


def test_the_round_2_chip_counts_appeals_by_their_round_2_tier_with_the_round_2_max() -> None:
    requests = [
        req("reqemma00000001", rnd(1, ask="4000", posted="1500"), rnd(2, ask="800", posted="300", tier=3)),
        req("reqliam00000001", rnd(1, ask="2000", posted="1000"), household=1000002),
    ]
    table = statistics(requests, RULES, table="camp", round_=2)
    assert table.total.apps == 1
    three = _tier(table.rows, 3)
    assert (three.apps, three.asked, three.amount) == (1, Decimal(800), Decimal(300))
    assert three.fee_pct == RULES.round2.tables["camp"].tiers[3].total_pct


def test_the_all_tables_chip_has_no_fee_percent() -> None:
    requests = [
        req("reqemma00000001", rnd(1, ask="4000", posted="1500")),
        req(
            "reqolivia000001",
            rnd(1, ask="1000", posted="400", pool="weekend_pool"),
            table="family",
            pool="weekend_pool",
        ),
    ]
    camp = statistics(requests, RULES, table="camp", round_=1)
    every = statistics(requests, RULES, table=None, round_=1)
    assert camp.total.apps == 1
    assert every.total.apps == 2
    assert all(row.fee_pct is None for row in every.rows)


def test_recipients_who_cancelled_keep_what_was_posted_by_reason_pool_and_round() -> None:
    """D131, RPT-22: a recipient is someone whose award posted, even if CampMinder has clawed it back since."""
    requests = [
        req(
            "reqemma00000001",
            rnd(1, ask="4000", posted="1500", clawed_back=True),
            standing="cancelled",
            reason="aid_not_enough",
        ),
        req("reqliam00000001", rnd(1, ask="2000", posted="1000"), household=1000002, standing="cancelled"),
        req("reqnoah00000001", rnd(1, ask="3000"), household=1000003, standing="cancelled", reason="medical"),
    ]
    assert recipients_cancelled(requests) == (
        CancelledRow("aid_not_enough", "camp_pool", 1, 1, Decimal(1500)),
        CancelledRow(NO_REASON, "camp_pool", 1, 1, Decimal(1000)),
    )


def test_tier_appeals_puts_round_1_apps_beside_appeals_with_a_derived_rate() -> None:
    """RPT-9: the Round 2 max % is a rules value; the appeal rate is Kindred-derived."""
    requests = [
        req("reqemma00000001", rnd(1, ask="4000", posted="1500"), rnd(2, ask="800", posted="300")),
        req("reqliam00000001", rnd(1, ask="2000", posted="1000"), household=1000002),
        req("reqnoah00000001", rnd(1, ask="2000"), rnd(3, ask="200", posted="200"), household=1000003),
    ]
    rows = tier_appeals(requests, RULES, table="camp")
    two = next(row for row in rows if row.tier == 2)
    assert (two.round1_apps, two.appeals, two.appeal_rate) == (3, 1, Decimal("33.3"))
    assert two.round1_fee_pct == Decimal(75)
    assert two.round2_max_pct == RULES.round2.tables["camp"].tiers[2].total_pct
    assert two.round3_awarded == Decimal(200)
    total = rows[-1]
    assert (total.tier, total.round1_apps, total.appeals, total.round1_fee_pct) == (None, 3, 1, None)


def test_outcomes_count_accepted_appealed_and_waiting_per_pool_and_overall() -> None:
    """RPT-23: waiting = posted Round 1, not accepted, no Round 2 ask; a cancelled family is not waiting."""
    requests = [
        req("reqemma00000001", rnd(1, ask="4000", posted="1500", accepted=True)),
        req("reqliam00000001", rnd(1, ask="2000", posted="1000"), rnd(2, ask="600"), household=1000002),
        req("reqnoah00000001", rnd(1, ask="2000", posted="800"), household=1000003),
        req("reqava000000001", rnd(1, ask="2000", posted="800"), household=1000004, standing="cancelled"),
        req(
            "reqolivia000001",
            rnd(1, ask="1000", posted="400", pool="weekend_pool"),
            household=1000005,
            pool="weekend_pool",
            table="family",
        ),
    ]
    camp, weekend, every = outcomes(requests)
    assert (camp.pool, camp.accepted, camp.accepted_amount) == ("camp_pool", 1, Decimal(1500))
    assert (camp.appealed, camp.appealed_asked, camp.waiting) == (1, Decimal(600), 1)
    assert (weekend.pool, weekend.waiting) == ("weekend_pool", 1)
    assert (every.pool, every.accepted, every.appealed, every.waiting) == (None, 1, 1, 2)


def test_outcomes_name_the_unpooled_requests_apart_from_the_every_request_row() -> None:
    """RPT-23: a request with no home pool is its own "no_pool" row (pool None), before the "headline" row that
    counts every live request; a season with no unpooled request has no no_pool row."""
    camp = req("reqemma00000001", rnd(1, ask="4000", posted="1500", accepted=True))
    loose = req("reqliam00000001", rnd(1, ask="2000", posted="1000"), household=1000002, pool=None)
    rows = outcomes([camp, loose])
    assert [(row.kind, row.pool) for row in rows] == [("pool", "camp_pool"), ("no_pool", None), ("headline", None)]
    pooled, unpooled, every = rows
    assert (pooled.accepted, pooled.waiting) == (1, 0)
    assert (unpooled.accepted, unpooled.waiting) == (0, 1)
    assert (every.accepted, every.waiting) == (1, 1)
    assert [row.kind for row in outcomes([camp])] == ["pool", "headline"]


def test_recipients_who_cancelled_are_grouped_by_the_rounds_lock_pool_not_the_home_pool() -> None:
    requests = [
        req(
            "reqemma00000001",
            rnd(1, ask="4000", posted="1500", pool="weekend_pool"),
            pool="camp_pool",
            standing="cancelled",
            reason="medical",
        )
    ]
    assert recipients_cancelled(requests) == (CancelledRow("medical", "weekend_pool", 1, 1, Decimal(1500)),)


def test_the_round_2_fee_percent_is_null_when_a_chips_programs_use_two_round_2_tables() -> None:
    """The chip's programs (camp's r1 table) route their appeals to two Round 2 tables, so no one fee % is true."""
    split = RULES.model_copy(deep=True)
    split.round2.program_tables["quest"] = "teen"
    requests = [req("reqemma00000001", rnd(1, ask="4000", posted="1500"), rnd(2, ask="800", posted="300", tier=3))]
    assert _tier(statistics(requests, RULES, table="camp", round_=2).rows, 3).fee_pct is not None
    assert _tier(statistics(requests, split, table="camp", round_=2).rows, 3).fee_pct is None


def test_a_round_outside_the_budget_leaves_the_percent_of_ask_denominator_but_stays_in_asked_and_in_the_with_grants_denominator() -> (
    None
):
    """Owner (c) (RULED 2026-10-02): D121's full-cost outside-funder round is never awarded, so its ask is not in
    % of ask's denominator; the plain asked column and the average ask still count it."""
    table = statistics(
        [
            req("reqemma00000001", rnd(1, ask="4000", posted="1500")),
            req("reqliam00000001", rnd(1, ask="3000", outside_budget=True), household=1000002),
        ],
        RULES,
        table="camp",
        round_=1,
    )
    two = _tier(table.rows, 2)
    assert (two.asked, two.asks, two.average_ask) == (Decimal(7000), 2, Decimal("3500.00"))
    assert (two.live_asked, two.pct_of_ask) == (Decimal(4000), Decimal("37.5"))
    # owner, RULED 2026-10-02: the with-grants denominator keeps outside-funded asks (1500 / (4000 + 3000)).
    assert two.pct_of_ask_with_grants == Decimal("21.4")


def test_awarded_is_posted_alone_on_either_basis_so_amount_is_awarded_plus_decided() -> None:
    """Slice 4 ask 2 (built on the D5/D80 ruling): Posted alone beside the decided basis's `amount`, net of clawback,
    live requests only (D80, D129, D54)."""
    requests = [
        req("reqemma00000001", rnd(1, ask="4000", posted="1500")),
        req("reqliam00000001", rnd(1, ask="2000", decided="1000"), household=1000002),
        req("reqnoah00000001", rnd(1, ask="3000", posted="900"), household=1000003, standing="cancelled"),
        req("reqoliv00000001", rnd(1, ask="2500", posted="700", clawed_back=True), household=1000004),
    ]
    posted = _tier(statistics(requests, RULES, table="camp", round_=1).rows, 2)
    both = _tier(statistics(requests, RULES, table="camp", round_=1, basis="posted_and_decided").rows, 2)
    assert (posted.awarded, posted.amount) == (Decimal(1500), Decimal(1500))
    assert (both.awarded, both.decided, both.amount) == (Decimal(1500), Decimal(1000), Decimal(2500))
    assert both.amount == both.awarded + both.decided


def test_percent_of_ask_with_grants_keeps_the_outside_funded_ask_in_its_denominator() -> None:
    """Owner (RULED 2026-10-02): "an outside funder counts as grants; grants means anything that isn't internal camp
    money; put them in the denom." The grants numerator holds the outside funder's money, so its ask stays in the
    denominator; the camp-money % of ask still drops it."""
    requests = [
        req("reqemma00000001", rnd(1, ask="1000", posted="500")),
        req("reqliam00000001", rnd(1, ask="2000", outside_budget=True), household=1000002, grants="2000"),
    ]
    table = statistics(requests, RULES, table="camp", round_=1)
    two = _tier(table.rows, 2)
    assert (two.pct_of_ask, two.grants, two.pct_of_ask_with_grants) == (Decimal("50.0"), Decimal(2000), Decimal("83.3"))
    # The totals row follows the same rule.
    assert (table.total.pct_of_ask, table.total.pct_of_ask_with_grants) == (Decimal("50.0"), Decimal("83.3"))


def test_an_outside_funded_rounds_own_money_counts_as_grants_on_percent_of_ask_with_grants() -> None:
    """Owner A1, carried through (RULED 2026-10-02: "grants means anything that isn't internal camp money"): an
    outside-budget round's Posted money is an outside funder's, so it joins the grants (column and numerator) even with
    no Grants-register row; the camp-money % of ask still leaves it out."""
    requests = [
        req("reqemma00000001", rnd(1, ask="1000", posted="500")),
        req("reqliam00000001", rnd(1, ask="2000", outside_budget=True, outside_posted="2000"), household=1000002),
    ]
    table = statistics(requests, RULES, table="camp", round_=1)
    two = _tier(table.rows, 2)
    assert (two.amount, two.pct_of_ask) == (Decimal(500), Decimal("50.0"))
    assert (two.grants, two.pct_of_ask_with_grants) == (Decimal(2000), Decimal("83.3"))
    assert (table.total.grants, table.total.pct_of_ask_with_grants) == (Decimal(2000), Decimal("83.3"))


def test_an_outside_funded_rounds_decided_money_counts_only_on_the_decided_basis() -> None:
    """Decided and not yet offered money joins the with-grants numerator on the "posted_and_decided" basis alone, as
    the camp's decided money does (D130); never on the Posted basis."""
    requests = [
        req("reqemma00000001", rnd(1, ask="1000", posted="500")),
        req("reqliam00000001", rnd(1, ask="2000", outside_budget=True, outside_decided="2000"), household=1000002),
    ]
    posted = _tier(statistics(requests, RULES, table="camp", round_=1).rows, 2)
    both = _tier(statistics(requests, RULES, table="camp", round_=1, basis="posted_and_decided").rows, 2)
    assert (posted.grants, posted.pct_of_ask_with_grants) == (Decimal(0), Decimal("16.7"))
    assert (both.grants, both.pct_of_ask_with_grants, both.decided) == (Decimal(2000), Decimal("83.3"), Decimal(0))


def test_an_outside_funded_rounds_money_leaves_with_a_clawback_or_a_cancellation() -> None:
    """Like the camp's Posted money (D54, D129): reversed or on a request that isn't live, it counts nowhere."""
    requests = [
        req("reqemma00000001", rnd(1, ask="1000", posted="500")),
        req(
            "reqliam00000001",
            rnd(1, ask="2000", outside_budget=True, outside_posted="2000", clawed_back=True),
            household=1000002,
        ),
        req(
            "reqnoah00000001",
            rnd(1, ask="3000", outside_budget=True, outside_posted="3000"),
            household=1000003,
            standing="cancelled",
        ),
    ]
    two = _tier(statistics(requests, RULES, table="camp", round_=1).rows, 2)
    assert (two.grants, two.pct_of_ask_with_grants) == (Decimal(0), Decimal("16.7"))


def test_the_round_2_fee_percent_follows_the_class_table_for_a_program_by_class() -> None:
    """§9.9: a by-class program counts under its class's Round 2 table, not under its stale program_tables entry."""
    requests = [req("reqemma00000001", rnd(1, ask="4000", posted="1500"), rnd(2, ask="800", posted="300", tier=3))]
    legacy = RULES.model_copy(deep=True)
    legacy.round2.program_tables["summer"] = "family"  # summer's appeals now use a second table
    assert _tier(statistics(requests, legacy, table="camp", round_=2).rows, 3).fee_pct is None
    # By class, summer prices from teen, so it leaves the camp chip and its stale entry no longer counts.
    by_class = with_levers(
        legacy, {"programs.summer.table_from_equity_class": True, "programs.summer.equity_class": "teen"}
    )
    assert _tier(statistics(requests, by_class, table="camp", round_=2).rows, 3).fee_pct is not None


# --- Rule M on Asked (owner 10-09): a request's asks count at most its priced session cost -------------------------


def test_asked_counts_a_request_above_its_session_cost_at_the_cost() -> None:
    """Rule M, as Development applies it: a typo'd 40,000 ask on a 4,000 session counts 4,000. Average ask follows,
    and so do the live asks behind % of ask (owner A5, 2026-10-09); only Asked (as typed) keeps the raw sum."""
    table = statistics(
        [
            req("reqemma00000001", rnd(1, ask="40000", posted="1500"), cost="4000"),
            req("reqliam00000001", rnd(1, ask="2000", posted="1000"), household=1000002, cost="4000"),
        ],
        RULES,
        table="camp",
        round_=1,
    )
    two = _tier(table.rows, 2)
    assert two.asked == Decimal(6000)
    assert two.average_ask == Decimal("3000.00")
    assert two.requests_capped == 1
    assert table.total.requests_capped == 1
    # A5 (owner 2026-10-09): % of ask's denominator is on the same capped basis, so the cap and % of ask agree.
    assert two.live_asked == Decimal(6000)
    assert two.asked_as_typed == Decimal(42000)  # A3: the raw sum, for the CSV and Copy's "Asked (as typed)"


def test_asked_counts_a_request_with_no_priced_cost_as_typed() -> None:
    table = statistics([req("reqemma00000001", rnd(1, ask="40000", posted="1500"))], RULES, table="camp", round_=1)
    assert _tier(table.rows, 2).asked == Decimal(40000)
    assert table.total.requests_capped == 0


def test_a_cancelled_request_still_counts_in_asked_at_the_cost() -> None:
    """D131: cancelled apps stay in Asked; the cap applies to them too."""
    table = statistics(
        [req("reqnoah00000001", rnd(1, ask="9000"), standing="cancelled", cost="4000")], RULES, table="camp", round_=1
    )
    assert table.total.asked == Decimal(4000)


def test_the_cap_is_on_the_whole_request_across_the_chosen_rounds() -> None:
    """All rounds is Development's need (A2): an unawarded 3,000 Round 1 and a 2,000 appeal re-ask the same shortfall,
    so it counts 3,000 (the higher of 3,000 and 0 + 2,000), not 5,000 capped at 3,500. Under the cost: not capped."""
    table = statistics(
        [req("reqemma00000001", rnd(1, ask="3000"), rnd(2, ask="2000"), cost="3500")], RULES, table="camp", round_=None
    )
    assert table.total.asked == Decimal(3000)
    assert table.total.asked_as_typed == Decimal(5000)
    assert table.total.requests_capped == 0


# --- Owner rulings A1–A5 (2026-10-09): Asked is capped like Development's need, on every figure ----------------------
# The 2026 sheet: a Round 2 ask is an INCREMENT on the Round 1 offer, and Round 3 funds what Round 2 left unfunded.
# All rounds = min(cost, need); a round chip n = min(ask n, max(0, cost - the awards posted before round n)).

COST = "4000"


def _asked(request: ReportRequest, round_: RoundChip) -> Decimal:
    return statistics([request], RULES, table="camp", round_=round_).total.asked


def test_a1_round_1_alone_above_the_cost_counts_at_the_cost() -> None:
    """Worked example: Round 1 ask 4,500, award 2,000, cost 4,000 → All rounds 4,000."""
    request = req("reqemma00000001", rnd(1, ask="4500", posted="2000"), cost=COST)
    assert _asked(request, None) == Decimal(4000)
    assert _asked(request, 1) == Decimal(4000)
    assert statistics([request], RULES, table="camp", round_=None).total.requests_capped == 1


def test_a2_an_appeal_on_the_round_1_offer_is_not_counted_twice() -> None:
    """Worked example: Round 1 3,000 / award 1,200, Round 2 1,800 → All rounds 3,000; chips 3,000 and 1,800 (they
    don't add up to All rounds: the appeal re-asks part of Round 1's shortfall)."""
    request = req("reqemma00000001", rnd(1, ask="3000", posted="1200"), rnd(2, ask="1800"), cost=COST)
    assert (_asked(request, None), _asked(request, 1), _asked(request, 2)) == (
        Decimal(3000),
        Decimal(3000),
        Decimal(1800),
    )
    assert statistics([request], RULES, table="camp", round_=None).total.requests_capped == 0


def test_a2_round_3_counts_at_most_what_the_cost_leaves_after_the_earlier_awards() -> None:
    """Worked example: Round 1 3,000 / 1,200, Round 2 1,500 / 1,000, Round 3 2,000 → All rounds 4,000 (need 4,200,
    capped); chips 3,000, 1,500 and 1,800 (4,000 less the 2,200 posted before Round 3)."""
    request = req(
        "reqemma00000001",
        rnd(1, ask="3000", posted="1200"),
        rnd(2, ask="1500", posted="1000"),
        rnd(3, ask="2000"),
        cost=COST,
    )
    chips = tuple(_asked(request, n) for n in (None, 1, 2, 3))
    assert chips == (Decimal(4000), Decimal(3000), Decimal(1500), Decimal(1800))
    every = statistics([request], RULES, table="camp", round_=None).total
    assert (every.asked_as_typed, every.requests_capped) == (Decimal(6500), 1)
    # A5: % of ask divides the 2,200 posted by the same capped 4,000, not the 6,500 typed.
    assert (every.live_asked, every.pct_of_ask) == (Decimal(4000), Decimal("55.0"))


def test_a2_the_award_before_a_round_is_the_posted_one_not_the_accepted_tick() -> None:
    """D47: the Round 1 award a Round 2 chip subtracts is Posted, accepted or not; a clawed-back one is no award."""
    accepted = req("reqemma00000001", rnd(1, ask="3000", posted="3000", accepted=True), rnd(2, ask="2000"), cost=COST)
    unaccepted = req("reqemma00000001", rnd(1, ask="3000", posted="3000"), rnd(2, ask="2000"), cost=COST)
    clawed = req("reqemma00000001", rnd(1, ask="3000", posted="3000", clawed_back=True), rnd(2, ask="2000"), cost=COST)
    assert _asked(accepted, 2) == _asked(unaccepted, 2) == Decimal(1000)
    assert _asked(clawed, 2) == Decimal(2000)


def test_a2_a_round_chip_with_no_priced_cost_counts_its_ask_as_typed() -> None:
    request = req("reqemma00000001", rnd(1, ask="3000", posted="3000"), rnd(2, ask="9000"))
    assert _asked(request, 2) == Decimal(9000)


def test_a1_the_footnote_counts_on_the_all_rounds_basis_on_every_chip() -> None:
    """The "N requests above their session's cost" count is Development's is_capped (the All-rounds basis), so a
    Round 2 chip names the same requests as All rounds."""
    request = req("reqemma00000001", rnd(1, ask="3000", posted="1200"), rnd(2, ask="3000"), cost=COST)
    assert statistics([request], RULES, table="camp", round_=2).total.requests_capped == 1
    assert statistics([request], RULES, table="camp", round_=None).total.requests_capped == 1


def test_a4_a_cancelled_request_is_capped_too_but_stays_out_of_percent_of_ask() -> None:
    """A4: a cancelled request's ask is capped at its priced cost; it never was in % of ask's denominator."""
    cancelled = req("reqnoah00000001", rnd(1, ask="9000"), rnd(2, ask="500"), standing="cancelled", cost=COST)
    total = statistics([cancelled], RULES, table="camp", round_=None).total
    assert (total.asked, total.asked_as_typed, total.requests_capped, total.live_asked) == (
        Decimal(4000),
        Decimal(9500),
        1,
        Decimal(0),
    )


def test_a5_the_in_budget_ask_leaves_an_outside_funded_round_and_is_capped() -> None:
    """A5 with owner (c): the in-budget denominator is need over the in-budget rounds, capped; % incl. grants divides
    by the capped need over every round."""
    request = req(
        "reqemma00000001",
        rnd(1, ask="4500", posted="1500"),
        rnd(2, ask="3000", outside_budget=True),
        cost=COST,
    )
    total = statistics([request], RULES, table="camp", round_=None).total
    assert (total.asked, total.live_asked) == (Decimal(4000), Decimal(4000))
    assert total.pct_of_ask_with_grants == Decimal("37.5")  # 1,500 ÷ the capped 4,000, not 7,500


def test_a1_the_march_committees_round_2_asked_is_capped() -> None:
    """A1: the committee table's "Round 2 asked" is the Round 2 chip's capped ask (cost 4,000 less the 3,000
    posted in Round 1)."""
    request = req("reqemma00000001", rnd(1, ask="3000", posted="3000"), rnd(2, ask="2500"), cost=COST)
    *_, every = outcomes([request])
    assert (every.appealed, every.appealed_asked) == (1, Decimal(1000))

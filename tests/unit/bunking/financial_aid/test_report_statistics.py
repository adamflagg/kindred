"""Reports › Statistics (clean spec §9.2; §9.7 RPT-5, RPT-9, RPT-10, RPT-22, RPT-23; D72, D80, D129–D131) over
fictional received requests (report_fixtures): the camp table's tiers, three families. Fictional only."""

from __future__ import annotations

from decimal import Decimal

from bunking.financial_aid.reports.statistics import (
    NO_REASON,
    CancelledRow,
    StatisticsRow,
    outcomes,
    recipients_cancelled,
    statistics,
    tier_appeals,
)
from tests.unit.bunking.financial_aid.fixtures import fictional_rules
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
    assert (every.asked, every.amount, every.pct_of_ask) == (Decimal(4800), Decimal(1800), Decimal("37.5"))


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

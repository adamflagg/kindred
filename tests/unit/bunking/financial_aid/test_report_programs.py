"""Reports › Programs (clean spec §9.3, §9.7 RPT-11; D72, D80, D129): sessions grouped by pool, pooled subtotals,
the multi-session rule. Fictional sessions (financial_aid_fakes.SESSIONS ids) and families only."""

from __future__ import annotations

from decimal import Decimal

from bunking.financial_aid.reports.programs import UNMATCHED_SESSION, programs
from tests.unit.bunking.financial_aid.report_fixtures import req, rnd

SESSION_2, TASTE_1, FAMILY_6 = 1000101, 1000104, 1000202
SESSIONS = {SESSION_2: "camp_pool", TASTE_1: "camp_pool", FAMILY_6: "weekend_pool"}


def test_every_rules_session_is_a_row_grouped_by_pool_even_with_no_apps() -> None:
    table = programs([req("reqemma00000001", rnd(1, ask="4000", posted="1500"))], SESSIONS)
    assert [(g.pool, [row.session_cm_id for row in g.sessions]) for g in table.pools] == [
        ("camp_pool", [SESSION_2, TASTE_1]),
        ("weekend_pool", [FAMILY_6]),
    ]
    taste = table.pools[0].sessions[1]
    assert (taste.round1.apps, taste.round1.average_request, taste.round1.pct_awarded) == (0, None, None)


def test_a_session_row_has_the_sheets_round_1_and_round_2_columns_and_kindreds_round_3() -> None:
    requests = [
        req("reqemma00000001", rnd(1, ask="4000", posted="1500"), rnd(2, ask="1000", posted="400")),
        req("reqliam00000001", rnd(1, ask="2000", posted="1000"), rnd(3, posted="200"), household=1000002),
        req("reqnoah00000001", rnd(1, ask="3000", posted="900"), household=1000003, standing="cancelled"),
    ]
    row = programs(requests, SESSIONS).pools[0].sessions[0]
    one = row.round1
    assert (one.apps, one.requested, one.awarded, one.awarded_count) == (3, Decimal(9000), Decimal(2500), 2)
    assert (one.average_request, one.average_award) == (Decimal("3000.00"), Decimal("1250.00"))
    assert one.pct_awarded == Decimal("41.7")  # 2,500 ÷ the included requests' 6,000
    assert (row.round2.apps, row.round2.requested, row.round2.awarded) == (1, Decimal(1000), Decimal(400))
    assert (row.round3.apps, row.round3.awarded) == (1, Decimal(200))  # a Round 3 posted with no ask keyed
    assert row.total_awarded == Decimal(3100)  # 1,500 + 400 + 1,000 + 200; the cancelled 900 is out


def test_subtotals_and_the_total_are_pooled_ratios_not_averages_of_rows() -> None:
    requests = [
        req("reqemma00000001", rnd(1, ask="4000", posted="2000")),
        req("reqliam00000001", rnd(1, ask="1000", posted="1000"), household=1000002, session=TASTE_1),
    ]
    camp = programs(requests, SESSIONS).pools[0]
    # Rows: 50% and 100%; the pooled subtotal is 3,000 ÷ 5,000 = 60%, not their 75% average.
    assert [row.round1.pct_awarded for row in camp.sessions] == [Decimal("50.0"), Decimal("100.0")]
    assert camp.subtotal.round1.pct_awarded == Decimal("60.0")
    assert camp.subtotal.round1.average_request == Decimal("2500.00")


def test_a_camper_at_two_sessions_is_two_requests_one_in_each_session() -> None:
    requests = [
        req("reqemma00000001", rnd(1, ask="4000", posted="1500")),
        req("reqemma00000002", rnd(1, ask="1000", posted="500"), session=TASTE_1),
    ]
    camp = programs(requests, SESSIONS).pools[0]
    assert [row.round1.apps for row in camp.sessions] == [1, 1]
    assert camp.subtotal.round1.apps == 2


def test_an_unmatched_request_is_its_pools_session_not_matched_row_and_no_pool_its_own_group() -> None:
    requests = [
        req("reqemma00000001", rnd(1, ask="4000"), session=0),
        req("reqava000000001", rnd(1, ask="500", pool=None), household=1000004, pool=None, table="", session=0),
    ]
    table = programs(requests, SESSIONS)
    camp = table.pools[0]
    assert camp.sessions[-1].session_cm_id == UNMATCHED_SESSION
    assert camp.sessions[-1].round1.apps == 1
    assert (table.pools[-1].pool, table.pools[-1].subtotal.round1.apps) == (None, 1)
    assert table.total.round1.apps == 2


def test_a_session_no_rules_program_claims_counts_in_its_pools_session_not_matched_row() -> None:
    """Sessions come from the rules (§9.3): a request on a session the rules don't list never makes its own row."""
    requests = [req("reqemma00000001", rnd(1, ask="4000"), session=1000401)]
    camp = programs(requests, SESSIONS).pools[0]
    assert [row.session_cm_id for row in camp.sessions] == [SESSION_2, TASTE_1, UNMATCHED_SESSION]
    assert camp.sessions[-1].round1.apps == 1


def test_a_session_shows_once_under_its_own_pool_whatever_the_requests_home_pool() -> None:
    """A rules session belongs to one program's pool; a request priced under another (a past read's pool) still
    counts in that session's row, never in a second copy of the session under another pool."""
    requests = [req("reqemma00000001", rnd(1, ask="4000", pool="weekend_pool"), pool="weekend_pool")]
    table = programs(requests, SESSIONS)
    rows = [(g.pool, r.session_cm_id) for g in table.pools for r in g.sessions if r.round1.apps]
    assert rows == [("camp_pool", SESSION_2)]

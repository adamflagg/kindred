"""Reports › Programs (clean spec §9.3, §9.7 RPT-11; D72, D80, D129): sessions grouped by pool, pooled subtotals,
the multi-session rule. Fictional sessions (financial_aid_fakes.SESSIONS ids) and families only."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from bunking.financial_aid.reports.programs import UNMATCHED_SESSION, one_row_sessions, programs
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
    assert one.pct_awarded == Decimal("41.7")  # 2,500 ÷ the live requests' 6,000
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


def test_a_round_outside_the_budget_leaves_the_programs_percent_denominator_but_stays_requested() -> None:
    """Owner (c) (RULED 2026-10-02): same rule as Statistics: asked/requested keep the ask, % awarded does not divide
    by it."""
    table = programs(
        [
            req("reqemma00000001", rnd(1, ask="4000", posted="1500")),
            req("reqliam00000001", rnd(1, ask="3000", outside_budget=True), household=1000002),
        ],
        {1000101: "camp_pool"},
    )
    block = table.total.round1
    assert (block.requested, block.asks, block.pct_awarded) == (Decimal(7000), 2, Decimal("37.5"))


def test_a1_requested_and_the_appeals_asked_are_capped_like_statistics_round_chips() -> None:
    """Owner A1/A2 (2026-10-09): By session's Round 1 "Requested" and Round 2 "Asked" are Statistics' round chips: a
    round's ask counts at most the cost less the awards posted before it (cost 4,000: Round 1 4,500 counts 4,000; the
    Round 2 3,000 after a 1,200 award counts 2,800). The as-typed sums ride along for the CSV and Copy (A3), and
    % awarded divides by the same capped asks (A5)."""
    table = programs(
        [req("reqemma00000001", rnd(1, ask="4500", posted="1200"), rnd(2, ask="3000", posted="1400"), cost="4000")],
        SESSIONS,
    )
    one, two = table.total.round1, table.total.round2
    assert (one.requested, one.requested_as_typed, one.pct_awarded) == (Decimal(4000), Decimal(4500), Decimal("30.0"))
    assert (two.requested, two.requested_as_typed, two.pct_awarded) == (Decimal(2800), Decimal(3000), Decimal("50.0"))
    assert table.requests_capped == 1  # need 4,500 > 4,000: the All-rounds basis, as Statistics' footnote


# --- the session order and the not-aided rows (ux3 statistics-14, statistics-13) ---------------------------------


def test_sessions_follow_the_given_rank_with_session_not_matched_last() -> None:
    """Owner Q8: a reader's order (bunking/session_order.py), never the CampMinder id; the unmatched row stays last."""
    requests = [req("reqemma00000001", rnd(1, ask="4000", posted="1500"), session=0)]
    rank = {TASTE_1: 0, SESSION_2: 1}
    table = programs(requests, {SESSION_2: "camp_pool", TASTE_1: "camp_pool"}, rank=rank)
    assert [row.session_cm_id for row in table.pools[0].sessions] == [TASTE_1, SESSION_2, UNMATCHED_SESSION]


def test_a_session_of_a_program_closed_to_aid_with_no_applications_is_not_a_row() -> None:
    """Owner Q7: "i think we should hide sessions which are the no pool ones yes." Keyed off the rules (the program is
    not open to aid), never the zero count: a session of an aided program shows at 0."""
    sessions: dict[int, str | None] = {SESSION_2: "camp_pool", TASTE_1: None, FAMILY_6: None}
    table = programs([], sessions, closed_to_aid=frozenset({TASTE_1, FAMILY_6}))
    assert [(g.pool, [r.session_cm_id for r in g.sessions]) for g in table.pools] == [("camp_pool", [SESSION_2])]


def test_a_closed_to_aid_session_with_an_application_shows() -> None:
    sessions: dict[int, str | None] = {TASTE_1: None, FAMILY_6: None}
    requests = [req("reqemma00000001", rnd(1, ask="400"), session=TASTE_1)]
    table = programs(requests, sessions, closed_to_aid=frozenset({TASTE_1, FAMILY_6}))
    assert [(g.pool, [r.session_cm_id for r in g.sessions]) for g in table.pools] == [(None, [TASTE_1])]
    assert table.pools[0].sessions[0].round1.apps == 1


# --- SCIT as one session (owner 2026-10-10: "approved to combine SCIT") ------------------------------------------

CIT, SIT = 1000107, 1000108


@dataclass(frozen=True)
class SessionRow:
    cm_id: int
    name: str
    session_type: str
    start_date: str
    end_date: str
    parent_cm_id: int = 0


def _scit_sessions() -> dict[int, str | None]:
    return {SESSION_2: "camp_pool", CIT: "camp_pool", SIT: "camp_pool"}


def test_a_one_row_group_is_one_row_whose_figures_sum_its_sessions() -> None:
    """Counselor and Specialist In-Training: two CampMinder sessions, one Camperships row summing both."""
    requests = [
        req("reqemma00000001", rnd(1, ask="4000", posted="1500"), session=CIT),
        req("reqliam00000001", rnd(1, ask="2000", posted="1000"), household=1000002, session=SIT),
    ]
    table = programs(requests, _scit_sessions(), one_row={CIT: CIT, SIT: CIT})
    rows = table.pools[0].sessions
    assert [row.session_cm_id for row in rows] == [SESSION_2, CIT]
    scit = rows[1]
    assert scit.session_cm_ids == (CIT, SIT)
    assert (scit.round1.apps, scit.round1.requested, scit.round1.awarded) == (2, Decimal(6000), Decimal(2500))
    assert scit.total_awarded == Decimal(2500)
    assert table.pools[0].subtotal.round1.apps == 2
    assert rows[0].session_cm_ids == (SESSION_2,)


def test_a_one_row_group_with_no_applications_on_one_session_counts_the_other_alone() -> None:
    """Real 2026's shape: CIT 14 apps + SIT 0 is one SCIT row of 14."""
    requests = [req(f"reqemma0000000{n}", rnd(1, ask="1000"), household=1000001 + n, session=CIT) for n in range(3)]
    scit = programs(requests, _scit_sessions(), one_row={CIT: CIT, SIT: CIT}).pools[0].sessions[1]
    assert (scit.session_cm_id, scit.session_cm_ids, scit.round1.apps) == (CIT, (CIT, SIT), 3)


def test_a_one_row_group_hides_only_when_every_session_is_closed_to_aid_and_empty() -> None:
    sessions = _scit_sessions()
    one_row = {CIT: CIT, SIT: CIT}
    hidden = programs([], sessions, one_row=one_row, closed_to_aid=frozenset({CIT, SIT}))
    assert [r.session_cm_id for r in hidden.pools[0].sessions] == [SESSION_2]
    shown = programs([], sessions, one_row=one_row, closed_to_aid=frozenset({SIT}))
    assert [r.session_cm_id for r in shown.pools[0].sessions] == [SESSION_2, CIT]


def test_one_row_sessions_groups_scit_by_type_within_a_pool_first_in_the_session_order() -> None:
    """By session type, never by id; per pool, so two programs' SCIT sessions never share a row; a lone one is
    its own row."""
    season = [
        SessionRow(SESSION_2, "Session 2", "main", "2027-06-20", "2027-07-10"),
        SessionRow(SIT, "Specialist In-Training", "scit", "2027-06-20", "2027-07-10"),
        SessionRow(CIT, "Counselor In-Training", "scit", "2027-06-20", "2027-07-10"),
        SessionRow(1000109, "Another In-Training", "scit", "2027-06-20", "2027-07-10"),
    ]
    pools: dict[int, str | None] = {SESSION_2: "camp_pool", CIT: "camp_pool", SIT: "camp_pool", 1000109: "tbm_pool"}
    assert one_row_sessions(season, pools) == {CIT: CIT, SIT: CIT}
    assert one_row_sessions(season[:2], pools) == {}
    assert one_row_sessions(season, {SESSION_2: "camp_pool", CIT: "camp_pool"}) == {}

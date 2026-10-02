"""The committee's year-over-year tables (clean spec §9.7 RPT-1, RPT-2, RPT-6, RPT-7, RPT-8, RPT-13, RPT-24): a
priced season (P) beside finance's typed history (r). Fictional rules (budget 500,000: camp 80%, weekends 15%,
b'mitzvah 5%), families and figures only."""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

from bunking.financial_aid.reports.committee import (
    NO_DEADLINE_CUT_GAP,
    PHASE_BOUNDARY_GAP,
    NativeSeason,
    committee_tables,
    native_phases,
)
from bunking.financial_aid.reports.history import ReportedFigure
from tests.unit.bunking.financial_aid.fixtures import fictional_rules
from tests.unit.bunking.financial_aid.report_fixtures import req, rnd

RULES = fictional_rules()
EARLY = datetime(2027, 1, 20, 18, 0, tzinfo=UTC)
LATE = datetime(2027, 2, 20, 18, 0, tzinfo=UTC)
CUTOFF = datetime(2027, 2, 2, 8, 0, tzinfo=UTC)  # the first instant after Feb 1 ends, camp time


def _season(*requests: object) -> NativeSeason:
    return NativeSeason(
        year=2027,
        document=RULES,
        requests=tuple(requests),  # type: ignore[arg-type]
        as_of=date(2027, 4, 1),
        cutoff=date(2027, 2, 1),
        cutoff_instant=CUTOFF,
    )


def _typed(
    metric: str,
    value: str,
    *,
    year: int = 2026,
    pool: str = "",
    tier: int = 0,
    phase: int = 0,
    at: str = "season_end",
    as_of: date | None = None,
    note: str = "",
) -> ReportedFigure:
    return ReportedFigure(
        year=year,
        view="finance",
        metric=metric,
        pool=pool,
        tier=tier,
        phase=phase,
        at=at,  # type: ignore[arg-type]
        as_of=as_of or date(year, 10, 10),
        value=Decimal(value),
        note=note,
    )


SEASON = _season(
    req("reqemma00000001", rnd(1, ask="4000", posted="1500"), rnd(2, ask="800", posted="300"), received_at=EARLY),
    req("reqliam00000001", rnd(1, ask="2000", posted="1000"), household=1000002, received_at=LATE),
    req(
        "reqnoah00000001", rnd(1, ask="3000", posted="900"), household=1000003, standing="cancelled", received_at=EARLY
    ),
    req(
        "reqolivia000001",
        rnd(1, ask="1000", posted="400", pool="weekend_pool"),
        household=1000004,
        pool="weekend_pool",
        table="family",
        received_at=None,
    ),
)


def test_a_priced_seasons_phase_row_splits_round_1_at_the_deadline_with_appeals_and_the_total() -> None:
    """RPT-1 (D155, ruled; replaces the pre-ruling test that expected phases 1 and 2 empty): the cut is the
    application deadline, so a season whose deadline is known shows all three phases."""
    season = replace(SEASON, deadline_instant=CUTOFF)
    row = next(r for r in committee_tables([season], []).phases if r.basis == "P")
    assert row.phases == (Decimal(1500), Decimal(1000), Decimal(300))
    assert row.total == Decimal(3200)  # 1,500 + 300 + 1,000 + 400; the cancelled 900 is out (D129)
    assert (row.budget, row.variance, row.side) == (Decimal(500000), Decimal(-496800), "under")
    assert row.total_pct_of_budget == Decimal("0.6")
    assert row.reconciliation == Decimal(400)  # Olivia has no received date: in no Round 1 phase
    assert row.gaps == ()


def test_a_typed_phase_row_computes_every_percent_and_shows_the_gap_and_the_band() -> None:
    """RPT-1 history: dollars typed, percentages computed; "total − Σ phases" shows any gap; the band is typed."""
    figures = [
        _typed("phase_awarded", "300000", phase=1, as_of=date(2026, 3, 2)),
        _typed("phase_awarded", "100000", phase=2),
        _typed("phase_awarded", "50000", phase=3),
        _typed("awarded", "460000"),
        _typed("budget", "500000", note="first board-approved budget"),
        _typed("phase_band_low", "51", phase=1),
        _typed("phase_band_high", "55", phase=1),
    ]
    row = committee_tables([], figures).phases[0]
    assert (row.year, row.basis) == (2026, "r")
    assert row.pct_of_budget == (Decimal("60.0"), Decimal("20.0"), Decimal("10.0"))
    assert row.share_of_phases == (Decimal("66.7"), Decimal("22.2"), Decimal("11.1"))
    assert row.reconciliation == Decimal(10000)
    assert (row.variance, row.side) == (Decimal(-40000), "under")
    assert row.phase_as_of[0] == date(2026, 3, 2)
    band = row.bands[0]
    assert band is not None
    assert (band.low, band.high, band.position) == (Decimal("255000.00"), Decimal("275000.00"), "above")
    assert row.bands[1] is None


def test_applications_split_at_the_cutoff_by_received_date_per_pool_and_in_total() -> None:
    """RPT-2 / RPT-6: received (cancelled included) by the cutoff, since, and the season's end."""
    rows = [r for r in committee_tables([SEASON], []).applications if r.basis == "P"]
    camp = next(r for r in rows if r.pool == "camp_pool")
    assert camp.at_cutoff is not None
    assert camp.since is not None
    assert camp.season_end is not None
    assert (camp.at_cutoff.apps, camp.at_cutoff.asked) == (2, Decimal(7000))
    assert (camp.since.apps, camp.since.asked) == (1, Decimal(2000))
    assert (camp.season_end.apps, camp.season_end.asked, camp.season_end.average) == (
        3,
        Decimal(9000),
        Decimal("3000.00"),
    )
    headline = next(r for r in rows if r.kind == "headline")
    assert headline.season_end is not None
    assert headline.at_cutoff is not None
    assert (headline.season_end.apps, headline.at_cutoff.apps, headline.unknown_received) == (4, 2, 1)


def test_typed_pools_that_dont_sum_to_the_headline_get_a_reconciliation_row() -> None:
    """RPT-6: typed years show "headline − Σ pools" (O-930-14), never a silent mismatch."""
    figures = [
        _typed("r1_apps", "40", pool="camp_pool", at="pull", as_of=date(2026, 2, 3)),
        _typed("r1_apps", "8", pool="weekend_pool", at="pull", as_of=date(2026, 2, 3)),
        _typed("r1_apps", "50", at="pull", as_of=date(2026, 2, 3)),
        _typed("r1_apps", "60"),
    ]
    rows = committee_tables([], figures).applications
    assert [r.kind for r in rows] == ["pool", "pool", "headline", "reconciliation"]  # the reconciliation sorts last
    gap = next(r for r in rows if r.kind == "reconciliation")
    assert gap.at_cutoff is not None
    assert gap.at_cutoff.apps == 2
    headline = next(r for r in rows if r.kind == "headline")
    assert headline.since is not None
    assert headline.since.apps == 10


def test_the_season_end_changes_against_the_season_before() -> None:
    figures = [_typed("r1_apps", "3", pool="camp_pool"), _typed("r1_asked", "8000", pool="camp_pool")]
    rows = committee_tables([SEASON], figures).applications
    camp = next(r for r in rows if r.year == 2027 and r.pool == "camp_pool")
    assert (camp.change_apps, camp.change_asked) == (0, Decimal(1000))


def test_budget_against_actuals_per_pool_with_shares_and_the_rules_split_as_reference() -> None:
    """RPT-7 / RPT-24: Allocated is the pool's whole allocation (all rounds); awarded counts in the round's pool."""
    rows = [r for r in committee_tables([SEASON], []).budget if r.basis == "P"]
    camp = next(r for r in rows if r.pool == "camp_pool")
    assert (camp.budget, camp.awarded) == (Decimal(400000), Decimal(2800))
    assert (camp.pct_of_budget, camp.pool_share, camp.rules_split_pct) == (Decimal("0.7"), Decimal("87.5"), Decimal(80))
    total = next(r for r in rows if r.kind == "headline")
    assert (total.budget, total.awarded, total.side) == (Decimal(500000), Decimal(3200), "under")
    assert total.pool_share is None


def test_typed_budget_rows_carry_finances_note() -> None:
    rows = committee_tables(
        [], [_typed("budget", "500000", note="first board-approved budget"), _typed("awarded", "520000")]
    ).budget
    assert len(rows) == 1
    assert (rows[0].variance, rows[0].side, rows[0].note) == (Decimal(20000), "over", "first board-approved budget")


def test_appeals_and_the_rate_count_every_received_request() -> None:
    """RPT-8: applications = season-end requests, cancelled included; appeals = any Round 2+ ask."""
    tables = committee_tables([SEASON], [_typed("r1_apps", "50"), _typed("appeals", "10")])
    p = next(r for r in tables.appeals if r.basis == "P")
    assert (p.applications, p.appeals, p.rate) == (4, 1, Decimal("25.0"))
    r = next(r for r in tables.appeals if r.basis == "r")
    assert (r.year, r.applications, r.appeals, r.rate) == (2026, 50, 10, Decimal("20.0"))


def test_round_1_percent_of_ask_is_live_awards_over_live_asks() -> None:
    """RPT-13, end of season."""
    rows = [r for r in committee_tables([SEASON], []).round1_pct if r.basis == "P"]
    camp = next(r for r in rows if r.pool == "camp_pool")
    assert (camp.awarded, camp.asked, camp.pct_of_ask) == (Decimal(2500), Decimal(6000), Decimal("41.7"))
    every = rows[-1]
    assert (every.pool, every.awarded, every.asked) == (None, Decimal(2900), Decimal(7000))


def test_round_1_percent_of_ask_leaves_an_outside_budget_round_out_of_its_denominator() -> None:
    """Owner (c), RULED 2026-10-02: a D121 full-cost outside-funder round is never awarded, so its ask is not in RPT-13's
    denominator; `asked` still shows it."""
    season = _season(
        req("reqemma00000001", rnd(1, ask="4000", posted="1500"), received_at=EARLY),
        req("reqliam00000001", rnd(1, ask="3000", outside_budget=True), household=1000002, received_at=EARLY),
    )
    rows = [r for r in committee_tables([season], []).round1_pct if r.basis == "P"]
    camp = next(r for r in rows if r.pool == "camp_pool")
    assert (camp.awarded, camp.asked, camp.asked_in_budget, camp.pct_of_ask) == (
        Decimal(1500),
        Decimal(7000),
        Decimal(4000),
        Decimal("37.5"),
    )
    headline = rows[-1]
    assert (headline.asked, headline.asked_in_budget, headline.pct_of_ask) == (
        Decimal(7000),
        Decimal(4000),
        Decimal("37.5"),
    )


def test_a_typed_round_1_row_divides_by_its_typed_ask() -> None:
    row = committee_tables([], [_typed("r1_awarded", "100"), _typed("r1_asked", "400")]).round1_pct[0]
    assert (row.asked, row.asked_in_budget, row.pct_of_ask) == (Decimal(400), Decimal(400), Decimal("25.0"))


def test_rows_run_by_season_typed_before_priced() -> None:
    tables = committee_tables([SEASON], [_typed("awarded", "460000"), _typed("awarded", "400000", year=2025)])
    assert [(r.year, r.basis) for r in tables.phases] == [(2025, "r"), (2026, "r"), (2027, "P")]


def test_a_request_with_no_pool_gets_a_no_pool_row_so_the_pool_rows_sum_to_the_headline() -> None:
    """RPT-2 / RPT-13: the budget table already names a no-pool row; applications and Round 1 % must too."""
    season = _season(
        req("reqemma00000001", rnd(1, ask="4000", posted="1500"), received_at=EARLY),
        req(
            "reqliam00000001",
            rnd(1, ask="2000", posted="1000", pool=None),
            household=1000002,
            pool=None,
            received_at=EARLY,
        ),
    )
    tables = committee_tables([season], [])
    apps = [r for r in tables.applications if r.basis == "P"]
    parts = [r for r in apps if r.kind in ("pool", "no_pool")]
    headline = next(r for r in apps if r.kind == "headline")
    assert [r.kind for r in parts] == ["pool", "no_pool"]
    assert sum(r.season_end.apps or 0 for r in parts if r.season_end) == headline.season_end.apps == 2  # type: ignore[union-attr]
    pct_rows = [r for r in tables.round1_pct if r.basis == "P"]
    nopool = next(r for r in pct_rows if r.kind == "no_pool")
    assert (nopool.pool, nopool.awarded, nopool.asked) == (None, Decimal(1000), Decimal(2000))
    headline_pct = next(r for r in pct_rows if r.kind == "headline")
    assert (
        sum((r.awarded or Decimal(0) for r in pct_rows if r.kind in ("pool", "no_pool")), Decimal(0))
        == headline_pct.awarded
    )


def test_the_cutoff_is_strict_less_than_on_the_boundary_instant() -> None:
    """RPT-2: received before the cutoff instant counts at the cutoff; received at it is since."""
    season = _season(
        req("reqemma00000001", rnd(1, ask="4000"), received_at=CUTOFF - timedelta(seconds=1)),
        req("reqliam00000001", rnd(1, ask="2000"), household=1000002, received_at=CUTOFF),
    )
    headline = next(r for r in committee_tables([season], []).applications if r.kind == "headline")
    assert headline.at_cutoff is not None
    assert headline.since is not None
    assert (headline.at_cutoff.apps, headline.since.apps) == (1, 1)


def test_the_budget_and_cancelled_recipients_use_the_rounds_lock_pool_not_the_home_pool() -> None:
    """A request whose home pool is camp but whose round locked in the weekend pool counts money in the weekend pool."""
    season = _season(req("reqemma00000001", rnd(1, ask="4000", posted="1500", pool="weekend_pool"), pool="camp_pool"))
    budget = {r.pool: r.awarded for r in committee_tables([season], []).budget if r.basis == "P" and r.kind == "pool"}
    assert budget.get("weekend_pool") == Decimal(1500)
    assert budget.get("camp_pool", Decimal(0)) == Decimal(0)


# --- Task A6b: the frozen received-by asks (D155) ----------------------------------------------------------------


def test_the_at_cutoff_asks_are_the_frozen_ones_and_the_season_end_the_live_ones() -> None:
    """D155: the snapshot counts the same requests; their Round 1 asks are the ones the cutoff day had."""
    emma = SEASON.requests[0]
    then = replace(emma, rounds=tuple(replace(f, ask=Decimal(3500)) if f.round == 1 else f for f in emma.rounds))
    season = replace(SEASON, cutoff_requests=(then,), asks_basis="as_of_cutoff")
    camp = next(r for r in committee_tables([season], []).applications if r.basis == "P" and r.pool == "camp_pool")
    assert camp.at_cutoff is not None
    assert camp.season_end is not None
    assert (camp.at_cutoff.apps, camp.at_cutoff.asked) == (2, Decimal(6500))  # Emma 3,500 then + Noah 3,000
    assert camp.season_end.asked == Decimal(9000)  # the season's end keeps asks as they stand
    assert (camp.asks_basis, camp.asks_reason) == ("as_of_cutoff", None)


# --- Task A10 (RULED, D155): the phase boundary ----------------------------------------------------------------


def test_with_the_boundary_set_round_1_splits_by_received_date_at_the_deadline() -> None:
    """O-930-10, the plan's recommended boundary: phase 1 is Round 1 awarded on requests received by the application
    deadline, phase 2 on those received after it; a request with no received date is in neither, so the
    reconciliation line shows it."""
    season = replace(SEASON, deadline_instant=CUTOFF)
    row = native_phases(season, None, boundary="received_by_deadline")
    # Emma (by the deadline) 1,500; Liam (after) 1,000; Olivia (no received date) 400 sits in the gap.
    assert row.phases == (Decimal(1500), Decimal(1000), Decimal(300))
    assert row.reconciliation == Decimal(400)
    assert row.gaps == ()


def test_without_the_boundary_phases_1_and_2_stay_empty() -> None:
    row = native_phases(replace(SEASON, deadline_instant=CUTOFF), None, boundary=None)
    assert row.phases[:2] == (None, None)
    assert row.gaps == (PHASE_BOUNDARY_GAP,)


def test_an_on_time_request_posted_later_stays_in_phase_1() -> None:
    """D155: the cut is the received date, never the posting date. Emma was received before the deadline; her Round 1
    posted on April 20, well after the bulk posting, and still counts in phase 1."""
    late_post = req(
        "reqemma00000002", rnd(1, ask="4000", posted="1500", posted_on=date(2027, 4, 20)), received_at=EARLY
    )
    row = native_phases(replace(_season(late_post), deadline_instant=CUTOFF), None, boundary="received_by_deadline")
    assert row.phases[:2] == (Decimal(1500), Decimal(0))


def test_a_season_with_no_deadline_cut_leaves_phases_1_and_2_blank_never_zero() -> None:
    """No received dates (a P season before 2027, D138) or no deadline: phases 1 and 2 are blank and named."""
    row = native_phases(SEASON, None, boundary="received_by_deadline")  # SEASON has no deadline_instant
    assert row.phases[:2] == (None, None)
    assert row.gaps == (NO_DEADLINE_CUT_GAP,)


def test_a_typed_season_with_no_phase_figures_shows_them_blank() -> None:
    """S1 Q2: 2022 gets phase figures if the deck has them, else blank: no 0, no reconciliation, no band."""
    row = committee_tables([], [_typed("awarded", "300000", year=2022), _typed("budget", "400000", year=2022)]).phases[
        0
    ]
    assert (row.year, row.basis) == (2022, "r")
    assert row.phases == (None, None, None)
    assert (row.share_of_phases, row.reconciliation) == ((None, None, None), None)
    assert row.total_pct_of_budget == Decimal("75.0")


def test_a_budget_met_to_the_dollar_reads_on() -> None:
    rows = committee_tables([], [_typed("budget", "500000"), _typed("awarded", "500000")]).budget
    assert (rows[0].variance, rows[0].side) == (Decimal(0), "on")


def test_the_received_through_snapshot_counts_round_1_asks_only() -> None:
    """Owner 49 (RULED 2026-10-02): the snapshot is Round 1 (application) asks from applications received by the
    date; Round 2 and 3 asks (appeals) are excluded from it, not read "as they stand now"."""
    emma = req(
        "reqemma00000001", rnd(1, ask="4000", posted="1500"), rnd(2, ask="900"), rnd(3, ask="600"), received_at=EARLY
    )
    season = replace(SEASON, requests=(emma,), cutoff_requests=(emma,), asks_basis="as_of_cutoff")
    camp = next(r for r in committee_tables([season], []).applications if r.basis == "P" and r.pool == "camp_pool")
    assert camp.at_cutoff is not None
    assert (camp.at_cutoff.apps, camp.at_cutoff.asked, camp.at_cutoff.average) == (
        1,
        Decimal(4000),
        Decimal("4000.00"),
    )

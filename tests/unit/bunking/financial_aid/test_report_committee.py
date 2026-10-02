"""The committee's year-over-year tables (clean spec §9.7 RPT-1, RPT-2, RPT-6, RPT-7, RPT-8, RPT-13, RPT-24): a
priced season (P) beside finance's typed history (r). Fictional rules (budget 500,000: camp 80%, weekends 15%,
b'mitzvah 5%), families and figures only."""

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal

from bunking.financial_aid.reports.committee import (
    PHASE_BOUNDARY_GAP,
    NativeSeason,
    committee_tables,
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


def test_a_priced_seasons_phase_row_has_appeals_and_the_total_but_waits_for_the_boundary() -> None:
    """RPT-1: phases 1 and 2 need O-930-10's boundary; appeals and the total don't."""
    row = next(r for r in committee_tables([SEASON], []).phases if r.basis == "P")
    assert row.phases == (None, None, Decimal(300))
    assert row.total == Decimal(3200)  # 1,500 + 300 + 1,000 + 400; the cancelled 900 is out (D129)
    assert (row.budget, row.variance, row.side) == (Decimal(500000), Decimal(-496800), "under")
    assert row.total_pct_of_budget == Decimal("0.6")
    assert row.reconciliation is None
    assert row.share_of_phases == (None, None, None)
    assert row.gaps == (PHASE_BOUNDARY_GAP,)


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


def test_rows_run_by_season_typed_before_priced() -> None:
    tables = committee_tables([SEASON], [_typed("awarded", "460000"), _typed("awarded", "400000", year=2025)])
    assert [(r.year, r.basis) for r in tables.phases] == [(2025, "r"), (2026, "r"), (2027, "P")]

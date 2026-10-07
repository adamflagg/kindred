"""Last year's arrival curve and the projection (Scenarios addendum §S11.7). The anchor is a
deadline of Wed 2026-02-04; eight arrivals fall in weeks −3 (1), −2 (1), −1 (3) and 0 (3), so the cumulative shares at
the weeks' ends are 0.125, 0.25, 0.625 and 1."""

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal

from api.services.camp_calendar import camp_week_offset
from bunking.financial_aid.arrival import (
    ArrivalCurve,
    CurvePoint,
    calendar_anchor,
    camp_date_of,
    curve_from_dates,
    points_from_json,
    points_json,
    project,
    share_by,
)
from bunking.financial_aid.scenarios import PoolResult, ScenarioResults

DEADLINE = date(2026, 2, 4)
DAYS = [
    date(2026, 1, 20),  # −15 days: week −3
    date(2026, 1, 21),  # −14: week −2
    date(2026, 1, 28),  # −7: week −1
    date(2026, 1, 29),
    date(2026, 2, 3),  # −1: week −1
    date(2026, 2, 4),  # the deadline day: week 0
    date(2026, 2, 4),
    date(2026, 2, 10),  # +6: still week 0
]
CURVE = curve_from_dates(DAYS, DEADLINE, year=2026, source="workbook")


def test_weeks_are_camp_week_offset_signed_and_zero_on_the_deadline_day() -> None:
    assert [
        camp_week_offset(day, DEADLINE)
        for day in (date(2026, 1, 28), date(2026, 2, 3), date(2026, 2, 4), date(2026, 2, 10), date(2026, 2, 11))
    ] == [
        -1,
        -1,
        0,
        0,
        1,
    ]


def test_points_are_cumulative_shares_at_each_weeks_end_from_the_first_arrival_to_the_last() -> None:
    assert CURVE.points == (
        CurvePoint(-3, Decimal("0.1250")),
        CurvePoint(-2, Decimal("0.2500")),
        CurvePoint(-1, Decimal("0.6250")),
        CurvePoint(0, Decimal("1.0000")),
    )
    assert (CURVE.counted, CURVE.anchor, CURVE.aligned_on, CURVE.source) == (
        8,
        DEADLINE,
        "application_deadline",
        "workbook",
    )


def test_the_share_is_interpolated_by_day_within_the_week() -> None:
    # The deadline day is day 0 of week 0: 0.625 + (1 − 0.625) × 1/7 = 0.67857… → 0.6786.
    assert share_by(CURVE, DEADLINE, DEADLINE) == Decimal("0.6786")
    # The day before is day 6 of week −1: the whole of that week, 0.625.
    assert share_by(CURVE, date(2026, 2, 3), DEADLINE) == Decimal("0.6250")
    # Day 0 of week −3: 0 + 0.125 × 1/7 = 0.017857… → 0.0179.
    assert share_by(CURVE, date(2026, 1, 14), DEADLINE) == Decimal("0.0179")


def test_zero_before_the_first_point_is_no_share_and_one_after_the_last() -> None:
    assert share_by(CURVE, date(2026, 1, 1), DEADLINE) is None  # nothing can be divided by 0
    assert share_by(CURVE, date(2026, 3, 1), DEADLINE) == Decimal("1.0000")


def test_a_stored_curve_with_gaps_reads_the_newest_point_at_or_before_each_week() -> None:
    flat = ArrivalCurve(
        2026,
        "application_deadline",
        DEADLINE,
        (CurvePoint(-60, Decimal("0.5")), CurvePoint(10, Decimal(1))),
        10,
        "workbook",
    )
    assert share_by(flat, date(2027, 1, 20), date(2027, 2, 3)) == Decimal("0.5000")


def test_a_calendar_curve_is_read_by_calendar_date_for_any_season() -> None:
    """Disagreement 8: a year with no deadline lines up from Jan 1; another season reads it from its own Jan 1."""
    calendar = curve_from_dates(DAYS, calendar_anchor(2026), year=2026, source="workbook", aligned_on="calendar")
    assert calendar.anchor == date(2026, 1, 1)
    assert share_by(calendar, date(2027, 1, 29), calendar_anchor(2027)) == share_by(
        calendar, date(2026, 1, 29), date(2026, 1, 1)
    )


def test_a_workbook_moment_counts_on_its_camp_day_across_the_dst_switch() -> None:
    """Review Focus 4: a naive cell is Pacific wall-clock time; the camp day turns at 9 am Pacific. PDT began on
    Sunday 2026-03-08."""
    assert camp_date_of(datetime(2026, 3, 8, 8, 30)) == date(2026, 3, 7)
    assert camp_date_of(datetime(2026, 3, 8, 9, 0)) == date(2026, 3, 8)
    assert camp_date_of(datetime(2026, 3, 7, 8, 59)) == date(2026, 3, 6)
    # A log row's UTC moment: 16:59 UTC is 9:59 PDT (Mar 8); 15:59 UTC is 8:59 PDT (Mar 7).
    assert camp_date_of(datetime(2026, 3, 8, 16, 59, tzinfo=UTC)) == date(2026, 3, 8)
    assert camp_date_of(datetime(2026, 3, 8, 15, 59, tzinfo=UTC)) == date(2026, 3, 7)


def _results() -> ScenarioResults:
    pool = PoolResult(
        pool="camp_pool",
        label="Camp",
        round1=Decimal(2600),
        round2=Decimal(300),
        round3=Decimal(0),
        round1_allocated=Decimal(400000),
        round1_remaining=None,
        remaining=None,
        round1_unmet=Decimal(0),
    )
    empty = pool.model_copy(
        update={
            "pool": "weekend_pool",
            "label": "Weekends",
            "round1": Decimal(0),
            "round2": Decimal(0),
            "round1_allocated": Decimal(75000),
        }
    )
    return ScenarioResults(
        requests=3,
        families=3,
        round1=Decimal(2600),
        round2=Decimal(300),
        round3=Decimal(0),
        round1_allocated=Decimal(500000),
        round1_remaining=None,
        remaining=None,
        at_minimum=0,
        held=0,
        held_asked=Decimal(0),
        round1_unmet=Decimal(0),
        pools=[pool, empty],
        by_tier=[],
    )


def test_project_divides_every_figure_by_the_share_to_the_cent() -> None:
    """§S11.7 at a share of 0.4: requests 3 ÷ 0.4 = 7.5 → 8 (half up); Round 1 2,600 ÷ 0.4 = 6,500; Round 1 + 2 2,900
    ÷ 0.4 = 7,250; Remaining 500,000 − 7,250 = 492,750; Camp 400,000 − 7,250 = 392,750; Weekends 75,000 − 0."""
    projected = project(
        _results(), Decimal("0.4"), through=DEADLINE, basis_year=2026, aligned_on="application_deadline"
    )
    assert (projected.requests, projected.round1, projected.round1_and_2, projected.remaining) == (
        8,
        Decimal("6500.00"),
        Decimal("7250.00"),
        Decimal("492750.00"),
    )
    assert [(p.pool, p.remaining) for p in projected.pools] == [
        ("camp_pool", Decimal("392750.00")),
        ("weekend_pool", Decimal("75000.00")),
    ]


def test_project_rounds_each_figure_half_up_to_the_cent() -> None:
    one_thousand = _results().model_copy(update={"round1": Decimal(1000), "round2": Decimal(0)})
    assert project(
        one_thousand, Decimal("0.3"), through=DEADLINE, basis_year=2026, aligned_on="calendar"
    ).round1 == Decimal("3333.33")
    assert project(
        one_thousand, Decimal("0.6"), through=DEADLINE, basis_year=2026, aligned_on="calendar"
    ).round1 == Decimal("1666.67")


def test_a_pool_with_no_allocation_has_no_projected_remaining() -> None:
    no_pool = _results().model_copy(update={"round1_allocated": None})
    assert project(no_pool, Decimal("0.5"), through=DEADLINE, basis_year=2026, aligned_on="calendar").remaining is None


def test_points_survive_their_json() -> None:
    assert points_from_json(points_json(CURVE)) == CURVE.points
    assert points_json(CURVE)[0] == {"week": -3, "share": "0.1250"}

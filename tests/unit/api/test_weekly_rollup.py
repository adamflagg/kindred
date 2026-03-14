"""Tests for weekly rollup derived from daily data points."""

from datetime import date

from api.schemas.velocity import DailyDataPoint
from api.services.velocity_service import rollup_daily_to_weekly


def _dp(
    date_str: str,
    day_offset: int,
    daily_new: int = 0,
    daily_cancelled: int = 0,
    gross_enrolled: int = 0,
    enrolled: int = 0,
    cancelled: int = 0,
    data_source: str = "reconstructed",
) -> DailyDataPoint:
    return DailyDataPoint(
        date=date_str,
        day_offset=day_offset,
        gross_enrolled=gross_enrolled,
        enrolled=enrolled,
        cancelled=cancelled,
        daily_new=daily_new,
        daily_cancelled=daily_cancelled,
        daily_new_boys=None,
        daily_new_girls=None,
        daily_cancelled_boys=None,
        daily_cancelled_girls=None,
        gross_enrolled_boys=None,
        gross_enrolled_girls=None,
        enrolled_boys=None,
        enrolled_girls=None,
        data_source=data_source,
    )


def test_rollup_single_full_week():
    """7 daily points become 1 weekly point."""
    daily = [
        _dp("2025-11-12", 0, daily_new=100, gross_enrolled=100, enrolled=100),
        _dp("2025-11-13", 1, daily_new=20, gross_enrolled=120, enrolled=120),
        _dp("2025-11-14", 2, daily_new=5, gross_enrolled=125, enrolled=125),
        _dp("2025-11-15", 3, daily_new=3, gross_enrolled=128, enrolled=128),
        _dp("2025-11-16", 4, daily_new=1, gross_enrolled=129, enrolled=129),
        _dp("2025-11-17", 5, daily_new=0, gross_enrolled=129, enrolled=129),
        _dp("2025-11-18", 6, daily_new=2, gross_enrolled=131, enrolled=131),
    ]
    season_start = date(2025, 11, 12)

    result = rollup_daily_to_weekly(daily, season_start)

    assert len(result) == 1
    wk = result[0]
    assert wk.week_number == 1
    assert wk.week_start == "2025-11-12"
    assert wk.week_end == "2025-11-18"
    assert wk.weekly_new == 131  # sum of daily_new
    assert wk.weekly_cancelled == 0
    assert wk.delta == 131
    assert wk.enrolled == 131  # last day's cumulative
    assert wk.gross_enrolled == 131
    assert wk.is_partial is False
    assert wk.days_in_week == 7


def test_rollup_partial_week():
    """Less than 7 days should be marked partial."""
    daily = [
        _dp("2025-11-12", 0, daily_new=100, gross_enrolled=100, enrolled=100),
        _dp("2025-11-13", 1, daily_new=20, gross_enrolled=120, enrolled=120),
        _dp("2025-11-14", 2, daily_new=5, gross_enrolled=125, enrolled=125),
    ]
    season_start = date(2025, 11, 12)

    result = rollup_daily_to_weekly(daily, season_start, is_current_year=True)

    assert len(result) == 1
    assert result[0].is_partial is True
    assert result[0].days_in_week == 3


def test_rollup_two_weeks():
    """14 daily points become 2 weekly points."""
    daily = []
    for i in range(14):
        d = date(2025, 11, 12 + i)
        daily.append(_dp(d.isoformat(), i, daily_new=10, gross_enrolled=10 * (i + 1), enrolled=10 * (i + 1)))
    season_start = date(2025, 11, 12)

    result = rollup_daily_to_weekly(daily, season_start)

    assert len(result) == 2
    assert result[0].week_number == 1
    assert result[1].week_number == 2
    assert result[0].weekly_new == 70  # 10 * 7
    assert result[1].weekly_new == 70


def test_rollup_week_label_format():
    """Week labels follow 'Wk N (Mon D–Mon D)' format."""
    daily = [_dp("2025-11-12", i, daily_new=1, gross_enrolled=i + 1, enrolled=i + 1) for i in range(7)]
    season_start = date(2025, 11, 12)

    result = rollup_daily_to_weekly(daily, season_start)

    # Same month: omit end month
    assert "Wk 1" in result[0].week_label
    assert "Nov 12" in result[0].week_label
    assert "18" in result[0].week_label


def test_rollup_week_label_cross_month():
    """Week crossing month boundary includes both month names."""
    # Week starting Nov 26, ending Dec 2
    daily = [
        _dp(
            date(2025, 11, 26 + i).isoformat() if 26 + i <= 30 else date(2025, 12, 26 + i - 30).isoformat(),
            14 + i,
            daily_new=1,
            gross_enrolled=i + 1,
            enrolled=i + 1,
        )
        for i in range(7)
    ]
    season_start = date(2025, 11, 12)

    result = rollup_daily_to_weekly(daily, season_start)

    assert "Nov" in result[0].week_label
    assert "Dec" in result[0].week_label


def test_rollup_mixed_data_source():
    """Mixed reconstructed + snapshot days produce 'mixed' data_source."""
    daily = [
        _dp("2025-11-12", 0, daily_new=100, gross_enrolled=100, enrolled=100, data_source="reconstructed"),
        _dp("2025-11-13", 1, daily_new=20, gross_enrolled=120, enrolled=120, data_source="reconstructed"),
        _dp("2025-11-14", 2, daily_new=5, gross_enrolled=125, enrolled=125, data_source="snapshot"),
        _dp("2025-11-15", 3, daily_new=3, gross_enrolled=128, enrolled=128, data_source="snapshot"),
        _dp("2025-11-16", 4, data_source="snapshot", gross_enrolled=128, enrolled=128),
        _dp("2025-11-17", 5, data_source="snapshot", gross_enrolled=128, enrolled=128),
        _dp("2025-11-18", 6, data_source="snapshot", gross_enrolled=128, enrolled=128),
    ]
    season_start = date(2025, 11, 12)

    result = rollup_daily_to_weekly(daily, season_start)

    assert result[0].data_source == "mixed"


def test_rollup_gender_fields():
    """Gender fields are summed for deltas, last-day for cumulatives."""
    daily = [
        DailyDataPoint(
            date="2025-11-12",
            day_offset=0,
            gross_enrolled=3,
            enrolled=3,
            cancelled=0,
            daily_new=3,
            daily_cancelled=0,
            daily_new_boys=None,
            daily_new_girls=None,
            daily_cancelled_boys=None,
            daily_cancelled_girls=None,
            gross_enrolled_boys=2,
            gross_enrolled_girls=1,
            enrolled_boys=2,
            enrolled_girls=1,
            data_source="reconstructed",
        ),
    ]
    season_start = date(2025, 11, 12)

    result = rollup_daily_to_weekly(daily, season_start, is_current_year=True)

    assert result[0].enrolled_boys == 2
    assert result[0].enrolled_girls == 1
    assert result[0].gross_enrolled_boys == 2
    assert result[0].gross_enrolled_girls == 1

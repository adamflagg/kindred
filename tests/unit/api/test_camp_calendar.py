"""Tests for camp_calendar — Pacific timezone camp-day boundary logic."""

from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

from api.services.camp_calendar import (
    CAMP_TZ,
    camp_day_offset,
    camp_week_offset,
    day1_window,
    get_camp_date,
    get_camp_today,
)


class TestGetCampDate:
    """get_camp_date converts a UTC datetime to its camp date."""

    def test_afternoon_pacific_same_day(self):
        """3pm Pacific (11pm UTC) → same camp date."""
        utc_dt = datetime(2026, 10, 15, 23, 0, 0, tzinfo=UTC)
        # 11pm UTC = 4pm PDT (Oct is still DST) → camp date Oct 15
        assert get_camp_date(utc_dt) == date(2026, 10, 15)

    def test_morning_after_9am_same_day(self):
        """10am Pacific → same camp date."""
        # 10am PST = 6pm UTC (Jan is PST, UTC-8)
        utc_dt = datetime(2026, 1, 15, 18, 0, 0, tzinfo=UTC)
        assert get_camp_date(utc_dt) == date(2026, 1, 15)

    def test_before_9am_pacific_previous_day(self):
        """7am Pacific → previous camp date."""
        # 7am PST = 3pm UTC
        utc_dt = datetime(2026, 1, 15, 15, 0, 0, tzinfo=UTC)
        assert get_camp_date(utc_dt) == date(2026, 1, 14)

    def test_exactly_9am_pacific_is_current_day(self):
        """9am Pacific → current camp date (boundary is inclusive)."""
        # 9am PST = 5pm UTC
        utc_dt = datetime(2026, 1, 15, 17, 0, 0, tzinfo=UTC)
        assert get_camp_date(utc_dt) == date(2026, 1, 15)

    def test_midnight_utc_is_afternoon_pacific_previous_day(self):
        """Midnight UTC = 4pm PST previous day → previous camp date."""
        utc_dt = datetime(2026, 1, 15, 0, 0, 0, tzinfo=UTC)
        # midnight UTC = 4pm PST Jan 14 → camp date Jan 14
        assert get_camp_date(utc_dt) == date(2026, 1, 14)

    def test_dst_transition_spring(self):
        """During PDT (summer), 8am Pacific = 3pm UTC → previous camp date."""
        # March 15 is PDT (UTC-7), 8am PDT = 3pm UTC
        utc_dt = datetime(2026, 3, 15, 15, 0, 0, tzinfo=UTC)
        assert get_camp_date(utc_dt) == date(2026, 3, 14)

    def test_3am_utc_sync_time(self):
        """3am UTC (daily sync) = 7pm PST previous day → previous camp date."""
        utc_dt = datetime(2026, 1, 15, 3, 0, 0, tzinfo=UTC)
        # 3am UTC = 7pm PST Jan 14 → camp date Jan 14
        assert get_camp_date(utc_dt) == date(2026, 1, 14)

    def test_5pm_utc_targeted_sync(self):
        """5pm UTC (targeted sync) = 9am PST → current camp date."""
        utc_dt = datetime(2026, 1, 15, 17, 0, 0, tzinfo=UTC)
        # 5pm UTC = 9am PST Jan 15 → camp date Jan 15
        assert get_camp_date(utc_dt) == date(2026, 1, 15)

    def test_naive_datetime_treated_as_utc(self):
        """Naive datetime (no tzinfo) should be treated as UTC."""
        naive_dt = datetime(2026, 1, 15, 18, 0, 0)
        assert get_camp_date(naive_dt) == date(2026, 1, 15)


class TestGetCampToday:
    """get_camp_today returns the current camp date."""

    def test_returns_date(self):
        result = get_camp_today()
        assert isinstance(result, date)


class TestCampDayOffset:
    """camp_day_offset computes days between anchor and camp date."""

    def test_same_day(self):
        assert camp_day_offset(date(2026, 10, 15), date(2026, 10, 15)) == 0

    def test_one_week_later(self):
        assert camp_day_offset(date(2026, 10, 22), date(2026, 10, 15)) == 7

    def test_before_anchor(self):
        assert camp_day_offset(date(2026, 10, 14), date(2026, 10, 15)) == -1


class TestCampWeekOffset:
    """camp_week_offset computes weeks from anchor."""

    def test_week_zero(self):
        assert camp_week_offset(date(2026, 10, 15), date(2026, 10, 15)) == 0

    def test_day_6_still_week_zero(self):
        assert camp_week_offset(date(2026, 10, 21), date(2026, 10, 15)) == 0

    def test_day_7_is_week_one(self):
        assert camp_week_offset(date(2026, 10, 22), date(2026, 10, 15)) == 1

    def test_day_20_is_week_two(self):
        assert camp_week_offset(date(2026, 11, 4), date(2026, 10, 15)) == 2


class TestDay1Window:
    """day1_window computes 9am-9am PT windows for tier opening dates."""

    def test_day1_window_basic(self):
        """Priority reg Nov 12 2025 should give 9am-9am PT window."""
        start, end = day1_window(date(2025, 11, 12))
        assert start == datetime(2025, 11, 12, 9, 0, tzinfo=CAMP_TZ)
        assert end == datetime(2025, 11, 13, 9, 0, tzinfo=CAMP_TZ)

    def test_day1_window_dst_boundary(self):
        """March date spanning DST transition should use correct PT offset."""
        # March 8, 2025: 9am PST; March 9 9am is PDT (DST springs at 2am March 9).
        # 9am PST (UTC-8) → 17:00 UTC; 9am PDT (UTC-7) → 16:00 UTC = 23h apart.
        start, end = day1_window(date(2025, 3, 8))
        assert start.tzinfo == CAMP_TZ
        assert end.tzinfo == CAMP_TZ
        start_utc = start.astimezone(ZoneInfo("UTC"))
        end_utc = end.astimezone(ZoneInfo("UTC"))
        diff_hours = (end_utc - start_utc).total_seconds() / 3600
        assert diff_hours == 23.0  # DST spring forward: 9am PST → 9am PDT = 23h

    def test_day1_window_november_pst(self):
        """November dates should be PST (UTC-8)."""
        start, end = day1_window(date(2025, 11, 12))
        start_utc = start.astimezone(ZoneInfo("UTC"))
        assert start_utc.hour == 17  # 9am PST = 5pm UTC

"""Tests for get_week_options in ForecastService.

Week options generate a list of Week 1 through today from the registration
anchor date with 1-based numbering, date ranges, and tier suffixes.
Used for rekeying the forecast page from calendar-date snapshots to
week-relative offsets.
"""

from datetime import date
from unittest.mock import AsyncMock

import pytest

from api.schemas.forecast import WeekOption
from api.services.forecast_service import ForecastService


@pytest.fixture
def mock_repository():
    """Create a mock MetricsRepository with default empty returns."""
    repo = AsyncMock()
    repo.fetch_registration_dates = AsyncMock(return_value={})
    repo.has_pre_anchor_enrollments = AsyncMock(return_value=False)
    return repo


@pytest.fixture
def service(mock_repository):
    """Create a ForecastService with mock repository."""
    return ForecastService(mock_repository)


class TestWeekOptionModel:
    """Test WeekOption Pydantic model construction."""

    def test_week_option_fields(self):
        """WeekOption can be constructed with all required fields."""
        opt = WeekOption(
            week_number=5,
            day_offset=37,
            label="Week 5 · Nov 19",
            is_today=False,
        )
        assert opt.week_number == 5
        assert opt.day_offset == 37
        assert opt.label == "Week 5 · Nov 19"
        assert opt.is_today is False


class TestWeekOptionsEmpty:
    """Test edge cases that return empty lists."""

    @pytest.mark.asyncio
    async def test_empty_when_no_reg_dates(self, service, mock_repository):
        """No registration dates configured returns empty list."""
        mock_repository.fetch_registration_dates.return_value = {}

        result = await service.get_week_options(year=2026, today=date(2026, 3, 10))

        assert result == []

    @pytest.mark.asyncio
    async def test_before_priority_reg_returns_empty(self, service, mock_repository):
        """Today before anchor date returns empty list."""
        mock_repository.fetch_registration_dates.return_value = {
            "priority_reg_date": "2025-10-15",
        }

        result = await service.get_week_options(year=2026, today=date(2025, 10, 1))

        assert result == []


class TestWeekOptionsBasic:
    """Test basic week option generation."""

    @pytest.mark.asyncio
    async def test_week_1_is_priority_reg(self, service, mock_repository):
        """Week 1 exists and has '(Priority Reg)' suffix in label."""
        mock_repository.fetch_registration_dates.return_value = {
            "priority_reg_date": "2025-10-15",
        }

        # 10 days after anchor — within Week 2, so Today + Week 2 + Week 1
        result = await service.get_week_options(year=2026, today=date(2025, 10, 25))

        # Week 1 should be in the list with Priority Reg suffix
        week_1 = [o for o in result if o.week_number == 1 and not o.is_today]
        assert len(week_1) == 1
        assert "(Priority Reg)" in week_1[0].label

    @pytest.mark.asyncio
    async def test_today_is_first_entry(self, service, mock_repository):
        """Today is always the first entry in the list, with is_today=True."""
        mock_repository.fetch_registration_dates.return_value = {
            "priority_reg_date": "2025-10-15",
        }

        result = await service.get_week_options(year=2026, today=date(2025, 11, 19))

        assert len(result) > 0
        assert result[0].is_today is True

    @pytest.mark.asyncio
    async def test_today_uses_exact_day_offset(self, service, mock_repository):
        """Today's day_offset is exact days since anchor, not snapped to week."""
        mock_repository.fetch_registration_dates.return_value = {
            "priority_reg_date": "2025-10-15",  # Wednesday
        }

        # 37 days after anchor (Oct 15 + 37 = Nov 21)
        today = date(2025, 11, 21)
        result = await service.get_week_options(year=2026, today=today)

        today_entry = result[0]
        assert today_entry.is_today is True
        assert today_entry.day_offset == 37  # exact days, not 35 (5*7)

    @pytest.mark.asyncio
    async def test_weekly_entries_between_week1_and_today(self, service, mock_repository):
        """Correct count and ordering of weekly entries between Week 1 and today."""
        mock_repository.fetch_registration_dates.return_value = {
            "priority_reg_date": "2025-10-15",  # Wednesday
        }

        # 23 days after anchor (mid-Week 4 in 1-based: 23 // 7 + 1 = 4)
        # Oct 15 + 23 days = Nov 7
        today = date(2025, 11, 7)
        result = await service.get_week_options(year=2026, today=today)

        # Today (day 23, mid-week 4) + Week 3 + Week 2 + Week 1 = 4 entries
        # Week 4 boundary not included separately; today IS week 4
        assert len(result) == 4

        # First is today (newest)
        assert result[0].is_today is True

        # Then descending completed week numbers (1-based)
        assert result[1].week_number == 3
        assert result[2].week_number == 2
        assert result[3].week_number == 1

        # All non-today entries have is_today=False
        for entry in result[1:]:
            assert entry.is_today is False

    @pytest.mark.asyncio
    async def test_today_on_week_boundary_no_duplicate(self, service, mock_repository):
        """When today falls exactly on a week boundary, no duplicate entry."""
        mock_repository.fetch_registration_dates.return_value = {
            "priority_reg_date": "2025-10-15",
        }

        # Exactly 21 days after anchor = Week 4 boundary (1-based: day 21 // 7 + 1 = 4)
        # Oct 15 + 21 = Nov 5
        today = date(2025, 11, 5)
        result = await service.get_week_options(year=2026, today=today)

        # Today IS Week 4, so: Today/Week4 + Week 3 + Week 2 + Week 1 = 4 entries
        assert len(result) == 4

        # Today entry should be labeled as its week AND marked is_today
        assert result[0].is_today is True
        assert result[0].week_number == 4
        assert result[0].day_offset == 21  # exact week boundary

        # No other entry should have week_number=4
        other_week4 = [o for o in result[1:] if o.week_number == 4]
        assert len(other_week4) == 0


class TestWeekOptionsFallback:
    """Test registration date fallback logic."""

    @pytest.mark.asyncio
    async def test_falls_back_to_early_reg_date(self, service, mock_repository):
        """Uses early_reg_date when priority_reg_date is missing."""
        mock_repository.fetch_registration_dates.return_value = {
            "early_reg_date": "2025-11-05",
        }

        # 10 days after early anchor
        today = date(2025, 11, 15)
        result = await service.get_week_options(year=2026, today=today)

        assert len(result) > 0
        # Week 1 should exist (1-based)
        week_1 = [o for o in result if o.week_number == 1]
        assert len(week_1) == 1

        # Day offset for today = 10
        assert result[0].is_today is True
        assert result[0].day_offset == 10


class TestWeekOptionsLabels:
    """Test label formatting."""

    @pytest.mark.asyncio
    async def test_today_label_includes_today_suffix(self, service, mock_repository):
        """Today's label includes 'Today'."""
        mock_repository.fetch_registration_dates.return_value = {
            "priority_reg_date": "2025-10-15",
        }

        result = await service.get_week_options(year=2026, today=date(2025, 10, 18))

        today_entry = result[0]
        assert "Today" in today_entry.label

    @pytest.mark.asyncio
    async def test_week_1_label_includes_priority_reg(self, service, mock_repository):
        """Week 1's label includes '(Priority Reg)'."""
        mock_repository.fetch_registration_dates.return_value = {
            "priority_reg_date": "2025-10-15",
        }

        # Far enough to have Week 1 as a separate entry
        result = await service.get_week_options(year=2026, today=date(2025, 11, 19))

        week_1_entries = [o for o in result if o.week_number == 1 and not o.is_today]
        assert len(week_1_entries) == 1
        assert "(Priority Reg)" in week_1_entries[0].label

    @pytest.mark.asyncio
    async def test_label_date_format(self, service, mock_repository):
        """Labels use 'Mon D' format (e.g., 'Oct 15', not 'Oct 05')."""
        mock_repository.fetch_registration_dates.return_value = {
            "priority_reg_date": "2025-10-15",
        }

        result = await service.get_week_options(year=2026, today=date(2025, 11, 3))

        # Week 1 label should contain "Oct 15" (1-based, anchor week)
        week_1 = next(o for o in result if o.week_number == 1)
        assert "Oct 15" in week_1.label


class TestWeekOptionsPastSeason:
    """Test that past seasons cap at SEASON_WEEKS instead of extending to today."""

    @pytest.mark.asyncio
    async def test_past_season_caps_at_season_weeks(self, service, mock_repository):
        """Past season (today > anchor + 41 weeks) caps week options at SEASON_WEEKS."""
        mock_repository.fetch_registration_dates.return_value = {
            "priority_reg_date": "2023-11-07",  # 2024 season anchor
        }

        # "Today" is far past the 2024 season end (41 weeks = 287 days after anchor)
        # 2023-11-07 + 287 = 2024-08-20 season end
        # Using 2026-03-24 as "today" — well past the season
        result = await service.get_week_options(year=2024, today=date(2026, 3, 24))

        # Should cap at SEASON_WEEKS, not extend to today
        assert len(result) > 0
        max_week = max(o.week_number for o in result)
        assert max_week == 41  # SEASON_WEEKS

    @pytest.mark.asyncio
    async def test_past_season_has_no_today_entry(self, service, mock_repository):
        """Past season should have no is_today=True entry."""
        mock_repository.fetch_registration_dates.return_value = {
            "priority_reg_date": "2023-11-07",
        }

        result = await service.get_week_options(year=2024, today=date(2026, 3, 24))

        today_entries = [o for o in result if o.is_today]
        assert len(today_entries) == 0

    @pytest.mark.asyncio
    async def test_past_season_first_entry_is_last_week(self, service, mock_repository):
        """Past season's first entry should be the final week (descending order)."""
        mock_repository.fetch_registration_dates.return_value = {
            "priority_reg_date": "2023-11-07",
        }

        result = await service.get_week_options(year=2024, today=date(2026, 3, 24))

        assert result[0].week_number == 41
        assert result[0].is_today is False

    @pytest.mark.asyncio
    async def test_past_season_total_entries_equals_season_weeks(self, service, mock_repository):
        """Past season returns exactly SEASON_WEEKS entries (Week 1 through 41)."""
        mock_repository.fetch_registration_dates.return_value = {
            "priority_reg_date": "2023-11-07",
        }

        result = await service.get_week_options(year=2024, today=date(2026, 3, 24))

        assert len(result) == 41
        # Verify descending order
        week_numbers = [o.week_number for o in result]
        assert week_numbers == list(range(41, 0, -1))

    @pytest.mark.asyncio
    async def test_current_season_still_has_today(self, service, mock_repository):
        """Current season (today within season window) still shows Today entry."""
        mock_repository.fetch_registration_dates.return_value = {
            "priority_reg_date": "2025-11-12",  # 2026 season anchor
        }

        # 19 weeks into the current season
        result = await service.get_week_options(year=2026, today=date(2026, 3, 24))

        today_entries = [o for o in result if o.is_today]
        assert len(today_entries) == 1

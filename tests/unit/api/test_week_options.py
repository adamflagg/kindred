"""Tests for get_week_options in ForecastService.

Week options generate a list of Week 0 through today from the registration
anchor date, independent of snapshot existence. Used for rekeying the forecast
page from calendar-date snapshots to week-relative offsets.
"""

from __future__ import annotations

import os
from datetime import date
from unittest.mock import AsyncMock

import pytest

os.environ["AUTH_MODE"] = "bypass"
os.environ["SKIP_PB_AUTH"] = "true"

from api.schemas.forecast import WeekOption
from api.services.forecast_service import ForecastService


@pytest.fixture
def mock_repository():
    """Create a mock MetricsRepository with default empty returns."""
    repo = AsyncMock()
    repo.fetch_registration_dates = AsyncMock(return_value={})
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
    async def test_week_0_is_priority_reg(self, service, mock_repository):
        """Week 0 exists and has '(Priority Reg)' suffix in label."""
        mock_repository.fetch_registration_dates.return_value = {
            "priority_reg_date": "2025-10-15",
        }

        # 3 days after anchor — within Week 0, so only Today + Week 0
        result = await service.get_week_options(year=2026, today=date(2025, 10, 18))

        # Week 0 should be in the list
        week_0 = [o for o in result if o.week_number == 0 and not o.is_today]
        assert len(week_0) == 1
        assert "(Priority Reg)" in week_0[0].label

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
    async def test_weekly_entries_between_week0_and_today(self, service, mock_repository):
        """Correct count and ordering of weekly entries between Week 0 and today."""
        mock_repository.fetch_registration_dates.return_value = {
            "priority_reg_date": "2025-10-15",  # Wednesday
        }

        # 21 days after anchor = exactly Week 3 boundary
        # But let's use 23 days (mid-Week 3) to not land on a boundary
        # Oct 15 + 23 days = Nov 7
        today = date(2025, 11, 7)
        result = await service.get_week_options(year=2026, today=today)

        # Today (day 23, week 3) + Week 3 + Week 2 + Week 1 + Week 0 = 5 entries
        # Wait: 23 days = 3 complete weeks + 2 days, so weeks 0,1,2,3 completed
        # Actually 23 // 7 = 3, so completed weeks are 0, 1, 2 (week 3 is in progress)
        # Today (mid-week 3) + Week 2 + Week 1 + Week 0 = 4 entries
        assert len(result) == 4

        # First is today (newest)
        assert result[0].is_today is True

        # Then descending week numbers
        assert result[1].week_number == 2
        assert result[2].week_number == 1
        assert result[3].week_number == 0

        # All non-today entries have is_today=False
        for entry in result[1:]:
            assert entry.is_today is False

    @pytest.mark.asyncio
    async def test_today_on_week_boundary_no_duplicate(self, service, mock_repository):
        """When today falls exactly on a week boundary, no duplicate entry."""
        mock_repository.fetch_registration_dates.return_value = {
            "priority_reg_date": "2025-10-15",
        }

        # Exactly 21 days after anchor = Week 3 boundary
        # Oct 15 + 21 = Nov 5
        today = date(2025, 11, 5)
        result = await service.get_week_options(year=2026, today=today)

        # Today IS Week 3, so: Today/Week3 + Week 2 + Week 1 + Week 0 = 4 entries
        assert len(result) == 4

        # Today entry should be labeled as its week AND marked is_today
        assert result[0].is_today is True
        assert result[0].week_number == 3
        assert result[0].day_offset == 21  # exact week boundary

        # No other entry should have week_number=3
        other_week3 = [o for o in result[1:] if o.week_number == 3]
        assert len(other_week3) == 0


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
        # Week 0 should exist
        week_0 = [o for o in result if o.week_number == 0]
        assert len(week_0) == 1

        # Day offset for today = 10
        assert result[0].is_today is True
        assert result[0].day_offset == 10


class TestWeekOptionsLabels:
    """Test label formatting."""

    @pytest.mark.asyncio
    async def test_today_label_includes_today_suffix(self, service, mock_repository):
        """Today's label ends with '(Today)'."""
        mock_repository.fetch_registration_dates.return_value = {
            "priority_reg_date": "2025-10-15",
        }

        result = await service.get_week_options(year=2026, today=date(2025, 10, 18))

        today_entry = result[0]
        assert "(Today)" in today_entry.label

    @pytest.mark.asyncio
    async def test_week_0_label_includes_priority_reg(self, service, mock_repository):
        """Week 0's label ends with '(Priority Reg)'."""
        mock_repository.fetch_registration_dates.return_value = {
            "priority_reg_date": "2025-10-15",
        }

        # Far enough to have Week 0 as a separate entry
        result = await service.get_week_options(year=2026, today=date(2025, 11, 19))

        week_0_entries = [o for o in result if o.week_number == 0 and not o.is_today]
        assert len(week_0_entries) == 1
        assert "(Priority Reg)" in week_0_entries[0].label

    @pytest.mark.asyncio
    async def test_label_date_format(self, service, mock_repository):
        """Labels use 'Mon D' format (e.g., 'Oct 15', not 'Oct 05')."""
        mock_repository.fetch_registration_dates.return_value = {
            "priority_reg_date": "2025-10-15",
        }

        result = await service.get_week_options(year=2026, today=date(2025, 11, 3))

        # Week 0 label should contain "Oct 15"
        week_0 = next(o for o in result if o.week_number == 0)
        assert "Oct 15" in week_0.label

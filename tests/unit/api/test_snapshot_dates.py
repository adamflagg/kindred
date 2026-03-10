"""Tests for snapshot date filtering logic.

Snapshot dates should be filtered to:
1. The registration anchor date (priority_reg_date or early_reg_date)
2. Every subsequent Monday after that
3. Capped at July 31 of the camp year
4. Only dates that have actual snapshot data in the database
"""

from __future__ import annotations

import os
from unittest.mock import AsyncMock

import pytest

os.environ["AUTH_MODE"] = "bypass"
os.environ["SKIP_PB_AUTH"] = "true"

from api.services.forecast_service import ForecastService


@pytest.fixture
def mock_repository():
    repo = AsyncMock()
    repo.fetch_registration_dates = AsyncMock(return_value={})
    repo.fetch_available_snapshot_dates = AsyncMock(return_value=[])
    return repo


@pytest.fixture
def service(mock_repository):
    return ForecastService(mock_repository)


class TestSnapshotDateFiltering:
    """Test that snapshot dates are filtered to anchor + Mondays."""

    @pytest.mark.asyncio
    async def test_filters_to_anchor_and_mondays(self, service, mock_repository):
        """Given priority_reg_date on a Wednesday, return that Wed + subsequent Mondays."""
        mock_repository.fetch_registration_dates.return_value = {
            "priority_reg_date": "2025-10-15",  # Wednesday
        }
        mock_repository.fetch_available_snapshot_dates.return_value = [
            "2025-10-27",  # Mon
            "2025-10-26",  # Sun
            "2025-10-25",  # Sat
            "2025-10-24",  # Fri
            "2025-10-23",  # Thu
            "2025-10-22",  # Wed
            "2025-10-21",  # Tue
            "2025-10-20",  # Mon
            "2025-10-19",  # Sun
            "2025-10-18",  # Sat
            "2025-10-17",  # Fri
            "2025-10-16",  # Thu
            "2025-10-15",  # Wed (anchor)
        ]

        result = await service.get_filtered_snapshot_dates(2026)

        assert result == [
            "2025-10-27",  # Mon
            "2025-10-20",  # Mon
            "2025-10-15",  # Anchor (Wed)
        ]

    @pytest.mark.asyncio
    async def test_anchor_on_monday_included(self, service, mock_repository):
        """If anchor is a Monday, it appears as both anchor and Monday."""
        mock_repository.fetch_registration_dates.return_value = {
            "priority_reg_date": "2025-10-20",  # Monday
        }
        mock_repository.fetch_available_snapshot_dates.return_value = [
            "2025-10-27",
            "2025-10-26",
            "2025-10-25",
            "2025-10-24",
            "2025-10-23",
            "2025-10-22",
            "2025-10-21",
            "2025-10-20",
        ]

        result = await service.get_filtered_snapshot_dates(2026)

        assert result == [
            "2025-10-27",  # Mon
            "2025-10-20",  # Mon (also anchor)
        ]

    @pytest.mark.asyncio
    async def test_falls_back_to_early_reg_date(self, service, mock_repository):
        """When no priority_reg_date, uses early_reg_date."""
        mock_repository.fetch_registration_dates.return_value = {
            "early_reg_date": "2025-11-05",  # Wednesday
        }
        mock_repository.fetch_available_snapshot_dates.return_value = [
            "2025-11-17",  # Mon
            "2025-11-16",
            "2025-11-15",
            "2025-11-14",
            "2025-11-13",
            "2025-11-12",
            "2025-11-11",
            "2025-11-10",  # Mon
            "2025-11-09",
            "2025-11-08",
            "2025-11-07",
            "2025-11-06",
            "2025-11-05",  # Wed (anchor)
        ]

        result = await service.get_filtered_snapshot_dates(2026)

        assert result == [
            "2025-11-17",
            "2025-11-10",
            "2025-11-05",
        ]

    @pytest.mark.asyncio
    async def test_capped_at_july_31(self, service, mock_repository):
        """Dates after July 31 of the camp year are excluded."""
        mock_repository.fetch_registration_dates.return_value = {
            "priority_reg_date": "2026-07-25",  # Unusual but possible
        }
        mock_repository.fetch_available_snapshot_dates.return_value = [
            "2026-08-10",  # Mon - beyond cap
            "2026-08-03",  # Mon - beyond cap
            "2026-07-31",  # Thu - within cap
            "2026-07-27",  # Mon
            "2026-07-25",  # anchor
        ]

        result = await service.get_filtered_snapshot_dates(2026)

        assert result == [
            "2026-07-27",
            "2026-07-25",
        ]

    @pytest.mark.asyncio
    async def test_no_registration_date_returns_empty(self, service, mock_repository):
        """When no registration dates configured, return empty list."""
        mock_repository.fetch_registration_dates.return_value = {}
        mock_repository.fetch_available_snapshot_dates.return_value = [
            "2026-03-10",
            "2026-03-09",
        ]

        result = await service.get_filtered_snapshot_dates(2026)

        assert result == []

    @pytest.mark.asyncio
    async def test_only_dates_with_snapshot_data(self, service, mock_repository):
        """Only dates that exist in snapshot data are returned."""
        mock_repository.fetch_registration_dates.return_value = {
            "priority_reg_date": "2025-10-15",  # Wed
        }
        mock_repository.fetch_available_snapshot_dates.return_value = [
            "2025-10-27",  # Mon - has data
            # "2025-10-20" missing - sync didn't run
            "2025-10-15",  # anchor - has data
        ]

        result = await service.get_filtered_snapshot_dates(2026)

        assert result == [
            "2025-10-27",
            "2025-10-15",
        ]

    @pytest.mark.asyncio
    async def test_datetime_with_t_suffix_handled(self, service, mock_repository):
        """Registration dates stored as datetime strings (with T suffix) are parsed correctly."""
        mock_repository.fetch_registration_dates.return_value = {
            "priority_reg_date": "2025-10-15T00:00:00Z",  # Datetime format
        }
        mock_repository.fetch_available_snapshot_dates.return_value = [
            "2025-10-20",  # Mon
            "2025-10-15",  # anchor
        ]

        result = await service.get_filtered_snapshot_dates(2026)

        assert result == [
            "2025-10-20",
            "2025-10-15",
        ]

    @pytest.mark.asyncio
    async def test_snapshots_before_anchor_excluded(self, service, mock_repository):
        """Snapshot dates before the anchor date are excluded."""
        mock_repository.fetch_registration_dates.return_value = {
            "priority_reg_date": "2025-10-15",
        }
        mock_repository.fetch_available_snapshot_dates.return_value = [
            "2025-10-20",
            "2025-10-15",
            "2025-10-13",  # Mon before anchor
            "2025-10-10",  # Before anchor
        ]

        result = await service.get_filtered_snapshot_dates(2026)

        assert result == [
            "2025-10-20",
            "2025-10-15",
        ]

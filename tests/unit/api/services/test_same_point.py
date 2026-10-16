"""Tests for the shared "same point last year" rule (decision 7), used by Forecast and Overview.

While a season is live, a prior season is read at the same registration day: the camp today's
offset from this season's anchor. After the season (or with no anchor) the compare is with the
prior season's final.
"""

from datetime import date
from unittest.mock import AsyncMock

import pytest

from api.services.same_point import live_same_point


def _repo(dates_by_year: dict[int, dict[str, str]] | Exception) -> AsyncMock:
    repo = AsyncMock()
    if isinstance(dates_by_year, Exception):
        repo.fetch_registration_dates.side_effect = dates_by_year
    else:

        async def fetch(year: int) -> dict[str, str]:
            return dates_by_year.get(year, {})

        repo.fetch_registration_dates.side_effect = fetch
    return repo


DATES_2026 = {
    2026: {
        "priority_reg_date": "2025-11-12",
        "early_reg_date": "2025-11-19",
        "open_reg_date": "2025-12-03",
    }
}


class TestLiveSamePoint:
    @pytest.mark.asyncio
    async def test_live_season_reads_the_registration_day(self) -> None:
        point = await live_same_point(_repo(DATES_2026), 2026, today=date(2026, 3, 2))

        assert point is not None
        assert point.day_offset == 110
        assert point.prior_offset == 110

    @pytest.mark.asyncio
    async def test_priority_date_reads_the_prior_through_the_next_day(self) -> None:
        """Decision 45: on the priority date the prior is read through the following day."""
        point = await live_same_point(_repo(DATES_2026), 2026, today=date(2025, 11, 12))

        assert point is not None
        assert point.day_offset == 0
        assert point.prior_offset == 1

    @pytest.mark.asyncio
    async def test_early_and_open_dates_read_through_the_next_day_too(self) -> None:
        """Ruling 11: the early and open dates get the same two-day window."""
        early = await live_same_point(_repo(DATES_2026), 2026, today=date(2025, 11, 19))
        open_ = await live_same_point(_repo(DATES_2026), 2026, today=date(2025, 12, 3))

        assert early is not None
        assert (early.day_offset, early.prior_offset) == (7, 8)
        assert open_ is not None
        assert (open_.day_offset, open_.prior_offset) == (21, 22)

    @pytest.mark.asyncio
    async def test_before_the_anchor_is_a_negative_day(self) -> None:
        point = await live_same_point(_repo(DATES_2026), 2026, today=date(2025, 11, 2))

        assert point is not None
        assert point.day_offset == -10
        assert point.prior_offset == -10

    @pytest.mark.asyncio
    async def test_after_the_season_compares_with_finals(self) -> None:
        # SEASON_WEEKS (41) weeks from 2025-11-12 end on 2026-08-25
        assert await live_same_point(_repo(DATES_2026), 2026, today=date(2026, 8, 25)) is not None
        assert await live_same_point(_repo(DATES_2026), 2026, today=date(2026, 8, 26)) is None

    @pytest.mark.asyncio
    async def test_no_anchor_compares_with_finals(self) -> None:
        assert await live_same_point(_repo({}), 2027, today=date(2026, 10, 15)) is None

    @pytest.mark.asyncio
    async def test_early_date_is_the_anchor_without_a_priority_date(self) -> None:
        repo = _repo({2026: {"early_reg_date": "2025-11-19"}})

        point = await live_same_point(repo, 2026, today=date(2025, 11, 29))

        assert point is not None
        assert point.day_offset == 10

    @pytest.mark.asyncio
    async def test_unreadable_dates_compare_with_finals(self) -> None:
        repo = _repo(RuntimeError("config unavailable"))

        assert await live_same_point(repo, 2026, today=date(2026, 3, 2)) is None

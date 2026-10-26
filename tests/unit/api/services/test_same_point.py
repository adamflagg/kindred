"""Tests for the shared "same point last year" rule (decision 7), used by Forecast and Overview.

While a season is live, a prior season is read at the same registration day: the camp today's
offset from this season's anchor. After the season (or with no anchor) the compare is with the
prior season's final.
"""

from datetime import date
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock

import pytest

from api.services.same_point import live_same_point, same_day_point, season_end


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


# PM-8 (owner, 2026-10-25, option A): "open" ends the day the season's last session starts, read from
# CampMinder session dates, instead of SEASON_WEEKS after the anchor.


def _session(session_type: str, start: str, end: str) -> SimpleNamespace:
    return SimpleNamespace(session_type=session_type, start_date=start, end_date=end)


SESSIONS_2026 = {
    1: _session("main", "2026-06-14 07:00:00.000Z", "2026-07-03 07:00:00.000Z"),
    2: _session("main", "2026-07-26 07:00:00.000Z", "2026-08-07 07:00:00.000Z"),
    3: _session("quest", "2026-07-12 07:00:00.000Z", "2026-07-24 07:00:00.000Z"),
    # Family Camp is never summer: its later start must not keep the season open
    4: _session("family", "2026-08-20 07:00:00.000Z", "2026-08-23 07:00:00.000Z"),
    # An off-season teen session (outside the summer window) does not count either
    5: _session("scit", "2026-10-02 07:00:00.000Z", "2026-10-04 07:00:00.000Z"),
}


def _repo_with_sessions(sessions: dict[int, Any] | Exception) -> AsyncMock:
    repo = _repo(DATES_2026)
    if isinstance(sessions, Exception):
        repo.fetch_sessions.side_effect = sessions
    else:
        repo.fetch_sessions.return_value = sessions
    return repo


class TestSeasonEndsWhenTheLastSessionStarts:
    @pytest.mark.asyncio
    async def test_the_day_before_the_last_session_starts_is_live(self) -> None:
        point = await live_same_point(_repo_with_sessions(SESSIONS_2026), 2026, today=date(2026, 7, 25))

        assert point is not None
        assert point.day_offset == (date(2026, 7, 25) - date(2025, 11, 12)).days

    @pytest.mark.asyncio
    async def test_the_day_the_last_session_starts_compares_with_finals(self) -> None:
        assert await live_same_point(_repo_with_sessions(SESSIONS_2026), 2026, today=date(2026, 7, 26)) is None

    @pytest.mark.asyncio
    async def test_reads_the_seasons_own_sessions(self) -> None:
        repo = _repo_with_sessions(SESSIONS_2026)

        await live_same_point(repo, 2026, today=date(2026, 3, 2))

        assert repo.fetch_sessions.await_args.args[0] == 2026

    @pytest.mark.asyncio
    async def test_family_camp_and_off_season_teens_do_not_keep_it_open(self) -> None:
        # Both start after the last summer session; neither moves the end
        assert await live_same_point(_repo_with_sessions(SESSIONS_2026), 2026, today=date(2026, 8, 1)) is None

    @pytest.mark.asyncio
    async def test_a_summer_teen_session_counts(self) -> None:
        sessions = {
            **SESSIONS_2026,
            6: _session("tli", "2026-07-30 07:00:00.000Z", "2026-08-05 07:00:00.000Z"),
        }

        assert await live_same_point(_repo_with_sessions(sessions), 2026, today=date(2026, 7, 29)) is not None
        assert await live_same_point(_repo_with_sessions(sessions), 2026, today=date(2026, 7, 30)) is None

    @pytest.mark.asyncio
    async def test_no_sessions_falls_back_to_the_season_weeks_window(self) -> None:
        # SEASON_WEEKS (41) weeks from 2025-11-12 end on 2026-08-25
        repo = _repo_with_sessions({})

        assert await live_same_point(repo, 2026, today=date(2026, 8, 25)) is not None
        assert await live_same_point(repo, 2026, today=date(2026, 8, 26)) is None

    @pytest.mark.asyncio
    async def test_sessions_without_readable_start_dates_fall_back(self) -> None:
        repo = _repo_with_sessions({1: _session("main", "", ""), 2: _session("main", "not a date", "x")})

        assert await live_same_point(repo, 2026, today=date(2026, 8, 25)) is not None
        assert await live_same_point(repo, 2026, today=date(2026, 8, 26)) is None

    @pytest.mark.asyncio
    async def test_unreadable_sessions_fall_back(self) -> None:
        repo = _repo_with_sessions(RuntimeError("sessions unavailable"))

        assert await live_same_point(repo, 2026, today=date(2026, 8, 25)) is not None
        assert await live_same_point(repo, 2026, today=date(2026, 8, 26)) is None


class TestSeasonEnd:
    @pytest.mark.asyncio
    async def test_is_the_day_the_last_summer_session_starts(self) -> None:
        assert await season_end(_repo_with_sessions(SESSIONS_2026), 2026, date(2025, 11, 12)) == date(2026, 7, 26)

    @pytest.mark.asyncio
    async def test_falls_back_to_the_day_after_the_season_weeks(self) -> None:
        assert await season_end(_repo_with_sessions({}), 2026, date(2025, 11, 12)) == date(2026, 8, 26)


class TestSameDayPoint:
    """Today compares at the same registration day all year (PM-8 A): no end, only an anchor."""

    @pytest.mark.asyncio
    async def test_reads_the_same_day_after_the_season(self) -> None:
        point = await same_day_point(_repo_with_sessions(SESSIONS_2026), 2026, today=date(2026, 10, 25))

        assert point is not None
        assert point.day_offset == (date(2026, 10, 25) - date(2025, 11, 12)).days
        assert point.prior_offset == point.day_offset

    @pytest.mark.asyncio
    async def test_clamps_a_phase_date_as_live_does(self) -> None:
        point = await same_day_point(_repo(DATES_2026), 2026, today=date(2025, 11, 12))

        assert point is not None
        assert (point.day_offset, point.prior_offset) == (0, 1)

    @pytest.mark.asyncio
    async def test_no_anchor_has_no_same_day(self) -> None:
        assert await same_day_point(_repo({}), 2027, today=date(2026, 10, 25)) is None

    @pytest.mark.asyncio
    async def test_unreadable_dates_have_no_same_day(self) -> None:
        assert await same_day_point(_repo(RuntimeError("config unavailable")), 2026, today=date(2026, 3, 2)) is None

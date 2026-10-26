"""The Waitlist tab has no comparison while registration is live (PM-8 A).

A past waitlist can't be rebuilt for a day, so a compare year asked with ``same_point_of`` while that
season is live says the comparison is unavailable instead of offering its final. After the season it
is read as it stands ("final"), as before.
"""

from datetime import date
from typing import Any
from unittest.mock import AsyncMock, Mock

import pytest

from api.services.waitlist_service import WaitlistService
from tests.unit.api.conftest import create_mock_session

ANCHORS = {2026: "2025-11-12", 2025: "2024-11-12"}


def _repo() -> Mock:
    repo = Mock()
    repo.fetch_attendees = AsyncMock(return_value=[])
    repo.fetch_persons = AsyncMock(return_value={})
    repo.fetch_status_history = AsyncMock(return_value=[])

    async def fetch_sessions(year: int, session_types: Any = None) -> dict[int, Any]:
        # 2026's last summer session starts 2026-07-26: the season is live until then
        return {1001: create_mock_session(1001, "Session 4", year, "main", f"{year}-07-26", f"{year}-08-08")}

    async def fetch_dates(year: int) -> dict[str, str]:
        return {"priority_reg_date": ANCHORS[year]} if year in ANCHORS else {}

    repo.fetch_sessions = AsyncMock(side_effect=fetch_sessions)
    repo.fetch_registration_dates = AsyncMock(side_effect=fetch_dates)
    return repo


class TestWaitlistSamePoint:
    @pytest.mark.asyncio
    async def test_live_season_has_no_comparison(self) -> None:
        result = await WaitlistService(_repo()).calculate_waitlist(2025, same_point_of=2026, today=date(2026, 3, 2))

        assert result.prior_basis == "unavailable"
        assert result.prior_unavailable_reason == "waitlist_not_rebuildable"

    @pytest.mark.asyncio
    async def test_after_the_season_compares_with_the_final(self) -> None:
        result = await WaitlistService(_repo()).calculate_waitlist(2025, same_point_of=2026, today=date(2026, 7, 26))

        assert result.prior_basis == "final"
        assert result.prior_unavailable_reason is None

    @pytest.mark.asyncio
    async def test_a_plain_read_has_no_basis(self) -> None:
        result = await WaitlistService(_repo()).calculate_waitlist(2025)

        assert result.prior_basis is None
        assert result.prior_unavailable_reason is None

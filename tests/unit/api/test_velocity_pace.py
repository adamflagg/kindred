"""Velocity's pace card (#3207 PR 12): what the response adds for it.

- ``prior_basis``: the viewed season decides the comparison (ruling #98). While the season is live
  (``live_same_point``, the one rule PR 11 uses) prior seasons are read at the same registration day;
  once it is over they are read at their final. No other date flips it.
- ``folds_into_session_cm_id`` on a prior session summary: ruling #97's fold. A prior embedded session
  with no match this year folds into the prior main session whose dates contain it
  (``fold_embedded_sessions``, Today's rule), named here by the current session that main matches.
"""

from datetime import date
from typing import Any
from unittest.mock import AsyncMock

import pytest

from api.services.velocity_service import VelocityService
from tests.unit.api.test_velocity_service import _sess, _wire_years, create_mock_snapshot


@pytest.fixture
def mock_repository() -> AsyncMock:
    repo = AsyncMock()
    repo.fetch_status_transitions = AsyncMock(return_value=[])

    async def _reg_dates(year: int) -> dict[str, str]:
        return {"priority_reg_date": f"{year - 1}-11-01"}

    repo.fetch_registration_dates = AsyncMock(side_effect=_reg_dates)
    return repo


@pytest.fixture
def service(mock_repository: AsyncMock) -> VelocityService:
    return VelocityService(mock_repository)


def _wire_fold_years(repo: Any) -> None:
    _wire_years(
        repo,
        sessions={
            2026: {
                1001: _sess(1001, "Session 1", 2026, start_date="2026-06-14", end_date="2026-07-04"),
                1002: _sess(1002, "Session 2", 2026, start_date="2026-07-06", end_date="2026-07-26"),
                1011: _sess(1011, "Session 1a", 2026, "embedded", start_date="2026-06-14", end_date="2026-06-27"),
            },
            2025: {
                1001: _sess(1001, "Session 1", 2025, start_date="2025-06-15", end_date="2025-07-05"),
                1002: _sess(1002, "Session 2", 2025, start_date="2025-07-07", end_date="2025-07-27"),
                1003: _sess(1003, "Session 3", 2025, start_date="2025-08-01", end_date="2025-08-15"),
                # Still runs this year: matched, so its own row, never folded.
                1011: _sess(1011, "Session 1a", 2025, "embedded", start_date="2025-06-15", end_date="2025-06-28"),
                # Retired, inside Session 2's dates: folds into Session 2.
                1021: _sess(1021, "Session 2b", 2025, "embedded", start_date="2025-07-14", end_date="2025-07-20"),
                # Retired, inside Session 3's dates, but Session 3 is retired too: nowhere to fold.
                1031: _sess(1031, "Session 3a", 2025, "embedded", start_date="2025-08-02", end_date="2025-08-08"),
            },
        },
        snapshots={
            2026: [create_mock_snapshot("2025-11-02", sid, 2026, enrolled=10) for sid in (1001, 1002, 1011)],
            2025: [
                create_mock_snapshot("2024-11-02", sid, 2025, enrolled=8)
                for sid in (1001, 1002, 1003, 1011, 1021, 1031)
            ],
        },
    )


class TestPaceFold:
    @pytest.mark.asyncio
    async def test_retired_embedded_names_the_current_session_it_folds_into(self, service, mock_repository):
        _wire_fold_years(mock_repository)
        result = await service.get_velocity(year=2026, compare_years=[2025], today=date(2026, 1, 20))

        folds = {s.session_cm_id: s.folds_into_session_cm_id for s in result.prior_year_session_summaries}
        assert folds == {1001: None, 1002: None, 1003: None, 1011: None, 1021: 1002, 1031: None}


class TestPacePriorBasis:
    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("today", "basis"),
        [
            (date(2025, 10, 15), "same_point"),  # before the priority date: the season is still ahead
            (date(2026, 1, 20), "same_point"),  # live
            (date(2026, 8, 14), "same_point"),  # the season's last day (priority date + SEASON_WEEKS weeks - 1)
            (date(2026, 8, 15), "final"),  # over: compare with the prior final
            (date(2027, 3, 1), "final"),
        ],
    )
    async def test_the_viewed_season_decides(self, service, mock_repository, today, basis):
        _wire_fold_years(mock_repository)
        result = await service.get_velocity(year=2026, compare_years=[2025], today=today)
        assert result.prior_basis == basis

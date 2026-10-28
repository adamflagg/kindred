"""A closed ("done") Camperships season (CLOSED-SEASONS-DONE, owner ruling NG-01, CSD-7): older than the prior
season N-1 of the configured season N. One helper, which Season > Rules' done test delegates to."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import MagicMock

import pytest

from api.services import aid_season_state, camp_calendar
from api.services.aid_season_state import (
    SeasonClosedError,
    SeasonYearUnknownError,
    configured_season_year,
    is_season_done,
    refuse_done_season,
    season_done,
)
from api.services.financial_aid_rules_service import FinancialAidRulesService
from tests.unit.api.services.rules_fakes import FakeStore


def _configured(year: int):  # type: ignore[no-untyped-def]
    async def read() -> int:
        return year

    return read


async def _unreadable() -> int:
    raise SeasonYearUnknownError("The dashboard's season couldn't be read")


@pytest.mark.parametrize(
    ("year", "configured", "done"),
    [(2025, 2027, True), (2024, 2027, True), (2026, 2027, False), (2027, 2027, False), (2026, 2028, True)],
)
def test_a_season_is_done_when_older_than_the_prior_season(year: int, configured: int, done: bool) -> None:
    assert is_season_done(year, configured) is done


@pytest.mark.asyncio
async def test_a_read_says_2025_is_done_and_2026_is_open_with_2027_configured() -> None:
    assert await season_done(2025, _configured(2027)) is True
    assert await season_done(2026, _configured(2027)) is False


@pytest.mark.asyncio
async def test_2026_closes_by_itself_once_2028_is_the_season() -> None:
    assert await season_done(2026, _configured(2028)) is True


@pytest.mark.asyncio
async def test_a_read_falls_back_to_the_oct_15_rule_when_the_season_cannot_be_read(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A sync-status blip must never 503 every Camperships page: a read takes the Oct 15 rule instead."""
    monkeypatch.delenv("CAMPMINDER_SEASON_ID", raising=False)
    # Oct 20, 2026: past the Oct 15 rollover, so the season is 2027 and 2025 is done.
    monkeypatch.setattr(camp_calendar, "_utcnow", lambda: datetime(2026, 10, 20, 18, tzinfo=UTC))
    assert await season_done(2025, _unreadable) is True
    assert await season_done(2026, _unreadable) is False
    # Oct 1, 2026: before the rollover, the season is still 2026, so 2025 is the prior season and open.
    monkeypatch.setattr(camp_calendar, "_utcnow", lambda: datetime(2026, 10, 1, 18, tzinfo=UTC))
    assert await season_done(2025, _unreadable) is False


@pytest.mark.asyncio
async def test_a_read_fallback_honours_the_env_override(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CAMPMINDER_SEASON_ID", "2026")
    monkeypatch.setattr(camp_calendar, "_utcnow", lambda: datetime(2026, 10, 20, 18, tzinfo=UTC))
    assert await season_done(2025, _unreadable) is False


@pytest.mark.asyncio
async def test_the_strict_reader_honours_the_env_override(monkeypatch: pytest.MonkeyPatch) -> None:
    pb = MagicMock()
    pb.send.side_effect = RuntimeError("sync status unreadable")
    monkeypatch.setenv("CAMPMINDER_SEASON_ID", "2028")
    assert await configured_season_year(pb) == 2028
    assert await season_done(2026, lambda: configured_season_year(pb)) is True


@pytest.mark.asyncio
async def test_a_write_to_a_done_season_is_refused() -> None:
    with pytest.raises(SeasonClosedError) as caught:
        await refuse_done_season(2025, _configured(2027))
    assert caught.value.year == 2025
    assert "2025 is closed" in str(caught.value)


@pytest.mark.asyncio
async def test_a_write_to_an_open_season_passes() -> None:
    await refuse_done_season(2026, _configured(2027))
    await refuse_done_season(2027, _configured(2027))


@pytest.mark.asyncio
async def test_a_write_refuses_when_the_season_cannot_be_read() -> None:
    """Writes stay strict, as rules' do: an unreadable season is never treated as open (503 at the router)."""
    with pytest.raises(SeasonYearUnknownError):
        await refuse_done_season(2026, _unreadable)


@pytest.mark.asyncio
async def test_the_rules_done_test_delegates_to_the_shared_helper(monkeypatch: pytest.MonkeyPatch) -> None:
    """Season > Rules' done season and the closed season are one rule: change the helper, both follow."""
    service = FinancialAidRulesService(FakeStore(), configured_year=_configured(2027))
    assert await service.season_state(2025) == (True, 2027)
    monkeypatch.setattr(aid_season_state, "is_season_done", lambda year, configured: False)
    assert await service.season_state(2025) == (False, 2027)


def test_the_rules_module_still_exports_the_strict_reader() -> None:
    """The reader moved to aid_season_state; the rules module re-exports it, so its callers and tests keep working."""
    from api.services import financial_aid_rules_service as rules

    assert rules.configured_season_year is configured_season_year
    assert rules.SeasonYearUnknownError is SeasonYearUnknownError

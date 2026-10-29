"""Which Camperships seasons are done (CLOSED-SEASONS-DONE; owner ruling NG-01, CSD-7, CSD-8, 2026-10-28).

A season is DONE when it is older than the prior season N-1 of the configured season N: 2025 and before while 2027 is
the season, and 2026 too once 2028 is (the Oct 15, 2027 rollover). It is the one test for three things that must agree:

- Season > Rules' done season (`FinancialAidRulesService.season_state` delegates here);
- the sync's closed season (pocketbase/sync/year.go `isClosedSeasonFor`: older than the synced pair N, N-1);
- the closed-season gate: a done season's requests read as history (nothing pending, no working click) and the server
  refuses every write that would change them (409).

Not to be confused with Reports' `season_closed` (financial_aid_reports_service), which means "the season's money
stopped moving" (its last aided session has ended): that one would close 2026 as soon as its last session ends.

Reads and writes take the configured season differently. A WRITE reads it strictly (`configured_season_year`): a
season that can't be read is refused (503), never treated as open. A READ falls back to `default_season_year()` (the
env override, else the Oct 15 rule, never the calendar year), so a sync-status blip never fails every page.
"""

from __future__ import annotations

import os
from collections.abc import Awaitable, Callable
from typing import Any

from api.services.camp_calendar import default_season_year
from api.services.pb_read import pb_read
from bunking.financial_aid.errors import FinancialAidError
from bunking.logging_config import get_logger

logger = get_logger(__name__)

ConfiguredYear = Callable[[], Awaitable[int]]
# What a staff read is handed (`season_done` bound to the dashboard's season): None on a service means no season is
# ever done, as Rules' `configured_year=None` does (internal routes, candidate pricing, tests).
SeasonDoneRead = Callable[[int], Awaitable[bool]]


class SeasonYearUnknownError(FinancialAidError, RuntimeError):
    """The configured season couldn't be read (Review Focus 3): no `_configured_year` on the sync status and no
    CAMPMINDER_SEASON_ID. A done season is never treated as open for want of its year, so a write is refused (503)
    until it can be read; a read falls back to the Oct 15 rule instead (`season_done`)."""


class SeasonClosedError(FinancialAidError, ValueError):
    """A write to a done season (CSD-8): refused (409). There is no Unlock: a closed season's requests are history."""

    def __init__(self, year: int, configured: int) -> None:
        self.year, self.configured = year, configured
        super().__init__(
            f"{year} is closed (the dashboard's season is {configured}): its requests show as history, and nothing "
            "in it can change"
        )


async def configured_season_year(pb: Any) -> int:
    """The dashboard's configured season, strictly (spec §11.1; review minor 9). The same sync status
    `current_season_year` reads, but that one swallows every failure and guesses the calendar year, which would read a
    done season as open after the switch. Here the env var is the only fallback, and anything else raises."""
    try:
        status = await pb_read(pb.send, "/api/custom/sync/status", {"method": "GET"})
        year = int((status or {}).get("_configured_year") or 0)
    except Exception as exc:  # re-raised below as the one error the router maps
        logger.warning(f"Camperships: sync status unreadable ({exc})")
        year = 0
    if year:
        return year
    season = os.environ.get("CAMPMINDER_SEASON_ID", "")
    if season.isdigit():
        return int(season)
    raise SeasonYearUnknownError("The dashboard's season couldn't be read, so no change is accepted; try again shortly")


def is_season_done(year: int, configured: int) -> bool:
    """Done: older than the prior season (N-1). The prior season stays workable for programs still running after the
    Oct 15 rollover (owner ruling 2026-10-14). The one place this test lives."""
    return year < configured - 1


async def season_done(year: int, configured_year: ConfiguredYear) -> bool:
    """For a READ: whether `year` is done. An unreadable configured season falls back to the Oct 15 rule."""
    try:
        configured = await configured_year()
    except SeasonYearUnknownError:
        configured = default_season_year()
    return is_season_done(year, configured)


async def refuse_done_season(year: int, configured_year: ConfiguredYear) -> None:
    """For a WRITE: raises SeasonClosedError for a done season, and SeasonYearUnknownError (503) when the configured
    season can't be read."""
    configured = await configured_year()
    if is_season_done(year, configured):
        raise SeasonClosedError(year, configured)

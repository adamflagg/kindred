"""The "same point last year" rule (decision 7), shared by Forecast and Overview.

While a season is live, a prior season is compared at the same registration day: the camp
today's offset from this season's anchor (priority date, else early date). On a phase date the
prior is read through the next day (decision 45, ruling 11; ``same_point_offset``). Once the
season is over, or when its anchor cannot be read, prior seasons are compared at their final.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import TYPE_CHECKING

from api.services.camp_calendar import SEASON_WEEKS, get_camp_today, phase_clamp_offsets, same_point_offset
from bunking.logging_config import get_logger

if TYPE_CHECKING:
    from api.services.metrics_repository import MetricsRepository

logger = get_logger(__name__)


@dataclass(frozen=True)
class SamePoint:
    """Where a live season stands: its registration day, and the day a prior season is read at."""

    day_offset: int
    prior_offset: int


def registration_anchor(reg_dates: dict[str, str]) -> date | None:
    """A season's registration anchor (priority date, else early date), or None when unset."""
    raw = reg_dates.get("priority_reg_date") or reg_dates.get("early_reg_date") or ""
    if not raw:
        return None
    try:
        return date.fromisoformat(raw.split("T")[0].split(" ")[0])
    except ValueError:
        return None


async def live_same_point(repo: MetricsRepository, year: int, today: date | None = None) -> SamePoint | None:
    """The registration day to compare prior seasons at while ``year``'s season is live.

    Live runs from before the anchor (a negative day) through ``SEASON_WEEKS`` weeks after it.
    Returns None after that, with no anchor, or when the dates cannot be read: compare with finals.
    """
    try:
        reg_dates = await repo.fetch_registration_dates(year)
    except Exception:
        logger.warning("Failed to read the %d registration dates, comparing with prior finals", year, exc_info=True)
        return None
    anchor = registration_anchor(reg_dates)
    if anchor is None:
        return None
    camp_today = today if today is not None else get_camp_today()
    if camp_today > anchor + timedelta(days=SEASON_WEEKS * 7 - 1):
        return None
    day_offset = (camp_today - anchor).days
    return SamePoint(day_offset, same_point_offset(day_offset, phase_clamp_offsets(reg_dates)))

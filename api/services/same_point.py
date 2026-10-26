"""The "same point last year" rule (decision 7), shared by every page that compares with a prior season.

While a season is live, a prior season is compared at the same registration day: the camp
today's offset from this season's anchor (priority date, else early date). On a phase date the
prior is read through the next day (decision 45, ruling 11; ``same_point_offset``). Once the
season is over, or when its anchor cannot be read, prior seasons are compared at their final.

PM-8 (owner, 2026-10-25, option A): the season is over the day its last summer session starts,
read from CampMinder's session dates (``season_end``). Today is the one page that never switches
to finals: it reads the same day all year (``same_day_point``).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import TYPE_CHECKING

from api.services.camp_calendar import SEASON_WEEKS, get_camp_today, phase_clamp_offsets, same_point_offset
from api.utils.session_metrics import resolve_cohort_session_ids
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


def _start_day(raw: object) -> date | None:
    try:
        return date.fromisoformat(str(raw or "")[:10])
    except ValueError:
        return None


async def season_end(repo: MetricsRepository, year: int, anchor: date) -> date:
    """The first day ``year``'s season is over: the day its last summer session starts.

    Summer is the sessions summer metrics count (``DISPLAY_SESSION_TYPES``, with SCIT and TLI
    only inside the summer window), so Family Camp and off-season teen sessions never keep a
    season open. A season with no readable session start dates falls back to the old window,
    ``SEASON_WEEKS`` weeks from the anchor, and says so in the log.
    """
    try:
        sessions = await repo.fetch_sessions(year, None)
        summer = resolve_cohort_session_ids(sessions, None)
        starts = [
            day
            for cm_id, s in sessions.items()
            if int(cm_id) in summer and (day := _start_day(getattr(s, "start_date", None)))
        ]
    except Exception:
        logger.warning("Failed to read the %d sessions", year, exc_info=True)
        starts = []
    if starts:
        return max(starts)
    logger.warning("No %d summer session start dates: the season closes %d weeks after its anchor", year, SEASON_WEEKS)
    return anchor + timedelta(days=SEASON_WEEKS * 7)


async def _point_and_anchor(
    repo: MetricsRepository, year: int, today: date | None
) -> tuple[SamePoint, date, date] | None:
    """(point, anchor, camp today) for ``year``, or None when its anchor cannot be read."""
    try:
        reg_dates = await repo.fetch_registration_dates(year)
    except Exception:
        logger.warning("Failed to read the %d registration dates", year, exc_info=True)
        return None
    anchor = registration_anchor(reg_dates)
    if anchor is None:
        return None
    camp_today = today if today is not None else get_camp_today()
    day_offset = (camp_today - anchor).days
    point = SamePoint(day_offset, same_point_offset(day_offset, phase_clamp_offsets(reg_dates)))
    return point, anchor, camp_today


async def same_day_point(repo: MetricsRepository, year: int, today: date | None = None) -> SamePoint | None:
    """The registration day ``year`` has reached, with no season end (Today, PM-8 A).

    None only when the season's anchor cannot be read: then there is no same day to compare at.
    """
    found = await _point_and_anchor(repo, year, today)
    return found[0] if found is not None else None


async def live_same_point(repo: MetricsRepository, year: int, today: date | None = None) -> SamePoint | None:
    """The registration day to compare prior seasons at while ``year``'s season is live.

    Live runs from before the anchor (a negative day) until the day the season's last summer
    session starts (``season_end``). Returns None from that day on, with no anchor, or when the
    dates cannot be read: compare with finals.
    """
    found = await _point_and_anchor(repo, year, today)
    if found is None:
        return None
    point, anchor, camp_today = found
    if camp_today >= await season_end(repo, year, anchor):
        return None
    return point

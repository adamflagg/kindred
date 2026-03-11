"""Camp calendar — Pacific timezone camp-day boundary logic.

A "camp day" runs from 9am Pacific to 9am Pacific the next morning.
All reporting date math uses this boundary as the atomic unit.

This module is the single source of truth for:
- What timezone the camp operates in
- What hour the camp day starts
- Converting UTC timestamps to camp dates
- Computing day/week offsets from registration anchors
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

CAMP_TZ = ZoneInfo("America/Los_Angeles")
CAMP_DAY_START_HOUR = 9


def get_camp_date(utc_dt: datetime) -> date:
    """Convert a UTC datetime to the camp date it falls in.

    Before 9am Pacific → previous calendar day's camp date.
    At or after 9am Pacific → current calendar day's camp date.

    Naive datetimes are treated as UTC.
    """
    if utc_dt.tzinfo is None:
        utc_dt = utc_dt.replace(tzinfo=UTC)
    pacific = utc_dt.astimezone(CAMP_TZ)
    if pacific.hour < CAMP_DAY_START_HOUR:
        return (pacific - timedelta(days=1)).date()
    return pacific.date()


def get_camp_today() -> date:
    """Return the current camp date."""
    return get_camp_date(datetime.now(tz=UTC))


def camp_day_offset(camp_date: date, anchor: date) -> int:
    """Days between anchor and camp_date."""
    return (camp_date - anchor).days


def camp_week_offset(camp_date: date, anchor: date) -> int:
    """Weeks between anchor and camp_date (integer division of day offset)."""
    return camp_day_offset(camp_date, anchor) // 7

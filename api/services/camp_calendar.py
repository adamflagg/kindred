"""Camp calendar — Pacific timezone camp-day boundary logic.

A "camp day" runs from 9am Pacific to 9am Pacific the next morning.
All reporting date math uses this boundary as the atomic unit.

This module is the single source of truth for:
- What timezone the camp operates in
- What hour the camp day starts
- Converting UTC timestamps to camp dates
- Computing day/week offsets from registration anchors
"""

from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

CAMP_TZ = ZoneInfo("America/Los_Angeles")
CAMP_DAY_START_HOUR = 9

# Registration tier configuration: (phase_key, config_key, label)
# Single source of truth used by velocity, forecast, and day1 services.
REGISTRATION_TIERS: list[tuple[str, str, str]] = [
    ("priority", "priority_reg_date", "Priority Registration"),
    ("early", "early_reg_date", "Early Registration"),
    ("open", "open_reg_date", "Open Registration"),
]

# Maximum weeks from season start containing meaningful registration data.
# Camp historically ends between week 39.6 and 41.3 relative to season start
# (derived from 2017-2026 data).
SEASON_WEEKS = 41


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


def format_week_date_range(anchor: date, week_num: int) -> str:
    """Format a date range for a week number, e.g. "Nov 12\u201318" or "Nov 26\u2013Dec 2".

    Args:
        anchor: Registration anchor date (start of Week 1).
        week_num: 1-based week number. 0 means the 7 days before anchor.
    """
    if week_num == 0:
        week_start = anchor - timedelta(days=7)
        week_end = anchor - timedelta(days=1)
    else:
        week_start = anchor + timedelta(days=(week_num - 1) * 7)
        week_end = anchor + timedelta(days=week_num * 7 - 1)
    start_fmt = week_start.strftime("%b %-d")
    if week_start.month == week_end.month:
        end_fmt = str(week_end.day)
    else:
        end_fmt = week_end.strftime("%b %-d")
    return f"{start_fmt}\u2013{end_fmt}"


def day1_window(tier_date: date) -> tuple[datetime, datetime]:
    """Return the 9am-to-9am PT window for a registration tier opening day.

    Used by Day 1 page to report the registration window boundaries.
    Actual counting uses date-level matching against effective_date.

    The window spans 9am Pacific on tier_date to 9am Pacific the following
    calendar day. Across a DST transition this may be 23 or 25 UTC hours.
    """
    next_day = tier_date + timedelta(days=1)
    start = datetime(tier_date.year, tier_date.month, tier_date.day, CAMP_DAY_START_HOUR, 0, tzinfo=CAMP_TZ)
    end = datetime(next_day.year, next_day.month, next_day.day, CAMP_DAY_START_HOUR, 0, tzinfo=CAMP_TZ)
    return (start, end)

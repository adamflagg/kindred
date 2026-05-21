"""Session swap detection utility.

Detects when a person cancels one session and enrolls in another within a
short window (default 1 day), indicating a session change rather than a
true departure from camp.
"""

from datetime import datetime, timedelta
from typing import Any

from api.utils.session_metrics import get_session_from_expand


def _parse_date(date_str: str | None) -> datetime | None:
    """Parse a date string to datetime, handling various formats."""
    if not date_str:
        return None
    # Try ISO date first (YYYY-MM-DD)
    try:
        return datetime.strptime(date_str[:10], "%Y-%m-%d")
    except ValueError, IndexError:
        return None


def detect_session_swaps(
    cancelled_attendees: list[Any],
    enrolled_attendees: list[Any],
    window_days: int = 1,
) -> set[int]:
    """Detect person_ids that are session swaps (cancel + enroll within window).

    A session swap occurs when a person cancels from one session and enrolls
    in a different session within `window_days` of the cancellation date.

    Args:
        cancelled_attendees: List of cancelled/withdrawn/dismissed attendee records.
        enrolled_attendees: List of enrolled attendee records.
        window_days: Maximum days between cancel and enroll dates to count as swap.

    Returns:
        Set of person_ids that are session swaps.
    """
    # Build per-person enrolled dates and session IDs
    enrolled_by_person: dict[int, list[tuple[datetime, int]]] = {}
    for att in enrolled_attendees:
        pid = getattr(att, "person_id", None)
        if pid is None:
            continue
        pid_int = int(pid)
        edate = _parse_date(getattr(att, "enrollment_date", None))
        session = get_session_from_expand(att)
        sid = int(getattr(session, "cm_id", 0)) if session else 0
        if edate and sid:
            enrolled_by_person.setdefault(pid_int, []).append((edate, sid))

    # Check each cancelled person for matching enrollment
    swap_pids: set[int] = set()
    window = timedelta(days=window_days)

    for att in cancelled_attendees:
        pid = getattr(att, "person_id", None)
        if pid is None:
            continue
        pid_int = int(pid)
        if pid_int in swap_pids:
            continue

        cancel_date = _parse_date(getattr(att, "enrollment_date", None))
        cancel_session = get_session_from_expand(att)
        cancel_sid = int(getattr(cancel_session, "cm_id", 0)) if cancel_session else 0

        if not cancel_date or not cancel_sid:
            continue

        for enroll_date, enroll_sid in enrolled_by_person.get(pid_int, []):
            if enroll_sid == cancel_sid:
                continue  # Same session doesn't count
            if abs((enroll_date - cancel_date).days) <= window.days:
                swap_pids.add(pid_int)
                break

    return swap_pids

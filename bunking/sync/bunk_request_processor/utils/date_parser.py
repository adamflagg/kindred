"""Parse temporal date strings from bunk request text.

This module provides utilities for parsing date strings like '6/4', 'June 5'
into datetime objects for temporal conflict resolution in bunk requests.
"""

from __future__ import annotations

import re
from datetime import datetime

# Month name to number mapping (supports full and abbreviated names)
MONTH_NAMES = {
    "january": 1,
    "jan": 1,
    "february": 2,
    "feb": 2,
    "march": 3,
    "mar": 3,
    "april": 4,
    "apr": 4,
    "may": 5,
    "june": 6,
    "jun": 6,
    "july": 7,
    "jul": 7,
    "august": 8,
    "aug": 8,
    "september": 9,
    "sep": 9,
    "sept": 9,
    "october": 10,
    "oct": 10,
    "november": 11,
    "nov": 11,
    "december": 12,
    "dec": 12,
}


def month_name_to_num(name: str) -> int | None:
    """Convert month name to number.

    Args:
        name: Month name (full or abbreviated, case-insensitive)

    Returns:
        Month number (1-12) or None if not recognized
    """
    return MONTH_NAMES.get(name.lower().strip())


def parse_temporal_date(date_str: str | None, reference_year: int = 2025) -> datetime | None:
    """Parse date strings like '6/4', 'June 5', '6/10' into datetime.

    Supports the following formats:
    - Slash format: '6/4', '6/10', '12/25' (month/day)
    - Month name: 'June 4', 'Jun 5', 'june 10' (case-insensitive)

    Args:
        date_str: Raw date string from AI or text
        reference_year: Year to assume (defaults to 2025 for camp season)

    Returns:
        Parsed datetime or None if unparseable
    """
    if not date_str:
        return None

    date_str = date_str.strip()
    if not date_str:
        return None

    # Pattern 1: Slash format (6/4, 6/10, 12/25)
    slash_pattern = r"^(\d{1,2})/(\d{1,2})$"
    match = re.match(slash_pattern, date_str)
    if match:
        month = int(match.group(1))
        day = int(match.group(2))
        try:
            return datetime(reference_year, month, day)
        except ValueError:
            return None  # Invalid date

    # Pattern 2: Month name format (June 4, Jun 5)
    name_pattern = r"^(\w+)\s+(\d{1,2})$"
    match = re.match(name_pattern, date_str, re.IGNORECASE)
    if match:
        month_name = match.group(1)
        day = int(match.group(2))
        month_num = month_name_to_num(month_name)
        if month_num is not None:
            try:
                return datetime(reference_year, month_num, day)
            except ValueError:
                return None  # Invalid date

    return None

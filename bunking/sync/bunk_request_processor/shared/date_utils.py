"""Shared date utilities for the bunk request processor."""

from __future__ import annotations

from datetime import datetime


def parse_date(date_str: str) -> datetime | None:
    """Parse various date formats commonly used in PocketBase/CampMinder data.

    Handles:
    - ISO date: "2024-06-15"
    - ISO datetime: "2024-06-15T10:30:00"
    - Space-separated: "2024-06-15 10:30:00"
    - With milliseconds: "2024-06-15T10:30:00.123Z"

    Args:
        date_str: Date string to parse

    Returns:
        Parsed datetime or None if parsing fails
    """
    if not date_str:
        return None

    # Try common formats
    formats = ["%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S"]

    # Strip milliseconds and timezone indicator before parsing
    clean_str = date_str.split(".")[0].split("Z")[0]

    for fmt in formats:
        try:
            return datetime.strptime(clean_str, fmt)
        except ValueError:
            continue

    return None

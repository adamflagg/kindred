"""Shared utilities module."""

from __future__ import annotations

from .date_utils import parse_date
from .name_utils import ParsedName, last_name_matches, parse_name
from .nickname_groups import DEFAULT_NICKNAME_GROUPS, SPELLING_VARIATIONS, find_nickname_variations

__all__ = [
    "parse_date",
    "ParsedName",
    "parse_name",
    "last_name_matches",
    "DEFAULT_NICKNAME_GROUPS",
    "SPELLING_VARIATIONS",
    "find_nickname_variations",
]

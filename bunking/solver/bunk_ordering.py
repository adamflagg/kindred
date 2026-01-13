"""Centralized bunk ranking for solver constraints.

Provides a single source of truth for bunk ordering that properly handles:
- Hebrew level names (Aleph, Bet)
- Numeric levels (1-20)
- Letter suffixes (6A, 6B)
- AG bunk exclusion

This module addresses the bug where G-6A and G-6B were treated as same-level
bunks (because extract_bunk_level strips suffixes), causing no flow incentive
between them.
"""

from __future__ import annotations

import re
from functools import lru_cache

# Level order: Hebrew names first, then numeric (1-19)
# Aleph=0, Bet=1, then 1=2, 2=3, ..., 19=20
LEVEL_ORDER: dict[str, int] = {
    "Aleph": 0,
    "Bet": 1,
    **{str(i): i + 1 for i in range(1, 20)},
}


def _suffix_order(suffix: str | None) -> int:
    """Get numeric order for a letter suffix.

    Args:
        suffix: Single letter suffix (A, B, C, etc.) or None

    Returns:
        0 for no suffix, 1 for A, 2 for B, etc.
    """
    if not suffix:
        return 0
    return ord(suffix.upper()) - ord("A") + 1


@lru_cache(maxsize=256)
def get_bunk_rank(bunk_name: str) -> tuple[int, int] | None:
    """Get sortable rank for a bunk name.

    Returns tuple (level_rank, suffix_rank) for proper sorting.
    Returns None for AG bunks (no ranking) or invalid names.

    The tuple allows proper sorting: G-6A=(7,1), G-6B=(7,2), G-7=(8,0)
    so sorted([G-7, G-6B, G-6A]) = [G-6A, G-6B, G-7]

    Args:
        bunk_name: Bunk name like "G-6A", "B-Aleph", "AG-8"

    Returns:
        (level_rank, suffix_rank) tuple, or None for AG/invalid bunks

    Examples:
        get_bunk_rank("G-6A") -> (7, 1)
        get_bunk_rank("G-6B") -> (7, 2)
        get_bunk_rank("G-7")  -> (8, 0)
        get_bunk_rank("AG-8") -> None
    """
    if not bunk_name:
        return None

    # AG bunks have no ranking (excluded from flow constraints)
    if bunk_name.startswith("AG-"):
        return None

    # Extract level part: "G-6A" -> "6A", "B-Aleph" -> "Aleph"
    match = re.match(r"^[BG]-(.+)$", bunk_name)
    if not match:
        return None

    level_part = match.group(1)
    if not level_part:
        return None

    # Check for letter suffix: "6A" -> level="6", suffix="A"
    # But NOT "Aleph" -> level="Aleph", suffix=None
    suffix = None
    if level_part[-1].isalpha() and len(level_part) > 1:
        # Could be "6A" or "Aleph" - check if prefix is numeric
        potential_level = level_part[:-1]
        if potential_level.isdigit():
            suffix = level_part[-1]
            level_part = potential_level

    # Get level rank from our order mapping
    level_rank = LEVEL_ORDER.get(level_part)
    if level_rank is None:
        return None

    return (level_rank, _suffix_order(suffix))


def compare_bunks(bunk1: str, bunk2: str) -> int:
    """Compare two bunks for ordering.

    Used to determine which bunk should have younger vs older campers.

    Args:
        bunk1: First bunk name
        bunk2: Second bunk name

    Returns:
        < 0 if bunk1 should have younger campers (lower rank)
        > 0 if bunk1 should have older campers (higher rank)
        0 if same rank or can't compare (AG bunks, invalid names)

    Examples:
        compare_bunks("G-6A", "G-6B") -> -1  (6A is younger than 6B)
        compare_bunks("G-6B", "G-7")  -> -1  (6B is younger than 7)
        compare_bunks("AG-8", "G-5")  -> 0   (can't compare AG)
    """
    rank1 = get_bunk_rank(bunk1)
    rank2 = get_bunk_rank(bunk2)

    # Can't compare if either is AG or invalid
    if rank1 is None or rank2 is None:
        return 0

    if rank1 < rank2:
        return -1
    elif rank1 > rank2:
        return 1
    return 0

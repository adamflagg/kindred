"""
Shared helper functions for constraint modules.

These utilities are used by multiple constraint builders and operate
on the SolverContext data.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from bunking.models_v2 import DirectBunk, DirectPerson

    from .base import SolverContext


def extract_bunk_level(bunk_name: str) -> str | None:
    """Extract level from bunk name (e.g., 'B-3' -> '3', 'B-Aleph' -> 'Aleph', 'G-6A' -> '6').

    Handles bunks with letter suffixes (e.g., G-6A, G-6B) by stripping the suffix
    and treating them as the same level as their base (e.g., G-6).
    """
    if not bunk_name or "-" not in bunk_name:
        return None

    parts = bunk_name.split("-")
    if len(parts) < 2:
        return None

    level = parts[1]

    # Check for empty level (e.g., "G-")
    if not level:
        return None

    # Strip any letter suffix (e.g., "6A" -> "6", "6B" -> "6")
    # This ensures G-6A and G-6B are treated as level 6
    if level and level[-1].isalpha() and level[:-1].isdigit():
        level = level[:-1]

    return level


def get_level_order() -> dict[str, int]:
    """Get the ordering of bunk levels (lower index = lower level)."""
    levels = ["Aleph", "Bet"] + [str(i) for i in range(1, 20)]
    return {level: idx for idx, level in enumerate(levels)}


def is_ag_session_bunk(bunk: DirectBunk) -> bool:
    """Check if this bunk is for an AG (Any Gender) session.

    AG bunks are completely exempt from all constraints except basic assignment.
    They simply take whoever is enrolled in that AG session.
    """
    # Check if bunk gender is AG
    if bunk.gender == "AG":
        return True

    # Also check if the bunk name contains "AG" (as backup)
    return "AG" in bunk.name.upper()


def calculate_edge_extreme_threshold(standard_capacity: int, max_percentage: float) -> int:
    """Calculate threshold for edge bunk exemption from existing config values.

    Returns the count below which an extreme grade is considered a "forced minority"
    and the edge bunk should be exempt from grade_ratio penalties.

    Formula: floor(capacity × (1 - max_percentage))

    With default values (capacity=12, max_pct=0.67):
    floor(12 × 0.33) = floor(3.96) = 3

    This is sustainable because threshold scales automatically when config changes.
    """
    minority_fraction = 1.0 - max_percentage
    threshold = int(standard_capacity * minority_fraction)  # int() floors for positive numbers
    return max(1, threshold)  # At least 1 to avoid edge cases


def is_edge_bunk_for_grades(bunk: DirectBunk, bunks: list[DirectBunk]) -> tuple[bool, str]:
    """Check if bunk is lowest or highest level for its gender/session.

    Returns (is_edge, edge_type) where edge_type is 'low', 'high', 'only', or 'none'.

    Edge bunks naturally absorb extreme grades (youngest/oldest kids) and may need
    different treatment for grade ratio constraints.
    """
    # Get all non-AG bunks with same gender and session
    same_group_bunks = [
        b
        for b in bunks
        if b.gender == bunk.gender and b.session_cm_id == bunk.session_cm_id and not is_ag_session_bunk(b)
    ]

    if len(same_group_bunks) <= 1:
        return True, "only"  # Single bunk is both edges

    level_order = get_level_order()
    sorted_bunks = sorted(same_group_bunks, key=lambda b: level_order.get(extract_bunk_level(b.name) or "", 999))

    if bunk.campminder_id == sorted_bunks[0].campminder_id:
        return True, "low"
    elif bunk.campminder_id == sorted_bunks[-1].campminder_id:
        return True, "high"
    else:
        return False, "none"


def should_exempt_edge_bunk_from_ratio(
    bunk: DirectBunk,
    bunks: list[DirectBunk],
    eligible_persons: list[DirectPerson],
    standard_capacity: int,
    max_percentage: float,
) -> tuple[bool, str]:
    """Check if edge bunk should be exempt from grade_ratio penalty.

    Only exempt when BOTH conditions are true:
    1. Bunk is edge (first/last level for gender/session)
    2. The extreme grade (which would be minority in this bunk) has very few campers

    The threshold is calculated dynamically from config:
    threshold = floor(standard_capacity × (1 - max_percentage))

    With defaults (12, 0.67): floor(12 × 0.33) = 3

    This handles unavoidable scenarios where 1-3 oldest/youngest kids
    MUST go in the edge bunk as a small minority, making grade dominance
    by the adjacent grade unavoidable.

    Returns (should_exempt, reason_for_logging).
    """
    # Step 1: Is this an edge bunk?
    is_edge, edge_type = is_edge_bunk_for_grades(bunk, bunks)

    if not is_edge:
        return False, "not_edge_bunk"

    # Step 2: Get grades of eligible persons
    grades = [p.grade for p in eligible_persons if p.grade is not None]
    if not grades:
        return False, "no_grades"

    # Step 3: Determine extreme grade based on edge type
    # Low edge → extreme grade is the LOWEST (those kids are minorities here)
    # High edge → extreme grade is the HIGHEST (those kids are minorities here)
    if edge_type in ("low", "only"):
        extreme_grade = min(grades)
    else:  # high
        extreme_grade = max(grades)

    extreme_count = sum(1 for g in grades if g == extreme_grade)

    # Step 4: Calculate threshold dynamically from config
    threshold = calculate_edge_extreme_threshold(standard_capacity, max_percentage)

    # Step 5: Only exempt if extreme grade count is below threshold
    if extreme_count <= threshold:
        return True, f"{edge_type}_edge_grade{extreme_grade}_only_{extreme_count}_campers_threshold_{threshold}"
    else:
        return (
            False,
            f"{edge_type}_edge_but_grade{extreme_grade}_has_{extreme_count}_campers_exceeds_threshold_{threshold}",
        )


def get_eligible_campers_for_bunk(ctx: SolverContext, bunk: DirectBunk) -> list[tuple[int, DirectPerson]]:
    """Get list of (person_idx, person) tuples for campers eligible for this bunk.

    Filters by:
    - Session match (camper must be in same session as bunk)
    - Gender match (for non-Mixed bunks, camper gender must match bunk gender)

    This dramatically reduces constraint generation by only considering
    valid assignments that respect session and gender boundaries.
    """
    eligible = []
    for person_idx, person_cm_id in enumerate(ctx.person_ids):
        person = ctx.person_by_cm_id[person_cm_id]

        # Check session match
        if person.session_cm_id != bunk.session_cm_id:
            continue

        # Check gender match (Mixed/AG bunks accept all genders)
        if bunk.gender not in ["Mixed", "AG"] and person.gender != bunk.gender:
            continue

        eligible.append((person_idx, person))

    return eligible

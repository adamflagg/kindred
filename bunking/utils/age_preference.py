"""Age preference satisfaction logic.

The user's preference determines what satisfies them:
- "prefer older" = OK if has older kids OR all same/higher grade (no younger)
- "prefer younger" = OK if has younger kids OR all same/lower grade (no older)

This module provides a single source of truth for this logic in Python.
The TypeScript equivalent is in frontend/src/utils/agePreferenceSatisfaction.ts
"""

from __future__ import annotations


def is_age_preference_satisfied(
    requester_grade: int,
    bunkmate_grades: list[int],
    preference: str,
) -> tuple[bool, str]:
    """Check if an age preference request is satisfied.

    Args:
        requester_grade: The grade of the camper making the request
        bunkmate_grades: List of grades of all bunkmates (excluding requester)
        preference: "older" or "younger"

    Returns:
        Tuple of (is_satisfied, detail_message)

    Logic:
        - "older": PASS if has older (max > requester) OR no younger (min >= requester)
        - "younger": PASS if has younger (min < requester) OR no older (max <= requester)
    """
    if not bunkmate_grades:
        return False, "No bunkmates yet"

    min_grade = min(bunkmate_grades)
    max_grade = max(bunkmate_grades)

    if preference == "older":
        has_older = max_grade > requester_grade
        has_younger = min_grade < requester_grade

        if has_older:
            return True, f"Has older bunkmates (up to grade {max_grade})"
        elif not has_younger:
            # All bunkmates are same grade or higher - acceptable
            if min_grade == max_grade == requester_grade:
                return True, f"All bunkmates are same grade ({min_grade})"
            else:
                return True, f"All bunkmates are same grade or older (grades {min_grade}-{max_grade})"
        else:
            return False, f"Has younger bunkmates (grade {min_grade}) - conflicts with 'prefer older'"

    elif preference == "younger":
        has_younger = min_grade < requester_grade
        has_older = max_grade > requester_grade

        if has_younger:
            return True, f"Has younger bunkmates (down to grade {min_grade})"
        elif not has_older:
            # All bunkmates are same grade or lower - acceptable
            if min_grade == max_grade == requester_grade:
                return True, f"All bunkmates are same grade ({min_grade})"
            else:
                return True, f"All bunkmates are same grade or younger (grades {min_grade}-{max_grade})"
        else:
            return False, f"Has older bunkmates (grade {max_grade}) - conflicts with 'prefer younger'"

    return False, f"Unknown preference: {preference}"

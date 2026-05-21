"""Age preference satisfaction logic.

The user's preference determines what satisfies them:
- "prefer older" = OK if has older kids OR all same/higher grade (no younger)
- "prefer younger" = OK if has younger kids OR all same/lower grade (no older)

This module provides a single source of truth for this logic in Python.
The TypeScript equivalent is in frontend/src/utils/agePreferenceSatisfaction.ts
"""

from collections import Counter


def _real_grades(bunkmate_grades: list[int]) -> tuple[list[int] | None, bool]:
    """Identify the two grades to evaluate against in a three-grade bunk.

    Returns (real_grades, tied_second_place).
    - For 1- or 2-grade bunks: returns (None, False) — caller uses raw bunkmate_grades.
    - For 3+ grade bunks where most-frequent grade is not unique: returns (None, False) — caller uses raw grades.
    - For 3+ grade bunks with a unique most-frequent grade and unique second-most-frequent grade: returns ([most_common, second_common], False).
    - For 3+ grade bunks with a unique most-frequent grade but tied second-most-frequent place: returns (None, True) — caller treats as satisfied.
    """
    distinct = set(bunkmate_grades)
    if len(distinct) <= 2:
        return None, False
    counts = Counter(bunkmate_grades).most_common()
    most_common_grade, most_common_count = counts[0]
    second_common_grade, second_common_count = counts[1]
    # If most-frequent grade is not uniquely #1, fall back to raw grades (no real-grades adjustment).
    if most_common_count == second_common_count:
        return None, False
    # Most-frequent grade is unique. Check if second-most-frequent place is also unique.
    if len(counts) >= 3 and counts[2][1] == second_common_count:
        return None, True
    return [most_common_grade, second_common_grade], False


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

    real, tied_second_place = _real_grades(bunkmate_grades)
    if tied_second_place:
        return True, "Three-grade bunk with tied second-place — satisfied"
    if real is not None:
        bunkmate_grades = real

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

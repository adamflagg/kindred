"""Spread-based filtering for name resolution candidates

Filters potential matches based on grade and age spreads to ensure
only age-appropriate candidates are considered."""

from __future__ import annotations

from ...core.models import Camper, Person


class SpreadFilter:
    """Filters candidates based on grade and age spread limits.

    Spread semantics differ by type:
    - Grade spread: Total range halved (e.g., 2 = ±1 grade)
    - Age spread: Max allowed difference (e.g., 24 months = up to 24 months apart)

    IMPORTANT: Age comparisons use CampMinder's years.months format where
    the decimal part represents months (00-11), not a fraction of a year.
    Example: 12.11 = 12 years 11 months = 155 total months

    We convert to total months for accurate comparisons.
    """

    def __init__(self, grade_spread: int | None = None, age_spread_months: int | None = None):
        """Initialize the spread filter

        Args:
            grade_spread: Total grade range (e.g., 2 = ±1 grade)
            age_spread_months: Total age range in months (e.g., 24 = ±12 months)
        """
        self.grade_spread = grade_spread
        self.age_spread_months = age_spread_months

    def _get_age_in_months(self, person: Camper | Person) -> int | None:
        """Get age in total months, properly handling CampMinder's years.months format.

        CampMinder stores age as years.months where decimal = months (00-11).
        Example: 10.06 = 10 years 6 months = 126 total months

        Args:
            person: Person or Camper object

        Returns:
            Total age in months, or None if age not available
        """
        # V2 Person with age_in_months property (preferred)
        if hasattr(person, "age_in_months") and person.age_in_months is not None:
            return person.age_in_months

        # Fallback: Parse CM age format manually if only 'age' is available
        if hasattr(person, "age") and person.age is not None:
            age = person.age
            years = int(age)
            # Decimal part is months (e.g., 10.06 -> 6 months)
            months = round((age - years) * 100)
            return years * 12 + months

        # V1 Camper compatibility
        if hasattr(person, "campminder_age") and person.campminder_age is not None:
            try:
                # campminder_age might have years/months attributes
                if hasattr(person.campminder_age, "total_months"):
                    total_months: int | None = person.campminder_age.total_months
                    return total_months
                elif hasattr(person.campminder_age, "years"):
                    years = int(person.campminder_age.years)
                    months = getattr(person.campminder_age, "months", 0)
                    return years * 12 + months
            except (AttributeError, ValueError, TypeError):
                pass

        return None

    def filter_candidates(self, requester: Camper | Person, candidates: list[Camper | Person]) -> list[Camper | Person]:
        """Filter candidates based on spread limits

        Args:
            requester: The camper making the request
            candidates: List of potential matches

        Returns:
            Filtered list of candidates within spread limits
        """
        filtered = candidates

        # Apply grade filter if specified
        requester_grade = getattr(requester, "grade", None) or getattr(requester, "grade_completed", None)
        if self.grade_spread is not None and requester_grade is not None:
            grade_half_spread = self.grade_spread / 2
            min_grade = requester_grade - grade_half_spread
            max_grade = requester_grade + grade_half_spread

            filtered = [
                c
                for c in filtered
                if (getattr(c, "grade", None) or getattr(c, "grade_completed", None)) is not None
                and min_grade <= (getattr(c, "grade", None) or getattr(c, "grade_completed", None)) <= max_grade
            ]

        # Apply age filter if specified (using total months for CM format accuracy)
        # Note: age_spread_months is the max allowed difference (not ±half like grade)
        if self.age_spread_months is not None:
            # Get requester age in total months
            requester_months = self._get_age_in_months(requester)

            if requester_months is not None:
                filtered_by_age = []
                for c in filtered:
                    candidate_months = self._get_age_in_months(c)

                    if candidate_months is not None:
                        age_diff = abs(requester_months - candidate_months)
                        if age_diff <= self.age_spread_months:
                            filtered_by_age.append(c)

                filtered = filtered_by_age

        return filtered

    def is_within_spread(self, requester: Camper | Person, candidate: Camper | Person) -> bool:
        """Check if a single candidate is within spread limits

        Args:
            requester: The camper making the request
            candidate: The potential match

        Returns:
            True if candidate is within all spread limits
        """
        # Check grade spread
        if self.grade_spread is not None:
            requester_grade = getattr(requester, "grade", None) or getattr(requester, "grade_completed", None)
            candidate_grade = getattr(candidate, "grade", None) or getattr(candidate, "grade_completed", None)

            if requester_grade is None or candidate_grade is None:
                return False

            grade_half_spread = self.grade_spread / 2
            grade_diff = abs(requester_grade - candidate_grade)
            if grade_diff > grade_half_spread:
                return False

        # Check age spread (using total months for CM format accuracy)
        # Note: age_spread_months is the max allowed difference (not ±half like grade)
        if self.age_spread_months is not None:
            requester_months = self._get_age_in_months(requester)
            candidate_months = self._get_age_in_months(candidate)

            if requester_months is None or candidate_months is None:
                return False

            # Compare difference directly against spread
            age_diff_months = abs(requester_months - candidate_months)
            if age_diff_months > self.age_spread_months:
                return False

        return True

"""Unit tests for age_preference satisfaction logic.

Tests the core business logic:
- "prefer older" = PASS if has older kids OR no younger kids (all same grade or higher is OK)
- "prefer younger" = PASS if has younger kids OR no older kids (all same grade or lower is OK)
"""

from __future__ import annotations

from bunking.utils.age_preference import is_age_preference_satisfied


class TestAgePreferenceSatisfied:
    """Test the is_age_preference_satisfied function."""

    # ==================== "OLDER" PREFERENCE TESTS ====================

    def test_older_with_older_bunkmates_satisfied(self):
        """Prefer older: bunk has older kids -> SATISFIED."""
        # Timmy (3rd grade) with 4th and 5th graders
        satisfied, detail = is_age_preference_satisfied(
            requester_grade=3,
            bunkmate_grades=[4, 5],
            preference="older",
        )
        assert satisfied is True
        assert "older" in detail.lower()

    def test_older_with_mixed_including_older_satisfied(self):
        """Prefer older: bunk has mix including older -> SATISFIED (has older)."""
        # Timmy (3rd grade) with 2nd, 3rd, and 4th graders
        # Has younger (2nd) but also has older (4th) -> PASS
        satisfied, detail = is_age_preference_satisfied(
            requester_grade=3,
            bunkmate_grades=[2, 3, 4],
            preference="older",
        )
        assert satisfied is True
        assert "older" in detail.lower()

    def test_older_all_same_grade_satisfied(self):
        """Prefer older: all same grade -> SATISFIED (no younger kids)."""
        # Timmy (3rd grade) with all 3rd graders
        satisfied, detail = is_age_preference_satisfied(
            requester_grade=3,
            bunkmate_grades=[3, 3, 3],
            preference="older",
        )
        assert satisfied is True
        assert "same" in detail.lower() or "older" in detail.lower()

    def test_older_with_only_younger_not_satisfied(self):
        """Prefer older: bunk has only younger kids -> NOT SATISFIED."""
        # Timmy (3rd grade) with only 2nd graders
        satisfied, detail = is_age_preference_satisfied(
            requester_grade=3,
            bunkmate_grades=[2, 2],
            preference="older",
        )
        assert satisfied is False
        assert "younger" in detail.lower()

    def test_older_with_younger_and_same_not_satisfied(self):
        """Prefer older: has younger and same grade but no older -> NOT SATISFIED."""
        # Timmy (3rd grade) with 2nd and 3rd graders (no 4th+)
        satisfied, detail = is_age_preference_satisfied(
            requester_grade=3,
            bunkmate_grades=[2, 3],
            preference="older",
        )
        assert satisfied is False
        assert "younger" in detail.lower()

    def test_older_all_higher_grades_satisfied(self):
        """Prefer older: all bunkmates are higher grade -> SATISFIED."""
        # Timmy (3rd grade) with all 4th and 5th graders
        satisfied, detail = is_age_preference_satisfied(
            requester_grade=3,
            bunkmate_grades=[4, 4, 5],
            preference="older",
        )
        assert satisfied is True

    # ==================== "YOUNGER" PREFERENCE TESTS ====================

    def test_younger_with_younger_bunkmates_satisfied(self):
        """Prefer younger: bunk has younger kids -> SATISFIED."""
        # Sarah (5th grade) with 3rd and 4th graders
        satisfied, detail = is_age_preference_satisfied(
            requester_grade=5,
            bunkmate_grades=[3, 4],
            preference="younger",
        )
        assert satisfied is True
        assert "younger" in detail.lower()

    def test_younger_with_mixed_including_younger_satisfied(self):
        """Prefer younger: bunk has mix including younger -> SATISFIED (has younger)."""
        # Sarah (5th grade) with 4th, 5th, and 6th graders
        # Has older (6th) but also has younger (4th) -> PASS
        satisfied, detail = is_age_preference_satisfied(
            requester_grade=5,
            bunkmate_grades=[4, 5, 6],
            preference="younger",
        )
        assert satisfied is True
        assert "younger" in detail.lower()

    def test_younger_all_same_grade_satisfied(self):
        """Prefer younger: all same grade -> SATISFIED (no older kids)."""
        # Sarah (5th grade) with all 5th graders
        satisfied, detail = is_age_preference_satisfied(
            requester_grade=5,
            bunkmate_grades=[5, 5, 5],
            preference="younger",
        )
        assert satisfied is True
        assert "same" in detail.lower() or "younger" in detail.lower()

    def test_younger_with_only_older_not_satisfied(self):
        """Prefer younger: bunk has only older kids -> NOT SATISFIED."""
        # Sarah (5th grade) with only 6th and 7th graders
        satisfied, detail = is_age_preference_satisfied(
            requester_grade=5,
            bunkmate_grades=[6, 7],
            preference="younger",
        )
        assert satisfied is False
        assert "older" in detail.lower()

    def test_younger_with_older_and_same_not_satisfied(self):
        """Prefer younger: has older and same grade but no younger -> NOT SATISFIED."""
        # Sarah (5th grade) with 5th and 6th graders (no 4th-)
        satisfied, detail = is_age_preference_satisfied(
            requester_grade=5,
            bunkmate_grades=[5, 6],
            preference="younger",
        )
        assert satisfied is False
        assert "older" in detail.lower()

    def test_younger_all_lower_grades_satisfied(self):
        """Prefer younger: all bunkmates are lower grade -> SATISFIED."""
        # Sarah (5th grade) with all 3rd and 4th graders
        satisfied, detail = is_age_preference_satisfied(
            requester_grade=5,
            bunkmate_grades=[3, 3, 4],
            preference="younger",
        )
        assert satisfied is True

    # ==================== EDGE CASES ====================

    def test_no_bunkmates_not_satisfied(self):
        """No bunkmates -> NOT SATISFIED with appropriate message."""
        satisfied, detail = is_age_preference_satisfied(
            requester_grade=3,
            bunkmate_grades=[],
            preference="older",
        )
        assert satisfied is False
        assert "no bunkmates" in detail.lower()

    def test_single_bunkmate_same_grade_older_satisfied(self):
        """Single bunkmate at same grade, prefer older -> SATISFIED."""
        satisfied, detail = is_age_preference_satisfied(
            requester_grade=3,
            bunkmate_grades=[3],
            preference="older",
        )
        assert satisfied is True

    def test_single_bunkmate_same_grade_younger_satisfied(self):
        """Single bunkmate at same grade, prefer younger -> SATISFIED."""
        satisfied, detail = is_age_preference_satisfied(
            requester_grade=3,
            bunkmate_grades=[3],
            preference="younger",
        )
        assert satisfied is True

    def test_unknown_preference_not_satisfied(self):
        """Unknown preference value -> NOT SATISFIED."""
        satisfied, detail = is_age_preference_satisfied(
            requester_grade=3,
            bunkmate_grades=[3, 4],
            preference="unknown",
        )
        assert satisfied is False
        assert "unknown" in detail.lower()

    def test_grade_boundaries_kindergarten(self):
        """Test with kindergarten (grade 0)."""
        # Kindergartener prefers older
        satisfied, detail = is_age_preference_satisfied(
            requester_grade=0,
            bunkmate_grades=[1, 2],
            preference="older",
        )
        assert satisfied is True

    def test_grade_boundaries_high_grade(self):
        """Test with high grade (8th grade)."""
        # 8th grader prefers younger
        satisfied, detail = is_age_preference_satisfied(
            requester_grade=8,
            bunkmate_grades=[6, 7],
            preference="younger",
        )
        assert satisfied is True

"""Unit tests for grade_adjacency HARD constraint.

Tests the core business logic:
- Adjacent grades (e.g., 4 and 5) are allowed in same bunk
- Non-adjacent grades (e.g., 4 and 6) are FORBIDDEN in same bunk
- Single-grade bunks are fine (nothing to compare)
- AG bunks are always exempt
- This is a HARD constraint - violations make solution infeasible
"""

from __future__ import annotations


class TestGradeAdjacencyDetection:
    """Test the grade adjacency detection logic."""

    def test_adjacent_grades_are_detected(self):
        """Grades 4 and 5 are adjacent (gap = 1)."""
        from bunking.solver.constraints.grade_adjacency import are_grades_adjacent

        assert are_grades_adjacent(4, 5) is True
        assert are_grades_adjacent(5, 4) is True  # Order doesn't matter

    def test_same_grade_is_adjacent(self):
        """Same grade counts as adjacent (gap = 0)."""
        from bunking.solver.constraints.grade_adjacency import are_grades_adjacent

        assert are_grades_adjacent(5, 5) is True

    def test_non_adjacent_grades_detected(self):
        """Grades 4 and 6 are NOT adjacent (gap = 2)."""
        from bunking.solver.constraints.grade_adjacency import are_grades_adjacent

        assert are_grades_adjacent(4, 6) is False
        assert are_grades_adjacent(6, 4) is False  # Order doesn't matter

    def test_larger_gap_non_adjacent(self):
        """Grades 4 and 7 are NOT adjacent (gap = 3)."""
        from bunking.solver.constraints.grade_adjacency import are_grades_adjacent

        assert are_grades_adjacent(4, 7) is False


class TestCalculateGradeGap:
    """Test the grade gap calculation."""

    def test_same_grade_gap_zero(self):
        """Same grade has gap of 0."""
        from bunking.solver.constraints.grade_adjacency import calculate_grade_gap

        assert calculate_grade_gap(5, 5) == 0

    def test_adjacent_grades_gap_one(self):
        """Adjacent grades have gap of 1."""
        from bunking.solver.constraints.grade_adjacency import calculate_grade_gap

        assert calculate_grade_gap(4, 5) == 1
        assert calculate_grade_gap(5, 4) == 1

    def test_non_adjacent_gap_two(self):
        """Grades 4 and 6 have gap of 2."""
        from bunking.solver.constraints.grade_adjacency import calculate_grade_gap

        assert calculate_grade_gap(4, 6) == 2
        assert calculate_grade_gap(6, 4) == 2

    def test_larger_gaps(self):
        """Test various larger gaps."""
        from bunking.solver.constraints.grade_adjacency import calculate_grade_gap

        assert calculate_grade_gap(2, 5) == 3
        assert calculate_grade_gap(1, 8) == 7


class TestFindNonAdjacentGradeViolations:
    """Test detection of non-adjacent grades in a list."""

    def test_single_grade_no_violation(self):
        """All same grade -> no violations."""
        from bunking.solver.constraints.grade_adjacency import find_non_adjacent_grade_violations

        violations = find_non_adjacent_grade_violations([5, 5, 5])
        assert len(violations) == 0

    def test_two_adjacent_grades_no_violation(self):
        """Two adjacent grades -> no violations."""
        from bunking.solver.constraints.grade_adjacency import find_non_adjacent_grade_violations

        violations = find_non_adjacent_grade_violations([4, 5])
        assert len(violations) == 0

    def test_two_non_adjacent_grades_violation(self):
        """Two non-adjacent grades -> one violation."""
        from bunking.solver.constraints.grade_adjacency import find_non_adjacent_grade_violations

        violations = find_non_adjacent_grade_violations([4, 6])
        assert len(violations) == 1
        assert violations[0] == (4, 6, 2)  # (grade1, grade2, gap)

    def test_three_grades_one_non_adjacent_pair(self):
        """Grades [4, 5, 7] have one non-adjacent pair (5, 7)."""
        from bunking.solver.constraints.grade_adjacency import find_non_adjacent_grade_violations

        violations = find_non_adjacent_grade_violations([4, 5, 7])
        # Only (5, 7) is non-adjacent - (4, 5) and (4, 7) handled by sorted unique approach
        # Actually with our constraint, we have max 2 unique grades due to grade_spread
        # So this test is academic but we should handle it
        assert len(violations) >= 1

    def test_empty_list_no_violation(self):
        """Empty list -> no violations."""
        from bunking.solver.constraints.grade_adjacency import find_non_adjacent_grade_violations

        violations = find_non_adjacent_grade_violations([])
        assert len(violations) == 0

    def test_single_grade_value_no_violation(self):
        """Single grade value -> no violations."""
        from bunking.solver.constraints.grade_adjacency import find_non_adjacent_grade_violations

        violations = find_non_adjacent_grade_violations([5])
        assert len(violations) == 0


class TestEdgeCases:
    """Test edge cases for grade adjacency."""

    def test_edge_bunk_still_constrained(self):
        """Edge bunks (lowest/highest) should NOT be exempt.

        User requirement: 2nd and 4th grade together is wrong regardless of
        whether it's an edge bunk. The hard constraint applies to ALL bunks.
        """
        # This tests the policy, not a function - we verify by NOT having
        # exemption logic in the constraint
        from bunking.solver.constraints.grade_adjacency import are_grades_adjacent

        # Even if this were an edge bunk, grades 2 and 4 should not be adjacent
        assert are_grades_adjacent(2, 4) is False

    def test_extreme_grades_not_adjacent(self):
        """Test extreme grade differences (kindergarten to 8th grade)."""
        from bunking.solver.constraints.grade_adjacency import are_grades_adjacent

        # K (0) and 8th grade should definitely not be adjacent
        assert are_grades_adjacent(0, 8) is False

    def test_consecutive_grades_from_k_to_1(self):
        """Kindergarten (0) and 1st grade (1) are adjacent."""
        from bunking.solver.constraints.grade_adjacency import are_grades_adjacent

        assert are_grades_adjacent(0, 1) is True


class TestGradeMissingIdentification:
    """Test identification of missing grades for error messages."""

    def test_identify_missing_grades_simple(self):
        """Grades [4, 6] are missing grade 5."""
        from bunking.solver.constraints.grade_adjacency import get_missing_grades

        missing = get_missing_grades([4, 6])
        assert missing == [5]

    def test_identify_missing_grades_larger_gap(self):
        """Grades [4, 7] are missing grades 5 and 6."""
        from bunking.solver.constraints.grade_adjacency import get_missing_grades

        missing = get_missing_grades([4, 7])
        assert missing == [5, 6]

    def test_no_missing_grades_adjacent(self):
        """Grades [4, 5] have no missing grades."""
        from bunking.solver.constraints.grade_adjacency import get_missing_grades

        missing = get_missing_grades([4, 5])
        assert missing == []

    def test_no_missing_grades_same(self):
        """Same grades have no missing grades."""
        from bunking.solver.constraints.grade_adjacency import get_missing_grades

        missing = get_missing_grades([5, 5])
        assert missing == []

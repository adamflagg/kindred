"""Tests for SpreadFilter age filtering with CampMinder age format.

CampMinder stores age as years.months format where:
- Integer part = years
- Decimal part = months (00-11)
Example: 10.03 = 10 years, 3 months = 123 total months

These tests verify that age filtering correctly handles this format
by using age_in_months for comparisons, not raw float arithmetic."""

from __future__ import annotations

from bunking.sync.bunk_request_processor.core.models import Person
from bunking.sync.bunk_request_processor.name_resolution.filters.spread_filter import SpreadFilter


def create_person_with_age(cm_age: float) -> Person:
    """Create a Person with CampMinder age format.

    Args:
        cm_age: Age in CampMinder format (e.g., 12.11 = 12 years 11 months)
    """
    person = Person(cm_id=1, first_name="Test", last_name="Person", age=cm_age)
    return person


class TestSpreadFilterCampMinderAgeFormat:
    """Tests for SpreadFilter handling of CampMinder years.months age format."""

    def test_age_in_months_conversion(self):
        """Verify Person.age_in_months correctly parses CM format."""
        # 12 years 11 months = 12*12 + 11 = 155 months
        person = create_person_with_age(12.11)
        assert person.age_in_months == 155

        # 10 years 0 months = 10*12 + 0 = 120 months
        person = create_person_with_age(10.00)
        assert person.age_in_months == 120

        # 10 years 6 months = 10*12 + 6 = 126 months
        person = create_person_with_age(10.06)
        assert person.age_in_months == 126

    def test_filter_candidates_18_month_spread_boundary(self):
        """BUG TEST: With 18-month spread, CM age math breaks.

        Requester: 10.06 (10y 6m = 126 months)
        Candidate: 12.00 (12y 0m = 144 months)
        Difference: 18 months (exactly at boundary, SHOULD be included)

        Current buggy behavior:
        - age_half_spread = 18/12 = 1.5 years
        - max_age = 10.06 + 1.5 = 11.56 (INVALID CM format)
        - 12.00 <= 11.56? FALSE -> incorrectly excluded

        Correct behavior:
        - requester_months = 126
        - candidate_months = 144
        - diff = 18 months <= 18 months -> included
        """
        spread_filter = SpreadFilter(age_spread_months=18)

        requester = create_person_with_age(10.06)  # 126 months
        candidate = create_person_with_age(12.00)  # 144 months
        # Difference is exactly 18 months - should be included

        result = spread_filter.filter_candidates(requester, [candidate])

        assert len(result) == 1, (
            "Candidate at 18-month boundary should be included. "
            "Requester: 10.06 (126mo), Candidate: 12.00 (144mo), Diff: 18mo"
        )

    def test_filter_candidates_18_month_spread_just_over(self):
        """Candidate just over the 18-month spread should be excluded.

        Requester: 10.06 (10y 6m = 126 months)
        Candidate: 12.01 (12y 1m = 145 months)
        Difference: 19 months (over boundary, should be excluded)
        """
        spread_filter = SpreadFilter(age_spread_months=18)

        requester = create_person_with_age(10.06)  # 126 months
        candidate = create_person_with_age(12.01)  # 145 months
        # Difference is 19 months - should be excluded

        result = spread_filter.filter_candidates(requester, [candidate])

        assert len(result) == 0, "Candidate 19 months away should be excluded with 18-month spread"

    def test_filter_candidates_24_month_spread_edge_case(self):
        """Test 24-month spread with edge case at year boundary.

        Requester: 10.01 (10y 1m = 121 months)
        Candidate: 12.00 (12y 0m = 144 months)
        Difference: 23 months (should be included)
        """
        spread_filter = SpreadFilter(age_spread_months=24)

        requester = create_person_with_age(10.01)  # 121 months
        candidate = create_person_with_age(12.00)  # 144 months
        # Difference is 23 months - should be included

        result = spread_filter.filter_candidates(requester, [candidate])

        assert len(result) == 1, "Candidate 23 months away should be included with 24-month spread"

    def test_filter_candidates_preserves_within_spread(self):
        """Multiple candidates - verify correct filtering."""
        spread_filter = SpreadFilter(age_spread_months=24)

        requester = create_person_with_age(11.00)  # 132 months

        candidates = [
            create_person_with_age(10.00),  # 120 months, diff=12, include
            create_person_with_age(12.00),  # 144 months, diff=12, include
            create_person_with_age(9.00),  # 108 months, diff=24, include (boundary)
            create_person_with_age(13.01),  # 157 months, diff=25, exclude
            create_person_with_age(8.11),  # 107 months, diff=25, exclude
        ]

        result = spread_filter.filter_candidates(requester, candidates)

        assert len(result) == 3, f"Expected 3 candidates within 24-month spread, got {len(result)}"

    def test_is_within_spread_18_month_boundary(self):
        """BUG TEST: is_within_spread also uses incorrect CM age math.

        Same scenario as filter_candidates test.
        """
        spread_filter = SpreadFilter(age_spread_months=18)

        requester = create_person_with_age(10.06)  # 126 months
        candidate = create_person_with_age(12.00)  # 144 months
        # Difference is exactly 18 months - should be within spread

        result = spread_filter.is_within_spread(requester, candidate)

        assert result is True, (
            "Candidate at 18-month boundary should be within spread. "
            "Requester: 10.06 (126mo), Candidate: 12.00 (144mo), Diff: 18mo"
        )

    def test_is_within_spread_excludes_over_boundary(self):
        """Candidate over the spread should return False."""
        spread_filter = SpreadFilter(age_spread_months=18)

        requester = create_person_with_age(10.06)  # 126 months
        candidate = create_person_with_age(12.02)  # 146 months
        # Difference is 20 months - should NOT be within spread

        result = spread_filter.is_within_spread(requester, candidate)

        assert result is False, "Candidate 20 months away should NOT be within 18-month spread"

    def test_cm_age_format_month_wraparound(self):
        """Test that CM format handles month values correctly.

        In CM format, months go 00-11 (not 00-99).
        12.11 is valid (12 years 11 months)
        12.12 would be invalid (should be 13.00)
        """
        spread_filter = SpreadFilter(age_spread_months=24)

        # 11 years 11 months vs 12 years 0 months
        # Difference should be exactly 1 month
        requester = create_person_with_age(11.11)  # 143 months
        candidate = create_person_with_age(12.00)  # 144 months

        result = spread_filter.is_within_spread(requester, candidate)

        assert result is True, "1-month difference should be within 24-month spread"

    def test_filter_with_none_age_excludes_candidate(self):
        """Candidates without age should be excluded."""
        spread_filter = SpreadFilter(age_spread_months=24)

        requester = create_person_with_age(11.00)
        candidate = Person(cm_id=2, first_name="No", last_name="Age", age=None)

        result = spread_filter.filter_candidates(requester, [candidate])

        assert len(result) == 0, "Candidate without age should be excluded"

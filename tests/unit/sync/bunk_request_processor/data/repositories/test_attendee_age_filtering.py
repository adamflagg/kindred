"""Test CampMinder age field usage in attendee age filtering.

Modular must also use CampMinder's age field, not calculate from birth_date.

This is authoritative because bunking staff use CampMinder's age field for their
calculations of allowed age difference ranges."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import Mock

import pytest

# Add the parent directory to the path so we can import our modules
test_dir = Path(__file__).resolve().parent
project_root = test_dir.parent.parent.parent.parent.parent
sys.path.insert(0, str(project_root))


class TestCampMinderAgeFiltering:
    """Test that age filtering uses CampMinder's age field."""

    def test_person_repository_maps_campminder_age(self):
        """Test that PersonRepository._map_to_person maps CampMinder's age field.

        The database has an 'age' field from CampMinder in years.months format
        (e.g., "10.03" = 10 years, 3 months). This must be mapped to Person.age.
        """
        from bunking.sync.bunk_request_processor.data.repositories.person_repository import (
            PersonRepository,
        )

        # Create a mock PocketBase client
        mock_pb = Mock()

        # Create repository
        repo = PersonRepository(mock_pb)

        # Create mock database record with CampMinder age
        mock_record = Mock()
        mock_record.cm_id = 12345
        mock_record.first_name = "John"
        mock_record.last_name = "Doe"
        mock_record.preferred_name = None
        mock_record.birthdate = "2014-03-15"  # Also has birthdate
        mock_record.age = 10.03  # CampMinder format: 10 years, 3 months
        mock_record.grade = 5
        mock_record.school = "Test School"
        mock_record.address = None

        # Map the record
        person = repo._map_to_person(mock_record)

        # Verify CampMinder age is mapped
        assert person is not None
        assert person.age == 10.03
        assert person.age_in_months == 123  # 10*12 + 3 = 123 months

    def test_age_difference_uses_campminder_age(self):
        """Test age difference calculation uses CampMinder age, not birth_date.

        Given:
        - Person A: CampMinder age 10.03 (10 years, 3 months = 123 months)
        - Person B: CampMinder age 8.09 (8 years, 9 months = 105 months)
        - Age difference: 123 - 105 = 18 months

        If we use birth_date with days/30.44, we'd get slightly different results.
        Must use CampMinder's age field for consistency with bunking staff.
        """
        from bunking.sync.bunk_request_processor.core.models import Person

        person_a = Person(
            cm_id=1,
            first_name="Alice",
            last_name="Smith",
            age=10.03,  # 123 months
        )

        person_b = Person(
            cm_id=2,
            first_name="Bob",
            last_name="Jones",
            age=8.09,  # 105 months
        )

        # Calculate difference using CampMinder ages
        assert person_a.age_in_months is not None
        assert person_b.age_in_months is not None
        diff_months = abs(person_a.age_in_months - person_b.age_in_months)
        assert diff_months == 18

    def test_age_filtering_respects_threshold(self):
        """Test that age filtering with 24-month threshold uses CampMinder age.

        For a 24-month threshold:
        - Person within 24 months: INCLUDE
        - Person beyond 24 months: EXCLUDE

        This must be based on CampMinder's age field.
        """
        from bunking.sync.bunk_request_processor.core.models import Person

        # Requester: 10 years, 6 months = 126 months
        requester = Person(
            cm_id=100,
            first_name="Requester",
            last_name="Test",
            age=10.06,
        )

        # Within threshold: 9 years, 0 months = 108 months (diff = 18 months)
        within_threshold = Person(
            cm_id=101,
            first_name="Within",
            last_name="Range",
            age=9.0,
        )

        # At boundary: 8 years, 6 months = 102 months (diff = 24 months)
        at_boundary = Person(
            cm_id=102,
            first_name="At",
            last_name="Boundary",
            age=8.06,
        )

        # Beyond threshold: 8 years, 5 months = 101 months (diff = 25 months)
        beyond_threshold = Person(
            cm_id=103,
            first_name="Beyond",
            last_name="Range",
            age=8.05,
        )

        max_age_diff = 24

        # Verify age_in_months is not None for all persons
        assert requester.age_in_months is not None
        assert within_threshold.age_in_months is not None
        assert at_boundary.age_in_months is not None
        assert beyond_threshold.age_in_months is not None

        # Within threshold: 126 - 108 = 18 <= 24 (INCLUDE)
        diff1 = abs(requester.age_in_months - within_threshold.age_in_months)
        assert diff1 == 18
        assert diff1 <= max_age_diff

        # At boundary: 126 - 102 = 24 <= 24 (INCLUDE)
        diff2 = abs(requester.age_in_months - at_boundary.age_in_months)
        assert diff2 == 24
        assert diff2 <= max_age_diff

        # Beyond threshold: 126 - 101 = 25 > 24 (EXCLUDE)
        diff3 = abs(requester.age_in_months - beyond_threshold.age_in_months)
        assert diff3 == 25
        assert diff3 > max_age_diff


class TestPersonRepositoryAgeMapping:
    """Test that PersonRepository correctly maps the CampMinder age field."""

    def test_map_to_person_with_zero_months(self):
        """Test mapping age with zero months (e.g., 12.0 = exactly 12 years)."""
        from bunking.sync.bunk_request_processor.data.repositories.person_repository import (
            PersonRepository,
        )

        mock_pb = Mock()
        repo = PersonRepository(mock_pb)

        mock_record = Mock()
        mock_record.cm_id = 1
        mock_record.first_name = "Test"
        mock_record.last_name = "Person"
        mock_record.preferred_name = None
        mock_record.birthdate = None
        mock_record.age = 12.0  # Exactly 12 years, 0 months
        mock_record.grade = None
        mock_record.school = None
        mock_record.address = None

        person = repo._map_to_person(mock_record)
        assert person is not None

        assert person.age == 12.0
        assert person.age_in_months == 144  # 12 * 12 = 144

    def test_map_to_person_with_high_months(self):
        """Test mapping age with 11 months (max valid months value)."""
        from bunking.sync.bunk_request_processor.data.repositories.person_repository import (
            PersonRepository,
        )

        mock_pb = Mock()
        repo = PersonRepository(mock_pb)

        mock_record = Mock()
        mock_record.cm_id = 1
        mock_record.first_name = "Test"
        mock_record.last_name = "Person"
        mock_record.preferred_name = None
        mock_record.birthdate = None
        mock_record.age = 9.11  # 9 years, 11 months
        mock_record.grade = None
        mock_record.school = None
        mock_record.address = None

        person = repo._map_to_person(mock_record)
        assert person is not None

        assert person.age == 9.11
        assert person.age_in_months == 119  # 9*12 + 11 = 119

    def test_map_to_person_without_age(self):
        """Test mapping when no age field is present."""
        from bunking.sync.bunk_request_processor.data.repositories.person_repository import (
            PersonRepository,
        )

        mock_pb = Mock()
        repo = PersonRepository(mock_pb)

        mock_record = Mock()
        mock_record.cm_id = 1
        mock_record.first_name = "Test"
        mock_record.last_name = "Person"
        mock_record.preferred_name = None
        mock_record.birthdate = "2014-01-01"
        mock_record.grade = None
        mock_record.school = None
        mock_record.address = None
        # No age attribute
        del mock_record.age

        person = repo._map_to_person(mock_record)
        assert person is not None

        assert person.age is None
        assert person.age_in_months is None


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

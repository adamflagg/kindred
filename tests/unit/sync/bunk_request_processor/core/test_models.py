"""Test-Driven Development for Core Domain Models

These tests define the correct behavior for our domain models
based on the business rules documented in docs/bunk_request_business_rules.md"""

import sys
from datetime import datetime
from pathlib import Path

import pytest

# Add the parent directory to the path so we can import our modules
test_dir = Path(__file__).resolve().parent
project_root = test_dir.parent.parent.parent.parent
sys.path.insert(0, str(project_root))


class TestRequestType:
    """Test the RequestType enum"""

    def test_request_type_values(self):
        """Test that RequestType has the correct values"""
        from bunking.sync.bunk_request_processor.core.models import RequestType

        assert RequestType.BUNK_WITH.value == "bunk_with"
        assert RequestType.NOT_BUNK_WITH.value == "not_bunk_with"
        assert RequestType.AGE_PREFERENCE.value == "age_preference"

    def test_request_type_exhaustive(self):
        """Test that we have exactly 3 request types"""
        from bunking.sync.bunk_request_processor.core.models import RequestType

        assert len(RequestType) == 3


class TestRequestSource:
    """Test the RequestSource enum"""

    def test_request_source_values(self):
        """Test that RequestSource has the correct values

        Note: Values match PocketBase schema (migration 1754196925):
        - FAMILY: Parent/family requests (ret_parent_socialize_with_best, share_bunk_with)
        - STAFF: Staff requests (do_not_share_bunk_with)
        - NOTES: Internal notes (internal_notes, bunking_notes)
        """
        from bunking.sync.bunk_request_processor.core.models import RequestSource

        assert RequestSource.FAMILY.value == "family"
        assert RequestSource.STAFF.value == "staff"
        assert RequestSource.NOTES.value == "notes"

    def test_request_source_exhaustive(self):
        """Test that we have exactly 3 request sources"""
        from bunking.sync.bunk_request_processor.core.models import RequestSource

        assert len(RequestSource) == 3


class TestRequestStatus:
    """Test the RequestStatus enum"""

    def test_request_status_values(self):
        """Test that RequestStatus has the correct values"""
        from bunking.sync.bunk_request_processor.core.models import RequestStatus

        assert RequestStatus.RESOLVED.value == "resolved"
        assert RequestStatus.PENDING.value == "pending"
        assert RequestStatus.DECLINED.value == "declined"


class TestAgePreference:
    """Test the AgePreference enum"""

    def test_age_preference_values(self):
        """Test that AgePreference has only older/younger"""
        from bunking.sync.bunk_request_processor.core.models import AgePreference

        assert AgePreference.OLDER.value == "older"
        assert AgePreference.YOUNGER.value == "younger"
        assert len(AgePreference) == 2


class TestPerson:
    """Test the Person dataclass"""

    def test_person_creation(self):
        """Test creating a Person with all fields"""
        from bunking.sync.bunk_request_processor.core.models import Person

        person = Person(
            cm_id=12345,
            first_name="John",
            last_name="Doe",
            preferred_name="Johnny",
            birth_date=datetime(2010, 5, 15),
            grade=8,
            school="Lincoln Middle School",
            session_cm_id=1000002,
        )

        assert person.cm_id == 12345
        assert person.first_name == "John"
        assert person.last_name == "Doe"
        assert person.preferred_name == "Johnny"
        assert person.birth_date == datetime(2010, 5, 15)
        assert person.grade == 8
        assert person.school == "Lincoln Middle School"
        assert person.session_cm_id == 1000002

    def test_person_minimal_creation(self):
        """Test creating a Person with only required fields"""
        from bunking.sync.bunk_request_processor.core.models import Person

        person = Person(cm_id=12345, first_name="John", last_name="Doe")

        assert person.cm_id == 12345
        assert person.first_name == "John"
        assert person.last_name == "Doe"
        assert person.preferred_name is None
        assert person.birth_date is None
        assert person.grade is None
        assert person.school is None
        assert person.session_cm_id is None

    def test_person_age_calculation(self):
        """Test that Person can calculate age correctly"""
        from bunking.sync.bunk_request_processor.core.models import Person

        person = Person(cm_id=12345, first_name="John", last_name="Doe", birth_date=datetime(2010, 5, 15))

        # Test age calculation
        age = person.age_as_of(datetime(2024, 6, 1))
        assert age == 14

        # Test day before birthday
        age = person.age_as_of(datetime(2024, 5, 14))
        assert age == 13

        # Test on birthday
        age = person.age_as_of(datetime(2024, 5, 15))
        assert age == 14

    def test_person_age_calculation_no_birthdate(self):
        """Test age calculation when birth_date is None"""
        from bunking.sync.bunk_request_processor.core.models import Person

        person = Person(cm_id=12345, first_name="John", last_name="Doe", birth_date=None)

        age = person.age_as_of(datetime(2024, 6, 1))
        assert age == 0

    def test_person_full_name(self):
        """Test full name formatting"""
        from bunking.sync.bunk_request_processor.core.models import Person

        person = Person(cm_id=12345, first_name="John", last_name="Doe", preferred_name="Johnny")

        assert person.full_name == "John Doe"
        assert person.display_name == "Johnny Doe"

    def test_person_display_name_no_preferred(self):
        """Test display name when no preferred name"""
        from bunking.sync.bunk_request_processor.core.models import Person

        person = Person(cm_id=12345, first_name="John", last_name="Doe")

        assert person.display_name == "John Doe"

    def test_person_has_campminder_age_field(self):
        """Test that Person model has CampMinder's age field.

        CampMinder provides age in years.months format (e.g., "10.03" = 10 years, 3 months).
        This is the authoritative source for bunking staff calculations.
        """
        from bunking.sync.bunk_request_processor.core.models import Person

        person = Person(
            cm_id=12345,
            first_name="John",
            last_name="Doe",
            age=10.03,  # CampMinder format: 10 years, 3 months
        )

        assert person.age == 10.03

    def test_person_age_in_months_conversion(self):
        """Test that CampMinder age converts correctly to months.

        CampMinder age "10.03" means 10 years, 3 months = 123 months.
        This is what bunking staff use for age difference calculations.
        """
        from bunking.sync.bunk_request_processor.core.models import Person

        # 10 years, 3 months = 123 months
        person = Person(cm_id=12345, first_name="John", last_name="Doe", age=10.03)
        assert person.age_in_months == 123

        # 8 years, 11 months = 107 months
        person2 = Person(cm_id=12346, first_name="Jane", last_name="Doe", age=8.11)
        assert person2.age_in_months == 107

        # 12 years, 0 months = 144 months
        person3 = Person(cm_id=12347, first_name="Bob", last_name="Smith", age=12.0)
        assert person3.age_in_months == 144

    def test_person_age_in_months_none_when_no_age(self):
        """Test age_in_months returns None when no CampMinder age."""
        from bunking.sync.bunk_request_processor.core.models import Person

        person = Person(
            cm_id=12345,
            first_name="John",
            last_name="Doe",
            # No age field
        )

        assert person.age_in_months is None

    def test_person_parents_parsing(self):
        """Test that parent_names JSON is correctly parsed into a list of dicts."""
        from bunking.sync.bunk_request_processor.core.models import Person

        person = Person(
            cm_id=12345,
            first_name="Emma",
            last_name="Johnson",
            parent_names='[{"first": "Sarah", "last": "Katz", "relationship": "Mother", "is_primary": true}, {"first": "David", "last": "Johnson", "relationship": "Father", "is_primary": false}]',
        )

        parents = person.parents
        assert len(parents) == 2
        assert parents[0]["first"] == "Sarah"
        assert parents[0]["last"] == "Katz"
        assert parents[0]["relationship"] == "Mother"
        assert parents[0]["is_primary"] is True
        assert parents[1]["first"] == "David"
        assert parents[1]["last"] == "Johnson"

    def test_person_parents_empty_when_none(self):
        """Test that parents returns empty list when parent_names is None."""
        from bunking.sync.bunk_request_processor.core.models import Person

        person = Person(
            cm_id=12345,
            first_name="John",
            last_name="Doe",
            # No parent_names
        )

        assert person.parents == []

    def test_person_parents_empty_on_invalid_json(self):
        """Test that parents returns empty list on invalid JSON."""
        from bunking.sync.bunk_request_processor.core.models import Person

        person = Person(cm_id=12345, first_name="John", last_name="Doe", parent_names="not valid json")

        assert person.parents == []

    def test_person_parent_last_names(self):
        """Test extracting unique parent last names for name resolution.

        This is used when bunk requests reference campers by their parents' surnames.
        """
        from bunking.sync.bunk_request_processor.core.models import Person

        person = Person(
            cm_id=12345,
            first_name="Emma",
            last_name="Johnson",
            parent_names='[{"first": "Sarah", "last": "Katz", "relationship": "Mother"}, {"first": "David", "last": "Johnson", "relationship": "Father"}]',
        )

        last_names = person.parent_last_names
        assert len(last_names) == 2
        assert "Katz" in last_names
        assert "Johnson" in last_names

    def test_person_parent_last_names_unique(self):
        """Test that parent_last_names returns unique values only."""
        from bunking.sync.bunk_request_processor.core.models import Person

        # Both parents have same last name
        person = Person(
            cm_id=12345,
            first_name="Emma",
            last_name="Katz",
            parent_names='[{"first": "Sarah", "last": "Katz", "relationship": "Mother"}, {"first": "David", "last": "Katz", "relationship": "Father"}]',
        )

        last_names = person.parent_last_names
        assert len(last_names) == 1
        assert "Katz" in last_names

    def test_person_parent_names_formatted(self):
        """Test formatted parent names string for AI disambiguation context."""
        from bunking.sync.bunk_request_processor.core.models import Person

        person = Person(
            cm_id=12345,
            first_name="Emma",
            last_name="Johnson",
            parent_names='[{"first": "Sarah", "last": "Katz", "relationship": "Mother"}, {"first": "David", "last": "Johnson", "relationship": "Father"}]',
        )

        formatted = person.parent_names_formatted
        assert formatted == "Mother: Sarah Katz, Father: David Johnson"

    def test_person_parent_names_formatted_none_when_no_parents(self):
        """Test that parent_names_formatted returns None when no parent data."""
        from bunking.sync.bunk_request_processor.core.models import Person

        person = Person(cm_id=12345, first_name="John", last_name="Doe")

        assert person.parent_names_formatted is None

    def test_person_parent_names_formatted_handles_missing_relationship(self):
        """Test that formatting handles missing relationship type."""
        from bunking.sync.bunk_request_processor.core.models import Person

        person = Person(
            cm_id=12345, first_name="Emma", last_name="Johnson", parent_names='[{"first": "Sarah", "last": "Katz"}]'
        )

        formatted = person.parent_names_formatted
        # Should default to "Guardian" when relationship is missing
        assert formatted == "Guardian: Sarah Katz"


class TestParsedRequest:
    """Test the ParsedRequest dataclass"""

    def test_parsed_request_bunk_with(self):
        """Test creating a bunk_with parsed request"""
        from bunking.sync.bunk_request_processor.core.models import ParsedRequest, RequestSource, RequestType

        request = ParsedRequest(
            raw_text="Johnny Smith",
            request_type=RequestType.BUNK_WITH,
            target_name="Johnny Smith",
            age_preference=None,
            source_field="share_bunk_with",
            source=RequestSource.FAMILY,
            confidence=0.95,
            csv_position=0,
            metadata={"ai_model": "gpt-4"},
            notes="High confidence match",
        )

        assert request.request_type == RequestType.BUNK_WITH
        assert request.target_name == "Johnny Smith"
        assert request.age_preference is None
        assert request.source == RequestSource.FAMILY
        assert request.csv_position == 0

    def test_parsed_request_age_preference(self):
        """Test creating an age_preference parsed request"""
        from bunking.sync.bunk_request_processor.core.models import (
            AgePreference,
            ParsedRequest,
            RequestSource,
            RequestType,
        )

        request = ParsedRequest(
            raw_text="older campers",
            request_type=RequestType.AGE_PREFERENCE,
            target_name=None,
            age_preference=AgePreference.OLDER,
            source_field="ret_parent_socialize_with_best",
            source=RequestSource.FAMILY,
            confidence=1.0,
            csv_position=0,
            metadata={},
            notes=None,
        )

        assert request.request_type == RequestType.AGE_PREFERENCE
        assert request.target_name is None
        assert request.age_preference == AgePreference.OLDER


class TestBunkRequest:
    """Test the BunkRequest dataclass"""

    def test_bunk_request_creation(self):
        """Test creating a complete BunkRequest"""
        from bunking.sync.bunk_request_processor.core.models import (
            BunkRequest,
            RequestSource,
            RequestStatus,
            RequestType,
        )

        request = BunkRequest(
            requester_cm_id=12345,
            requested_cm_id=67890,
            request_type=RequestType.BUNK_WITH,
            session_cm_id=1000002,
            priority=4,
            confidence_score=0.95,
            source=RequestSource.FAMILY,
            source_field="share_bunk_with",
            csv_position=0,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={"resolution_method": "exact_match"},
        )

        assert request.requester_cm_id == 12345
        assert request.requested_cm_id == 67890
        assert request.priority == 4
        assert request.year == 2025
        assert request.status == RequestStatus.RESOLVED
        assert not request.is_placeholder

    def test_bunk_request_age_preference(self):
        """Test creating an age preference request (no requested_cm_id)"""
        from bunking.sync.bunk_request_processor.core.models import (
            BunkRequest,
            RequestSource,
            RequestStatus,
            RequestType,
        )

        request = BunkRequest(
            requester_cm_id=12345,
            requested_cm_id=None,  # No target for age preference
            request_type=RequestType.AGE_PREFERENCE,
            session_cm_id=1000002,
            priority=1,
            confidence_score=1.0,
            source=RequestSource.FAMILY,
            source_field="ret_parent_socialize_with_best",
            csv_position=0,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={"age_preference": "older"},
        )

        assert request.requested_cm_id is None
        assert request.request_type == RequestType.AGE_PREFERENCE

    def test_bunk_request_placeholder(self):
        """Test creating a LAST_YEAR_BUNKMATES placeholder"""
        from bunking.sync.bunk_request_processor.core.models import (
            BunkRequest,
            RequestSource,
            RequestStatus,
            RequestType,
        )

        request = BunkRequest(
            requester_cm_id=12345,
            requested_cm_id=None,  # Placeholder has no specific target
            request_type=RequestType.BUNK_WITH,
            session_cm_id=1000002,
            priority=4,
            confidence_score=1.0,
            source=RequestSource.FAMILY,
            source_field="share_bunk_with",
            csv_position=0,
            year=2025,
            status=RequestStatus.PENDING,  # Needs review
            is_placeholder=True,
            metadata={"placeholder_type": "LAST_YEAR_BUNKMATES", "notes": "Review prior year bunking arrangement"},
        )

        assert request.is_placeholder
        assert request.requested_cm_id is None
        assert request.status == RequestStatus.PENDING


class TestResolvedName:
    """Test the ResolvedName dataclass"""

    def test_resolved_name_successful(self):
        """Test a successful name resolution"""
        from bunking.sync.bunk_request_processor.core.models import Person, ResolvedName

        matched_person = Person(cm_id=67890, first_name="Johnny", last_name="Smith")

        alternate1 = Person(cm_id=11111, first_name="John", last_name="Smith")
        alternate2 = Person(cm_id=22222, first_name="Jonathan", last_name="Smith")

        resolved = ResolvedName(
            original_name="Johnny Smith",
            matched_cm_id=67890,
            matched_person=matched_person,
            confidence=0.95,
            resolution_method="exact_match",
            alternate_matches=[(alternate1, 0.80), (alternate2, 0.75)],
        )

        assert resolved.matched_cm_id == 67890
        assert resolved.confidence == 0.95
        assert resolved.resolution_method == "exact_match"
        assert len(resolved.alternate_matches) == 2

    def test_resolved_name_unresolved(self):
        """Test an unresolved name"""
        from bunking.sync.bunk_request_processor.core.models import ResolvedName

        resolved = ResolvedName(
            original_name="Unknown Person",
            matched_cm_id=None,
            matched_person=None,
            confidence=0.0,
            resolution_method="unresolved",
            alternate_matches=[],
        )

        assert resolved.matched_cm_id is None
        assert resolved.matched_person is None
        assert resolved.confidence == 0.0
        assert resolved.resolution_method == "unresolved"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

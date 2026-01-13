"""Test-Driven Development for AttendeeRepository

Tests the data access layer for Attendee entities.
Updated for new PocketBase schema:
- person_id (direct field with CM ID)
- session via expanded relation (session_id field was deleted)"""

import sys
from pathlib import Path
from unittest.mock import Mock

import pytest

# Add the parent directory to the path
test_dir = Path(__file__).resolve().parent
project_root = test_dir.parent.parent.parent.parent
sys.path.insert(0, str(project_root))

from bunking.sync.bunk_request_processor.data.repositories.attendee_repository import AttendeeRepository


class TestAttendeeRepository:
    """Test the AttendeeRepository data access"""

    @pytest.fixture
    def mock_pb_client(self):
        """Create a mock PocketBase client"""
        mock_client = Mock()
        mock_attendees_collection = Mock()
        mock_persons_collection = Mock()

        def collection_side_effect(name):
            if name == "attendees":
                return mock_attendees_collection
            elif name == "persons":
                return mock_persons_collection
            return Mock()

        mock_client.collection.side_effect = collection_side_effect
        return mock_client, mock_attendees_collection, mock_persons_collection

    @pytest.fixture
    def repository(self, mock_pb_client):
        """Create an AttendeeRepository with mocked client"""
        mock_client, _, _ = mock_pb_client
        return AttendeeRepository(mock_client)

    def _create_attendee_mock(self, person_id, session_cm_id, year, cabin_name=None, age=None, birth_date=None):
        """Helper to create a properly structured attendee mock.

        Note: person_id is a direct field, but session comes from expanded relation.
        """
        mock = Mock()
        mock.person_id = person_id
        mock.year = year
        # Session comes from expanded relation (session_id field was deleted)
        mock.expand = {"session": Mock(cm_id=session_cm_id)}
        if cabin_name:
            mock.cabin_name = cabin_name
        if age:
            mock.age = age
        if birth_date:
            mock.birth_date = birth_date
        return mock

    def test_get_by_person_and_year(self, repository, mock_pb_client):
        """Test getting attendee record by person CM ID and year"""
        mock_client, mock_attendees, _ = mock_pb_client

        # Mock the database response with expand pattern
        mock_result = Mock()
        mock_result.items = [
            self._create_attendee_mock(person_id=12345, session_cm_id=1000002, year=2025, cabin_name="Cabin A", age=14)
        ]
        mock_attendees.get_list.return_value = mock_result

        # Test the method
        attendee = repository.get_by_person_and_year(12345, 2025)

        # Verify the result
        assert attendee is not None
        assert attendee["person_cm_id"] == 12345
        assert attendee["session_cm_id"] == 1000002
        assert attendee["year"] == 2025
        assert attendee["cabin_name"] == "Cabin A"
        assert attendee["age"] == 14

        # Verify the query uses person_id (not person_cm_id) and includes expand
        args = mock_attendees.get_list.call_args[1]
        assert "person_id = 12345" in args["query_params"]["filter"]
        assert "year = 2025" in args["query_params"]["filter"]
        assert args["query_params"]["expand"] == "session"

    def test_get_by_person_and_year_not_found(self, repository, mock_pb_client):
        """Test when attendee record doesn't exist"""
        mock_client, mock_attendees, _ = mock_pb_client

        # Mock empty response
        mock_result = Mock()
        mock_result.items = []
        mock_attendees.get_list.return_value = mock_result

        attendee = repository.get_by_person_and_year(99999, 2025)
        assert attendee is None

    def test_get_session_attendees(self, repository, mock_pb_client):
        """Test getting all attendees for a session"""
        mock_client, mock_attendees, _ = mock_pb_client

        # Mock multiple attendee records with expand pattern
        # Note: We filter by session_cm_id in Python after expanding
        mock_attendees_list = [
            self._create_attendee_mock(12345, 1000002, 2025, age=14),
            self._create_attendee_mock(67890, 1000002, 2025, age=13),
            self._create_attendee_mock(11111, 1000002, 2025, age=15),
            # This one is for a different session - should be filtered out
            self._create_attendee_mock(22222, 1000003, 2025, age=14),
        ]
        mock_attendees.get_full_list.return_value = mock_attendees_list

        attendees = repository.get_session_attendees(1000002, 2025)

        # Should only return attendees for session 1000002
        assert len(attendees) == 3
        assert attendees[0]["person_cm_id"] == 12345
        assert attendees[1]["person_cm_id"] == 67890
        assert attendees[2]["person_cm_id"] == 11111
        assert all(a["session_cm_id"] == 1000002 for a in attendees)
        assert all(a["year"] == 2025 for a in attendees)

    def test_get_session_attendees_returns_name_and_grade(self, repository, mock_pb_client):
        """Test that get_session_attendees returns name and grade fields.

        - name: "{first_name} {last_name}"
        - person_id: CM ID
        - grade: grade_completed from person
        - age: parsed age
        - session: session CM ID
        """
        mock_client, mock_attendees, mock_persons = mock_pb_client

        # Mock attendee records with expand pattern
        mock_attendees_list = [
            self._create_attendee_mock(12345, 1000002, 2025, age=14),
            self._create_attendee_mock(67890, 1000002, 2025, age=13),
        ]
        mock_attendees.get_full_list.return_value = mock_attendees_list

        # Create Person objects for bulk_find_by_cm_ids
        from bunking.sync.bunk_request_processor.core.models import Person

        person1 = Person(cm_id=12345, first_name="John", last_name="Smith", grade=8)
        person2 = Person(cm_id=67890, first_name="Jane", last_name="Doe", grade=7)

        # Mock the person_repo.bulk_find_by_cm_ids method directly
        repository.person_repo.bulk_find_by_cm_ids = Mock(
            return_value={
                12345: person1,
                67890: person2,
            }
        )

        attendees = repository.get_session_attendees(1000002, 2025)

        assert len(attendees) == 2

        # Check first attendee has name and grade
        assert attendees[0]["name"] == "John Smith"
        assert attendees[0]["grade"] == 8
        assert attendees[0]["person_id"] == 12345

        # Check second attendee
        assert attendees[1]["name"] == "Jane Doe"
        assert attendees[1]["grade"] == 7
        assert attendees[1]["person_id"] == 67890

    def test_get_session_attendees_caches_results(self, repository, mock_pb_client):
        """Test that get_session_attendees caches results.

        for O(1) lookups instead of hitting DB every time.
        """
        mock_client, mock_attendees, mock_persons = mock_pb_client

        # Mock attendee records
        mock_attendees_list = [
            self._create_attendee_mock(12345, 1000002, 2025, age=14),
        ]
        mock_attendees.get_full_list.return_value = mock_attendees_list

        # Mock person_repo.bulk_find_by_cm_ids
        from bunking.sync.bunk_request_processor.core.models import Person

        person1 = Person(cm_id=12345, first_name="John", last_name="Smith", grade=8)
        repository.person_repo.bulk_find_by_cm_ids = Mock(return_value={12345: person1})

        # First call
        attendees1 = repository.get_session_attendees(1000002, 2025)

        # Second call - should use cache, not hit DB again
        attendees2 = repository.get_session_attendees(1000002, 2025)

        # Results should be the same
        assert attendees1 == attendees2

        # DB should only be called once for attendees (cached on second call)
        assert mock_attendees.get_full_list.call_count == 1

    def test_get_session_attendees_cache_per_session(self, repository, mock_pb_client):
        """Test that cache is per-session - different sessions hit DB separately."""
        mock_client, mock_attendees, mock_persons = mock_pb_client

        # Mock attendee records for two sessions
        def attendees_side_effect(**kwargs):
            filter_str = kwargs.get("query_params", {}).get("filter", "")
            if "year = 2025" in filter_str:
                return [
                    self._create_attendee_mock(12345, 1000002, 2025),
                    self._create_attendee_mock(67890, 1000003, 2025),
                ]
            return []

        mock_attendees.get_full_list.side_effect = attendees_side_effect

        # Mock person_repo.bulk_find_by_cm_ids
        from bunking.sync.bunk_request_processor.core.models import Person

        person1 = Person(cm_id=12345, first_name="John", last_name="Smith", grade=8)
        person2 = Person(cm_id=67890, first_name="Jane", last_name="Doe", grade=7)

        def bulk_find_side_effect(cm_ids):
            result = {}
            if 12345 in cm_ids:
                result[12345] = person1
            if 67890 in cm_ids:
                result[67890] = person2
            return result

        repository.person_repo.bulk_find_by_cm_ids = Mock(side_effect=bulk_find_side_effect)

        # Call for session 1000002
        attendees1 = repository.get_session_attendees(1000002, 2025)

        # Call for different session 1000003
        attendees2 = repository.get_session_attendees(1000003, 2025)

        # Call for session 1000002 again - should use cache
        attendees3 = repository.get_session_attendees(1000002, 2025)

        # First session should have John
        assert len(attendees1) == 1
        assert attendees1[0]["person_id"] == 12345

        # Second session should have Jane
        assert len(attendees2) == 1
        assert attendees2[0]["person_id"] == 67890

        # Third call returns same as first (cached)
        assert attendees1 == attendees3

    def test_get_age_filtered_session_peers(self, repository, mock_pb_client):
        """Test getting peers within age range from same session"""
        mock_client, mock_attendees, mock_persons = mock_pb_client

        # First, mock getting the requester's info
        mock_requester_result = Mock()
        mock_requester_result.items = [
            self._create_attendee_mock(
                person_id=12345, session_cm_id=1000002, year=2025, age=14, birth_date="2010-05-15"
            )
        ]

        # Then mock getting session attendees (via get_full_list with expand)
        mock_attendees_list = [
            self._create_attendee_mock(12345, 1000002, 2025, age=14),  # Self
            self._create_attendee_mock(67890, 1000002, 2025, age=14),  # Same age
            self._create_attendee_mock(11111, 1000002, 2025, age=13),  # 1 year younger
            self._create_attendee_mock(22222, 1000002, 2025, age=16),  # 2 years older
            self._create_attendee_mock(33333, 1000002, 2025, age=10),  # 4 years younger (too far)
        ]

        # Mock person details - persons repository does its own lookup
        def create_person_mock(cm_id, fname, lname, birth_date):
            mock = Mock()
            mock.cm_id = cm_id
            mock.first_name = fname
            mock.last_name = lname
            mock.preferred_name = None
            mock.birthdate = birth_date
            mock.grade = 8
            mock.school = "Test School"
            mock.birth_date = Mock()  # For Person model
            return mock

        mock_persons_result = Mock()
        mock_persons_result.items = [
            create_person_mock(67890, "Jane", "Smith", "2010-05-20"),
            create_person_mock(11111, "Bob", "Wilson", "2011-03-10"),
            create_person_mock(22222, "Alice", "Johnson", "2008-07-25"),
        ]

        # Set up the mock returns - get_list for requester, get_full_list for all attendees
        mock_attendees.get_list.return_value = mock_requester_result
        mock_attendees.get_full_list.return_value = mock_attendees_list
        mock_persons.get_list.return_value = mock_persons_result

        # Test with 24 month filter
        peers = repository.get_age_filtered_session_peers(12345, 1000002, 2025, max_age_diff_months=24)

        # Should return 3 peers (excluding self and too-young peer)
        assert len(peers) == 3
        cm_ids = [p.cm_id for p in peers]
        assert 12345 not in cm_ids  # Self excluded
        assert 67890 in cm_ids  # Same age included
        assert 11111 in cm_ids  # 1 year younger included
        assert 22222 in cm_ids  # 2 years older included
        assert 33333 not in cm_ids  # 4 years younger excluded

    def test_get_age_filtered_peers_handles_missing_birth_dates(self, repository, mock_pb_client):
        """Test age filtering when some peers have no birth date"""
        mock_client, mock_attendees, mock_persons = mock_pb_client

        # Mock requester
        mock_requester_result = Mock()
        mock_requester_result.items = [self._create_attendee_mock(12345, 1000002, 2025, birth_date="2010-05-15")]

        # Mock attendees (some without ages)
        mock_attendees_list = [
            self._create_attendee_mock(12345, 1000002, 2025, age=14),
            self._create_attendee_mock(67890, 1000002, 2025, age=14),
            self._create_attendee_mock(11111, 1000002, 2025, age=None),  # No age
            self._create_attendee_mock(22222, 1000002, 2025, age=13),
        ]

        # Mock persons - one without birth date
        def create_person_mock(cm_id, fname, lname, birth_date):
            mock = Mock()
            mock.cm_id = cm_id
            mock.first_name = fname
            mock.last_name = lname
            mock.preferred_name = None
            mock.birthdate = birth_date
            mock.grade = 8
            mock.school = "Test School"
            mock.birth_date = None if birth_date is None else Mock()
            return mock

        mock_persons_result = Mock()
        mock_persons_result.items = [
            create_person_mock(67890, "Jane", "Smith", "2010-05-20"),
            create_person_mock(11111, "Bob", "Wilson", None),  # No birth date
            create_person_mock(22222, "Alice", "Johnson", "2011-03-10"),
        ]

        mock_attendees.get_list.return_value = mock_requester_result
        mock_attendees.get_full_list.return_value = mock_attendees_list
        mock_persons.get_list.return_value = mock_persons_result

        peers = repository.get_age_filtered_session_peers(12345, 1000002, 2025)

        # Should include peers with known birth dates, exclude those without
        assert len(peers) == 2
        cm_ids = [p.cm_id for p in peers]
        assert 67890 in cm_ids
        assert 22222 in cm_ids
        assert 11111 not in cm_ids  # Excluded due to missing birth date

    def test_bulk_get_sessions_for_persons(self, repository, mock_pb_client):
        """Test getting session info for multiple people at once"""
        mock_client, mock_attendees, _ = mock_pb_client

        # Mock response with multiple attendee records using expand pattern
        mock_result = Mock()
        mock_result.items = [
            self._create_attendee_mock(12345, 1000002, 2025),
            self._create_attendee_mock(67890, 1000003, 2025),
            self._create_attendee_mock(11111, 1000002, 2025),
            # 99999 not found
        ]
        mock_attendees.get_list.return_value = mock_result

        # Test bulk lookup
        sessions = repository.bulk_get_sessions_for_persons([12345, 67890, 11111, 99999], 2025)

        assert len(sessions) == 3
        assert sessions[12345] == 1000002
        assert sessions[67890] == 1000003
        assert sessions[11111] == 1000002
        assert 99999 not in sessions

        # Verify query uses person_id (not person_cm_id) with OR clauses and expand
        args = mock_attendees.get_list.call_args[1]
        filter_str = args["query_params"]["filter"]
        # Query uses OR clauses for person_id
        assert "person_id = 12345" in filter_str
        assert "person_id = 67890" in filter_str
        assert "year = 2025" in filter_str
        # Should request expand for session
        assert args["query_params"]["expand"] == "session"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

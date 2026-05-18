"""Test-Driven Development for AttendeeRepository

Tests the data access layer for Attendee entities.
Updated for new PocketBase schema:
- person_id (direct field with CM ID)
- session via expanded relation (session_id field was deleted)"""

import sys
from pathlib import Path
from unittest.mock import Mock, patch

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
        """Test getting session info for multiple people at once.

        Uses get_full_list and filters to bunking-relevant session types only.
        """
        mock_client, mock_attendees, _ = mock_pb_client

        # Helper to create attendee mock with session_type
        def make_attendee(person_id, session_cm_id, year, session_type="main"):
            mock = Mock()
            mock.person_id = person_id
            mock.year = year
            session_mock = Mock()
            session_mock.cm_id = session_cm_id
            session_mock.session_type = session_type
            mock.expand = {"session": session_mock}
            return mock

        # Mock response with multiple attendee records using expand pattern
        mock_attendees.get_full_list.return_value = [
            make_attendee(12345, 1000002, 2025, session_type="main"),
            make_attendee(67890, 1000003, 2025, session_type="main"),
            make_attendee(11111, 1000002, 2025, session_type="main"),
            # 99999 not found
        ]

        # Test bulk lookup
        sessions = repository.bulk_get_sessions_for_persons([12345, 67890, 11111, 99999], 2025)

        assert len(sessions) == 3
        assert sessions[12345] == 1000002
        assert sessions[67890] == 1000003
        assert sessions[11111] == 1000002
        assert 99999 not in sessions

        # Verify query uses person_id (not person_cm_id) with OR clauses and expand
        args = mock_attendees.get_full_list.call_args[1]
        filter_str = args["query_params"]["filter"]
        # Query uses OR clauses for person_id
        assert "person_id = 12345" in filter_str
        assert "person_id = 67890" in filter_str
        assert "year = 2025" in filter_str
        # Should request expand for session
        assert args["query_params"]["expand"] == "session"

    def test_bulk_get_all_sessions_for_persons(self, repository, mock_pb_client):
        """Test getting ALL bunking sessions per person (multi-enrollment aware).

        Unlike bulk_get_sessions_for_persons (which collapses to one session
        per person), returns the full list of bunking enrollments.
        """
        mock_client, mock_attendees, _ = mock_pb_client

        def make_attendee(person_id, session_cm_id, year, session_type="main"):
            mock = Mock()
            mock.person_id = person_id
            mock.year = year
            session_mock = Mock()
            session_mock.cm_id = session_cm_id
            session_mock.session_type = session_type
            mock.expand = {"session": session_mock}
            return mock

        # Person 12345 enrolled in TWO bunking sessions; person 67890 in one
        mock_attendees.get_full_list.return_value = [
            make_attendee(12345, 1000001, 2025, session_type="main"),
            make_attendee(12345, 1000002, 2025, session_type="ag"),
            make_attendee(67890, 1000003, 2025, session_type="main"),
            # Non-bunking session — must be excluded
            make_attendee(12345, 9000001, 2025, session_type="family_camp"),
        ]

        sessions = repository.bulk_get_all_sessions_for_persons([12345, 67890], 2025)

        # Person 12345 has BOTH bunking enrollments returned (multi-enrollment)
        assert sorted(sessions[12345]) == [1000001, 1000002]
        # Family-camp session is NOT included
        assert 9000001 not in sessions[12345]
        # Person 67890 has one enrollment
        assert sessions[67890] == [1000003]

        # Verify query shape
        args = mock_attendees.get_full_list.call_args[1]
        assert "person_id = 12345" in args["query_params"]["filter"]
        assert "person_id = 67890" in args["query_params"]["filter"]
        assert "year = 2025" in args["query_params"]["filter"]
        assert args["query_params"]["expand"] == "session"

    def test_bulk_get_all_sessions_for_persons_empty_input(self, repository, mock_pb_client):
        """Empty input returns empty dict without DB hit."""
        _, mock_attendees, _ = mock_pb_client
        assert repository.bulk_get_all_sessions_for_persons([], 2025) == {}
        mock_attendees.get_full_list.assert_not_called()


class TestBulkGetSessionsFiltersBunkingSessions:
    """Tests that bulk_get_sessions_for_persons only returns bunking-relevant sessions.

    Bug: Campers enrolled in both summer camp (Session 2) and Family Camp get
    their session incorrectly identified as Family Camp. This causes the
    ExactMatchStrategy to see a "different session" match and return lower
    confidence, preventing auto-resolution.

    Root cause: No session_type filter + per_page too small + last-write-wins
    on multi-enrolled campers.
    """

    @pytest.fixture
    def mock_pb_client(self):
        mock_client = Mock()
        mock_attendees_collection = Mock()
        mock_sessions_collection = Mock()
        mock_persons_collection = Mock()

        collections = {
            "attendees": mock_attendees_collection,
            "camp_sessions": mock_sessions_collection,
            "persons": mock_persons_collection,
        }

        def collection_side_effect(name):
            return collections.get(name, Mock())

        mock_client.collection.side_effect = collection_side_effect
        return mock_client, mock_attendees_collection, mock_sessions_collection

    @pytest.fixture
    def repository(self, mock_pb_client):
        mock_client, _, _ = mock_pb_client
        return AttendeeRepository(mock_client)

    def _create_attendee_mock(self, person_id, session_cm_id, year, session_type="main"):
        mock = Mock()
        mock.person_id = person_id
        mock.year = year
        session_mock = Mock()
        session_mock.cm_id = session_cm_id
        session_mock.session_type = session_type
        mock.expand = {"session": session_mock}
        return mock

    def test_filters_out_family_camp_enrollment(self, repository, mock_pb_client):
        """A camper in Session 2 + Family Camp should map to Session 2 only."""
        _, mock_attendees, _ = mock_pb_client

        mock_result = Mock()
        mock_result.items = [
            self._create_attendee_mock(12345, 1235404, 2026, session_type="main"),
            self._create_attendee_mock(12345, 1309517, 2026, session_type="family"),
        ]
        mock_attendees.get_full_list.return_value = mock_result.items

        sessions = repository.bulk_get_sessions_for_persons([12345], 2026)

        assert sessions[12345] == 1235404  # Session 2, not Family Camp

    def test_filters_out_quest_enrollment(self, repository, mock_pb_client):
        """A camper in Session 4 + Quest should map to Session 4 only."""
        _, mock_attendees, _ = mock_pb_client

        mock_result = Mock()
        mock_result.items = [
            self._create_attendee_mock(67890, 1235406, 2026, session_type="main"),
            self._create_attendee_mock(67890, 1236365, 2026, session_type="quest"),
        ]
        mock_attendees.get_full_list.return_value = mock_result.items

        sessions = repository.bulk_get_sessions_for_persons([67890], 2026)

        assert sessions[67890] == 1235406  # Session 4, not Quest

    def test_includes_ag_and_embedded_sessions(self, repository, mock_pb_client):
        """AG and embedded sessions are bunking-relevant and should be included."""
        _, mock_attendees, _ = mock_pb_client

        mock_result = Mock()
        mock_result.items = [
            self._create_attendee_mock(11111, 1378704, 2026, session_type="ag"),
            self._create_attendee_mock(22222, 1356533, 2026, session_type="embedded"),
        ]
        mock_attendees.get_full_list.return_value = mock_result.items

        sessions = repository.bulk_get_sessions_for_persons([11111, 22222], 2026)

        assert sessions[11111] == 1378704
        assert sessions[22222] == 1356533

    def test_handles_multi_enrolled_campers_with_many_persons(self, repository, mock_pb_client):
        """With 200+ persons, all enrollments must be fetched (not truncated by per_page)."""
        _, mock_attendees, _ = mock_pb_client

        # 3 campers: one with 2 enrollments, two with 1
        mock_result = Mock()
        mock_result.items = [
            self._create_attendee_mock(100, 1235404, 2026, session_type="main"),
            self._create_attendee_mock(100, 1309514, 2026, session_type="family"),
            self._create_attendee_mock(200, 1235405, 2026, session_type="main"),
            self._create_attendee_mock(300, 1235406, 2026, session_type="main"),
        ]
        mock_attendees.get_full_list.return_value = mock_result.items

        sessions = repository.bulk_get_sessions_for_persons([100, 200, 300], 2026)

        assert sessions[100] == 1235404  # Session 2, not Family Camp
        assert sessions[200] == 1235405  # Session 3
        assert sessions[300] == 1235406  # Session 4

    def test_camper_only_in_non_bunking_sessions_excluded(self, repository, mock_pb_client):
        """A camper only in Family Camp / Quest should not appear in results."""
        _, mock_attendees, _ = mock_pb_client

        mock_result = Mock()
        mock_result.items = [
            self._create_attendee_mock(99999, 1309514, 2026, session_type="family"),
        ]
        mock_attendees.get_full_list.return_value = mock_result.items

        sessions = repository.bulk_get_sessions_for_persons([99999], 2026)

        assert 99999 not in sessions

    def test_uses_get_full_list_not_get_list(self, repository, mock_pb_client):
        """Must use get_full_list to avoid per_page truncation with multi-enrolled campers."""
        _, mock_attendees, _ = mock_pb_client

        mock_attendees.get_full_list.return_value = [
            self._create_attendee_mock(12345, 1235404, 2026, session_type="main"),
        ]

        repository.bulk_get_sessions_for_persons([12345], 2026)

        mock_attendees.get_full_list.assert_called_once()
        mock_attendees.get_list.assert_not_called()

    def test_handles_none_expand_in_session_type_filter(self, repository, mock_pb_client):
        """item.expand = None on line 257 must not raise AttributeError.

        Bug #658: In _bulk_get_sessions_chunk, line 257 uses an unsafe pattern:
            getattr(item, "expand", {}).get("session")
        If item.expand exists but is None, getattr returns None (not {}),
        and .get("session") raises AttributeError. The broad except block then
        returns {} — losing ALL results, not just the bad item.

        This test patches _get_session_cm_id to return a valid value so the
        early guard on line 253 doesn't skip the item, forcing execution to
        reach the unsafe expand access on line 257.
        """
        from unittest.mock import patch

        _, mock_attendees, _ = mock_pb_client

        # Create an item where expand is explicitly None but person_id exists
        mock_bad_item = Mock()
        mock_bad_item.person_id = 12345
        mock_bad_item.year = 2026
        mock_bad_item.expand = None  # attribute exists but is None

        # Create a valid item that should still be returned
        mock_good_item = self._create_attendee_mock(67890, 1235404, 2026, session_type="main")

        mock_attendees.get_full_list.return_value = [mock_bad_item, mock_good_item]

        # Patch _get_session_cm_id so the None-expand item isn't skipped at line 253
        original_get_session = repository._get_session_cm_id

        def patched_get_session(item):
            if getattr(item, "person_id", None) == 12345:
                return 9999999  # Fake session CM ID to bypass early guard
            return original_get_session(item)

        with patch.object(repository, "_get_session_cm_id", side_effect=patched_get_session):
            sessions = repository.bulk_get_sessions_for_persons([12345, 67890], 2026)

        # The None-expand item should be skipped gracefully (no valid session type)
        assert 12345 not in sessions
        # The valid item MUST still be returned — not lost to a broad except
        assert sessions[67890] == 1235404


class TestBulkGetSessionsLogging:
    """Tests that silent except blocks log exceptions instead of swallowing them."""

    @pytest.fixture
    def mock_pb_client(self):
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
        mock_client, _, _ = mock_pb_client
        return AttendeeRepository(mock_client)

    def test_bulk_get_sessions_logs_exception_on_query_failure(self, repository, mock_pb_client):
        """Silent except blocks must log — not swallow — exceptions."""
        _, mock_attendees, _ = mock_pb_client
        mock_attendees.get_full_list.side_effect = Exception("PB connection failed")

        with patch("bunking.sync.bunk_request_processor.data.repositories.attendee_repository.logger") as mock_logger:
            result = repository.bulk_get_sessions_for_persons([12345], 2025)

        assert result == {}
        mock_logger.exception.assert_called_once()

    def test_get_session_attendees_logs_exception(self, repository, mock_pb_client):
        """get_session_attendees must log exceptions."""
        _, mock_attendees, _ = mock_pb_client
        mock_attendees.get_full_list.side_effect = Exception("DB timeout")

        with patch("bunking.sync.bunk_request_processor.data.repositories.attendee_repository.logger") as mock_logger:
            result = repository.get_session_attendees(1000002, 2025)

        assert result == []
        mock_logger.exception.assert_called_once()

    def test_get_age_filtered_peers_logs_exception(self, repository, mock_pb_client):
        """get_age_filtered_session_peers must log exceptions."""
        _, mock_attendees, _ = mock_pb_client

        # get_by_person_and_year must succeed (it has its own intentional silent catch)
        mock_result = Mock()
        mock_attendee = Mock()
        mock_attendee.person_id = 12345
        mock_attendee.year = 2025
        mock_attendee.birth_date = "2010-05-15"
        mock_attendee.expand = {"session": Mock(cm_id=1000002)}
        mock_result.items = [mock_attendee]
        mock_attendees.get_list.return_value = mock_result

        # Then make the session attendees call fail (triggers outer except)
        mock_attendees.get_full_list.side_effect = Exception("Session query failed")

        with patch("bunking.sync.bunk_request_processor.data.repositories.attendee_repository.logger") as mock_logger:
            result = repository.get_age_filtered_session_peers(12345, 1000002, 2025)

        assert result == []
        mock_logger.exception.assert_called()


class TestBulkGetSessionsStatusPriority:
    """Tests that enrolled sessions are prioritized over applied/waitlisted."""

    @pytest.fixture
    def mock_pb_client(self):
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
        mock_client, _, _ = mock_pb_client
        return AttendeeRepository(mock_client)

    def _make_attendee(self, person_id, session_cm_id, status_id, session_type="main"):
        mock = Mock()
        mock.person_id = person_id
        mock.status_id = status_id
        session_mock = Mock()
        session_mock.cm_id = session_cm_id
        session_mock.session_type = session_type
        mock.expand = {"session": session_mock}
        return mock

    def test_enrolled_session_not_overwritten_by_applied(self, repository, mock_pb_client):
        """When person has enrolled (2) + applied (8) bunking sessions, enrolled wins."""
        _, mock_attendees, _ = mock_pb_client

        # Enrolled in main session, applied for embedded — enrolled should win
        mock_attendees.get_full_list.return_value = [
            self._make_attendee(1000001, 1000010, 2, "main"),  # enrolled
            self._make_attendee(1000001, 1000011, 8, "embedded"),  # applied — should NOT overwrite
        ]

        sessions = repository.bulk_get_sessions_for_persons([1000001], 2026)
        assert sessions[1000001] == 1000010  # enrolled session wins

    def test_enrolled_not_overwritten_by_waitlisted(self, repository, mock_pb_client):
        """Enrolled session not overwritten by a waitlisted one."""
        _, mock_attendees, _ = mock_pb_client

        mock_attendees.get_full_list.return_value = [
            self._make_attendee(12345, 1000010, 2, "main"),  # enrolled
            self._make_attendee(12345, 1000013, 4, "main"),  # waitlisted
        ]

        sessions = repository.bulk_get_sessions_for_persons([12345], 2026)
        assert sessions[12345] == 1000010

    def test_non_enrolled_can_be_overwritten_by_enrolled(self, repository, mock_pb_client):
        """If applied comes first, enrolled later should overwrite."""
        _, mock_attendees, _ = mock_pb_client

        mock_attendees.get_full_list.return_value = [
            self._make_attendee(12345, 1000011, 8, "embedded"),  # applied first
            self._make_attendee(12345, 1000010, 2, "main"),  # enrolled later — should win
        ]

        sessions = repository.bulk_get_sessions_for_persons([12345], 2026)
        assert sessions[12345] == 1000010

    def test_cancelled_only_still_appears_in_results(self, repository, mock_pb_client):
        """Person with only cancelled bunking enrollment still appears (ConflictDetector handles decline)."""
        _, mock_attendees, _ = mock_pb_client

        mock_attendees.get_full_list.return_value = [
            self._make_attendee(1000002, 1000012, 32, "main"),  # cancelled
        ]

        sessions = repository.bulk_get_sessions_for_persons([1000002], 2026)
        assert 1000002 in sessions


class TestBulkGetEnrollmentForPersons:
    """Tests for bulk_get_enrollment_for_persons — returns EnrollmentInfo with status_id."""

    @pytest.fixture
    def mock_pb_client(self):
        mock_client = Mock()
        mock_attendees_collection = Mock()
        mock_sessions_collection = Mock()

        def collection_side_effect(name):
            if name == "attendees":
                return mock_attendees_collection
            elif name == "camp_sessions":
                return mock_sessions_collection
            return Mock()

        mock_client.collection.side_effect = collection_side_effect
        return mock_client, mock_attendees_collection, mock_sessions_collection

    @pytest.fixture
    def repository(self, mock_pb_client):
        mock_client, _, _ = mock_pb_client
        return AttendeeRepository(mock_client)

    def _make_attendee(self, person_id, session_cm_id, status_id, session_type="main"):
        mock = Mock()
        mock.person_id = person_id
        mock.status_id = status_id
        session_mock = Mock()
        session_mock.cm_id = session_cm_id
        session_mock.session_type = session_type
        mock.expand = {"session": session_mock}
        return mock

    def test_returns_enrollment_info_for_enrolled(self, repository, mock_pb_client):
        """Enrolled camper returns EnrollmentInfo with status_id=2."""
        _, mock_attendees, _ = mock_pb_client
        mock_attendees.get_full_list.return_value = [
            self._make_attendee(12345, 1000010, 2, "main"),
        ]

        result = repository.bulk_get_enrollment_for_persons([12345], 2026)

        assert 12345 in result
        assert result[12345].session_cm_id == 1000010
        assert result[12345].status_id == 2
        assert result[12345].is_active is True

    def test_returns_cancelled_enrollment(self, repository, mock_pb_client):
        """Cancelled camper returns EnrollmentInfo with status_id=32."""
        _, mock_attendees, _ = mock_pb_client
        mock_attendees.get_full_list.return_value = [
            self._make_attendee(12345, 1000010, 32, "main"),
        ]

        result = repository.bulk_get_enrollment_for_persons([12345], 2026)

        assert 12345 in result
        assert result[12345].status_id == 32
        assert result[12345].is_inactive is True

    def test_returns_waitlisted_enrollment(self, repository, mock_pb_client):
        """Waitlisted camper returns EnrollmentInfo with status_id=8."""
        _, mock_attendees, _ = mock_pb_client
        mock_attendees.get_full_list.return_value = [
            self._make_attendee(12345, 1000010, 8, "main"),
        ]

        result = repository.bulk_get_enrollment_for_persons([12345], 2026)

        assert 12345 in result
        assert result[12345].status_id == 8
        assert result[12345].is_pending_enrollment is True

    def test_filters_non_bunking_sessions(self, repository, mock_pb_client):
        """Family-camp-only camper excluded (same as bulk_get_sessions_for_persons)."""
        _, mock_attendees, _ = mock_pb_client
        mock_attendees.get_full_list.return_value = [
            self._make_attendee(99999, 1309514, 2, "family"),
        ]

        result = repository.bulk_get_enrollment_for_persons([99999], 2026)

        assert 99999 not in result

    def test_enrolled_wins_over_cancelled(self, repository, mock_pb_client):
        """When person has enrolled + cancelled bunking sessions, enrolled wins."""
        _, mock_attendees, _ = mock_pb_client
        mock_attendees.get_full_list.return_value = [
            self._make_attendee(12345, 1000010, 2, "main"),  # enrolled
            self._make_attendee(12345, 1000011, 32, "embedded"),  # cancelled
        ]

        result = repository.bulk_get_enrollment_for_persons([12345], 2026)

        assert result[12345].status_id == 2
        assert result[12345].session_cm_id == 1000010

    def test_cancelled_only_still_returned(self, repository, mock_pb_client):
        """Person with ONLY cancelled bunking enrollment is still returned (not suppressed)."""
        _, mock_attendees, _ = mock_pb_client
        mock_attendees.get_full_list.return_value = [
            self._make_attendee(12345, 1000010, 32, "main"),
        ]

        result = repository.bulk_get_enrollment_for_persons([12345], 2026)

        assert 12345 in result
        assert result[12345].status_id == 32

    def test_waitlisted_wins_over_cancelled(self, repository, mock_pb_client):
        """When person has waitlisted + cancelled bunking sessions, waitlisted wins."""
        _, mock_attendees, _ = mock_pb_client
        mock_attendees.get_full_list.return_value = [
            self._make_attendee(12345, 1000010, 32, "main"),  # cancelled
            self._make_attendee(12345, 1000011, 8, "embedded"),  # waitlisted
        ]

        result = repository.bulk_get_enrollment_for_persons([12345], 2026)

        assert result[12345].status_id == 8
        assert result[12345].session_cm_id == 1000011

    def test_empty_input_returns_empty(self, repository, mock_pb_client):
        """Empty person list returns empty dict without DB call."""
        _, mock_attendees, _ = mock_pb_client

        result = repository.bulk_get_enrollment_for_persons([], 2026)

        assert result == {}
        mock_attendees.get_full_list.assert_not_called()

    def test_multiple_persons(self, repository, mock_pb_client):
        """Multiple persons with different statuses returned correctly."""
        _, mock_attendees, _ = mock_pb_client
        mock_attendees.get_full_list.return_value = [
            self._make_attendee(100, 1000010, 2, "main"),  # enrolled
            self._make_attendee(200, 1000010, 32, "main"),  # cancelled
            self._make_attendee(300, 1000010, 8, "main"),  # waitlisted
        ]

        result = repository.bulk_get_enrollment_for_persons([100, 200, 300], 2026)

        assert result[100].is_active is True
        assert result[200].is_inactive is True
        assert result[300].is_pending_enrollment is True


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

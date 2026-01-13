"""Test-Driven Development for PersonRepository

Tests the data access layer for Person entities.
Updated for new PocketBase schema (cm_id, first_name, last_name, preferred_name, birthdate)."""

import sys
from datetime import datetime
from pathlib import Path
from unittest.mock import Mock

import pytest

# Add the parent directory to the path
test_dir = Path(__file__).resolve().parent
project_root = test_dir.parent.parent.parent.parent
sys.path.insert(0, str(project_root))

from bunking.sync.bunk_request_processor.data.repositories.person_repository import PersonRepository


class TestPersonRepository:
    """Test the PersonRepository data access"""

    @pytest.fixture
    def mock_pb_client(self):
        """Create a mock PocketBase client"""
        mock_client = Mock()
        mock_collection = Mock()
        mock_client.collection.return_value = mock_collection
        return mock_client, mock_collection

    @pytest.fixture
    def repository(self, mock_pb_client):
        """Create a PersonRepository with mocked client"""
        mock_client, _ = mock_pb_client
        return PersonRepository(mock_client)

    def _create_person_mock(
        self,
        cm_id,
        first_name,
        last_name,
        preferred_name=None,
        birthdate="2010-05-15",
        grade=8,
        school="Lincoln Middle",
    ):
        """Helper to create a properly structured person mock"""
        mock = Mock()
        mock.cm_id = cm_id
        mock.first_name = first_name
        mock.last_name = last_name
        mock.preferred_name = preferred_name
        mock.birthdate = birthdate
        mock.grade = grade
        mock.school = school
        return mock

    def test_find_by_cm_id(self, repository, mock_pb_client):
        """Test finding a person by CM ID"""
        mock_client, mock_collection = mock_pb_client

        # Mock the database response with correct field names
        mock_result = Mock()
        mock_result.items = [
            self._create_person_mock(
                cm_id=12345,
                first_name="John",
                last_name="Doe",
                preferred_name="Johnny",
                birthdate="2010-05-15",
                grade=8,
                school="Lincoln Middle",
            )
        ]
        mock_collection.get_list.return_value = mock_result

        # Test the method
        person = repository.find_by_cm_id(12345)

        # Verify the result
        assert person is not None
        assert person.cm_id == 12345
        assert person.first_name == "John"
        assert person.last_name == "Doe"
        assert person.preferred_name == "Johnny"
        assert person.birth_date == datetime(2010, 5, 15)
        assert person.grade == 8
        assert person.school == "Lincoln Middle"

        # Verify the query uses cm_id
        mock_collection.get_list.assert_called_once()
        args = mock_collection.get_list.call_args[1]
        assert "cm_id = 12345" in args["query_params"]["filter"]

    def test_find_by_cm_id_not_found(self, repository, mock_pb_client):
        """Test finding a person that doesn't exist"""
        mock_client, mock_collection = mock_pb_client

        # Mock empty response
        mock_result = Mock()
        mock_result.items = []
        mock_collection.get_list.return_value = mock_result

        person = repository.find_by_cm_id(99999)
        assert person is None

    def test_find_by_name(self, repository, mock_pb_client):
        """Test finding people by first and last name"""
        mock_client, mock_collection = mock_pb_client

        # Mock multiple results with correct field names
        mock_result = Mock()
        mock_result.items = [
            self._create_person_mock(
                cm_id=12345,
                first_name="John",
                last_name="Smith",
                preferred_name=None,
                birthdate="2010-05-15",
                grade=8,
                school="Lincoln",
            ),
            self._create_person_mock(
                cm_id=67890,
                first_name="John",
                last_name="Smith",
                preferred_name="Johnny",
                birthdate="2011-03-20",
                grade=7,
                school="Washington",
            ),
        ]
        mock_collection.get_list.return_value = mock_result

        people = repository.find_by_name("John", "Smith")

        assert len(people) == 2
        assert people[0].cm_id == 12345
        assert people[1].cm_id == 67890
        assert all(p.first_name == "John" for p in people)
        assert all(p.last_name == "Smith" for p in people)

        # Verify the query uses first_name and last_name
        args = mock_collection.get_list.call_args[1]
        assert "first_name = 'John'" in args["query_params"]["filter"]
        assert "last_name = 'Smith'" in args["query_params"]["filter"]

    def test_find_by_session(self, repository, mock_pb_client):
        """Test finding all people in a specific session"""
        mock_client, mock_collection = mock_pb_client

        # Mock attendees collection with expand pattern
        # DB field is person_id, session comes from expanded relation
        def create_attendee_mock(person_id, session_cm_id):
            mock = Mock()
            mock.person_id = person_id
            mock.expand = {"session": Mock(cm_id=session_cm_id)}
            return mock

        mock_attendees = [
            create_attendee_mock(12345, 1000002),
            create_attendee_mock(67890, 1000002),
            create_attendee_mock(11111, 1000002),
        ]

        # Mock persons collection response
        mock_persons = Mock()
        mock_persons.items = [
            self._create_person_mock(12345, "John", "Doe", None, "2010-05-15", 8, "Lincoln"),
            self._create_person_mock(67890, "Jane", "Smith", None, "2010-08-20", 8, "Lincoln"),
            self._create_person_mock(11111, "Bob", "Wilson", "Bobby", "2011-01-10", 7, "Washington"),
        ]

        # Set up the mock to return different results based on collection name
        def collection_side_effect(name):
            if name == "attendees":
                mock_coll = Mock()
                mock_coll.get_full_list.return_value = mock_attendees
                return mock_coll
            elif name == "persons":
                return Mock(get_list=Mock(return_value=mock_persons))
            return mock_collection

        mock_client.collection.side_effect = collection_side_effect

        people = repository.find_by_session(1000002, 2025)

        assert len(people) == 3
        assert people[0].cm_id == 12345
        assert people[1].cm_id == 67890
        assert people[2].cm_id == 11111

        # Verify the calls were made correctly
        calls = mock_client.collection.call_args_list
        assert len(calls) >= 2
        assert calls[0][0][0] == "attendees"
        assert calls[1][0][0] == "persons"

    def test_find_by_normalized_name(self, repository, mock_pb_client):
        """Test finding people by normalized name"""
        mock_client, mock_collection = mock_pb_client

        # Mock response with correct field names
        mock_result = [
            self._create_person_mock(
                cm_id=12345,
                first_name="John",
                last_name="O'Brien",
                preferred_name=None,
                birthdate="2010-05-15",
                grade=8,
                school="Lincoln",
            )
        ]
        mock_collection.get_full_list.return_value = mock_result

        # Test with normalized name
        people = repository.find_by_normalized_name("john obrien")

        assert len(people) == 1
        assert people[0].cm_id == 12345
        assert people[0].last_name == "O'Brien"

        # Should have called get_full_list to search all records
        mock_collection.get_full_list.assert_called_once()

    def test_find_by_normalized_name_with_apostrophe_in_search(self, repository, mock_pb_client):
        """Test that searching WITH apostrophe still finds names WITH apostrophe.

        BUG FIX: Prior to this fix, there was asymmetric normalization:
        - Search side: .lower().strip() → "o'brien" (keeps apostrophe)
        - DB side: .lower().strip() + .replace("'", "") → "obrien" (removes apostrophe)
        - Result: "o'brien" != "obrien" → NO MATCH (bug!)

        This test verifies that normalize_name() is used on BOTH sides,
        ensuring names like O'Brien, D'Amato, etc. can be found regardless
        of whether the search term includes the apostrophe.
        """
        mock_client, mock_collection = mock_pb_client

        # Mock response - person has apostrophe in name
        mock_result = [
            self._create_person_mock(
                cm_id=12345,
                first_name="John",
                last_name="O'Brien",
                preferred_name=None,
                birthdate="2010-05-15",
                grade=8,
                school="Lincoln",
            )
        ]
        mock_collection.get_full_list.return_value = mock_result

        # Search WITH apostrophe - should still find the person
        people = repository.find_by_normalized_name("John O'Brien")

        assert len(people) == 1, (
            "Should find 'John O'Brien' when searching with apostrophe. "
            "Both search and DB should use normalize_name() for consistent comparison."
        )
        assert people[0].cm_id == 12345
        assert people[0].last_name == "O'Brien"

    def test_find_by_normalized_name_handles_hyphens_consistently(self, repository, mock_pb_client):
        """Test that hyphenated names are handled consistently.

        Both search and DB sides should normalize the same way.
        """
        mock_client, mock_collection = mock_pb_client

        # Mock response - person has hyphenated name
        mock_result = [
            self._create_person_mock(
                cm_id=12345,
                first_name="Mary-Jane",
                last_name="Smith",
                preferred_name=None,
                birthdate="2010-05-15",
                grade=8,
                school="Lincoln",
            )
        ]
        mock_collection.get_full_list.return_value = mock_result

        # Search with hyphen - should find the person
        people = repository.find_by_normalized_name("Mary-Jane Smith")

        assert len(people) == 1, (
            "Should find 'Mary-Jane Smith' when searching with hyphen. "
            "Hyphens should be preserved per monolith normalize_name() behavior."
        )
        assert people[0].cm_id == 12345
        assert people[0].first_name == "Mary-Jane"

    def test_bulk_find_by_cm_ids(self, repository, mock_pb_client):
        """Test finding multiple people by CM IDs in one query"""
        mock_client, mock_collection = mock_pb_client

        # Mock response with correct field names
        mock_result = Mock()
        mock_result.items = [
            self._create_person_mock(12345, "John", "Doe", None, "2010-05-15", 8, "Lincoln"),
            self._create_person_mock(67890, "Jane", "Smith", None, "2010-08-20", 8, "Lincoln"),
        ]
        mock_collection.get_list.return_value = mock_result

        people = repository.bulk_find_by_cm_ids([12345, 67890, 99999])

        assert len(people) == 2
        assert people[12345].first_name == "John"
        assert people[67890].first_name == "Jane"
        assert 99999 not in people

        # Verify the query uses IN operator with cm_id
        args = mock_collection.get_list.call_args[1]
        assert "cm_id IN (12345, 67890, 99999)" in args["query_params"]["filter"]

    def test_date_parsing(self, repository, mock_pb_client):
        """Test various date formats are parsed correctly"""
        mock_client, mock_collection = mock_pb_client

        # Test various date formats - note: DB field is 'birthdate' (no underscore)
        test_cases = [
            ("2010-05-15", datetime(2010, 5, 15)),
            ("2010-05-15T00:00:00", datetime(2010, 5, 15)),
            ("2010-05-15 12:30:45", datetime(2010, 5, 15, 12, 30, 45)),
            ("", None),
            (None, None),
        ]

        for date_str, expected in test_cases:
            mock_result = Mock()
            mock_result.items = [
                self._create_person_mock(
                    cm_id=12345,
                    first_name="Test",
                    last_name="User",
                    preferred_name=None,
                    birthdate=date_str,
                    grade=8,
                    school="Test School",
                )
            ]
            mock_collection.get_list.return_value = mock_result

            person = repository.find_by_cm_id(12345)
            if expected:
                assert person.birth_date == expected
            else:
                assert person.birth_date is None

    def test_cache_integration(self, repository, mock_pb_client):
        """Test that repository integrates with cache when provided"""
        mock_client, mock_collection = mock_pb_client
        mock_cache = Mock()

        # Create repository with cache
        cached_repo = PersonRepository(mock_client, cache=mock_cache)

        # Mock cache miss
        mock_cache.get.return_value = None

        # Mock database response with correct field names
        mock_result = Mock()
        mock_result.items = [self._create_person_mock(12345, "John", "Doe", None, "2010-05-15", 8, "Lincoln")]
        mock_collection.get_list.return_value = mock_result

        # First call should hit database and cache result
        person1 = cached_repo.find_by_cm_id(12345)

        assert person1 is not None
        assert person1.cm_id == 12345
        mock_cache.get.assert_called_once_with("person:cm_id:12345")
        mock_cache.set.assert_called_once()

        # Second call should hit cache
        mock_cache.get.return_value = person1
        person2 = cached_repo.find_by_cm_id(12345)

        assert person2 == person1
        assert mock_collection.get_list.call_count == 1  # Still only one DB call

    def test_find_by_name_matches_preferred_name(self, repository, mock_pb_client):
        """Test finding people by preferred_name + last_name.

        preferred_name variations so searching for "Bobby Smith" finds a person
        with first_name="Robert", preferred_name="Bobby", last_name="Smith".

        The modular find_by_name() should also check preferred_name.
        """
        mock_client, mock_collection = mock_pb_client

        # Person has first_name="Robert" but preferred_name="Bobby"
        mock_result = Mock()
        mock_result.items = [
            self._create_person_mock(
                cm_id=12345,
                first_name="Robert",
                last_name="Smith",
                preferred_name="Bobby",
                birthdate="2010-05-15",
                grade=8,
                school="Lincoln Middle",
            )
        ]
        mock_collection.get_list.return_value = mock_result

        # Search by preferred name "Bobby" + last name "Smith"
        people = repository.find_by_name("Bobby", "Smith")

        # Should find the person via preferred_name match
        assert len(people) == 1
        assert people[0].cm_id == 12345
        assert people[0].first_name == "Robert"  # Legal first name
        assert people[0].preferred_name == "Bobby"  # Preferred name matches search

        # Verify the query includes preferred_name in the filter
        args = mock_collection.get_list.call_args[1]
        filter_str = args["query_params"]["filter"]
        assert "preferred_name" in filter_str, f"Filter should include preferred_name check but was: {filter_str}"

    def test_find_by_first_name_matches_preferred_name(self, repository, mock_pb_client):
        """Test finding people by preferred_name in first-name-only search.

        "FIRST:preferredname" variations so searching for first name "Bobby"
        finds a person with first_name="Robert", preferred_name="Bobby".

        The modular find_by_first_name() should also check preferred_name.
        """
        mock_client, mock_collection = mock_pb_client

        # Person has first_name="Robert" but preferred_name="Bobby"
        mock_result = Mock()
        mock_result.items = [
            self._create_person_mock(
                cm_id=12345,
                first_name="Robert",
                last_name="Smith",
                preferred_name="Bobby",
                birthdate="2010-05-15",
                grade=8,
                school="Lincoln Middle",
            )
        ]
        mock_collection.get_list.return_value = mock_result

        # Search by preferred name "Bobby" only
        people = repository.find_by_first_name("Bobby")

        # Should find the person via preferred_name match
        assert len(people) == 1
        assert people[0].cm_id == 12345
        assert people[0].first_name == "Robert"  # Legal first name
        assert people[0].preferred_name == "Bobby"  # Preferred name matches search

        # Verify the query includes preferred_name in the filter
        args = mock_collection.get_list.call_args[1]
        filter_str = args["query_params"]["filter"]
        assert "preferred_name" in filter_str, f"Filter should include preferred_name check but was: {filter_str}"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

"""Tests for PersonRepository, focusing on sibling lookups.

Tests the find_siblings() method used for expanding SIBLING placeholders
when parents reference "twins", "siblings", etc. in bunk requests.
"""

from __future__ import annotations

from unittest.mock import MagicMock, Mock

import pytest

from bunking.sync.bunk_request_processor.core.models import Person
from bunking.sync.bunk_request_processor.data.repositories.person_repository import (
    PersonRepository,
)


class TestPersonModelHouseholdId:
    """Test that Person model includes household_id field."""

    def test_person_has_household_id_field(self):
        """Person dataclass should have household_id field."""
        person = Person(
            cm_id=123,
            first_name="Calla",
            last_name="Wright-Thompson",
            household_id=12345,
        )
        assert person.household_id == 12345

    def test_person_household_id_defaults_to_none(self):
        """household_id should default to None."""
        person = Person(
            cm_id=123,
            first_name="John",
            last_name="Doe",
        )
        assert person.household_id is None


class TestFindSiblings:
    """Tests for PersonRepository.find_siblings()."""

    @pytest.fixture
    def mock_pb_client(self):
        """Create a mock PocketBase client."""
        return MagicMock()

    @pytest.fixture
    def repo(self, mock_pb_client):
        """Create PersonRepository with mock client."""
        # Suppress deprecation warning for direct construction in tests
        PersonRepository._from_factory = True
        repo = PersonRepository(mock_pb_client)
        PersonRepository._from_factory = False
        return repo

    def test_find_siblings_returns_empty_when_person_not_found(self, repo, mock_pb_client):
        """Should return empty list when person doesn't exist."""
        # Mock find_by_cm_id to return None
        mock_pb_client.collection.return_value.get_list.return_value.items = []

        siblings = repo.find_siblings(cm_id=99999, year=2025)

        assert siblings == []

    def test_find_siblings_returns_empty_when_no_household_id(self, repo, mock_pb_client):
        """Should return empty list when person has no household_id."""
        # Create a mock person record without household_id
        mock_record = Mock()
        mock_record.cm_id = 123
        mock_record.first_name = "John"
        mock_record.last_name = "Doe"
        mock_record.household_id = None
        mock_record.preferred_name = None
        mock_record.grade = 5
        mock_record.school = None
        mock_record.birthdate = None
        mock_record.address = None
        mock_record.age = None
        mock_record.parent_names = None

        mock_result = Mock()
        mock_result.items = [mock_record]
        mock_pb_client.collection.return_value.get_list.return_value = mock_result

        siblings = repo.find_siblings(cm_id=123, year=2025)

        assert siblings == []

    def test_find_siblings_returns_sibling_with_same_household_id(self, repo, mock_pb_client):
        """Should return sibling(s) with matching household_id."""
        # First call returns the person
        person_record = Mock()
        person_record.cm_id = 19930614
        person_record.first_name = "Calla"
        person_record.last_name = "Wright-Thompson"
        person_record.household_id = 12345
        person_record.preferred_name = None
        person_record.grade = 4
        person_record.school = None
        person_record.birthdate = None
        person_record.address = None
        person_record.age = None
        person_record.parent_names = None

        # Second call returns the sibling
        sibling_record = Mock()
        sibling_record.cm_id = 19930605
        sibling_record.first_name = "Penelope"
        sibling_record.last_name = "Wright-Thompson"
        sibling_record.household_id = 12345
        sibling_record.preferred_name = "Pippi"
        sibling_record.grade = 4
        sibling_record.school = None
        sibling_record.birthdate = None
        sibling_record.address = None
        sibling_record.age = None
        sibling_record.parent_names = None

        # Configure mock to return different results for different queries
        mock_result_person = Mock()
        mock_result_person.items = [person_record]

        mock_result_siblings = Mock()
        mock_result_siblings.items = [sibling_record]

        # First call finds the person, second finds siblings
        mock_pb_client.collection.return_value.get_list.side_effect = [
            mock_result_person,  # find_by_cm_id
            mock_result_siblings,  # find_siblings query
        ]

        siblings = repo.find_siblings(cm_id=19930614, year=2025)

        assert len(siblings) == 1
        assert siblings[0].cm_id == 19930605
        assert siblings[0].first_name == "Penelope"
        assert siblings[0].preferred_name == "Pippi"

    def test_find_siblings_excludes_self(self, repo, mock_pb_client):
        """Should NOT include the requester in the siblings list."""
        # This is implicitly tested by the filter query:
        # "household_id = X && cm_id != {cm_id}"
        # But let's verify the filter is constructed correctly

        person_record = Mock()
        person_record.cm_id = 19930614
        person_record.first_name = "Calla"
        person_record.last_name = "Wright-Thompson"
        person_record.household_id = 12345
        person_record.preferred_name = None
        person_record.grade = 4
        person_record.school = None
        person_record.birthdate = None
        person_record.address = None
        person_record.age = None
        person_record.parent_names = None

        mock_result = Mock()
        mock_result.items = [person_record]

        mock_empty_result = Mock()
        mock_empty_result.items = []

        mock_pb_client.collection.return_value.get_list.side_effect = [
            mock_result,  # find_by_cm_id
            mock_empty_result,  # find_siblings (empty - only child)
        ]

        repo.find_siblings(cm_id=19930614, year=2025)

        # Verify the second call used the correct filter
        calls = mock_pb_client.collection.return_value.get_list.call_args_list
        assert len(calls) == 2

        # Second call should have filter excluding self
        sibling_query = calls[1]
        filter_str = sibling_query.kwargs.get("query_params", {}).get("filter", "")
        assert "cm_id != 19930614" in filter_str
        assert "household_id = 12345" in filter_str


class TestPersonRepositoryMapsHouseholdId:
    """Test that _map_to_person includes household_id."""

    @pytest.fixture
    def mock_pb_client(self):
        """Create a mock PocketBase client."""
        return MagicMock()

    @pytest.fixture
    def repo(self, mock_pb_client):
        """Create PersonRepository with mock client."""
        PersonRepository._from_factory = True
        repo = PersonRepository(mock_pb_client)
        PersonRepository._from_factory = False
        return repo

    def test_map_to_person_includes_household_id(self, repo):
        """_map_to_person should extract household_id from db record."""
        mock_record = Mock()
        mock_record.cm_id = 123
        mock_record.first_name = "Test"
        mock_record.last_name = "User"
        mock_record.household_id = 999888
        mock_record.preferred_name = None
        mock_record.grade = 5
        mock_record.school = "Test School"
        mock_record.birthdate = None
        mock_record.address = None
        mock_record.age = 10.05
        mock_record.parent_names = None

        person = repo._map_to_person(mock_record)

        assert person is not None
        assert person.household_id == 999888

    def test_map_to_person_handles_missing_household_id(self, repo):
        """_map_to_person should handle missing household_id gracefully."""
        mock_record = Mock(
            spec=[
                "cm_id",
                "first_name",
                "last_name",
                "preferred_name",
                "grade",
                "school",
                "birthdate",
                "address",
                "age",
                "parent_names",
            ]
        )
        mock_record.cm_id = 123
        mock_record.first_name = "Test"
        mock_record.last_name = "User"
        mock_record.preferred_name = None
        mock_record.grade = 5
        mock_record.school = None
        mock_record.birthdate = None
        mock_record.address = None
        mock_record.age = None
        mock_record.parent_names = None
        # No household_id attribute

        person = repo._map_to_person(mock_record)

        assert person is not None
        assert person.household_id is None


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

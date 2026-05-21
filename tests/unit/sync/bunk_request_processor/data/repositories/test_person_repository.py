"""Tests for PersonRepository household_id mapping."""

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

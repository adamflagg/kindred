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


class TestNameSearchErrorLogsCarryNoNames:
    """A failed name search must not write the searched-for name to an ERROR line.

    The PocketBase client's ``ClientResponseError`` renders the request URL --
    and with it the ``filter`` that holds the name -- in ``str(e)``. Logging the
    exception as-is would put the name back in the production log the message
    text was cleaned of.
    """

    NAME_URL = (
        "http://127.0.0.1:8090/api/collections/persons/records"
        "?filter=%28first_name+%3D+%27Emma%27+%7C%7C+preferred_name+%3D+%27Emma%27%29"
        "+%26%26+last_name+%3D+%27Johnson%27"
    )

    @pytest.fixture
    def repo(self):
        from pocketbase.errors import ClientResponseError

        pb = MagicMock()
        error = ClientResponseError("Response error. Status code:400", url=self.NAME_URL, status=400)
        pb.collection.return_value.get_list.side_effect = error
        pb.collection.return_value.get_full_list.side_effect = error
        PersonRepository._from_factory = True
        repo = PersonRepository(pb)
        PersonRepository._from_factory = False
        return repo

    @pytest.mark.parametrize(
        ("method", "args"),
        [
            ("find_by_name", ("Emma", "Johnson")),
            ("find_by_first_name", ("Emma",)),
            ("find_by_last_name", ("Johnson",)),
            ("find_by_first_and_parent_surname", ("Emma", "Johnson")),
            # Its query filters only by year today, but every name-search error
            # path follows the same contract.
            ("find_by_normalized_name", ("emma johnson",)),
        ],
    )
    def test_error_line_omits_the_name_but_keeps_the_status(self, repo, caplog, method, args):
        with caplog.at_level("ERROR"):
            assert getattr(repo, method)(*args, year=2025) == []

        assert caplog.records, "the failure is still logged"
        assert "Emma" not in caplog.text
        assert "Johnson" not in caplog.text
        assert "400" in caplog.text, "the status stays, so the line is still diagnosable"

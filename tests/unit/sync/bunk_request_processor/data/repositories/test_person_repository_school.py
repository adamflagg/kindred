"""Tests for PersonRepository.find_by_school and find_by_congregation methods.

These methods support group reference resolution by looking up campers
who share a school or congregation with the requester."""

from __future__ import annotations

from unittest.mock import MagicMock, Mock

import pytest

from bunking.sync.bunk_request_processor.core.models import Person
from bunking.sync.bunk_request_processor.data.repositories.person_repository import (
    PersonRepository,
)


class TestFindBySchool:
    """Tests for PersonRepository.find_by_school()."""

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

    def _make_person_record(
        self,
        cm_id: int,
        first_name: str,
        last_name: str,
        school: str | None = None,
        grade: int | None = None,
    ) -> Mock:
        """Create a mock PocketBase person record."""
        record = Mock()
        record.cm_id = cm_id
        record.first_name = first_name
        record.last_name = last_name
        record.preferred_name = None
        record.grade = grade
        record.school = school
        record.birthdate = None
        record.address = None
        record.age = None
        record.parent_names = None
        record.household_id = None
        return record

    def test_find_by_school_returns_matching_persons(self, repo, mock_pb_client):
        """Should return persons matching the given school and year."""
        mock_result = Mock()
        mock_result.items = [
            self._make_person_record(100, "Emma", "Johnson", school="Riverside Elementary", grade=5),
            self._make_person_record(101, "Liam", "Garcia", school="Riverside Elementary", grade=5),
        ]
        mock_pb_client.collection.return_value.get_full_list.return_value = mock_result.items

        persons = repo.find_by_school("Riverside Elementary", year=2025)

        assert len(persons) == 2
        assert persons[0].cm_id == 100
        assert persons[1].cm_id == 101

    def test_find_by_school_uses_correct_filter(self, repo, mock_pb_client):
        """Should query PocketBase with school and year filter."""
        mock_pb_client.collection.return_value.get_full_list.return_value = []

        repo.find_by_school("Oak Valley Middle", year=2025)

        mock_pb_client.collection.assert_called_with("persons")
        call_args = mock_pb_client.collection.return_value.get_full_list.call_args
        filter_str = call_args[1]["query_params"]["filter"]
        assert "school = 'Oak Valley Middle'" in filter_str
        assert "year = 2025" in filter_str

    def test_find_by_school_returns_empty_when_no_matches(self, repo, mock_pb_client):
        """Should return empty list when no persons match."""
        mock_pb_client.collection.return_value.get_full_list.return_value = []

        persons = repo.find_by_school("Nonexistent School", year=2025)

        assert persons == []

    def test_find_by_school_escapes_apostrophes(self, repo, mock_pb_client):
        """Should escape single quotes in school name for PocketBase filter."""
        mock_pb_client.collection.return_value.get_full_list.return_value = []

        repo.find_by_school("St. Mary's Academy", year=2025)

        call_args = mock_pb_client.collection.return_value.get_full_list.call_args
        filter_str = call_args[1]["query_params"]["filter"]
        assert "St. Mary''s Academy" in filter_str

    def test_find_by_school_handles_exception(self, repo, mock_pb_client):
        """Should return empty list on database error."""
        mock_pb_client.collection.return_value.get_full_list.side_effect = Exception("DB error")

        persons = repo.find_by_school("Riverside Elementary", year=2025)

        assert persons == []


class TestFindByCongregation:
    """Tests for PersonRepository.find_by_congregation()."""

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

    def _make_person_record(
        self,
        cm_id: int,
        first_name: str,
        last_name: str,
        normalized_congregation: str | None = None,
        grade: int | None = None,
    ) -> Mock:
        """Create a mock PocketBase person record with normalized_congregation."""
        record = Mock()
        record.cm_id = cm_id
        record.first_name = first_name
        record.last_name = last_name
        record.preferred_name = None
        record.grade = grade
        record.school = None
        record.birthdate = None
        record.address = None
        record.age = None
        record.parent_names = None
        record.household_id = None
        record.normalized_congregation = normalized_congregation
        return record

    def test_find_by_congregation_returns_matching_persons(self, repo, mock_pb_client):
        """Should return persons matching the given congregation and year."""
        mock_result_items = [
            self._make_person_record(200, "Olivia", "Chen", normalized_congregation="Temple Beth El", grade=6),
            self._make_person_record(201, "Noah", "Williams", normalized_congregation="Temple Beth El", grade=6),
        ]
        mock_pb_client.collection.return_value.get_full_list.return_value = mock_result_items

        persons = repo.find_by_congregation("Temple Beth El", year=2025)

        assert len(persons) == 2
        assert persons[0].cm_id == 200
        assert persons[1].cm_id == 201

    def test_find_by_congregation_uses_correct_filter(self, repo, mock_pb_client):
        """Should query PocketBase with normalized_congregation and year filter."""
        mock_pb_client.collection.return_value.get_full_list.return_value = []

        repo.find_by_congregation("Congregation Emanu-El", year=2025)

        mock_pb_client.collection.assert_called_with("persons")
        call_args = mock_pb_client.collection.return_value.get_full_list.call_args
        filter_str = call_args[1]["query_params"]["filter"]
        assert "normalized_congregation = 'Congregation Emanu-El'" in filter_str
        assert "year = 2025" in filter_str

    def test_find_by_congregation_returns_empty_when_no_matches(self, repo, mock_pb_client):
        """Should return empty list when no persons match."""
        mock_pb_client.collection.return_value.get_full_list.return_value = []

        persons = repo.find_by_congregation("Unknown Temple", year=2025)

        assert persons == []

    def test_find_by_congregation_escapes_apostrophes(self, repo, mock_pb_client):
        """Should escape single quotes in congregation name for PocketBase filter."""
        mock_pb_client.collection.return_value.get_full_list.return_value = []

        repo.find_by_congregation("B'nai Israel", year=2025)

        call_args = mock_pb_client.collection.return_value.get_full_list.call_args
        filter_str = call_args[1]["query_params"]["filter"]
        assert "B''nai Israel" in filter_str

    def test_find_by_congregation_handles_exception(self, repo, mock_pb_client):
        """Should return empty list on database error."""
        mock_pb_client.collection.return_value.get_full_list.side_effect = Exception("DB error")

        persons = repo.find_by_congregation("Temple Beth El", year=2025)

        assert persons == []


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

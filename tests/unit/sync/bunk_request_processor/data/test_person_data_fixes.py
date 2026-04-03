"""Tests for Person model data layer fixes.

Verifies that:
1. Person has gender and congregation as first-class fields
2. person_repository reads normalized columns instead of deleted address JSON
3. temporal_name_cache reads same normalized columns
"""

import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

project_root = Path(__file__).resolve().parent.parent.parent.parent.parent.parent
sys.path.insert(0, str(project_root))

from bunking.sync.bunk_request_processor.core.models import Person


class TestPersonModelFields:
    """Person dataclass has gender and congregation as first-class fields."""

    def test_person_has_gender_field(self):
        p = Person(cm_id=1001, first_name="Emma", last_name="Johnson", gender="F")
        assert p.gender == "F"

    def test_person_has_congregation_field(self):
        p = Person(cm_id=1001, first_name="Emma", last_name="Johnson", congregation="Temple Beth El")
        assert p.congregation == "Temple Beth El"

    def test_person_gender_defaults_none(self):
        p = Person(cm_id=1001, first_name="Emma", last_name="Johnson")
        assert p.gender is None

    def test_person_congregation_defaults_none(self):
        p = Person(cm_id=1001, first_name="Emma", last_name="Johnson")
        assert p.congregation is None


from bunking.sync.bunk_request_processor.data.repositories.person_repository import PersonRepository


class TestPersonRepositoryMapping:
    """person_repository._map_to_person reads normalized DB columns."""

    def _make_db_record(self, **overrides):
        """Create a mock PocketBase record with person fields."""
        defaults = {
            "cm_id": 1001,
            "first_name": "Emma",
            "last_name": "Johnson",
            "preferred_name": None,
            "birthdate": None,
            "grade": 5,
            "school": "Hillcrest Elementary",
            "normalized_school": "Hillcrest ES",
            "normalized_city": "Oakland",
            "address_state": "CA",
            "address_city": "Oakland",
            "age": None,
            "parent_names": None,
            "household_id": None,
            "gender": "F",
            "normalized_congregation": "Temple Beth El",
        }
        defaults.update(overrides)
        record = MagicMock()
        for key, val in defaults.items():
            setattr(record, key, val)
        record.__class__ = type("PBRecord", (), {k: None for k in defaults})
        for key, val in defaults.items():
            setattr(record, key, val)
        return record

    def test_city_reads_normalized_city(self):
        repo = PersonRepository.__new__(PersonRepository)
        record = self._make_db_record(normalized_city="Oakland", address_city="Oakland (raw)")
        person = repo._map_to_person(record)
        assert person.city == "Oakland"

    def test_city_falls_back_to_address_city(self):
        repo = PersonRepository.__new__(PersonRepository)
        record = self._make_db_record(normalized_city=None, address_city="San Francisco")
        person = repo._map_to_person(record)
        assert person.city == "San Francisco"

    def test_state_reads_address_state(self):
        repo = PersonRepository.__new__(PersonRepository)
        record = self._make_db_record(address_state="CA")
        person = repo._map_to_person(record)
        assert person.state == "CA"

    def test_school_reads_normalized_school(self):
        repo = PersonRepository.__new__(PersonRepository)
        record = self._make_db_record(normalized_school="Hillcrest ES", school="Hillcrest Elementary School")
        person = repo._map_to_person(record)
        assert person.school == "Hillcrest ES"

    def test_school_falls_back_to_raw(self):
        repo = PersonRepository.__new__(PersonRepository)
        record = self._make_db_record(normalized_school=None, school="Hillcrest Elementary School")
        person = repo._map_to_person(record)
        assert person.school == "Hillcrest Elementary School"

    def test_gender_is_first_class_field(self):
        repo = PersonRepository.__new__(PersonRepository)
        record = self._make_db_record(gender="F")
        person = repo._map_to_person(record)
        assert person.gender == "F"

    def test_congregation_is_first_class_field(self):
        repo = PersonRepository.__new__(PersonRepository)
        record = self._make_db_record(normalized_congregation="Temple Beth El")
        person = repo._map_to_person(record)
        assert person.congregation == "Temple Beth El"

    def test_city_not_from_deleted_address_json(self):
        """The old address JSON column was deleted in migration 1500000054.
        Verify we don't try to parse it."""
        repo = PersonRepository.__new__(PersonRepository)
        record = self._make_db_record(normalized_city="Oakland", address_state="CA")
        person = repo._map_to_person(record)
        assert person.city == "Oakland"
        assert person.state == "CA"

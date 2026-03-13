"""Tests for GeoCategory enum."""

from api.constants.geo import GeoCategory


class TestGeoCategory:
    def test_has_city(self):
        assert GeoCategory.CITY.value == "city"

    def test_has_school(self):
        assert GeoCategory.SCHOOL.value == "school"

    def test_has_congregation(self):
        assert GeoCategory.CONGREGATION.value == "congregation"

    def test_exactly_three_members(self):
        assert len(GeoCategory) == 3

    def test_is_string_enum(self):
        assert isinstance(GeoCategory.CITY, str)
        assert GeoCategory.CITY.value == "city"

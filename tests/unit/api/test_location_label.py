"""TDD tests for api.utils.location_label (kindred#2755).

One helper owns the "a person's city/state label" rule shared with Go's
`PersonLocation`/`PersonLocationCityOnly` (pocketbase/sync/location_label.go)
and the frontend's `personLocation` (frontend/src/utils/addressUtils.ts):

1. normalized_city, when non-blank, IS the whole label.
2. Otherwise compose address_city + address_state.
3. A caller wanting the city without the state calls a variant of the
   helper, not its own regex.

These tests are written FIRST, before the module exists (TDD).
"""

from types import SimpleNamespace
from unittest.mock import MagicMock

from api.utils.location_label import (
    person_city_only,
    person_city_state_for_display,
    person_location,
)


def _person(**kwargs: object) -> SimpleNamespace:
    return SimpleNamespace(**kwargs)


class TestPersonLocation:
    """person_location(person) -> the whole display-ready "City, ST" label."""

    def test_normalized_city_wins_outright(self) -> None:
        person = _person(normalized_city="Berkeley, CA", address_city="berkeley", address_state="CA")
        assert person_location(person) == "Berkeley, CA"

    def test_normalized_city_wins_even_without_a_state_suffix(self) -> None:
        """normalized_city IS the label, verbatim, regardless of shape."""
        person = _person(normalized_city="Washington", address_city="somewhere else", address_state="OR")
        assert person_location(person) == "Washington"

    def test_composes_when_normalized_is_blank(self) -> None:
        person = _person(normalized_city="", address_city="Oakland", address_state="CA")
        assert person_location(person) == "Oakland, CA"

    def test_composes_when_normalized_is_missing(self) -> None:
        """A person object that simply has no normalized_city attribute at all."""
        person = _person(address_city="Oakland", address_state="CA")
        assert person_location(person) == "Oakland, CA"

    def test_composes_when_normalized_is_whitespace(self) -> None:
        person = _person(normalized_city="   ", address_city="Oakland", address_state="CA")
        assert person_location(person) == "Oakland, CA"

    def test_never_doubles_the_state(self) -> None:
        """The "San Carlos, CA, CA" bug (kindred#2753): normalized_city already
        carries the state, so it must never be composed with address_state again."""
        person = _person(normalized_city="San Carlos, CA", address_city="San Carlos", address_state="CA")
        assert person_location(person) == "San Carlos, CA"

    def test_city_only_when_state_is_blank(self) -> None:
        person = _person(normalized_city=None, address_city="Oakland", address_state="")
        assert person_location(person) == "Oakland"

    def test_state_only_when_city_is_blank(self) -> None:
        person = _person(normalized_city=None, address_city="", address_state="CA")
        assert person_location(person) == "CA"

    def test_both_blank_returns_none(self) -> None:
        person = _person(normalized_city=None, address_city="", address_state="")
        assert person_location(person) is None

    def test_no_attributes_at_all_returns_none(self) -> None:
        assert person_location(_person()) is None

    def test_unset_mock_attributes_are_not_mistaken_for_values(self) -> None:
        """A MagicMock with no attributes explicitly set (the shape most
        service-layer tests build persons from) auto-vivifies every attribute
        access as a truthy child mock rather than raising AttributeError, so
        a naive `getattr(...) or default` treats it as real data. Every
        production caller in drilldown_service.py builds its mocks this way
        (tests/unit/api/conftest.py's create_mock_attendee), so this is not
        hypothetical -- it broke TestWaitlistSessionGenderDrilldown on first
        write."""
        assert person_location(MagicMock()) is None


class TestPersonCityOnlyMockSafety:
    def test_unset_mock_attributes_are_not_mistaken_for_values(self) -> None:
        assert person_city_only(MagicMock()) is None


class TestPersonCityStateForDisplay:
    """person_city_state_for_display(person) -> (city, state) tuple for a
    schema with SEPARATE city/state fields (DrilldownAttendee)."""

    def test_normalized_city_becomes_city_with_state_none(self) -> None:
        """state must come back None whenever city already carries it, or a
        caller rendering f"{city}, {state}" (DrillDownModal.tsx) doubles it."""
        person = _person(normalized_city="San Carlos, CA", address_city="San Carlos", address_state="CA")
        assert person_city_state_for_display(person) == ("San Carlos, CA", None)

    def test_falls_back_to_raw_columns_with_their_own_state(self) -> None:
        person = _person(normalized_city=None, address_city="Springfield", address_state="IL")
        assert person_city_state_for_display(person) == ("Springfield", "IL")

    def test_blank_normalized_falls_back(self) -> None:
        person = _person(normalized_city="", address_city="Springfield", address_state="IL")
        assert person_city_state_for_display(person) == ("Springfield", "IL")

    def test_all_blank_returns_none_none(self) -> None:
        person = _person(normalized_city="", address_city="", address_state="")
        assert person_city_state_for_display(person) == (None, None)

    def test_unset_mock_attributes_are_not_mistaken_for_values(self) -> None:
        assert person_city_state_for_display(MagicMock()) == (None, None)


class TestPersonCityOnly:
    """person_city_only(person) -> city with the state suffix stripped,
    mirroring Go's PersonLocationCityOnly, for a caller that wants city alone
    (the bunk-request school-disambiguation strategy compares city and state
    independently and must not skew when one side carries the other)."""

    def test_prefers_normalized_and_strips_its_state(self) -> None:
        person = _person(normalized_city="Berkeley, CA", address_city="berkeley")
        assert person_city_only(person) == "Berkeley"

    def test_falls_back_to_raw_city(self) -> None:
        person = _person(normalized_city=None, address_city="Oakland")
        assert person_city_only(person) == "Oakland"

    def test_falls_back_when_normalized_is_whitespace(self) -> None:
        person = _person(normalized_city="   ", address_city="Oakland")
        assert person_city_only(person) == "Oakland"

    def test_keeps_a_comma_that_is_not_a_state(self) -> None:
        person = _person(normalized_city="Washington, District", address_city="")
        assert person_city_only(person) == "Washington, District"

    def test_both_blank_returns_none(self) -> None:
        person = _person(normalized_city="", address_city="")
        assert person_city_only(person) is None

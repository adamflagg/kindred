"""Test for school disambiguation city/state matching.

This test verifies that school disambiguation requires matching school + city + state,

GAP being tested:
  Section: 2. Name Resolution
  Method: _disambiguate_by_school
  Lines: 1203-1257
  Gap: Missing city/state matching (modular only matches school name)

Architecture context:
  - batch_resolve() pre-loads Person objects via find_by_name()
  - These candidates are passed to strategies via resolve_with_context()
  - Person objects will have city/state when loaded from DB
  - City/state matching enables MORE local resolution, reducing AI calls

Note: The attendee_info format in batch_resolve() has a mismatch with what
strategies expect (keys are tuples vs cm_id). This causes fallback to DB
queries for requester info. That's a separate issue - this test focuses
on city/state matching using the pre-loaded candidate Person objects."""

from __future__ import annotations

from unittest.mock import Mock

import pytest

from bunking.sync.bunk_request_processor.core.models import Person
from bunking.sync.bunk_request_processor.resolution.strategies.school_disambiguation import (
    SchoolDisambiguationStrategy,
)


class TestPersonModelCityState:
    """Test that Person model has city/state fields for location-based disambiguation"""

    def test_person_has_city_field(self):
        """Person model should have city field.

        This is required for the school disambiguation strategy to use
        location-based matching per monolith behavior.
        """
        person = Person(
            cm_id=1,
            first_name="Test",
            last_name="User",
            city="Oakland",
        )
        assert hasattr(person, "city"), "Person model must have 'city' field"
        assert person.city == "Oakland"

    def test_person_has_state_field(self):
        """Person model should have state field.

        Combined with city and school, this enables the 3-way match
        """
        person = Person(
            cm_id=1,
            first_name="Test",
            last_name="User",
            state="CA",
        )
        assert hasattr(person, "state"), "Person model must have 'state' field"
        assert person.state == "CA"

    def test_person_city_state_default_to_none(self):
        """City and state should default to None when not provided."""
        person = Person(
            cm_id=1,
            first_name="Test",
            last_name="User",
        )
        assert person.city is None
        assert person.state is None


class TestSchoolDisambiguationWithLocation:
    """Test that school disambiguation uses city/state matching.

        if (candidate_school == requester_school and
            candidate_city == requester_city and
            candidate_state == requester_state):
            school_matches.append(candidate_id)

    This is a 3-way exact match: school + city + state.
    Without city/state matching, false positives occur when multiple schools
    share the same name but are in different locations.
    """

    def test_resolve_with_context_uses_location_from_candidates(self):
        """When candidates have city/state, use them for disambiguation.

        This tests the resolve_with_context path which receives pre-loaded
        Person objects from batch_resolve(). The candidates should include
        city/state from the DB, enabling location-based filtering.
        """
        person_repo = Mock()
        attendee_repo = Mock()

        # Requester from Lincoln Elementary in Oakland, CA
        requester = Person(
            cm_id=100,
            first_name="Sarah",
            last_name="Jones",
            school="Lincoln Elementary",
            city="Oakland",
            state="CA",
            grade=4,
        )

        # Pre-loaded candidates (simulating batch_resolve output)
        candidate_same_location = Person(
            cm_id=201,
            first_name="Emma",
            last_name="Wilson",
            school="Lincoln Elementary",
            city="Oakland",
            state="CA",
            grade=4,
        )

        candidate_different_city = Person(
            cm_id=202,
            first_name="Emma",
            last_name="Wilson",
            school="Lincoln Elementary",
            city="Denver",
            state="CO",
            grade=4,
        )

        # Mock person_repo to return requester when queried
        person_repo.find_by_cm_id.return_value = requester

        strategy = SchoolDisambiguationStrategy(person_repo, attendee_repo)

        # Use resolve_with_context (the batch path) with pre-loaded candidates
        result = strategy.resolve_with_context(
            name="Emma Wilson",
            requester_cm_id=100,
            session_cm_id=12345,
            year=2025,
            candidates=[candidate_same_location, candidate_different_city],
            attendee_info=None,  # Falls back to person_repo for requester
        )

        # Should resolve to Oakland candidate only (city/state match)
        assert result.is_resolved, "Should resolve when one candidate matches full location"
        assert result.person is not None
        assert result.person.cm_id == 201, "Should select candidate with matching city/state"

    def test_same_school_same_city_different_state_no_match(self):
        """Same school + city but different state should NOT be treated as same school.

        Example: Springfield, IL vs Springfield, MO
        """
        person_repo = Mock()
        attendee_repo = Mock()

        requester = Person(
            cm_id=100,
            first_name="John",
            last_name="Smith",
            school="Central High School",
            city="Springfield",
            state="IL",
            grade=6,
        )

        candidate_same_state = Person(
            cm_id=301,
            first_name="Mike",
            last_name="Johnson",
            school="Central High School",
            city="Springfield",
            state="IL",  # Same state
            grade=6,
        )

        candidate_different_state = Person(
            cm_id=302,
            first_name="Mike",
            last_name="Johnson",
            school="Central High School",
            city="Springfield",
            state="MO",  # Different state!
            grade=6,
        )

        person_repo.find_by_cm_id.return_value = requester

        strategy = SchoolDisambiguationStrategy(person_repo, attendee_repo)

        result = strategy.resolve_with_context(
            name="Mike Johnson",
            requester_cm_id=100,
            session_cm_id=12345,
            year=2025,
            candidates=[candidate_same_state, candidate_different_state],
            attendee_info=None,
        )

        assert result.is_resolved
        assert result.person is not None
        assert result.person.cm_id == 301, "Should select IL candidate, not MO"
        assert result.person.state == "IL"

    def test_requester_without_location_skips_location_matching(self):
        """if not (requester_city and requester_state):
                return None

        If requester lacks city/state, location matching cannot be used.
        Fall back to other criteria (school name only, then grade).
        """
        person_repo = Mock()
        attendee_repo = Mock()

        requester = Person(
            cm_id=100,
            first_name="Sarah",
            last_name="Jones",
            school="Lincoln Elementary",
            city=None,  # No location data
            state=None,
            grade=4,
        )

        candidate1 = Person(
            cm_id=201,
            first_name="Emma",
            last_name="Wilson",
            school="Lincoln Elementary",
            city="Oakland",
            state="CA",
            grade=4,  # Same grade
        )

        candidate2 = Person(
            cm_id=202,
            first_name="Emma",
            last_name="Wilson",
            school="Lincoln Elementary",
            city="Denver",
            state="CO",
            grade=5,  # Different grade
        )

        person_repo.find_by_cm_id.return_value = requester

        strategy = SchoolDisambiguationStrategy(person_repo, attendee_repo)

        result = strategy.resolve_with_context(
            name="Emma Wilson",
            requester_cm_id=100,
            session_cm_id=12345,
            year=2025,
            candidates=[candidate1, candidate2],
            attendee_info=None,
        )

        # Without requester location, should use school-only + grade matching
        # Both share school name, but candidate1 has same grade → prefer candidate1
        # The metadata should NOT indicate location matching was used
        if result.is_resolved:
            assert result.metadata is not None
            assert "same_location" not in str(result.metadata.get("match_type", "")), (
                "Should not claim location match when requester has no location"
            )


class TestSchoolsMatchMethod:
    """Test the _schools_match method signature and behavior.

    Current: _schools_match(school1, school2) - only school name
    Required: _schools_match that considers city/state when available
    """

    def test_schools_match_signature_includes_location(self):
        """The _schools_match method should accept location parameters.

        This allows the method to enforce 3-way matching when location
        data is available, while still working with school-only matching
        as a fallback.
        """
        person_repo = Mock()
        attendee_repo = Mock()
        strategy = SchoolDisambiguationStrategy(person_repo, attendee_repo)

        # Test the method can be called with location params
        # If this fails, the signature needs to be updated
        try:
            # New signature should support location matching
            result = strategy._schools_match(
                candidate_school="Lincoln Elementary",
                requester_school="Lincoln Elementary",
                candidate_city="Oakland",
                requester_city="Oakland",
                candidate_state="CA",
                requester_state="CA",
            )
            assert result is True, "Should match when all fields match"

            # Different city should NOT match
            result = strategy._schools_match(
                candidate_school="Lincoln Elementary",
                requester_school="Lincoln Elementary",
                candidate_city="Denver",
                requester_city="Oakland",
                candidate_state="CO",
                requester_state="CA",
            )
            assert result is False, "Should NOT match when city/state differ"
        except TypeError:
            pytest.fail("_schools_match must accept city/state parameters for location-based matching")

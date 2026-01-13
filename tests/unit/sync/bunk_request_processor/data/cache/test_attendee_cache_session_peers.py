"""Tests for session peers functionality in AttendeeCache/TemporalNameCache.

This tests the missing functionality needed for self-reference first-name validation:
- Reverse lookup: session → [persons]
- count_session_peers_with_first_name() method

    requester_session = self.attendees_cache.get(requester_cm_id)
    for person_id, person_data in self.person_cache.items():
        if self.attendees_cache.get(person_id) != requester_session:
            continue
        # Count same-first-name peers in same session"""

from __future__ import annotations

from unittest.mock import MagicMock, Mock

import pytest

from bunking.sync.bunk_request_processor.data.cache.temporal_name_cache import (
    TemporalNameCache,
)


class TestSessionPeersIndex:
    """Tests for session → [persons] reverse index."""

    @pytest.fixture
    def mock_pb(self):
        """Create a mock PocketBase client."""
        pb = MagicMock()
        pb.collection = MagicMock(return_value=MagicMock())
        return pb

    @pytest.fixture
    def cache(self, mock_pb):
        """Create a TemporalNameCache instance."""
        return TemporalNameCache(mock_pb, year=2025)

    def test_get_persons_in_session_returns_list(self, cache):
        """Verify get_persons_in_session returns a list of person CM IDs.

        Expected: Given a session_cm_id, return all person CM IDs attending that session.
        """
        # Pre-populate the cache with test data
        cache._attendees_with_sessions = {
            1001: {"session_cm_id": 100, "session_name": "Session 1"},
            1002: {"session_cm_id": 100, "session_name": "Session 1"},
            1003: {"session_cm_id": 200, "session_name": "Session 2"},
            1004: {"session_cm_id": 100, "session_name": "Session 1"},
        }
        # Build the reverse index
        cache._build_session_to_persons_index()

        # Get persons in session 100
        persons = cache.get_persons_in_session(100)

        assert isinstance(persons, list)
        assert len(persons) == 3
        assert set(persons) == {1001, 1002, 1004}

    def test_get_persons_in_session_returns_empty_for_unknown_session(self, cache):
        """Verify empty list returned for unknown session."""
        cache._attendees_with_sessions = {
            1001: {"session_cm_id": 100, "session_name": "Session 1"},
        }
        cache._build_session_to_persons_index()

        persons = cache.get_persons_in_session(999)

        assert persons == []

    def test_session_to_persons_index_built_during_initialize(self, cache, mock_pb):
        """Verify the session→persons index is built during initialize().

        The index should be populated after _load_attendees_with_sessions completes.
        """
        # Mock the collection data
        mock_sessions = [
            Mock(cm_id=100, campminder_id=100, name="Session 1", parent_id=None),
        ]
        mock_attendees = [
            Mock(person_id=1001, expand={"session": Mock(cm_id=100, campminder_id=100)}, year=2025),
            Mock(person_id=1002, expand={"session": Mock(cm_id=100, campminder_id=100)}, year=2025),
        ]

        def mock_get_full_list(query_params=None):
            collection_name = mock_pb.collection.call_args[0][0]
            if collection_name == "camp_sessions":
                return mock_sessions
            elif collection_name == "attendees":
                return mock_attendees
            elif collection_name == "persons" or collection_name == "bunk_assignments":
                return []
            return []

        mock_pb.collection.return_value.get_full_list = mock_get_full_list

        # Run initialize (synchronous method)
        cache.initialize()

        # The index should exist and be populated
        assert hasattr(cache, "_session_to_persons")
        persons = cache.get_persons_in_session(100)
        assert len(persons) == 2


class TestCountSessionPeersWithFirstName:
    """Tests for counting session peers with same first name."""

    @pytest.fixture
    def mock_pb(self):
        """Create a mock PocketBase client."""
        pb = MagicMock()
        return pb

    @pytest.fixture
    def cache(self, mock_pb):
        """Create a TemporalNameCache with pre-populated data."""
        cache = TemporalNameCache(mock_pb, year=2025)

        # Pre-populate person cache with test data
        # Person objects need cm_id, first_name, last_name
        from bunking.sync.bunk_request_processor.core.models import Person

        cache._person_cache = {
            1001: Person(cm_id=1001, first_name="Jacob", last_name="Smith", grade=5),
            1002: Person(cm_id=1002, first_name="Jacob", last_name="Jones", grade=5),
            1003: Person(cm_id=1003, first_name="Emma", last_name="Brown", grade=5),
            1004: Person(cm_id=1004, first_name="Jacob", last_name="Williams", grade=5),
            1005: Person(cm_id=1005, first_name="Emma", last_name="Davis", grade=5),
        }

        # All in same session except 1005
        cache._attendees_with_sessions = {
            1001: {"session_cm_id": 100, "session_name": "Session 1"},
            1002: {"session_cm_id": 100, "session_name": "Session 1"},
            1003: {"session_cm_id": 100, "session_name": "Session 1"},
            1004: {"session_cm_id": 100, "session_name": "Session 1"},
            1005: {"session_cm_id": 200, "session_name": "Session 2"},
        }

        # Build the index
        cache._build_session_to_persons_index()

        return cache

    def test_count_session_peers_with_same_first_name(self, cache):
        """Verify counting peers with same first name in same session.

        - Count people in same session with same first name
        - Exclude the requester from the count

        Given: Jacob Smith (1001) is in Session 100
               Jacob Jones (1002) and Jacob Williams (1004) are also in Session 100
               Emma Brown (1003) is in Session 100 but different first name

        When: We count peers with first name "Jacob" for person 1001

        Then: Count should be 2 (1002 and 1004, excluding 1001)
        """
        count = cache.count_session_peers_with_first_name(
            session_cm_id=100,
            first_name="Jacob",
            exclude_cm_id=1001,  # Exclude the requester
        )

        assert count == 2  # 1002 and 1004

    def test_count_excludes_requester(self, cache):
        """Verify the requester is excluded from the count."""
        # Count for 1002 (Jacob Jones) - should exclude self
        count = cache.count_session_peers_with_first_name(session_cm_id=100, first_name="Jacob", exclude_cm_id=1002)

        # Should be 1001 and 1004 = 2
        assert count == 2

    def test_count_zero_when_no_other_peers_with_name(self, cache):
        """Verify 0 returned when no OTHER peers share the first name.

        This is the key case for self-reference detection:
        If a camper requests "Emma" and they ARE Emma, and NO OTHER Emma
        exists in their session, it's likely self-referential.
        """
        # Emma Brown (1003) is the only Emma in session 100
        # Emma Davis (1005) is in session 200
        count = cache.count_session_peers_with_first_name(
            session_cm_id=100,
            first_name="Emma",
            exclude_cm_id=1003,  # Exclude Emma Brown
        )

        assert count == 0

    def test_count_case_insensitive(self, cache):
        """Verify first name matching is case-insensitive."""
        count = cache.count_session_peers_with_first_name(
            session_cm_id=100,
            first_name="JACOB",  # Uppercase
            exclude_cm_id=1001,
        )

        assert count == 2

    def test_count_with_unknown_session(self, cache):
        """Verify 0 returned for unknown session."""
        count = cache.count_session_peers_with_first_name(
            session_cm_id=999,  # Unknown session
            first_name="Jacob",
            exclude_cm_id=1001,
        )

        assert count == 0

    def test_count_handles_normalized_names(self, cache):
        """Verify matching handles name normalization.

        Names like "Jacob" and "jacob" should match.
        Names with special chars should be normalized.
        """
        count = cache.count_session_peers_with_first_name(
            session_cm_id=100,
            first_name="jacob",  # lowercase
            exclude_cm_id=1001,
        )

        assert count == 2


class TestSelfReferenceMetadataPopulation:
    """Tests for populating session_peers_with_same_first_name in request metadata.

    This tests the integration point where the cache data is wired into
    the validation metadata that SelfReferenceRule needs.
    """

    @pytest.fixture
    def mock_pb(self):
        """Create a mock PocketBase client."""
        pb = MagicMock()
        return pb

    @pytest.fixture
    def cache(self, mock_pb):
        """Create a TemporalNameCache with pre-populated data."""
        cache = TemporalNameCache(mock_pb, year=2025)

        from bunking.sync.bunk_request_processor.core.models import Person

        cache._person_cache = {
            1001: Person(cm_id=1001, first_name="Unique", last_name="Name", grade=5),
            1002: Person(cm_id=1002, first_name="Common", last_name="Name1", grade=5),
            1003: Person(cm_id=1003, first_name="Common", last_name="Name2", grade=5),
        }

        cache._attendees_with_sessions = {
            1001: {"session_cm_id": 100, "session_name": "Session 1"},
            1002: {"session_cm_id": 100, "session_name": "Session 1"},
            1003: {"session_cm_id": 100, "session_name": "Session 1"},
        }

        cache._build_session_to_persons_index()

        return cache

    def test_get_self_reference_context_unique_name(self, cache):
        """Verify context for a requester with unique first name.

        When a camper has a unique first name in their session,
        first-name-only requests matching that name are likely self-referential.
        """
        context = cache.get_self_reference_context(
            requester_cm_id=1001,  # "Unique"
            session_cm_id=100,
        )

        assert context["requester_first_name"] == "unique"  # normalized
        assert context["session_peers_with_same_first_name"] == 0

    def test_get_self_reference_context_common_name(self, cache):
        """Verify context for a requester with common first name.

        When multiple campers share a first name, first-name-only requests
        are ambiguous but not necessarily self-referential.
        """
        context = cache.get_self_reference_context(
            requester_cm_id=1002,  # "Common"
            session_cm_id=100,
        )

        assert context["requester_first_name"] == "common"  # normalized
        assert context["session_peers_with_same_first_name"] == 1  # 1003

    def test_get_self_reference_context_unknown_requester(self, cache):
        """Verify None returned for unknown requester."""
        context = cache.get_self_reference_context(
            requester_cm_id=9999,  # Unknown
            session_cm_id=100,
        )

        assert context is None

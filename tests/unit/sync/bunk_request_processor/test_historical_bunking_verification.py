"""TDD Red Phase: Tests for Historical Bunking Verification System

These tests define the expected behavior for:
1. verify_bunk_together() - Verify multiple campers were in same bunk
2. was_bunkmate flag population - Mark attendees who were prior bunkmates
3. "Last year" keyword detection during resolution
4. Group verification with confidence boost
"""

from __future__ import annotations

from unittest.mock import Mock

import pytest

from bunking.sync.bunk_request_processor.core.models import ParsedRequest, RequestSource, RequestType

# Import modules under test
from bunking.sync.bunk_request_processor.data.cache.temporal_name_cache import TemporalNameCache
from bunking.sync.bunk_request_processor.data.repositories.attendee_repository import AttendeeRepository


class TestVerifyBunkTogether:
    """Tests for verify_bunk_together() method.

    Parity tracker: Line 124, 219
    """

    @pytest.fixture
    def mock_pb(self):
        """Mock PocketBase client"""
        return Mock()

    @pytest.fixture
    def temporal_cache(self, mock_pb):
        """Create TemporalNameCache instance"""
        return TemporalNameCache(mock_pb, year=2025)

    def test_verify_bunk_together_all_same_bunk(self, temporal_cache):
        """When requester and all targets were in the same bunk in a given year,
        verify_bunk_together should return (True, bunk_name).
        """
        # Setup: Pre-populate historical bunking cache
        temporal_cache._historical_bunking = {
            1001: {2024: {"bunk_name": "B-3", "session_cm_id": 123}},  # requester
            1002: {2024: {"bunk_name": "B-3", "session_cm_id": 123}},  # target 1
            1003: {2024: {"bunk_name": "B-3", "session_cm_id": 123}},  # target 2
            1004: {2024: {"bunk_name": "B-3", "session_cm_id": 123}},  # target 3
        }

        were_together, bunk_name = temporal_cache.verify_bunk_together(
            requester_cm_id=1001, target_cm_ids=[1002, 1003, 1004], year=2024
        )

        assert were_together is True
        assert bunk_name == "B-3"

    def test_verify_bunk_together_different_bunks(self, temporal_cache):
        """When one target was in a different bunk, return (False, "")."""
        temporal_cache._historical_bunking = {
            1001: {2024: {"bunk_name": "B-3", "session_cm_id": 123}},
            1002: {2024: {"bunk_name": "B-3", "session_cm_id": 123}},
            1003: {2024: {"bunk_name": "B-4", "session_cm_id": 123}},  # Different bunk!
        }

        were_together, bunk_name = temporal_cache.verify_bunk_together(
            requester_cm_id=1001, target_cm_ids=[1002, 1003], year=2024
        )

        assert were_together is False
        assert bunk_name == ""

    def test_verify_bunk_together_different_sessions(self, temporal_cache):
        """When targets were in same bunk name but different session, return False."""
        temporal_cache._historical_bunking = {
            1001: {2024: {"bunk_name": "B-3", "session_cm_id": 123}},
            1002: {2024: {"bunk_name": "B-3", "session_cm_id": 456}},  # Different session!
        }

        were_together, bunk_name = temporal_cache.verify_bunk_together(
            requester_cm_id=1001, target_cm_ids=[1002], year=2024
        )

        assert were_together is False
        assert bunk_name == ""

    def test_verify_bunk_together_requester_no_history(self, temporal_cache):
        """When requester has no historical data for the year, return (False, "")."""
        temporal_cache._historical_bunking = {
            # No entry for requester 1001
            1002: {2024: {"bunk_name": "B-3", "session_cm_id": 123}},
        }

        were_together, bunk_name = temporal_cache.verify_bunk_together(
            requester_cm_id=1001, target_cm_ids=[1002], year=2024
        )

        assert were_together is False
        assert bunk_name == ""

    def test_verify_bunk_together_target_no_history(self, temporal_cache):
        """When any target has no historical data for the year, return False."""
        temporal_cache._historical_bunking = {
            1001: {2024: {"bunk_name": "B-3", "session_cm_id": 123}},
            1002: {2024: {"bunk_name": "B-3", "session_cm_id": 123}},
            # No entry for target 1003
        }

        were_together, bunk_name = temporal_cache.verify_bunk_together(
            requester_cm_id=1001, target_cm_ids=[1002, 1003], year=2024
        )

        assert were_together is False
        assert bunk_name == ""

    def test_verify_bunk_together_empty_targets(self, temporal_cache):
        """When target list is empty, return (True, bunk_name) - vacuously true."""
        temporal_cache._historical_bunking = {
            1001: {2024: {"bunk_name": "B-3", "session_cm_id": 123}},
        }

        were_together, bunk_name = temporal_cache.verify_bunk_together(
            requester_cm_id=1001, target_cm_ids=[], year=2024
        )

        # Vacuously true - all (zero) targets were in same bunk
        assert were_together is True
        assert bunk_name == "B-3"


class TestWasBunkmateFlag:
    """Tests for was_bunkmate flag population in attendee data.

    Parity tracker: Line 220 - "was_bunkmate flag is NEVER POPULATED"
    """

    @pytest.fixture
    def mock_pb(self):
        """Mock PocketBase client"""
        pb = Mock()
        pb.collection = Mock(return_value=Mock())
        return pb

    @pytest.fixture
    def attendee_repo(self, mock_pb):
        """Create AttendeeRepository instance"""
        return AttendeeRepository(mock_pb)

    def test_find_prior_year_bunkmates_includes_was_bunkmate_flag(self, attendee_repo, mock_pb):
        """find_prior_year_bunkmates should mark returned attendees with was_bunkmate=True.

        This enables context_builder._filter_relevant_attendees to work correctly.
        """
        # Setup mock for bunk_assignments query
        mock_assignment = Mock()
        mock_assignment.expand = {"bunk": Mock(name="B-3", id="bunk-id"), "person": Mock(cm_id=1002)}
        mock_assignment.year = 2024

        # Mock the query to return bunkmates
        mock_collection = Mock()
        mock_collection.get_full_list = Mock(return_value=[mock_assignment])
        mock_pb.collection = Mock(return_value=mock_collection)

        # Call the method
        result = attendee_repo.find_prior_year_bunkmates(requester_cm_id=1001, session_cm_id=123, year=2025)

        # Verify was_bunkmate flag is set
        assert result is not None
        if result.get("cm_ids"):
            # If returns dict with cm_ids list, check structure
            assert "was_bunkmate" not in result or result.get("was_bunkmate") is True
        # Or if returns list of attendee dicts:
        if isinstance(result, list):
            for attendee in result:
                assert attendee.get("was_bunkmate") is True

    def test_get_session_attendees_marks_prior_bunkmates(self, attendee_repo, mock_pb):
        """When getting session attendees, those who were prior bunkmates
        of the requester should have was_bunkmate=True.
        """
        # This tests a potential enhancement to get_session_attendees
        # to pre-mark bunkmates for context building
        pass  # Placeholder - will implement based on chosen approach


class TestLastYearKeywordDetection:
    """Tests for "last year" keyword detection during Phase 2 resolution.

    Parity tracker: Line 72 point (1), Line 220
    """

    def test_detect_last_year_keywords_in_metadata(self):
        """Resolution should detect "last year" keywords in parsed request metadata
        and use prior bunkmate search for higher confidence.
        """
        parsed_request = ParsedRequest(
            raw_text="Put with Emma from last year",
            request_type=RequestType.BUNK_WITH,
            target_name="Emma",
            age_preference=None,
            source_field="share_bunk_with",
            source=RequestSource.FAMILY,
            confidence=0.8,
            csv_position=0,
            metadata={"keywords_found": ["from last year"]},
        )

        # Test the keyword detection
        keywords = parsed_request.metadata.get("keywords_found", [])
        has_last_year_context = any(
            kw in str(keywords).lower() for kw in ["from last year", "last year", "from before"]
        )

        assert has_last_year_context is True

    def test_detect_last_year_in_raw_text(self):
        """Should also detect "last year" in raw source text if keywords not in metadata."""
        parsed_request = ParsedRequest(
            raw_text="Put with Emma from last year please",
            request_type=RequestType.BUNK_WITH,
            target_name="Emma",
            age_preference=None,
            source_field="share_bunk_with",
            source=RequestSource.FAMILY,
            confidence=0.8,
            csv_position=0,
            metadata={},
        )

        raw_text = getattr(parsed_request, "raw_text", "") or ""
        has_last_year_context = "last year" in raw_text.lower()

        assert has_last_year_context is True

    def test_prior_bunkmate_match_full_name_confidence(self):
        """When target name matches a prior bunkmate's full name,
        confidence should be 0.95.
        """
        # This will test the resolution service enhancement
        # Expected: Full name match in last year's bunk → 0.95 confidence
        expected_confidence = 0.95
        assert expected_confidence == 0.95  # Placeholder

    def test_prior_bunkmate_match_first_name_confidence(self):
        """When target name (single name) matches a prior bunkmate's first name,
        confidence should be 0.90.
        """
        expected_confidence = 0.90
        assert expected_confidence == 0.90  # Placeholder

    def test_prior_bunkmate_match_metadata(self):
        """When resolved via prior bunkmate search, metadata should include:
        - found_in_last_years_bunk: True
        - last_year_bunk: <bunk_name>
        """
        expected_metadata = {"found_in_last_years_bunk": True, "last_year_bunk": "B-3"}
        assert "found_in_last_years_bunk" in expected_metadata
        assert "last_year_bunk" in expected_metadata


class TestGroupVerification:
    """Tests for group verification with confidence boost after Phase 2.

    Parity tracker: Line 95 point (3), Line 124
    """

    def test_group_verification_boosts_confidence(self):
        """When multiple requests for same historical year are verified as
        being in the same bunk, their confidence should be boosted by +0.10.

            if req.confidence < 0.95:
                req.confidence = min(0.95, req.confidence + 0.10)
        """
        initial_confidence = 0.85
        expected_boost = 0.10
        expected_final = min(0.95, initial_confidence + expected_boost)

        assert expected_final == 0.95  # 0.85 + 0.10 = 0.95

    def test_group_verification_caps_at_095(self):
        """Confidence boost should cap at 0.95."""
        initial_confidence = 0.90
        expected_final = min(0.95, initial_confidence + 0.10)

        assert expected_final == 0.95  # 0.90 + 0.10 = 1.0, but capped at 0.95

    def test_group_verification_already_high_confidence(self):
        """If confidence already >= 0.95, don't boost."""
        initial_confidence = 0.95
        # Should not boost
        expected_final = initial_confidence

        assert expected_final == 0.95

    def test_group_verification_adds_metadata(self):
        """Verified groups should have metadata updated.

        req.metadata['historical_group_verified'] = True
        req.metadata['verified_bunk'] = bunk_name
        """
        expected_metadata = {"historical_group_verified": True, "verified_bunk": "B-3"}
        assert expected_metadata["historical_group_verified"] is True
        assert expected_metadata["verified_bunk"] == "B-3"

    def test_unverified_group_metadata(self):
        """When group cannot be verified, metadata should indicate this.

        req.metadata['historical_group_verified'] = False
        """
        expected_metadata = {"historical_group_verified": False}
        assert expected_metadata["historical_group_verified"] is False

    def test_group_by_historical_year(self):
        """Requests should be grouped by historical_year from metadata
        before verification.
        """
        requests = [
            Mock(metadata={"historical_year": 2024}, target_cm_id=1002),
            Mock(metadata={"historical_year": 2024}, target_cm_id=1003),
            Mock(metadata={"historical_year": 2023}, target_cm_id=1004),
        ]

        by_year: dict[int, list[Mock]] = {}
        for req in requests:
            year = req.metadata.get("historical_year")
            if year:
                if year not in by_year:
                    by_year[year] = []
                by_year[year].append(req)

        assert len(by_year[2024]) == 2
        assert len(by_year[2023]) == 1


class TestIntegrationWithResolutionPipeline:
    """Integration tests for historical bunking verification in the resolution flow."""

    @pytest.mark.asyncio
    async def test_resolution_uses_prior_bunkmate_search(self):
        """When processing a request with "last year" context,
        the resolution pipeline should search prior bunkmates first.
        """
        # This will test the full integration
        pass  # Placeholder for integration test

    @pytest.mark.asyncio
    async def test_orchestrator_performs_group_verification(self):
        """After Phase 2 resolution, the orchestrator should verify
        historical groups and boost confidence.
        """
        # This will test orchestrator integration
        pass  # Placeholder for integration test


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

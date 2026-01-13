"""Tests for LAST_YEAR_BUNKMATES placeholder expansion.

Verifies that the orchestrator's PlaceholderExpander service correctly expands
generic "keep with last year's bunk" requests into individual bunk_with requests
for each returning bunkmate.

1. Detects LAST_YEAR_BUNKMATES placeholder in parsed requests
2. Calls find_prior_year_bunkmates() to get returning bunkmates
3. Creates individual bunk_with request for each returning bunkmate
4. Sets confidence=0.90, includes prior_year_bunk metadata
5. Marks for manual review with reason "Auto-expanded from generic prior year request"
"""

from __future__ import annotations

from unittest.mock import Mock, patch

import pytest

from bunking.sync.bunk_request_processor.core.models import (
    ParsedRequest,
    ParseRequest,
    ParseResult,
    Person,
    RequestSource,
    RequestType,
)
from bunking.sync.bunk_request_processor.resolution.interfaces import ResolutionResult


class TestExpandLastYearBunkmatesPlaceholders:
    """Test PlaceholderExpander.expand() behavior via orchestrator integration."""

    @pytest.fixture
    def mock_attendee_repo(self):
        """Create mock AttendeeRepository with find_prior_year_bunkmates."""
        repo = Mock()
        repo.find_prior_year_bunkmates = Mock()
        return repo

    @pytest.fixture
    def mock_person_repo(self):
        """Create mock PersonRepository with find_by_cm_id."""
        repo = Mock()
        repo.find_by_cm_id = Mock()
        return repo

    @pytest.fixture
    def orchestrator(self, mock_attendee_repo, mock_person_repo):
        """Create orchestrator instance with mocked repositories."""
        mock_pb = Mock()
        # Mock the collection calls to return empty lists
        mock_pb.collection.return_value.get_full_list.return_value = []

        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        # Create orchestrator with minimal config - suppress AI initialization
        with patch.dict("os.environ", {"AI_API_KEY": "test-key"}):
            orch = RequestOrchestrator(pb=mock_pb, year=2025, session_cm_ids=[1234567])

        # Inject our mocked repositories
        orch._attendee_repo = mock_attendee_repo
        orch._person_repo = mock_person_repo

        # Also update the PlaceholderExpander service to use the mocked repos
        orch.placeholder_expander._attendee_repo = mock_attendee_repo
        orch.placeholder_expander._person_repo = mock_person_repo

        return orch

    def _create_parse_result_with_placeholder(
        self, requester_cm_id: int, session_cm_id: int
    ) -> tuple[ParseResult, list[ResolutionResult]]:
        """Helper to create a ParseResult with LAST_YEAR_BUNKMATES placeholder."""
        parsed_request = ParsedRequest(
            raw_text="keep with last year's bunk",
            request_type=RequestType.BUNK_WITH,
            target_name="LAST_YEAR_BUNKMATES",
            age_preference=None,
            source_field="Share Bunk With",
            source=RequestSource.FAMILY,
            confidence=1.0,
            csv_position=0,
            metadata={},
        )

        parse_request = ParseRequest(
            request_text="keep with last year's bunk",
            field_name="share_bunk_with",
            requester_name="Test Camper",
            requester_cm_id=requester_cm_id,
            requester_grade="5",
            session_cm_id=session_cm_id,
            session_name="Session 1",
            year=2025,
            row_data={},
        )

        parse_result = ParseResult(
            parsed_requests=[parsed_request],
            needs_historical_context=False,
            is_valid=True,
            parse_request=parse_request,
            metadata={},
        )

        resolution_result = ResolutionResult(
            person=None, confidence=1.0, method="placeholder", metadata={"placeholder": "LAST_YEAR_BUNKMATES"}
        )

        return parse_result, [resolution_result]

    def _create_parse_result_with_real_name(
        self, requester_cm_id: int, session_cm_id: int, target_name: str, target_cm_id: int
    ) -> tuple[ParseResult, list[ResolutionResult]]:
        """Helper to create a ParseResult with a resolved real name."""
        parsed_request = ParsedRequest(
            raw_text=f"bunk with {target_name}",
            request_type=RequestType.BUNK_WITH,
            target_name=target_name,
            age_preference=None,
            source_field="Share Bunk With",
            source=RequestSource.FAMILY,
            confidence=0.95,
            csv_position=0,
            metadata={},
        )

        parse_request = ParseRequest(
            request_text=f"bunk with {target_name}",
            field_name="share_bunk_with",
            requester_name="Test Camper",
            requester_cm_id=requester_cm_id,
            requester_grade="5",
            session_cm_id=session_cm_id,
            session_name="Session 1",
            year=2025,
            row_data={},
        )

        parse_result = ParseResult(
            parsed_requests=[parsed_request],
            needs_historical_context=False,
            is_valid=True,
            parse_request=parse_request,
            metadata={},
        )

        person = Person(
            cm_id=target_cm_id,
            first_name=target_name.split()[0],
            last_name=target_name.split()[-1] if " " in target_name else "Unknown",
        )

        resolution_result = ResolutionResult(person=person, confidence=0.95, method="exact_match", metadata={})

        return parse_result, [resolution_result]

    @pytest.mark.asyncio
    async def test_expands_placeholder_to_individual_requests(self, orchestrator, mock_attendee_repo, mock_person_repo):
        """When LAST_YEAR_BUNKMATES placeholder is detected with returning bunkmates,
        should create individual bunk_with requests for each returning bunkmate.
        """
        requester_cm_id = 11111
        session_cm_id = 1234567

        # Setup: Two returning bunkmates from last year
        mock_attendee_repo.find_prior_year_bunkmates.return_value = {
            "cm_ids": [22222, 33333],
            "prior_bunk": "B-5",
            "prior_year": 2024,
            "total_in_bunk": 5,
            "returning_count": 2,
        }

        # Mock person lookups for the bunkmates
        mock_person_repo.find_by_cm_id.side_effect = [
            Person(cm_id=22222, first_name="John", last_name="Smith"),
            Person(cm_id=33333, first_name="Jane", last_name="Doe"),
        ]

        # Create resolution results with the placeholder
        parse_result, resolution_list = self._create_parse_result_with_placeholder(requester_cm_id, session_cm_id)
        resolution_results = [(parse_result, resolution_list)]

        # Execute expansion via the PlaceholderExpander service
        expanded_results = await orchestrator.placeholder_expander.expand(resolution_results)

        # Verify: Should have 2 results (one for each returning bunkmate)
        assert len(expanded_results) == 2

        # Check first expanded request
        pr1, res1 = expanded_results[0]
        assert len(pr1.parsed_requests) == 1
        assert pr1.parsed_requests[0].target_name == "John Smith"
        assert pr1.parsed_requests[0].request_type == RequestType.BUNK_WITH
        assert res1[0].person.cm_id == 22222
        assert res1[0].confidence == 0.90
        assert res1[0].metadata.get("auto_generated_from_prior_year") is True
        assert res1[0].metadata.get("prior_year_bunk") == "B-5"
        assert res1[0].metadata.get("prior_year") == 2024

        # Check second expanded request
        pr2, res2 = expanded_results[1]
        assert pr2.parsed_requests[0].target_name == "Jane Doe"
        assert res2[0].person.cm_id == 33333
        assert res2[0].confidence == 0.90

    @pytest.mark.asyncio
    async def test_no_returning_bunkmates_marks_for_review(self, orchestrator, mock_attendee_repo):
        """When LAST_YEAR_BUNKMATES placeholder is detected but no bunkmates are returning,
        should mark the original request for manual review with appropriate reason.
        """
        requester_cm_id = 11111
        session_cm_id = 1234567

        # Setup: No returning bunkmates
        mock_attendee_repo.find_prior_year_bunkmates.return_value = {
            "cm_ids": [],  # No returning bunkmates
            "prior_bunk": "B-5",
            "prior_year": 2024,
            "total_in_bunk": 5,
            "returning_count": 0,
        }

        parse_result, resolution_list = self._create_parse_result_with_placeholder(requester_cm_id, session_cm_id)
        resolution_results = [(parse_result, resolution_list)]

        # Execute expansion via the PlaceholderExpander service
        expanded_results = await orchestrator.placeholder_expander.expand(resolution_results)

        # Should keep original result but mark for review
        assert len(expanded_results) == 1
        pr, res_list = expanded_results[0]

        # Resolution should have 0 confidence (will be PENDING status)
        assert res_list[0].confidence == 0.0
        # Check expansion failure was recorded
        assert res_list[0].method == "placeholder_expansion_failed"

    @pytest.mark.asyncio
    async def test_no_prior_year_assignment_marks_for_review(self, orchestrator, mock_attendee_repo):
        """When LAST_YEAR_BUNKMATES placeholder is detected but requester wasn't at camp last year,
        should mark for manual review.
        """
        requester_cm_id = 11111
        session_cm_id = 1234567

        # Setup: No prior year data found (new camper)
        mock_attendee_repo.find_prior_year_bunkmates.return_value = {}  # Empty = no prior assignment

        parse_result, resolution_list = self._create_parse_result_with_placeholder(requester_cm_id, session_cm_id)
        resolution_results = [(parse_result, resolution_list)]

        # Execute expansion
        expanded_results = await orchestrator.placeholder_expander.expand(resolution_results)

        # Should keep original but with 0 confidence (will be PENDING)
        assert len(expanded_results) == 1
        pr, res_list = expanded_results[0]

        assert res_list[0].confidence == 0.0
        assert res_list[0].method == "placeholder_expansion_failed"

    @pytest.mark.asyncio
    async def test_non_placeholder_requests_pass_through_unchanged(self, orchestrator):
        """Non-placeholder requests should pass through unchanged.
        Only LAST_YEAR_BUNKMATES placeholders should be expanded.
        """
        requester_cm_id = 11111
        session_cm_id = 1234567

        # Create a regular resolved request (not a placeholder)
        parse_result, resolution_list = self._create_parse_result_with_real_name(
            requester_cm_id, session_cm_id, "John Smith", 22222
        )
        resolution_results = [(parse_result, resolution_list)]

        # Execute expansion
        expanded_results = await orchestrator.placeholder_expander.expand(resolution_results)

        # Should pass through unchanged
        assert len(expanded_results) == 1
        pr, res_list = expanded_results[0]
        assert pr.parsed_requests[0].target_name == "John Smith"
        assert res_list[0].person.cm_id == 22222
        assert res_list[0].confidence == 0.95  # Original confidence preserved

    @pytest.mark.asyncio
    async def test_mixed_placeholder_and_regular_requests(self, orchestrator, mock_attendee_repo, mock_person_repo):
        """When processing a batch with both placeholder and regular requests,
        should expand placeholders and preserve regular requests.
        """
        session_cm_id = 1234567

        # Setup: One returning bunkmate for the placeholder
        mock_attendee_repo.find_prior_year_bunkmates.return_value = {
            "cm_ids": [22222],
            "prior_bunk": "B-5",
            "prior_year": 2024,
            "total_in_bunk": 3,
            "returning_count": 1,
        }

        mock_person_repo.find_by_cm_id.return_value = Person(cm_id=22222, first_name="John", last_name="Smith")

        # Create resolution results: one placeholder + one regular
        placeholder_pr, placeholder_res = self._create_parse_result_with_placeholder(11111, session_cm_id)
        regular_pr, regular_res = self._create_parse_result_with_real_name(44444, session_cm_id, "Sarah Jones", 55555)

        resolution_results = [(placeholder_pr, placeholder_res), (regular_pr, regular_res)]

        # Execute expansion
        expanded_results = await orchestrator.placeholder_expander.expand(resolution_results)

        # Should have 2 results: 1 expanded from placeholder, 1 regular
        assert len(expanded_results) == 2

        # Verify expanded request (from placeholder)
        pr1, res1 = expanded_results[0]
        assert pr1.parsed_requests[0].target_name == "John Smith"
        assert res1[0].person.cm_id == 22222
        assert res1[0].metadata.get("auto_generated_from_prior_year") is True

        # Verify regular request (unchanged)
        pr2, res2 = expanded_results[1]
        assert pr2.parsed_requests[0].target_name == "Sarah Jones"
        assert res2[0].person.cm_id == 55555
        assert res2[0].metadata.get("auto_generated_from_prior_year") is None

    @pytest.mark.asyncio
    async def test_expanded_requests_have_correct_metadata(self, orchestrator, mock_attendee_repo, mock_person_repo):
        """Expanded requests should include all required metadata matching monolith behavior.

        - auto_generated_from_prior_year: True
        - prior_year_bunk: bunk name from last year
        - prior_year: the prior year
        - original_request: 'LAST_YEAR_BUNKMATES'
        """
        requester_cm_id = 11111
        session_cm_id = 1234567

        mock_attendee_repo.find_prior_year_bunkmates.return_value = {
            "cm_ids": [22222],
            "prior_bunk": "G-Aleph",
            "prior_year": 2024,
            "total_in_bunk": 4,
            "returning_count": 1,
        }

        mock_person_repo.find_by_cm_id.return_value = Person(cm_id=22222, first_name="Emma", last_name="Wilson")

        parse_result, resolution_list = self._create_parse_result_with_placeholder(requester_cm_id, session_cm_id)
        resolution_results = [(parse_result, resolution_list)]

        expanded_results = await orchestrator.placeholder_expander.expand(resolution_results)

        assert len(expanded_results) == 1
        pr, res_list = expanded_results[0]

        # Check all required metadata
        metadata = res_list[0].metadata
        assert metadata.get("auto_generated_from_prior_year") is True
        assert metadata.get("prior_year_bunk") == "G-Aleph"
        assert metadata.get("prior_year") == 2024
        assert metadata.get("original_request") == "LAST_YEAR_BUNKMATES"

        # The ParsedRequest should also have the generated target name
        assert pr.parsed_requests[0].target_name == "Emma Wilson"

    @pytest.mark.asyncio
    async def test_preserves_source_field_and_source(self, orchestrator, mock_attendee_repo, mock_person_repo):
        """Expanded requests should preserve the original source_field and source
        from the placeholder request.
        """
        requester_cm_id = 11111
        session_cm_id = 1234567

        mock_attendee_repo.find_prior_year_bunkmates.return_value = {
            "cm_ids": [22222],
            "prior_bunk": "B-5",
            "prior_year": 2024,
            "total_in_bunk": 3,
            "returning_count": 1,
        }

        mock_person_repo.find_by_cm_id.return_value = Person(cm_id=22222, first_name="John", last_name="Smith")

        parse_result, resolution_list = self._create_parse_result_with_placeholder(requester_cm_id, session_cm_id)
        # Modify source_field to verify it's preserved
        parse_result.parsed_requests[0].source_field = "BunkingNotes Notes"
        parse_result.parsed_requests[0].source = RequestSource.NOTES

        resolution_results = [(parse_result, resolution_list)]

        expanded_results = await orchestrator.placeholder_expander.expand(resolution_results)

        pr, res_list = expanded_results[0]
        assert pr.parsed_requests[0].source_field == "BunkingNotes Notes"
        assert pr.parsed_requests[0].source == RequestSource.NOTES


class TestExpandLastYearBunkmatesPipelineIntegration:
    """Integration tests verifying PlaceholderExpander service is correctly
    wired into the orchestrator.
    """

    @pytest.mark.asyncio
    async def test_expansion_happens_after_phase2_before_phase3(self):
        """Verify PlaceholderExpander service is correctly initialized and wired
        into the orchestrator for use after Phase 2 resolution.
        """
        # This test verifies the wiring, not the logic
        # The actual expansion is tested in TestExpandLastYearBunkmatesPlaceholders

        mock_pb = Mock()
        mock_pb.collection.return_value.get_full_list.return_value = []

        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )
        from bunking.sync.bunk_request_processor.services.placeholder_expander import (
            PlaceholderExpander,
        )

        with patch.dict("os.environ", {"AI_API_KEY": "test-key"}):
            orch = RequestOrchestrator(pb=mock_pb, year=2025, session_cm_ids=[])

        # Verify the PlaceholderExpander service is initialized
        assert hasattr(orch, "placeholder_expander")
        assert isinstance(orch.placeholder_expander, PlaceholderExpander)
        assert callable(orch.placeholder_expander.expand)

        # Verify the repositories are stored as instance attributes
        assert hasattr(orch, "_attendee_repo")
        assert hasattr(orch, "_person_repo")

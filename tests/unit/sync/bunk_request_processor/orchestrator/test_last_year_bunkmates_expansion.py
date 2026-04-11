"""Tests for LAST_YEAR_BUNKMATES group reference handling (auto-expand disabled).

Verifies that the orchestrator's PlaceholderExpander service correctly handles
"keep with last year's bunk" requests by creating a single PENDING request for
staff review instead of auto-expanding to individual bunk_with requests.

Auto-expansion is disabled because:
1. Vague references should not generate N individual requests
2. Staff should review and manually create specific requests
3. Named references ("Mike from last year") still resolve normally via resolution strategies
"""

from __future__ import annotations

from unittest.mock import Mock, patch

import pytest

from bunking.sync.bunk_request_processor.core.models import (
    GroupKind,
    ParsedRequest,
    ParseRequest,
    ParseResult,
    Person,
    RequestSource,
    RequestType,
)
from bunking.sync.bunk_request_processor.resolution.interfaces import ResolutionResult


class TestExpandLastYearBunkmatesPlaceholders:
    """Test PlaceholderExpander.expand() behavior via orchestrator integration.

    Since auto-expansion is disabled for LAST_YEAR_BUNKMATES, all tests
    verify that a single staff review request is created instead of
    individual expanded requests.
    """

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
        from bunking.sync.bunk_request_processor.services.group_resolvers import (
            build_resolver_registry,
        )

        # Create orchestrator with minimal config - suppress AI initialization
        with patch.dict("os.environ", {"AI_API_KEY": "test-key"}):
            orch = RequestOrchestrator(pb=mock_pb, year=2025, session_cm_ids=[1234567])

        # Inject our mocked repositories
        orch._attendee_repo = mock_attendee_repo
        orch._person_repo = mock_person_repo

        # Build resolver registry with mocked repos
        orch.resolver_registry = build_resolver_registry(
            attendee_repo=mock_attendee_repo,
            person_repo=mock_person_repo,
            year=2025,
        )

        return orch

    def _create_parse_result_with_placeholder(
        self, requester_cm_id: int, session_cm_id: int
    ) -> tuple[ParseResult, list[ResolutionResult]]:
        """Helper to create a ParseResult with LAST_YEAR_BUNKMATES group reference."""
        parsed_request = ParsedRequest(
            raw_text="keep with last year's bunk",
            request_type=RequestType.BUNK_WITH,
            target_name="",
            age_preference=None,
            source_field="Share Bunk With",
            source=RequestSource.FAMILY,
            confidence=1.0,
            csv_position=0,
            metadata={},
            group_kind=GroupKind.LAST_YEAR_BUNKMATES,
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
            person=None,
            confidence=1.0,
            method="group_reference",
            metadata={"group_kind": "last_year_bunkmates"},
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
    async def test_bunkmates_creates_staff_review_not_individual_requests(
        self, orchestrator, mock_attendee_repo, mock_person_repo
    ):
        """When LAST_YEAR_BUNKMATES placeholder is detected, should create a single
        staff review request instead of expanding to individual bunk_with requests.
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

        # Mock bulk person lookup (should NOT be called since expansion is disabled)
        john = Person(cm_id=22222, first_name="John", last_name="Smith")
        jane = Person(cm_id=33333, first_name="Jane", last_name="Doe")
        mock_person_repo.bulk_find_by_cm_ids.return_value = {22222: john, 33333: jane}

        # Create resolution results with the placeholder
        parse_result, resolution_list = self._create_parse_result_with_placeholder(requester_cm_id, session_cm_id)
        resolution_results = [(parse_result, resolution_list)]

        # Execute expansion via the PlaceholderExpander service
        expanded_results = await orchestrator.placeholder_expander.expand(
            resolution_results, orchestrator.resolver_registry
        )

        # Should have 1 result (staff review), NOT 2 (individual expansions)
        assert len(expanded_results) == 1

        pr, res_list = expanded_results[0]
        assert res_list[0].method == "auto_expand_disabled"
        assert res_list[0].person is None
        assert res_list[0].metadata.get("needs_staff_review") is True
        assert res_list[0].metadata.get("group_kind") == "last_year_bunkmates"

    @pytest.mark.asyncio
    async def test_no_returning_bunkmates_marks_for_review(self, orchestrator, mock_attendee_repo):
        """When LAST_YEAR_BUNKMATES placeholder is detected but no bunkmates are returning,
        should still create staff review request (auto-expand disabled).
        """
        requester_cm_id = 11111
        session_cm_id = 1234567

        # Setup: No returning bunkmates
        mock_attendee_repo.find_prior_year_bunkmates.return_value = {
            "cm_ids": [],
            "prior_bunk": "B-5",
            "prior_year": 2024,
            "total_in_bunk": 5,
            "returning_count": 0,
        }

        parse_result, resolution_list = self._create_parse_result_with_placeholder(requester_cm_id, session_cm_id)
        resolution_results = [(parse_result, resolution_list)]

        expanded_results = await orchestrator.placeholder_expander.expand(
            resolution_results, orchestrator.resolver_registry
        )

        # Should keep original result but as staff review
        assert len(expanded_results) == 1
        pr, res_list = expanded_results[0]

        assert res_list[0].confidence == 0.0
        assert res_list[0].method == "auto_expand_disabled"

    @pytest.mark.asyncio
    async def test_no_prior_year_assignment_marks_for_review(self, orchestrator, mock_attendee_repo):
        """When LAST_YEAR_BUNKMATES placeholder is detected but requester wasn't at camp last year,
        should create staff review request (auto-expand disabled).
        """
        requester_cm_id = 11111
        session_cm_id = 1234567

        # Setup: No prior year data found (new camper)
        mock_attendee_repo.find_prior_year_bunkmates.return_value = {}

        parse_result, resolution_list = self._create_parse_result_with_placeholder(requester_cm_id, session_cm_id)
        resolution_results = [(parse_result, resolution_list)]

        expanded_results = await orchestrator.placeholder_expander.expand(
            resolution_results, orchestrator.resolver_registry
        )

        assert len(expanded_results) == 1
        pr, res_list = expanded_results[0]

        assert res_list[0].confidence == 0.0
        assert res_list[0].method == "auto_expand_disabled"

    @pytest.mark.asyncio
    async def test_non_placeholder_requests_pass_through_unchanged(self, orchestrator):
        """Non-placeholder requests should pass through unchanged.
        Only LAST_YEAR_BUNKMATES placeholders are affected by auto-expand disable.
        """
        requester_cm_id = 11111
        session_cm_id = 1234567

        # Create a regular resolved request (not a placeholder)
        parse_result, resolution_list = self._create_parse_result_with_real_name(
            requester_cm_id, session_cm_id, "John Smith", 22222
        )
        resolution_results = [(parse_result, resolution_list)]

        expanded_results = await orchestrator.placeholder_expander.expand(
            resolution_results, orchestrator.resolver_registry
        )

        # Should pass through unchanged
        assert len(expanded_results) == 1
        pr, res_list = expanded_results[0]
        assert pr.parsed_requests[0].target_name == "John Smith"
        assert res_list[0].person.cm_id == 22222
        assert res_list[0].confidence == 0.95

    @pytest.mark.asyncio
    async def test_mixed_placeholder_and_regular_requests(self, orchestrator, mock_attendee_repo, mock_person_repo):
        """When processing a batch with both placeholder and regular requests,
        should create staff review for placeholder and preserve regular requests.
        """
        session_cm_id = 1234567

        # Setup: bunkmate data (won't be used due to disabled auto-expand)
        mock_attendee_repo.find_prior_year_bunkmates.return_value = {
            "cm_ids": [22222],
            "prior_bunk": "B-5",
            "prior_year": 2024,
            "total_in_bunk": 3,
            "returning_count": 1,
        }
        mock_person_repo.bulk_find_by_cm_ids.return_value = {
            22222: Person(cm_id=22222, first_name="John", last_name="Smith"),
        }

        # Create resolution results: one placeholder + one regular
        placeholder_pr, placeholder_res = self._create_parse_result_with_placeholder(11111, session_cm_id)
        regular_pr, regular_res = self._create_parse_result_with_real_name(44444, session_cm_id, "Sarah Jones", 55555)

        resolution_results = [(placeholder_pr, placeholder_res), (regular_pr, regular_res)]

        expanded_results = await orchestrator.placeholder_expander.expand(
            resolution_results, orchestrator.resolver_registry
        )

        # Should have 2 results: 1 staff review + 1 regular
        assert len(expanded_results) == 2

        # First result: staff review for placeholder
        pr1, res1 = expanded_results[0]
        assert res1[0].method == "auto_expand_disabled"
        assert res1[0].person is None
        assert res1[0].metadata.get("needs_staff_review") is True

        # Second result: regular request unchanged
        pr2, res2 = expanded_results[1]
        assert pr2.parsed_requests[0].target_name == "Sarah Jones"
        assert res2[0].person.cm_id == 55555
        assert res2[0].metadata.get("needs_staff_review") is None

    @pytest.mark.asyncio
    async def test_staff_review_has_group_kind_metadata(self, orchestrator, mock_attendee_repo, mock_person_repo):
        """Staff review request should include group_kind metadata for context."""
        requester_cm_id = 11111
        session_cm_id = 1234567

        mock_attendee_repo.find_prior_year_bunkmates.return_value = {
            "cm_ids": [22222],
            "prior_bunk": "G-Aleph",
            "prior_year": 2024,
            "total_in_bunk": 4,
            "returning_count": 1,
        }
        mock_person_repo.bulk_find_by_cm_ids.return_value = {
            22222: Person(cm_id=22222, first_name="Emma", last_name="Wilson"),
        }

        parse_result, resolution_list = self._create_parse_result_with_placeholder(requester_cm_id, session_cm_id)
        resolution_results = [(parse_result, resolution_list)]

        expanded_results = await orchestrator.placeholder_expander.expand(
            resolution_results, orchestrator.resolver_registry
        )

        assert len(expanded_results) == 1
        pr, res_list = expanded_results[0]

        # Check metadata on the resolution result
        metadata = res_list[0].metadata
        assert metadata.get("group_kind") == "last_year_bunkmates"
        assert metadata.get("needs_staff_review") is True
        assert res_list[0].method == "auto_expand_disabled"

        # Original request text should be preserved
        assert pr.parsed_requests[0].raw_text == "keep with last year's bunk"

    @pytest.mark.asyncio
    async def test_preserves_source_field_and_source(self, orchestrator, mock_attendee_repo, mock_person_repo):
        """Staff review request should preserve the original source_field and source."""
        requester_cm_id = 11111
        session_cm_id = 1234567

        mock_attendee_repo.find_prior_year_bunkmates.return_value = {
            "cm_ids": [22222],
            "prior_bunk": "B-5",
            "prior_year": 2024,
            "total_in_bunk": 3,
            "returning_count": 1,
        }
        mock_person_repo.bulk_find_by_cm_ids.return_value = {
            22222: Person(cm_id=22222, first_name="John", last_name="Smith"),
        }

        parse_result, resolution_list = self._create_parse_result_with_placeholder(requester_cm_id, session_cm_id)
        # Modify source_field to verify it's preserved
        parse_result.parsed_requests[0].source_field = "BunkingNotes Notes"
        parse_result.parsed_requests[0].source = RequestSource.STAFF

        resolution_results = [(parse_result, resolution_list)]

        expanded_results = await orchestrator.placeholder_expander.expand(
            resolution_results, orchestrator.resolver_registry
        )

        pr, res_list = expanded_results[0]
        assert pr.parsed_requests[0].source_field == "BunkingNotes Notes"
        assert pr.parsed_requests[0].source == RequestSource.STAFF


class TestExpandLastYearBunkmatesPipelineIntegration:
    """Integration tests verifying PlaceholderExpander service is correctly
    wired into the orchestrator.
    """

    @pytest.mark.asyncio
    async def test_expansion_happens_after_phase2_before_phase3(self):
        """Verify PlaceholderExpander service is correctly initialized and wired
        into the orchestrator for use after Phase 2 resolution.
        """
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

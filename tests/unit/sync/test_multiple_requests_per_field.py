"""
Test multiple requests per field functionality in V3b architecture
"""

from unittest.mock import AsyncMock, Mock

import pytest

from bunking.sync.bunk_request_processor.core.models import (
    ParsedRequest,
    ParseResult,
    Person,
    RequestType,
)
from bunking.sync.bunk_request_processor.integration.batch_processor import BatchProcessor
from bunking.sync.bunk_request_processor.services.phase2_resolution_service import (
    Phase2ResolutionService,
    ResolutionCase,
)
from bunking.sync.bunk_request_processor.services.phase3_disambiguation_service import (
    DisambiguationCase,
    Phase3DisambiguationService,
)


class TestMultipleRequestsPerField:
    """Test that V3b correctly processes ALL requests from fields containing multiple names"""

    def _create_parsed_request(
        self, target_name: str, request_type: str = "bunk_with", source_field: str = "bunk_with_1"
    ) -> ParsedRequest:
        """Helper to create a properly structured ParsedRequest"""
        req = Mock(spec=ParsedRequest)
        req.target_name = target_name
        req.request_type = request_type
        req.raw_text = target_name
        req.age_preference = None
        req.source_field = source_field
        req.source = "csv"
        req.confidence = 0.95
        req.csv_position = 0
        req.metadata = {}
        req.priority = "high"
        req.is_valid = True
        return req

    def _create_person(self, cm_id: str, name: str, grade: str = "3") -> Person:
        """Helper to create a Person mock"""
        person = Mock()
        person.cm_id = cm_id
        parts = name.split()
        person.first_name = parts[0]
        person.last_name = parts[1] if len(parts) > 1 else ""
        person.grade = int(grade) if grade else None
        person.name = name  # Add computed name property
        return person

    def _create_resolution_result(self, person=None, candidates=None, confidence=0.0, method="test", **kwargs):
        """Helper to create a ResolutionResult"""
        result = Mock()
        result.person = person
        result.candidates = candidates or []
        result.confidence = confidence
        result.method = method
        result.metadata = {}
        result.is_ambiguous = len(result.candidates) > 1
        result.is_resolved = result.person is not None
        # Ignore is_ambiguous in kwargs as it's computed
        if "is_ambiguous" in kwargs:
            kwargs.pop("is_ambiguous")
        for key, value in kwargs.items():
            setattr(result, key, value)
        return result

    @pytest.fixture
    def mock_ai_provider(self):
        """Mock AI provider that returns multiple parsed requests"""
        provider = Mock()
        provider.name = "test_provider"
        return provider

    @pytest.fixture
    def sample_parse_request(self):
        """Sample parse request with multiple names"""
        req = Mock()
        req.request_text = "Sara, Rana, Avery"
        req.field_name = "bunk_with_1"
        req.requester_name = "Parent Name"
        req.requester_cm_id = 100
        req.requester_grade = ""
        req.session_cm_id = 1000
        req.session_name = "Session 1"
        req.year = 2025
        req.row_data = {"id": "test_123", "bunk_with_1": "Sara, Rana, Avery"}
        req.id = "test_123"  # Add id for tests that expect it
        return req

    @pytest.fixture
    def sample_parsed_response_multiple(self):
        """AI response with multiple parsed requests"""
        response = Mock()
        response.requests = [
            Mock(target_name="Sara", request_type=RequestType.BUNK_WITH, is_valid=True, confidence=0.95, metadata={}),
            Mock(target_name="Rana", request_type=RequestType.BUNK_WITH, is_valid=True, confidence=0.95, metadata={}),
            Mock(target_name="Avery", request_type=RequestType.BUNK_WITH, is_valid=True, confidence=0.95, metadata={}),
        ]
        response.confidence = 0.95
        response.parsed_count = 3
        response.metadata = {}
        return response

    def test_batch_processor_convert_to_parse_result(self, sample_parse_request, sample_parsed_response_multiple):
        """Test that BatchProcessor._convert_to_parse_result handles ALL requests"""
        # Setup
        batch_processor = BatchProcessor(Mock())

        # Execute
        parse_result = batch_processor._convert_to_parse_result(sample_parse_request, sample_parsed_response_multiple)

        # Verify that ALL 3 requests were processed
        assert len(parse_result.parsed_requests) == 3
        assert parse_result.parsed_requests[0].target_name == "Sara"
        assert parse_result.parsed_requests[1].target_name == "Rana"
        assert parse_result.parsed_requests[2].target_name == "Avery"

        # Verify source field is set for all
        for req in parse_result.parsed_requests:
            assert req.source_field == "bunk_with_1"
            assert req.request_type == RequestType.BUNK_WITH
            assert req.confidence == 0.95

    def test_phase2_resolution_case_handles_lists(self, sample_parse_request):
        """Test that ResolutionCase properly handles lists of parsed requests"""
        # Create ParseResult with multiple requests
        parse_result = ParseResult(
            parsed_requests=[
                self._create_parsed_request("Sara"),
                self._create_parsed_request("Rana"),
                self._create_parsed_request("Avery"),
            ],
            parse_request=sample_parse_request,
        )

        # Create ResolutionCase
        case = ResolutionCase(parse_result)

        # Verify it handles the list correctly
        assert len(case.parsed_requests) == 3
        assert case.parsed_requests[0].target_name == "Sara"
        assert case.parsed_requests[1].target_name == "Rana"
        assert case.parsed_requests[2].target_name == "Avery"
        assert len(case.requests_needing_resolution) == 3

    @pytest.mark.asyncio
    async def test_phase2_batch_resolve_returns_lists(self, sample_parse_request):
        """Test that Phase2ResolutionService.batch_resolve returns lists of ResolutionResults"""
        # Setup
        resolver = Mock()
        context_builder = Mock()
        service = Phase2ResolutionService(resolver, context_builder)

        # Create test data
        parse_results = [
            ParseResult(
                parsed_requests=[self._create_parsed_request("Sara"), self._create_parsed_request("Rana")],
                parse_request=sample_parse_request,
            )
        ]

        # Mock resolver to return different results
        sara_person = self._create_person("200", "Sara Smith", "3")
        rana_person = self._create_person("201", "Rana Jones", "3")

        # Mock the resolution pipeline batch_resolve method
        resolver.batch_resolve = Mock(
            return_value=[
                self._create_resolution_result(person=sara_person, confidence=0.9, method="exact_match"),
                self._create_resolution_result(person=rana_person, confidence=0.85, method="fuzzy_match"),
            ]
        )

        # Execute
        results = await service.batch_resolve(parse_results)

        # Verify structure
        assert len(results) == 1
        _, resolution_list = results[0]
        assert len(resolution_list) == 2
        assert resolution_list[0].person is not None
        assert resolution_list[0].person.name == "Sara Smith"  # type: ignore[attr-defined]
        assert resolution_list[1].person is not None
        assert resolution_list[1].person.name == "Rana Jones"  # type: ignore[attr-defined]

    def test_phase3_disambiguation_case_tracks_ambiguous_indices(self):
        """Test that DisambiguationCase properly tracks which resolutions are ambiguous"""
        # Create test data
        parse_result = ParseResult(
            parsed_requests=[
                self._create_parsed_request("Sara"),
                self._create_parsed_request("Rana"),
                self._create_parsed_request("Avery"),
            ]
        )

        # Create resolution results - Sara is ambiguous, Rana is resolved, Avery is ambiguous
        sara_candidates = [
            self._create_person("200", "Sara Smith", "3"),
            self._create_person("201", "Sara Johnson", "3"),
        ]
        rana_person = self._create_person("202", "Rana Jones", "3")
        avery_candidates = [
            self._create_person("203", "Avery Brown", "3"),
            self._create_person("204", "Avery Miller", "3"),
        ]

        resolution_results = [
            self._create_resolution_result(candidates=sara_candidates),
            self._create_resolution_result(person=rana_person, confidence=0.95),
            self._create_resolution_result(candidates=avery_candidates),
        ]

        # Create disambiguation case
        case = DisambiguationCase(parse_result, resolution_results)

        # Verify
        assert case.has_ambiguous
        assert case.ambiguous_indices == [0, 2]  # Sara and Avery are ambiguous
        assert len(case.disambiguated_results) == 3
        assert all(r is None for r in case.disambiguated_results)

    @pytest.mark.skip(reason="Test mock returns dict but code expects object with .additional_context attribute - FIX")
    @pytest.mark.asyncio
    async def test_phase3_creates_individual_disambiguation_requests(self):
        """Test that Phase3 creates individual requests while preserving field context"""
        # Setup
        ai_provider = Mock()
        context_builder = Mock()
        batch_processor = Mock()
        service = Phase3DisambiguationService(ai_provider, context_builder, batch_processor)

        # Create test case with multiple ambiguous names
        parse_result = ParseResult(
            parsed_requests=[self._create_parsed_request("Sara"), self._create_parsed_request("Avery")],
            parse_request=Mock(
                requester_cm_id="100",
                requester_name="Parent",
                requester_grade="",
                session_cm_id="1000",
                session_name="Session 1",
                year=2025,
            ),
        )

        resolution_results = [
            self._create_resolution_result(candidates=[Mock(cm_id="200"), Mock(cm_id="201")], is_ambiguous=True),
            self._create_resolution_result(candidates=[Mock(cm_id="202"), Mock(cm_id="203")], is_ambiguous=True),
        ]

        # Mock context builder
        context_builder.build_disambiguation_context = Mock(
            side_effect=[
                {"name": "Sara", "field_context": "Requested together with: Avery"},
                {"name": "Avery", "field_context": "Requested together with: Sara"},
            ]
        )

        # Mock batch processor response
        batch_processor.batch_disambiguate = AsyncMock(
            return_value=[Mock(person_cm_id="200", confidence=0.9), Mock(person_cm_id="203", confidence=0.85)]
        )

        # Execute
        results = await service.batch_disambiguate([(parse_result, resolution_results)])

        # Verify
        assert len(results) == 1
        _, final_resolutions = results[0]
        assert len(final_resolutions) == 2

        # Check that context builder was called with field context
        assert context_builder.build_disambiguation_context.call_count == 2
        for call in context_builder.build_disambiguation_context.call_args_list:
            context = call[1]
            assert "parsed_request" in context
            assert "candidates" in context

    @pytest.mark.skip(reason="Test mock returns dict but code expects object with .additional_context attribute - FIX")
    @pytest.mark.asyncio
    async def test_phase3_preserves_list_structure(self):
        """Test that Phase 3 preserves list structure through disambiguation"""
        # Setup
        ai_provider = Mock()
        context_builder = Mock()
        context_builder.build_disambiguation_context = Mock(return_value={})
        batch_processor = Mock()
        service = Phase3DisambiguationService(ai_provider, context_builder, batch_processor)

        # Create test data with multiple requests
        parse_result = ParseResult(
            parsed_requests=[
                self._create_parsed_request("Sara"),
                self._create_parsed_request("Rana"),
                self._create_parsed_request("Avery"),
            ],
            parse_request=Mock(
                requester_cm_id=100,
                requester_name="Parent",
                requester_grade="",
                session_cm_id=1000,
                session_name="Session 1",
                year=2025,
            ),
        )

        # Create resolution results - Sara is ambiguous, Rana resolved, Avery ambiguous
        resolution_results = [
            self._create_resolution_result(candidates=[Mock(cm_id="200"), Mock(cm_id="201")], is_ambiguous=True),
            self._create_resolution_result(person=Mock(cm_id="202"), confidence=0.95, is_ambiguous=False),
            self._create_resolution_result(candidates=[Mock(cm_id="203"), Mock(cm_id="204")], is_ambiguous=True),
        ]

        # Mock batch processor to return disambiguation results
        batch_processor.batch_disambiguate = AsyncMock(
            return_value=[Mock(person_cm_id="200", confidence=0.9), Mock(person_cm_id="204", confidence=0.85)]
        )

        # Execute
        results = await service.batch_disambiguate([(parse_result, resolution_results)])

        # Verify structure preserved
        assert len(results) == 1
        result_pr, result_resolutions = results[0]
        assert len(result_pr.parsed_requests) == 3
        assert len(result_resolutions) == 3

    @pytest.mark.asyncio
    async def test_end_to_end_multiple_requests_flow(self):
        """Test complete flow from parsing to final results with multiple requests per field"""
        # This test verifies the entire pipeline handles multiple requests correctly

        # Setup parse request
        parse_request = Mock()
        parse_request.request_text = "Sara Smith, Rana Jones, Avery Brown"
        parse_request.field_name = "bunk_with_1"
        parse_request.requester_cm_id = 100
        parse_request.id = "test_123"

        # Setup response with multiple requests
        parsed_response = Mock()
        parsed_response.requests = [
            Mock(
                target_name="Sara Smith",
                request_type=RequestType.BUNK_WITH,
                confidence=0.95,
                is_valid=True,
                metadata={},
            ),
            Mock(
                target_name="Rana Jones",
                request_type=RequestType.BUNK_WITH,
                confidence=0.95,
                is_valid=True,
                metadata={},
            ),
            Mock(
                target_name="Avery Brown",
                request_type=RequestType.BUNK_WITH,
                confidence=0.95,
                is_valid=True,
                metadata={},
            ),
        ]
        parsed_response.confidence = 0.95
        parsed_response.metadata = {}

        batch_processor = BatchProcessor(Mock())

        # Execute conversion
        parse_result = batch_processor._convert_to_parse_result(parse_request, parsed_response)

        # Verify all requests were converted
        assert len(parse_result.parsed_requests) == 3

        # Verify each request maintains its identity
        names = [req.target_name for req in parse_result.parsed_requests]
        assert "Sara Smith" in names
        assert "Rana Jones" in names
        assert "Avery Brown" in names

        # Verify all have the same source field
        for req in parse_result.parsed_requests:
            assert req.source_field == "bunk_with_1"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

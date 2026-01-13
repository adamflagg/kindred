"""Tests for HistoricalVerificationService

Tests cover:
1. Initialization with temporal name cache
2. Pass-through when no historical context
3. Grouping of requests by historical year
4. Verification of historical groups (same bunk)
5. Confidence boosting for verified groups (+0.10)
6. Confidence capping at 0.95
7. Handling unverified groups (no boost)
8. Skip single-item groups (need 2+ for verification)
"""

from __future__ import annotations

from unittest.mock import Mock

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
from bunking.sync.bunk_request_processor.services.historical_verification_service import (
    HistoricalVerificationService,
)

# ============================================================================
# Test Fixtures and Helpers
# ============================================================================


def _create_person(
    cm_id: int = 12345,
    first_name: str = "Sarah",
    last_name: str = "Smith",
) -> Person:
    """Helper to create Person objects"""
    return Person(
        cm_id=cm_id,
        first_name=first_name,
        last_name=last_name,
    )


def _create_parse_request(
    requester_cm_id: int = 11111,
    session_cm_id: int = 1000002,
    year: int = 2025,
) -> ParseRequest:
    """Helper to create ParseRequest objects"""
    return ParseRequest(
        request_text="bunk with Sarah Smith from 2024",
        field_name="share_bunk_with",
        requester_name="Test Requester",
        requester_cm_id=requester_cm_id,
        requester_grade="5",
        session_cm_id=session_cm_id,
        session_name="Session 2",
        year=year,
        row_data={"share_bunk_with": "bunk with Sarah Smith from 2024"},
    )


def _create_parsed_request(
    target_name: str = "Sarah Smith",
    request_type: RequestType = RequestType.BUNK_WITH,
) -> ParsedRequest:
    """Helper to create ParsedRequest objects"""
    return ParsedRequest(
        raw_text=f"bunk with {target_name}",
        request_type=request_type,
        target_name=target_name,
        age_preference=None,
        source_field="share_bunk_with",
        source=RequestSource.FAMILY,
        confidence=0.9,
        csv_position=0,
        metadata={},
    )


def _create_parse_result(
    parsed_requests: list[ParsedRequest] | None = None,
    parse_request: ParseRequest | None = None,
    is_valid: bool = True,
) -> ParseResult:
    """Helper to create ParseResult objects"""
    if parsed_requests is None:
        parsed_requests = [_create_parsed_request()]
    if parse_request is None:
        parse_request = _create_parse_request()
    return ParseResult(
        parsed_requests=parsed_requests,
        is_valid=is_valid,
        parse_request=parse_request,
        needs_historical_context=False,
        metadata={},
    )


def _create_resolution_with_history(
    person: Person,
    historical_year: int,
    confidence: float = 0.80,
) -> ResolutionResult:
    """Helper to create a resolution result with historical year metadata"""
    return ResolutionResult(
        person=person,
        confidence=confidence,
        method="exact_match",
        metadata={"historical_year": historical_year},
    )


def _create_resolution_without_history(
    person: Person,
    confidence: float = 0.85,
) -> ResolutionResult:
    """Helper to create a resolution result without historical context"""
    return ResolutionResult(
        person=person,
        confidence=confidence,
        method="exact_match",
        metadata={},
    )


@pytest.fixture
def mock_temporal_cache() -> Mock:
    """Create a mock temporal name cache"""
    cache = Mock()
    cache.verify_bunk_together = Mock(return_value=(False, None))
    return cache


@pytest.fixture
def service(mock_temporal_cache: Mock) -> HistoricalVerificationService:
    """Create a HistoricalVerificationService with mock cache"""
    return HistoricalVerificationService(
        temporal_name_cache=mock_temporal_cache,
    )


# ============================================================================
# Test: Initialization
# ============================================================================


class TestHistoricalVerificationServiceInit:
    """Tests for HistoricalVerificationService initialization"""

    def test_init_with_temporal_cache(self, mock_temporal_cache: Mock) -> None:
        """Should initialize with temporal name cache"""
        service = HistoricalVerificationService(
            temporal_name_cache=mock_temporal_cache,
        )
        assert service is not None

    def test_init_with_none_cache(self) -> None:
        """Should handle None cache (verification disabled)"""
        service = HistoricalVerificationService(temporal_name_cache=None)
        assert service is not None


# ============================================================================
# Test: Pass-through behavior
# ============================================================================


class TestPassThrough:
    """Tests for results passing through unchanged"""

    @pytest.mark.asyncio
    async def test_no_cache_returns_unchanged(self) -> None:
        """Results should pass through unchanged when no temporal cache"""
        service = HistoricalVerificationService(temporal_name_cache=None)

        person = _create_person()
        parse_result = _create_parse_result()
        resolution = _create_resolution_with_history(person, 2024)

        input_results = [(parse_result, [resolution])]
        output = await service.verify(input_results)

        assert len(output) == 1
        assert output[0] == (parse_result, [resolution])

    @pytest.mark.asyncio
    async def test_invalid_parse_results_pass_through(self, service: HistoricalVerificationService) -> None:
        """Invalid parse results should pass through unchanged"""
        parse_result = _create_parse_result(is_valid=False)
        resolution = ResolutionResult(confidence=0.0, method="none")

        input_results = [(parse_result, [resolution])]
        output = await service.verify(input_results)

        assert len(output) == 1
        assert output[0] == (parse_result, [resolution])

    @pytest.mark.asyncio
    async def test_empty_input_returns_empty(self, service: HistoricalVerificationService) -> None:
        """Empty input should return empty output"""
        output = await service.verify([])
        assert output == []

    @pytest.mark.asyncio
    async def test_no_historical_year_metadata_passes_through(self, service: HistoricalVerificationService) -> None:
        """Results without historical_year metadata should pass through"""
        person = _create_person()
        parse_result = _create_parse_result()
        resolution = _create_resolution_without_history(person)

        input_results = [(parse_result, [resolution])]
        output = await service.verify(input_results)

        assert len(output) == 1
        # Should be unchanged
        _, resolutions = output[0]
        assert resolutions[0].confidence == 0.85


# ============================================================================
# Test: Verification logic
# ============================================================================


class TestVerification:
    """Tests for historical group verification"""

    @pytest.mark.asyncio
    async def test_single_item_group_not_verified(
        self, service: HistoricalVerificationService, mock_temporal_cache: Mock
    ) -> None:
        """Groups with only 1 item should not be verified (need 2+)"""
        person = _create_person()
        parse_result = _create_parse_result()
        resolution = _create_resolution_with_history(person, 2024, confidence=0.80)

        input_results = [(parse_result, [resolution])]
        output = await service.verify(input_results)

        # Cache should not be called for single-item groups
        mock_temporal_cache.verify_bunk_together.assert_not_called()

        # Confidence should be unchanged
        _, resolutions = output[0]
        assert resolutions[0].confidence == 0.80

    @pytest.mark.asyncio
    async def test_verified_group_gets_confidence_boost(
        self, service: HistoricalVerificationService, mock_temporal_cache: Mock
    ) -> None:
        """Verified historical group should get +0.10 confidence boost"""
        mock_temporal_cache.verify_bunk_together.return_value = (True, "B-3")

        person1 = _create_person(cm_id=22222, first_name="Alex", last_name="Jones")
        person2 = _create_person(cm_id=33333, first_name="Jordan", last_name="Lee")

        parse_result = _create_parse_result(
            parsed_requests=[
                _create_parsed_request("Alex Jones"),
                _create_parsed_request("Jordan Lee"),
            ]
        )
        resolutions = [
            _create_resolution_with_history(person1, 2024, confidence=0.80),
            _create_resolution_with_history(person2, 2024, confidence=0.80),
        ]

        input_results = [(parse_result, resolutions)]
        output = await service.verify(input_results)

        # Both should have boosted confidence
        _, out_resolutions = output[0]
        assert out_resolutions[0].confidence == 0.90  # 0.80 + 0.10
        assert out_resolutions[1].confidence == 0.90
        assert out_resolutions[0].metadata is not None
        assert out_resolutions[0].metadata.get("historical_group_verified") is True
        assert out_resolutions[0].metadata.get("verified_bunk") == "B-3"

    @pytest.mark.asyncio
    async def test_confidence_capped_at_095(
        self, service: HistoricalVerificationService, mock_temporal_cache: Mock
    ) -> None:
        """Boosted confidence should be capped at 0.95"""
        mock_temporal_cache.verify_bunk_together.return_value = (True, "G-5")

        person1 = _create_person(cm_id=22222)
        person2 = _create_person(cm_id=33333)

        parse_result = _create_parse_result(
            parsed_requests=[
                _create_parsed_request("Person 1"),
                _create_parsed_request("Person 2"),
            ]
        )
        resolutions = [
            _create_resolution_with_history(person1, 2024, confidence=0.90),
            _create_resolution_with_history(person2, 2024, confidence=0.92),
        ]

        input_results = [(parse_result, resolutions)]
        output = await service.verify(input_results)

        _, out_resolutions = output[0]
        assert out_resolutions[0].confidence == 0.95  # 0.90 + 0.10, but capped
        assert out_resolutions[1].confidence == 0.95  # 0.92 + 0.10, but capped

    @pytest.mark.asyncio
    async def test_already_high_confidence_gets_metadata_only(
        self, service: HistoricalVerificationService, mock_temporal_cache: Mock
    ) -> None:
        """Items already at 0.95+ should only get metadata update"""
        mock_temporal_cache.verify_bunk_together.return_value = (True, "B-3")

        person1 = _create_person(cm_id=22222)
        person2 = _create_person(cm_id=33333)

        parse_result = _create_parse_result(
            parsed_requests=[
                _create_parsed_request("Person 1"),
                _create_parsed_request("Person 2"),
            ]
        )
        resolutions = [
            _create_resolution_with_history(person1, 2024, confidence=0.95),
            _create_resolution_with_history(person2, 2024, confidence=0.97),
        ]

        input_results = [(parse_result, resolutions)]
        output = await service.verify(input_results)

        _, out_resolutions = output[0]
        assert out_resolutions[0].confidence == 0.95  # No change, already at max
        assert out_resolutions[1].confidence == 0.97  # No change
        assert out_resolutions[0].metadata is not None
        assert out_resolutions[0].metadata.get("historical_group_verified") is True

    @pytest.mark.asyncio
    async def test_unverified_group_marked_false(
        self, service: HistoricalVerificationService, mock_temporal_cache: Mock
    ) -> None:
        """Unverified groups should be marked with verified=False"""
        mock_temporal_cache.verify_bunk_together.return_value = (False, None)

        person1 = _create_person(cm_id=22222)
        person2 = _create_person(cm_id=33333)

        parse_result = _create_parse_result(
            parsed_requests=[
                _create_parsed_request("Person 1"),
                _create_parsed_request("Person 2"),
            ]
        )
        resolutions = [
            _create_resolution_with_history(person1, 2024, confidence=0.80),
            _create_resolution_with_history(person2, 2024, confidence=0.80),
        ]

        input_results = [(parse_result, resolutions)]
        output = await service.verify(input_results)

        _, out_resolutions = output[0]
        # Confidence should NOT be boosted
        assert out_resolutions[0].confidence == 0.80
        assert out_resolutions[1].confidence == 0.80
        # But should have verified=False metadata
        assert out_resolutions[0].metadata is not None
        assert out_resolutions[0].metadata.get("historical_group_verified") is False


# ============================================================================
# Test: Multiple years in same result
# ============================================================================


class TestMultipleYears:
    """Tests for handling multiple historical years"""

    @pytest.mark.asyncio
    async def test_separate_verification_per_year(
        self, service: HistoricalVerificationService, mock_temporal_cache: Mock
    ) -> None:
        """Each year's group should be verified separately"""

        # 2024 group verified, 2023 group not verified
        def verify_side_effect(requester_id, target_ids, year):
            if year == 2024:
                return (True, "B-3")
            return (False, None)

        mock_temporal_cache.verify_bunk_together.side_effect = verify_side_effect

        person1 = _create_person(cm_id=22222)
        person2 = _create_person(cm_id=33333)
        person3 = _create_person(cm_id=44444)
        person4 = _create_person(cm_id=55555)

        parse_result = _create_parse_result(
            parsed_requests=[
                _create_parsed_request("Person 1"),
                _create_parsed_request("Person 2"),
                _create_parsed_request("Person 3"),
                _create_parsed_request("Person 4"),
            ]
        )
        resolutions = [
            _create_resolution_with_history(person1, 2024, confidence=0.80),
            _create_resolution_with_history(person2, 2024, confidence=0.80),
            _create_resolution_with_history(person3, 2023, confidence=0.80),
            _create_resolution_with_history(person4, 2023, confidence=0.80),
        ]

        input_results = [(parse_result, resolutions)]
        output = await service.verify(input_results)

        _, out_resolutions = output[0]

        # 2024 group should be boosted
        assert out_resolutions[0].confidence == 0.90
        assert out_resolutions[1].confidence == 0.90
        assert out_resolutions[0].metadata is not None
        assert out_resolutions[0].metadata.get("historical_group_verified") is True

        # 2023 group should NOT be boosted
        assert out_resolutions[2].confidence == 0.80
        assert out_resolutions[3].confidence == 0.80
        assert out_resolutions[2].metadata is not None
        assert out_resolutions[2].metadata.get("historical_group_verified") is False

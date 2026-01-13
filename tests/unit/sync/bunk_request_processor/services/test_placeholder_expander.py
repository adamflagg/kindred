"""Tests for PlaceholderExpander service

Tests cover:
1. Initialization with required repositories
2. Pass-through of non-placeholder results
3. LAST_YEAR_BUNKMATES placeholder expansion
4. Handling when no prior year data exists
5. Handling when requester wasn't at camp last year
6. Handling when no bunkmates returned this year
7. Creation of individual bunk_with requests for each bunkmate
8. Metadata preservation from original request
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
from bunking.sync.bunk_request_processor.services.placeholder_expander import (
    PlaceholderExpander,
)
from bunking.sync.bunk_request_processor.shared.constants import (
    LAST_YEAR_BUNKMATES_PLACEHOLDER,
    SIBLING_PLACEHOLDER,
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
        request_text="keep with last year's bunk",
        field_name="share_bunk_with",
        requester_name="Test Requester",
        requester_cm_id=requester_cm_id,
        requester_grade="5",
        session_cm_id=session_cm_id,
        session_name="Session 2",
        year=year,
        row_data={"share_bunk_with": "keep with last year's bunk"},
    )


def _create_parsed_request(
    target_name: str = LAST_YEAR_BUNKMATES_PLACEHOLDER,
    request_type: RequestType = RequestType.BUNK_WITH,
) -> ParsedRequest:
    """Helper to create ParsedRequest objects"""
    return ParsedRequest(
        raw_text="keep with last year's bunk",
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


def _create_placeholder_resolution() -> ResolutionResult:
    """Helper to create a placeholder resolution result"""
    return ResolutionResult(
        person=None,
        confidence=0.0,
        method="placeholder",
        metadata={"placeholder": LAST_YEAR_BUNKMATES_PLACEHOLDER},
    )


def _create_resolved_result(person: Person) -> ResolutionResult:
    """Helper to create a resolved result"""
    return ResolutionResult(
        person=person,
        confidence=0.9,
        method="exact_match",
        metadata={},
    )


@pytest.fixture
def mock_attendee_repo() -> Mock:
    """Create a mock attendee repository"""
    repo = Mock()
    repo.find_prior_year_bunkmates = Mock(return_value=None)
    return repo


@pytest.fixture
def mock_person_repo() -> Mock:
    """Create a mock person repository"""
    repo = Mock()
    repo.find_by_cm_id = Mock(return_value=None)
    return repo


@pytest.fixture
def expander(mock_attendee_repo: Mock, mock_person_repo: Mock) -> PlaceholderExpander:
    """Create a PlaceholderExpander with mock dependencies"""
    return PlaceholderExpander(
        attendee_repo=mock_attendee_repo,
        person_repo=mock_person_repo,
        year=2025,
    )


# ============================================================================
# Test: Initialization
# ============================================================================


class TestPlaceholderExpanderInit:
    """Tests for PlaceholderExpander initialization"""

    def test_init_with_required_dependencies(self, mock_attendee_repo: Mock, mock_person_repo: Mock) -> None:
        """Should initialize with attendee and person repositories"""
        expander = PlaceholderExpander(
            attendee_repo=mock_attendee_repo,
            person_repo=mock_person_repo,
            year=2025,
        )
        assert expander is not None
        assert expander.year == 2025

    def test_init_validates_year(self, mock_attendee_repo: Mock, mock_person_repo: Mock) -> None:
        """Should raise ValueError for invalid year"""
        with pytest.raises(ValueError, match="year must be positive"):
            PlaceholderExpander(
                attendee_repo=mock_attendee_repo,
                person_repo=mock_person_repo,
                year=0,
            )


# ============================================================================
# Test: Pass-through behavior
# ============================================================================


class TestPassThrough:
    """Tests for non-placeholder results passing through unchanged"""

    @pytest.mark.asyncio
    async def test_non_placeholder_results_pass_through(self, expander: PlaceholderExpander) -> None:
        """Results without placeholders should pass through unchanged"""
        person = _create_person()
        parse_result = _create_parse_result(parsed_requests=[_create_parsed_request(target_name="Sarah Smith")])
        resolution = _create_resolved_result(person)

        input_results = [(parse_result, [resolution])]
        output = await expander.expand(input_results)

        assert len(output) == 1
        assert output[0] == (parse_result, [resolution])

    @pytest.mark.asyncio
    async def test_invalid_parse_results_pass_through(self, expander: PlaceholderExpander) -> None:
        """Invalid parse results should pass through unchanged"""
        parse_result = _create_parse_result(is_valid=False)
        resolution = ResolutionResult(confidence=0.0, method="none")

        input_results = [(parse_result, [resolution])]
        output = await expander.expand(input_results)

        assert len(output) == 1
        assert output[0] == (parse_result, [resolution])

    @pytest.mark.asyncio
    async def test_empty_input_returns_empty(self, expander: PlaceholderExpander) -> None:
        """Empty input should return empty output"""
        output = await expander.expand([])
        assert output == []


# ============================================================================
# Test: Placeholder expansion
# ============================================================================


class TestPlaceholderExpansion:
    """Tests for LAST_YEAR_BUNKMATES placeholder expansion"""

    @pytest.mark.asyncio
    async def test_expands_placeholder_to_individual_requests(
        self, expander: PlaceholderExpander, mock_attendee_repo: Mock, mock_person_repo: Mock
    ) -> None:
        """Should expand placeholder into individual bunk_with requests"""
        # Setup: 2 returning bunkmates
        mock_attendee_repo.find_prior_year_bunkmates.return_value = {
            "cm_ids": [22222, 33333],
            "prior_bunk": "B-3",
            "prior_year": 2024,
        }
        mock_person_repo.find_by_cm_id.side_effect = [
            _create_person(cm_id=22222, first_name="Alex", last_name="Jones"),
            _create_person(cm_id=33333, first_name="Jordan", last_name="Lee"),
        ]

        parse_result = _create_parse_result()
        resolution = _create_placeholder_resolution()

        input_results = [(parse_result, [resolution])]
        output = await expander.expand(input_results)

        # Should have 2 expanded results (one per bunkmate)
        assert len(output) == 2

        # First expanded request
        first_parse, first_resolutions = output[0]
        assert first_parse.is_valid
        assert len(first_parse.parsed_requests) == 1
        assert first_parse.parsed_requests[0].target_name == "Alex Jones"
        assert first_parse.parsed_requests[0].request_type == RequestType.BUNK_WITH
        assert first_resolutions[0].person is not None
        assert first_resolutions[0].person.cm_id == 22222
        assert first_resolutions[0].confidence == 0.90

        # Second expanded request
        second_parse, second_resolutions = output[1]
        assert second_parse.parsed_requests[0].target_name == "Jordan Lee"
        assert second_resolutions[0].person is not None
        assert second_resolutions[0].person.cm_id == 33333

    @pytest.mark.asyncio
    async def test_expansion_preserves_metadata(
        self, expander: PlaceholderExpander, mock_attendee_repo: Mock, mock_person_repo: Mock
    ) -> None:
        """Expanded requests should have proper metadata"""
        mock_attendee_repo.find_prior_year_bunkmates.return_value = {
            "cm_ids": [22222],
            "prior_bunk": "G-5",
            "prior_year": 2024,
        }
        mock_person_repo.find_by_cm_id.return_value = _create_person(cm_id=22222)

        parse_result = _create_parse_result()
        resolution = _create_placeholder_resolution()

        output = await expander.expand([(parse_result, [resolution])])

        assert len(output) == 1
        first_parse, first_resolutions = output[0]

        # Check parsed request metadata
        parsed_req = first_parse.parsed_requests[0]
        assert parsed_req.metadata.get("auto_generated_from_prior_year") is True
        assert parsed_req.metadata.get("prior_year_bunk") == "G-5"
        assert parsed_req.metadata.get("prior_year") == 2024
        assert parsed_req.metadata.get("original_request") == LAST_YEAR_BUNKMATES_PLACEHOLDER

        # Check resolution metadata
        res = first_resolutions[0]
        assert res.metadata is not None
        assert res.metadata.get("auto_generated_from_prior_year") is True
        assert res.method == "prior_year_bunkmate"


# ============================================================================
# Test: Failure cases
# ============================================================================


class TestExpansionFailures:
    """Tests for placeholder expansion failure cases"""

    @pytest.mark.asyncio
    async def test_no_prior_year_data(self, expander: PlaceholderExpander, mock_attendee_repo: Mock) -> None:
        """Should handle when requester has no prior year assignment"""
        mock_attendee_repo.find_prior_year_bunkmates.return_value = None

        parse_result = _create_parse_result()
        resolution = _create_placeholder_resolution()

        output = await expander.expand([(parse_result, [resolution])])

        # Should return one result with failed expansion
        assert len(output) == 1
        _, resolutions = output[0]
        assert resolutions[0].method == "placeholder_expansion_failed"
        assert resolutions[0].metadata is not None
        assert "expansion_failure_reason" in resolutions[0].metadata

    @pytest.mark.asyncio
    async def test_no_returning_bunkmates(self, expander: PlaceholderExpander, mock_attendee_repo: Mock) -> None:
        """Should handle when no bunkmates are returning this year"""
        mock_attendee_repo.find_prior_year_bunkmates.return_value = {
            "cm_ids": [],
            "prior_bunk": "B-3",
            "prior_year": 2024,
        }

        parse_result = _create_parse_result()
        resolution = _create_placeholder_resolution()

        output = await expander.expand([(parse_result, [resolution])])

        assert len(output) == 1
        _, resolutions = output[0]
        assert resolutions[0].method == "placeholder_expansion_failed"

    @pytest.mark.asyncio
    async def test_bunkmate_not_found_in_person_repo(
        self, expander: PlaceholderExpander, mock_attendee_repo: Mock, mock_person_repo: Mock
    ) -> None:
        """Should skip bunkmates that can't be found in person repo"""
        mock_attendee_repo.find_prior_year_bunkmates.return_value = {
            "cm_ids": [22222, 33333],  # Two bunkmates
            "prior_bunk": "B-3",
            "prior_year": 2024,
        }
        # Only first bunkmate found
        mock_person_repo.find_by_cm_id.side_effect = [
            _create_person(cm_id=22222, first_name="Alex", last_name="Jones"),
            None,  # Second bunkmate not found
        ]

        parse_result = _create_parse_result()
        resolution = _create_placeholder_resolution()

        output = await expander.expand([(parse_result, [resolution])])

        # Should only have 1 expanded result (the found bunkmate)
        assert len(output) == 1
        first_parse, _ = output[0]
        assert first_parse.parsed_requests[0].target_name == "Alex Jones"


# ============================================================================
# Test: Multiple placeholders mixed with regular results
# ============================================================================


class TestMixedResults:
    """Tests for handling mixed placeholder and regular results"""

    @pytest.mark.asyncio
    async def test_mixed_placeholder_and_regular_results(
        self, expander: PlaceholderExpander, mock_attendee_repo: Mock, mock_person_repo: Mock
    ) -> None:
        """Should handle mix of placeholder and regular results"""
        # Setup placeholder expansion
        mock_attendee_repo.find_prior_year_bunkmates.return_value = {
            "cm_ids": [22222],
            "prior_bunk": "B-3",
            "prior_year": 2024,
        }
        mock_person_repo.find_by_cm_id.return_value = _create_person(cm_id=22222)

        # Regular result (no placeholder)
        regular_person = _create_person(cm_id=44444, first_name="Sam", last_name="Wilson")
        regular_parse = _create_parse_result(parsed_requests=[_create_parsed_request(target_name="Sam Wilson")])
        regular_resolution = _create_resolved_result(regular_person)

        # Placeholder result
        placeholder_parse = _create_parse_result()
        placeholder_resolution = _create_placeholder_resolution()

        input_results = [
            (regular_parse, [regular_resolution]),
            (placeholder_parse, [placeholder_resolution]),
        ]

        output = await expander.expand(input_results)

        # Should have 2 results: 1 regular pass-through + 1 expanded
        assert len(output) == 2

        # First should be regular (passed through)
        assert output[0] == (regular_parse, [regular_resolution])

        # Second should be expanded
        expanded_parse, expanded_res = output[1]
        assert expanded_parse.parsed_requests[0].target_name == "Sarah Smith"
        assert expanded_res[0].person is not None
        assert expanded_res[0].person.cm_id == 22222


# ============================================================================
# Test: SIBLING Placeholder Expansion
# ============================================================================


def _create_sibling_placeholder_resolution() -> ResolutionResult:
    """Helper to create a SIBLING placeholder resolution result"""
    return ResolutionResult(
        person=None,
        confidence=0.0,
        method="placeholder",
        metadata={"placeholder": SIBLING_PLACEHOLDER},
    )


def _create_sibling_parsed_request(
    target_name: str = SIBLING_PLACEHOLDER,
    request_type: RequestType = RequestType.BUNK_WITH,
) -> ParsedRequest:
    """Helper to create a ParsedRequest with SIBLING placeholder"""
    return ParsedRequest(
        raw_text="bunk with twin",
        request_type=request_type,
        target_name=target_name,
        age_preference=None,
        source_field="bunking_notes",
        source=RequestSource.FAMILY,
        confidence=0.9,
        csv_position=0,
        metadata={},
    )


def _create_sibling_parse_request(
    requester_cm_id: int = 19930614,
    session_cm_id: int = 1000001,
    year: int = 2025,
) -> ParseRequest:
    """Helper to create ParseRequest for sibling test"""
    return ParseRequest(
        request_text="bunk with twin",
        field_name="bunking_notes",
        requester_name="Calla Wright-Thompson",
        requester_cm_id=requester_cm_id,
        requester_grade="4",
        session_cm_id=session_cm_id,
        session_name="Taste of Camp",
        year=year,
        row_data={"bunking_notes": "bunk with twin"},
    )


class TestSiblingPlaceholderExpansion:
    """Tests for SIBLING placeholder expansion via household_id lookup"""

    @pytest.mark.asyncio
    async def test_expands_sibling_placeholder_to_individual_request(
        self, expander: PlaceholderExpander, mock_person_repo: Mock
    ) -> None:
        """Should expand SIBLING placeholder into request for sibling"""
        # Setup: Twin sibling found via household_id
        sibling = _create_person(
            cm_id=19930605,
            first_name="Penelope",
            last_name="Wright-Thompson",
        )
        sibling.household_id = 12345

        mock_person_repo.find_siblings.return_value = [sibling]

        parse_request = _create_sibling_parse_request()
        parsed_request = _create_sibling_parsed_request()
        parse_result = _create_parse_result(
            parsed_requests=[parsed_request],
            parse_request=parse_request,
        )
        resolution = _create_sibling_placeholder_resolution()

        output = await expander.expand([(parse_result, [resolution])])

        # Should have 1 expanded result (the sibling)
        assert len(output) == 1
        expanded_parse, expanded_res = output[0]

        assert expanded_parse.is_valid
        assert len(expanded_parse.parsed_requests) == 1
        assert expanded_parse.parsed_requests[0].target_name == "Penelope Wright-Thompson"
        assert expanded_parse.parsed_requests[0].request_type == RequestType.BUNK_WITH
        assert expanded_res[0].person is not None
        assert expanded_res[0].person.cm_id == 19930605
        assert expanded_res[0].confidence == 0.95  # High confidence for sibling lookup
        assert expanded_res[0].method == "sibling_household_lookup"

    @pytest.mark.asyncio
    async def test_sibling_expansion_preserves_request_type(
        self, expander: PlaceholderExpander, mock_person_repo: Mock
    ) -> None:
        """Should preserve original request_type (bunk_with or not_bunk_with)"""
        sibling = _create_person(cm_id=19930605, first_name="Penelope", last_name="Wright-Thompson")
        mock_person_repo.find_siblings.return_value = [sibling]

        # Create a NOT_BUNK_WITH request (e.g., "don't bunk with sibling")
        parse_request = _create_sibling_parse_request()
        parsed_request = _create_sibling_parsed_request(request_type=RequestType.NOT_BUNK_WITH)
        parse_result = _create_parse_result(
            parsed_requests=[parsed_request],
            parse_request=parse_request,
        )
        resolution = _create_sibling_placeholder_resolution()

        output = await expander.expand([(parse_result, [resolution])])

        assert len(output) == 1
        expanded_parse, _ = output[0]
        # Should preserve NOT_BUNK_WITH type
        assert expanded_parse.parsed_requests[0].request_type == RequestType.NOT_BUNK_WITH

    @pytest.mark.asyncio
    async def test_sibling_expansion_metadata(self, expander: PlaceholderExpander, mock_person_repo: Mock) -> None:
        """Expanded sibling requests should have proper metadata"""
        sibling = _create_person(cm_id=19930605, first_name="Penelope", last_name="Wright-Thompson")
        mock_person_repo.find_siblings.return_value = [sibling]

        parse_request = _create_sibling_parse_request()
        parsed_request = _create_sibling_parsed_request()
        parse_result = _create_parse_result(
            parsed_requests=[parsed_request],
            parse_request=parse_request,
        )
        resolution = _create_sibling_placeholder_resolution()

        output = await expander.expand([(parse_result, [resolution])])

        assert len(output) == 1
        expanded_parse, expanded_res = output[0]

        # Check parsed request metadata
        parsed_req = expanded_parse.parsed_requests[0]
        assert parsed_req.metadata.get("auto_generated_from_sibling") is True
        assert parsed_req.metadata.get("sibling_cm_id") == 19930605
        assert parsed_req.metadata.get("original_request") == SIBLING_PLACEHOLDER

        # Check resolution metadata
        res = expanded_res[0]
        assert res.metadata is not None
        assert res.metadata.get("auto_generated_from_sibling") is True
        assert res.method == "sibling_household_lookup"

    @pytest.mark.asyncio
    async def test_no_siblings_found(self, expander: PlaceholderExpander, mock_person_repo: Mock) -> None:
        """Should handle when no siblings are found (no matching household_id)"""
        mock_person_repo.find_siblings.return_value = []  # No siblings

        parse_request = _create_sibling_parse_request()
        parsed_request = _create_sibling_parsed_request()
        parse_result = _create_parse_result(
            parsed_requests=[parsed_request],
            parse_request=parse_request,
        )
        resolution = _create_sibling_placeholder_resolution()

        output = await expander.expand([(parse_result, [resolution])])

        # Should return one result with failed expansion
        assert len(output) == 1
        _, resolutions = output[0]
        assert resolutions[0].method == "placeholder_expansion_failed"
        assert resolutions[0].metadata is not None
        assert "expansion_failure_reason" in resolutions[0].metadata
        assert SIBLING_PLACEHOLDER in str(resolutions[0].metadata.get("original_request"))

    @pytest.mark.asyncio
    async def test_multiple_siblings_expanded(self, expander: PlaceholderExpander, mock_person_repo: Mock) -> None:
        """Should create individual requests for each sibling (e.g., triplets)"""
        # Setup: Multiple siblings (triplets)
        sibling1 = _create_person(cm_id=111, first_name="Alice", last_name="Smith")
        sibling2 = _create_person(cm_id=222, first_name="Bob", last_name="Smith")
        mock_person_repo.find_siblings.return_value = [sibling1, sibling2]

        parse_request = _create_sibling_parse_request()
        parsed_request = _create_sibling_parsed_request()
        parse_result = _create_parse_result(
            parsed_requests=[parsed_request],
            parse_request=parse_request,
        )
        resolution = _create_sibling_placeholder_resolution()

        output = await expander.expand([(parse_result, [resolution])])

        # Should have 2 expanded results (one per sibling)
        assert len(output) == 2

        # First sibling
        first_parse, first_res = output[0]
        assert first_parse.parsed_requests[0].target_name == "Alice Smith"
        assert first_res[0].person is not None
        assert first_res[0].person.cm_id == 111

        # Second sibling
        second_parse, second_res = output[1]
        assert second_parse.parsed_requests[0].target_name == "Bob Smith"
        assert second_res[0].person is not None
        assert second_res[0].person.cm_id == 222

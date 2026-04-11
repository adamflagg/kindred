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
    GroupKind,
    ParsedRequest,
    ParseRequest,
    ParseResult,
    Person,
    RequestSource,
    RequestType,
)
from bunking.sync.bunk_request_processor.resolution.interfaces import ResolutionResult
from bunking.sync.bunk_request_processor.services.group_resolvers import (
    GroupResolver,
    build_resolver_registry,
)
from bunking.sync.bunk_request_processor.services.placeholder_expander import (
    PlaceholderExpander,
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
    target_name: str = "",
    request_type: RequestType = RequestType.BUNK_WITH,
    group_kind: GroupKind | None = GroupKind.LAST_YEAR_BUNKMATES,
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
        group_kind=group_kind,
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
    """Helper to create a group_reference resolution result"""
    return ResolutionResult(
        person=None,
        confidence=1.0,
        method="group_reference",
        metadata={"group_kind": "last_year_bunkmates"},
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
def expander() -> PlaceholderExpander:
    """Create a PlaceholderExpander"""
    return PlaceholderExpander(year=2025)


@pytest.fixture
def resolver_registry(mock_attendee_repo: Mock, mock_person_repo: Mock) -> dict[GroupKind, GroupResolver]:
    """Create a resolver registry using mock dependencies."""
    return build_resolver_registry(
        attendee_repo=mock_attendee_repo,
        person_repo=mock_person_repo,
        year=2025,
    )


# ============================================================================
# Test: Initialization
# ============================================================================


class TestPlaceholderExpanderInit:
    """Tests for PlaceholderExpander initialization"""

    def test_init_with_year(self) -> None:
        """Should initialize with year"""
        expander = PlaceholderExpander(year=2025)
        assert expander is not None
        assert expander.year == 2025

    def test_init_validates_year(self) -> None:
        """Should raise ValueError for invalid year"""
        with pytest.raises(ValueError, match="year must be positive"):
            PlaceholderExpander(year=0)


# ============================================================================
# Test: Pass-through behavior
# ============================================================================


class TestPassThrough:
    """Tests for non-placeholder results passing through unchanged"""

    @pytest.mark.asyncio
    async def test_non_placeholder_results_pass_through(
        self, expander: PlaceholderExpander, resolver_registry: dict[GroupKind, GroupResolver]
    ) -> None:
        """Results without placeholders should pass through unchanged"""
        person = _create_person()
        parse_result = _create_parse_result(
            parsed_requests=[_create_parsed_request(target_name="Sarah Smith", group_kind=None)]
        )
        resolution = _create_resolved_result(person)

        input_results = [(parse_result, [resolution])]
        output = await expander.expand(input_results, resolver_registry)

        assert len(output) == 1
        assert output[0] == (parse_result, [resolution])

    @pytest.mark.asyncio
    async def test_invalid_parse_results_pass_through(
        self, expander: PlaceholderExpander, resolver_registry: dict[GroupKind, GroupResolver]
    ) -> None:
        """Invalid parse results should pass through unchanged"""
        parse_result = _create_parse_result(is_valid=False)
        resolution = ResolutionResult(confidence=0.0, method="none")

        input_results = [(parse_result, [resolution])]
        output = await expander.expand(input_results, resolver_registry)

        assert len(output) == 1
        assert output[0] == (parse_result, [resolution])

    @pytest.mark.asyncio
    async def test_empty_input_returns_empty(
        self, expander: PlaceholderExpander, resolver_registry: dict[GroupKind, GroupResolver]
    ) -> None:
        """Empty input should return empty output"""
        output = await expander.expand([], resolver_registry)
        assert output == []


# ============================================================================
# Test: Placeholder expansion
# ============================================================================


class TestPlaceholderExpansion:
    """Tests for LAST_YEAR_BUNKMATES placeholder handling (auto-expand disabled)"""

    @pytest.mark.asyncio
    async def test_bunkmates_creates_single_staff_review_request(
        self,
        expander: PlaceholderExpander,
        mock_attendee_repo: Mock,
        mock_person_repo: Mock,
        resolver_registry: dict[GroupKind, GroupResolver],
    ) -> None:
        """LAST_YEAR_BUNKMATES should create a single PENDING request, not expand to individuals"""
        # Setup: 2 returning bunkmates (should NOT be expanded)
        mock_attendee_repo.find_prior_year_bunkmates.return_value = {
            "cm_ids": [22222, 33333],
            "prior_bunk": "B-3",
            "prior_year": 2024,
        }
        alex = _create_person(cm_id=22222, first_name="Alex", last_name="Jones")
        jordan = _create_person(cm_id=33333, first_name="Jordan", last_name="Lee")
        mock_person_repo.bulk_find_by_cm_ids.return_value = {22222: alex, 33333: jordan}

        parse_result = _create_parse_result()
        resolution = _create_placeholder_resolution()

        input_results = [(parse_result, [resolution])]
        output = await expander.expand(input_results, resolver_registry)

        # Should have 1 result (single PENDING for staff review), not 2 individual expanded ones
        assert len(output) == 1

        result_parse, result_resolutions = output[0]
        assert result_parse.is_valid
        assert len(result_parse.parsed_requests) == 1
        # Original request preserved (not expanded to individual names)
        assert result_parse.parsed_requests[0].raw_text == "keep with last year's bunk"
        # Resolution is unresolved, flagged for staff review
        assert result_resolutions[0].person is None
        assert result_resolutions[0].method == "auto_expand_disabled"
        assert result_resolutions[0].metadata is not None
        assert result_resolutions[0].metadata.get("needs_staff_review") is True

    @pytest.mark.asyncio
    async def test_bunkmates_staff_review_has_group_kind_metadata(
        self,
        expander: PlaceholderExpander,
        mock_attendee_repo: Mock,
        mock_person_repo: Mock,
        resolver_registry: dict[GroupKind, GroupResolver],
    ) -> None:
        """Staff review request should include group_kind metadata for context"""
        mock_attendee_repo.find_prior_year_bunkmates.return_value = {
            "cm_ids": [22222],
            "prior_bunk": "G-5",
            "prior_year": 2024,
        }
        person = _create_person(cm_id=22222)
        mock_person_repo.bulk_find_by_cm_ids.return_value = {22222: person}

        parse_result = _create_parse_result()
        resolution = _create_placeholder_resolution()

        output = await expander.expand([(parse_result, [resolution])], resolver_registry)

        assert len(output) == 1
        first_parse, first_resolutions = output[0]

        # Check parse result metadata indicates auto-expand was disabled
        assert first_parse.metadata.get("auto_expand_disabled") is True
        assert first_parse.metadata.get("group_kind") == "last_year_bunkmates"

        # Check resolution metadata
        res = first_resolutions[0]
        assert res.metadata is not None
        assert res.metadata.get("group_kind") == "last_year_bunkmates"
        assert res.metadata.get("needs_staff_review") is True
        assert res.method == "auto_expand_disabled"


# ============================================================================
# Test: Failure cases
# ============================================================================


class TestExpansionFailures:
    """Tests for LAST_YEAR_BUNKMATES handling with auto-expand disabled.

    Since auto-expand is disabled, the BunkmateResolver is never called.
    All LAST_YEAR_BUNKMATES references produce a single staff review request.
    """

    @pytest.mark.asyncio
    async def test_no_prior_year_data_creates_staff_review(
        self, expander: PlaceholderExpander, mock_attendee_repo: Mock, resolver_registry: dict[GroupKind, GroupResolver]
    ) -> None:
        """Should create staff review regardless of prior year data availability"""
        mock_attendee_repo.find_prior_year_bunkmates.return_value = None

        parse_result = _create_parse_result()
        resolution = _create_placeholder_resolution()

        output = await expander.expand([(parse_result, [resolution])], resolver_registry)

        # Should return one result flagged for staff review
        assert len(output) == 1
        _, resolutions = output[0]
        assert resolutions[0].method == "auto_expand_disabled"
        assert resolutions[0].metadata is not None
        assert resolutions[0].metadata.get("needs_staff_review") is True

    @pytest.mark.asyncio
    async def test_no_returning_bunkmates_creates_staff_review(
        self, expander: PlaceholderExpander, mock_attendee_repo: Mock, resolver_registry: dict[GroupKind, GroupResolver]
    ) -> None:
        """Even with empty bunkmate data, should create staff review (resolver not called)"""
        mock_attendee_repo.find_prior_year_bunkmates.return_value = {
            "cm_ids": [],
            "prior_bunk": "B-3",
            "prior_year": 2024,
        }

        parse_result = _create_parse_result()
        resolution = _create_placeholder_resolution()

        output = await expander.expand([(parse_result, [resolution])], resolver_registry)

        assert len(output) == 1
        _, resolutions = output[0]
        assert resolutions[0].method == "auto_expand_disabled"

    @pytest.mark.asyncio
    async def test_resolver_never_called_when_disabled(
        self,
        expander: PlaceholderExpander,
        mock_attendee_repo: Mock,
        mock_person_repo: Mock,
        resolver_registry: dict[GroupKind, GroupResolver],
    ) -> None:
        """BunkmateResolver should never be invoked when auto-expand is disabled"""
        mock_attendee_repo.find_prior_year_bunkmates.return_value = {
            "cm_ids": [22222, 33333],
            "prior_bunk": "B-3",
            "prior_year": 2024,
        }
        alex = _create_person(cm_id=22222, first_name="Alex", last_name="Jones")
        mock_person_repo.bulk_find_by_cm_ids.return_value = {22222: alex}

        parse_result = _create_parse_result()
        resolution = _create_placeholder_resolution()

        output = await expander.expand([(parse_result, [resolution])], resolver_registry)

        # Single staff review result
        assert len(output) == 1
        _, resolutions = output[0]
        assert resolutions[0].method == "auto_expand_disabled"
        # Resolver should not have been called
        mock_attendee_repo.find_prior_year_bunkmates.assert_not_called()


# ============================================================================
# Test: Multiple placeholders mixed with regular results
# ============================================================================


class TestMixedResults:
    """Tests for handling mixed placeholder and regular results"""

    @pytest.mark.asyncio
    async def test_mixed_placeholder_and_regular_results(
        self,
        expander: PlaceholderExpander,
        mock_attendee_repo: Mock,
        mock_person_repo: Mock,
        resolver_registry: dict[GroupKind, GroupResolver],
    ) -> None:
        """Should handle mix of placeholder and regular results"""
        # Setup placeholder expansion
        mock_attendee_repo.find_prior_year_bunkmates.return_value = {
            "cm_ids": [22222],
            "prior_bunk": "B-3",
            "prior_year": 2024,
        }
        person = _create_person(cm_id=22222)
        mock_person_repo.bulk_find_by_cm_ids.return_value = {22222: person}

        # Regular result (no placeholder)
        regular_person = _create_person(cm_id=44444, first_name="Sam", last_name="Wilson")
        regular_parse = _create_parse_result(
            parsed_requests=[_create_parsed_request(target_name="Sam Wilson", group_kind=None)]
        )
        regular_resolution = _create_resolved_result(regular_person)

        # Placeholder result
        placeholder_parse = _create_parse_result()
        placeholder_resolution = _create_placeholder_resolution()

        input_results = [
            (regular_parse, [regular_resolution]),
            (placeholder_parse, [placeholder_resolution]),
        ]

        output = await expander.expand(input_results, resolver_registry)

        # Should have 2 results: 1 regular pass-through + 1 staff review (not expanded)
        assert len(output) == 2

        # First should be regular (passed through)
        assert output[0] == (regular_parse, [regular_resolution])

        # Second should be a staff review request (auto-expand disabled)
        review_parse, review_res = output[1]
        assert review_res[0].method == "auto_expand_disabled"
        assert review_res[0].person is None
        assert review_res[0].metadata is not None
        assert review_res[0].metadata.get("needs_staff_review") is True


# ============================================================================
# Test: SIBLING Placeholder Expansion
# ============================================================================


def _create_sibling_placeholder_resolution() -> ResolutionResult:
    """Helper to create a SIBLING group_reference resolution result"""
    return ResolutionResult(
        person=None,
        confidence=1.0,
        method="group_reference",
        metadata={"group_kind": "sibling"},
    )


def _create_sibling_parsed_request(
    target_name: str = "",
    request_type: RequestType = RequestType.BUNK_WITH,
) -> ParsedRequest:
    """Helper to create a ParsedRequest with SIBLING group_kind"""
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
        group_kind=GroupKind.SIBLING,
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
        self, expander: PlaceholderExpander, mock_person_repo: Mock, resolver_registry: dict[GroupKind, GroupResolver]
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

        output = await expander.expand([(parse_result, [resolution])], resolver_registry)

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
        assert expanded_res[0].method == "sibling_expansion"

    @pytest.mark.asyncio
    async def test_sibling_expansion_preserves_request_type(
        self, expander: PlaceholderExpander, mock_person_repo: Mock, resolver_registry: dict[GroupKind, GroupResolver]
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

        output = await expander.expand([(parse_result, [resolution])], resolver_registry)

        assert len(output) == 1
        expanded_parse, _ = output[0]
        # Should preserve NOT_BUNK_WITH type
        assert expanded_parse.parsed_requests[0].request_type == RequestType.NOT_BUNK_WITH

    @pytest.mark.asyncio
    async def test_sibling_expansion_metadata(
        self, expander: PlaceholderExpander, mock_person_repo: Mock, resolver_registry: dict[GroupKind, GroupResolver]
    ) -> None:
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

        output = await expander.expand([(parse_result, [resolution])], resolver_registry)

        assert len(output) == 1
        expanded_parse, expanded_res = output[0]

        # Check parsed request metadata
        parsed_req = expanded_parse.parsed_requests[0]
        assert parsed_req.metadata.get("expanded_from") == "sibling"

        # Check resolution metadata
        res = expanded_res[0]
        assert res.metadata is not None
        assert res.metadata.get("expanded_from") == "sibling"
        assert res.method == "sibling_expansion"

    @pytest.mark.asyncio
    async def test_no_siblings_found(
        self, expander: PlaceholderExpander, mock_person_repo: Mock, resolver_registry: dict[GroupKind, GroupResolver]
    ) -> None:
        """Should handle when no siblings are found (no matching household_id)"""
        mock_person_repo.find_siblings.return_value = []  # No siblings

        parse_request = _create_sibling_parse_request()
        parsed_request = _create_sibling_parsed_request()
        parse_result = _create_parse_result(
            parsed_requests=[parsed_request],
            parse_request=parse_request,
        )
        resolution = _create_sibling_placeholder_resolution()

        output = await expander.expand([(parse_result, [resolution])], resolver_registry)

        # Should return one result with failed expansion
        assert len(output) == 1
        _, resolutions = output[0]
        assert resolutions[0].method == "placeholder_expansion_failed"
        assert resolutions[0].metadata is not None
        assert "expansion_failure_reason" in resolutions[0].metadata
        assert resolutions[0].metadata.get("group_kind") == "sibling"

    @pytest.mark.asyncio
    async def test_multiple_siblings_expanded(
        self, expander: PlaceholderExpander, mock_person_repo: Mock, resolver_registry: dict[GroupKind, GroupResolver]
    ) -> None:
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

        output = await expander.expand([(parse_result, [resolution])], resolver_registry)

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


class TestHistoricalAutoExpandDisabled:
    """Tests that vague historical references (last_year_bunkmates) do NOT expand
    into individual requests. Instead, a single PENDING request is created for staff review.
    Named references like 'Mike from last year' should still resolve through resolution strategies."""

    @pytest.mark.asyncio
    async def test_last_year_bunkmates_does_not_expand_to_individual_requests(
        self,
        expander: PlaceholderExpander,
        mock_attendee_repo: Mock,
        mock_person_repo: Mock,
        resolver_registry: dict[GroupKind, GroupResolver],
    ) -> None:
        """LAST_YEAR_BUNKMATES group reference should NOT expand into individual requests."""
        # Even though bunkmates exist in the database, the expander should NOT expand them
        mock_attendee_repo.find_prior_year_bunkmates.return_value = {
            "cm_ids": [22222, 33333, 44444],
            "prior_bunk": "B-3",
            "prior_year": 2024,
        }
        alex = _create_person(cm_id=22222, first_name="Alex", last_name="Jones")
        jordan = _create_person(cm_id=33333, first_name="Jordan", last_name="Lee")
        taylor = _create_person(cm_id=44444, first_name="Taylor", last_name="Davis")
        mock_person_repo.bulk_find_by_cm_ids.return_value = {22222: alex, 33333: jordan, 44444: taylor}

        parse_result = _create_parse_result()
        resolution = _create_placeholder_resolution()

        output = await expander.expand([(parse_result, [resolution])], resolver_registry)

        # Should produce exactly 1 result, NOT 3 individual expanded results
        assert len(output) == 1, (
            f"Expected 1 result (single PENDING request for staff review), got {len(output)} "
            "(historical auto-expand should be disabled)"
        )

        # The single result should be marked for staff review
        result_parse, result_resolutions = output[0]
        assert len(result_resolutions) == 1

        result_resolution = result_resolutions[0]
        # Should NOT be resolved to a specific person
        assert result_resolution.person is None, "Vague historical reference should not resolve to a specific person"
        # Should have metadata indicating staff review needed
        assert result_resolution.metadata is not None
        assert result_resolution.metadata.get("needs_staff_review") is True
        assert result_resolution.metadata.get("group_kind") == "last_year_bunkmates"

    @pytest.mark.asyncio
    async def test_sibling_expansion_still_works(
        self,
        expander: PlaceholderExpander,
        mock_person_repo: Mock,
        resolver_registry: dict[GroupKind, GroupResolver],
    ) -> None:
        """Sibling expansion should still work normally (not affected by historical disable)."""
        sibling = _create_person(cm_id=19930605, first_name="Penelope", last_name="Wright-Thompson")
        mock_person_repo.find_siblings.return_value = [sibling]

        parse_request = _create_sibling_parse_request()
        parsed_request = _create_sibling_parsed_request()
        parse_result = _create_parse_result(
            parsed_requests=[parsed_request],
            parse_request=parse_request,
        )
        resolution = _create_sibling_placeholder_resolution()

        output = await expander.expand([(parse_result, [resolution])], resolver_registry)

        # Sibling expansion should still produce individual requests
        assert len(output) == 1
        expanded_parse, expanded_res = output[0]
        assert expanded_parse.parsed_requests[0].target_name == "Penelope Wright-Thompson"
        assert expanded_res[0].person is not None
        assert expanded_res[0].person.cm_id == 19930605

    @pytest.mark.asyncio
    async def test_vague_historical_creates_pending_with_original_text(
        self,
        expander: PlaceholderExpander,
        mock_attendee_repo: Mock,
        mock_person_repo: Mock,
        resolver_registry: dict[GroupKind, GroupResolver],
    ) -> None:
        """Vague historical reference should preserve original request text for staff context."""
        mock_attendee_repo.find_prior_year_bunkmates.return_value = {
            "cm_ids": [22222],
            "prior_bunk": "B-3",
            "prior_year": 2024,
        }
        person = _create_person(cm_id=22222)
        mock_person_repo.bulk_find_by_cm_ids.return_value = {22222: person}

        parse_result = _create_parse_result()
        resolution = _create_placeholder_resolution()

        output = await expander.expand([(parse_result, [resolution])], resolver_registry)

        assert len(output) == 1
        result_parse, _ = output[0]
        # Original request text should be preserved
        assert result_parse.parsed_requests[0].raw_text == "keep with last year's bunk"

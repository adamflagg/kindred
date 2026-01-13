"""Tests for temporal conflict detection and filtering.

Tests the system's ability to handle temporal conflicts in bunk requests,
such as "6/4 wants separate bunks | 6/5 changed minds, want together".

This test file follows TDD - written before implementation.
"""

from __future__ import annotations

from datetime import datetime
from unittest.mock import Mock

from bunking.sync.bunk_request_processor.core.models import (
    ParsedRequest,
    ParseResult,
    RequestSource,
    RequestType,
)


class TestDateParser:
    """Tests for the date parsing utility."""

    def test_parse_slash_format_single_digit(self):
        """Parse dates like '6/4' (month/day)."""
        from bunking.sync.bunk_request_processor.utils.date_parser import parse_temporal_date

        result = parse_temporal_date("6/4", 2025)
        assert result == datetime(2025, 6, 4)

    def test_parse_slash_format_double_digit_day(self):
        """Parse dates like '6/10' (month/day with double-digit day)."""
        from bunking.sync.bunk_request_processor.utils.date_parser import parse_temporal_date

        result = parse_temporal_date("6/10", 2025)
        assert result == datetime(2025, 6, 10)

    def test_parse_slash_format_double_digit_both(self):
        """Parse dates like '12/25' (double-digit month and day)."""
        from bunking.sync.bunk_request_processor.utils.date_parser import parse_temporal_date

        result = parse_temporal_date("12/25", 2025)
        assert result == datetime(2025, 12, 25)

    def test_parse_month_name_full(self):
        """Parse dates like 'June 4' (full month name)."""
        from bunking.sync.bunk_request_processor.utils.date_parser import parse_temporal_date

        result = parse_temporal_date("June 4", 2025)
        assert result == datetime(2025, 6, 4)

    def test_parse_month_name_lowercase(self):
        """Parse dates like 'june 10' (lowercase month name)."""
        from bunking.sync.bunk_request_processor.utils.date_parser import parse_temporal_date

        result = parse_temporal_date("june 10", 2025)
        assert result == datetime(2025, 6, 10)

    def test_parse_month_name_abbreviated(self):
        """Parse dates like 'Jun 5' (abbreviated month name)."""
        from bunking.sync.bunk_request_processor.utils.date_parser import parse_temporal_date

        result = parse_temporal_date("Jun 5", 2025)
        assert result == datetime(2025, 6, 5)

    def test_none_input_returns_none(self):
        """None input returns None."""
        from bunking.sync.bunk_request_processor.utils.date_parser import parse_temporal_date

        assert parse_temporal_date(None) is None

    def test_empty_string_returns_none(self):
        """Empty string returns None."""
        from bunking.sync.bunk_request_processor.utils.date_parser import parse_temporal_date

        assert parse_temporal_date("") is None

    def test_invalid_format_returns_none(self):
        """Invalid format returns None."""
        from bunking.sync.bunk_request_processor.utils.date_parser import parse_temporal_date

        assert parse_temporal_date("invalid") is None
        assert parse_temporal_date("yesterday") is None
        assert parse_temporal_date("2025-06-04") is None  # ISO format not supported

    def test_whitespace_stripped(self):
        """Whitespace is stripped from input."""
        from bunking.sync.bunk_request_processor.utils.date_parser import parse_temporal_date

        result = parse_temporal_date("  6/4  ", 2025)
        assert result == datetime(2025, 6, 4)

    def test_default_year(self):
        """Uses default year 2025 when not specified."""
        from bunking.sync.bunk_request_processor.utils.date_parser import parse_temporal_date

        result = parse_temporal_date("6/4")
        assert result is not None
        assert result.year == 2025


class TestTemporalConflictFiltering:
    """Tests for the temporal conflict filtering in orchestrator."""

    def _create_parsed_request(
        self,
        request_type: RequestType,
        target_name: str,
        csv_position: int = 1,
        is_superseded: bool = False,
        temporal_date: datetime | None = None,
        supersedes_reason: str | None = None,
    ) -> ParsedRequest:
        """Helper to create a ParsedRequest with temporal fields."""
        req = ParsedRequest(
            raw_text="test",
            request_type=request_type,
            target_name=target_name,
            age_preference=None,
            source_field="bunk_with",
            source=RequestSource.FAMILY,
            confidence=0.9,
            csv_position=csv_position,
            metadata={},
            notes=None,
        )
        # Add temporal fields (these will be added to the model)
        req.is_superseded = is_superseded
        req.temporal_date = temporal_date
        req.supersedes_reason = supersedes_reason
        return req

    def _create_parse_result(self, requests: list[ParsedRequest]) -> ParseResult:
        """Helper to create a ParseResult."""
        return ParseResult(
            parsed_requests=requests,
            is_valid=True,
        )

    def test_superseded_flag_filters_request(self):
        """Requests marked is_superseded=True should be filtered out."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import RequestOrchestrator

        # Create orchestrator with minimal mocks
        orchestrator = RequestOrchestrator.__new__(RequestOrchestrator)

        # Create requests: one superseded, one not
        superseded_req = self._create_parsed_request(
            RequestType.NOT_BUNK_WITH,
            "SIBLING",
            csv_position=1,
            is_superseded=True,
            temporal_date=datetime(2025, 6, 4),
            supersedes_reason="changed minds on 6/5",
        )
        current_req = self._create_parsed_request(
            RequestType.BUNK_WITH,
            "SIBLING",
            csv_position=2,
            is_superseded=False,
            temporal_date=datetime(2025, 6, 5),
        )

        parse_results = [self._create_parse_result([superseded_req, current_req])]

        # Run filter
        kept, filtered = orchestrator._filter_temporal_conflicts(parse_results)

        # Should keep 1, filter 1
        assert filtered == 1
        assert kept == 1
        assert len(parse_results[0].parsed_requests) == 1
        assert parse_results[0].parsed_requests[0].request_type == RequestType.BUNK_WITH

    def test_date_comparison_resolves_conflict_when_no_superseded_flag(self):
        """When same target has bunk_with and not_bunk_with, use dates to resolve."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import RequestOrchestrator

        orchestrator = RequestOrchestrator.__new__(RequestOrchestrator)
        orchestrator._logger = Mock()  # type: ignore[attr-defined]

        # Both requests for same target, neither marked superseded
        # But they conflict (bunk_with vs not_bunk_with)
        older_req = self._create_parsed_request(
            RequestType.NOT_BUNK_WITH,
            "SIBLING",
            csv_position=1,
            is_superseded=False,  # AI didn't mark it
            temporal_date=datetime(2025, 6, 4),
        )
        newer_req = self._create_parsed_request(
            RequestType.BUNK_WITH,
            "SIBLING",
            csv_position=2,
            is_superseded=False,
            temporal_date=datetime(2025, 6, 5),
        )

        parse_results = [self._create_parse_result([older_req, newer_req])]

        kept, filtered = orchestrator._filter_temporal_conflicts(parse_results)

        # Should keep the newer one (6/5)
        assert filtered == 1
        assert kept == 1
        assert parse_results[0].parsed_requests[0].request_type == RequestType.BUNK_WITH

    def test_position_fallback_when_no_dates(self):
        """Without dates, use csv_position to resolve conflicts."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import RequestOrchestrator

        orchestrator = RequestOrchestrator.__new__(RequestOrchestrator)
        orchestrator._logger = Mock()  # type: ignore[attr-defined]

        # Both requests for same target, neither has dates
        earlier_req = self._create_parsed_request(
            RequestType.NOT_BUNK_WITH,
            "SIBLING",
            csv_position=1,
            is_superseded=False,
            temporal_date=None,  # No date
        )
        later_req = self._create_parsed_request(
            RequestType.BUNK_WITH,
            "SIBLING",
            csv_position=2,
            is_superseded=False,
            temporal_date=None,
        )

        parse_results = [self._create_parse_result([earlier_req, later_req])]

        kept, filtered = orchestrator._filter_temporal_conflicts(parse_results)

        # Should keep the later one (position 2)
        assert filtered == 1
        assert kept == 1
        assert parse_results[0].parsed_requests[0].request_type == RequestType.BUNK_WITH

    def test_no_conflict_passes_through(self):
        """Non-conflicting requests should not be filtered."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import RequestOrchestrator

        orchestrator = RequestOrchestrator.__new__(RequestOrchestrator)
        orchestrator._logger = Mock()  # type: ignore[attr-defined]

        # Two bunk_with requests for DIFFERENT targets
        req1 = self._create_parsed_request(
            RequestType.BUNK_WITH,
            "Emma",
            csv_position=1,
        )
        req2 = self._create_parsed_request(
            RequestType.BUNK_WITH,
            "Sarah",
            csv_position=2,
        )

        parse_results = [self._create_parse_result([req1, req2])]

        kept, filtered = orchestrator._filter_temporal_conflicts(parse_results)

        # Should keep both
        assert filtered == 0
        assert kept == 2
        assert len(parse_results[0].parsed_requests) == 2

    def test_same_type_requests_not_filtered(self):
        """Multiple requests of same type for same target are NOT conflicts."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import RequestOrchestrator

        orchestrator = RequestOrchestrator.__new__(RequestOrchestrator)
        orchestrator._logger = Mock()  # type: ignore[attr-defined]

        # Two bunk_with requests for same target (should both pass)
        req1 = self._create_parsed_request(
            RequestType.BUNK_WITH,
            "Emma",
            csv_position=1,
        )
        req2 = self._create_parsed_request(
            RequestType.BUNK_WITH,
            "Emma",
            csv_position=2,
        )

        parse_results = [self._create_parse_result([req1, req2])]

        kept, filtered = orchestrator._filter_temporal_conflicts(parse_results)

        # Should keep both (not a conflict - they're the same type)
        assert filtered == 0
        assert kept == 2

    def test_age_preference_not_affected(self):
        """Age preference requests should not be filtered as conflicts."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import RequestOrchestrator

        orchestrator = RequestOrchestrator.__new__(RequestOrchestrator)
        orchestrator._logger = Mock()  # type: ignore[attr-defined]

        # bunk_with and age_preference for same field - not a conflict
        bunk_req = self._create_parsed_request(
            RequestType.BUNK_WITH,
            "Emma",
            csv_position=1,
        )
        age_req = self._create_parsed_request(
            RequestType.AGE_PREFERENCE,
            "older",
            csv_position=2,
        )

        parse_results = [self._create_parse_result([bunk_req, age_req])]

        kept, filtered = orchestrator._filter_temporal_conflicts(parse_results)

        # Should keep both
        assert filtered == 0
        assert kept == 2

    def test_invalid_parse_result_skipped(self):
        """Invalid parse results should be skipped."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import RequestOrchestrator

        orchestrator = RequestOrchestrator.__new__(RequestOrchestrator)
        orchestrator._logger = Mock()  # type: ignore[attr-defined]

        invalid_result = ParseResult(
            parsed_requests=[],
            is_valid=False,
        )

        parse_results = [invalid_result]

        kept, filtered = orchestrator._filter_temporal_conflicts(parse_results)

        assert kept == 0
        assert filtered == 0

    def test_empty_requests_skipped(self):
        """ParseResults with no requests should be skipped."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import RequestOrchestrator

        orchestrator = RequestOrchestrator.__new__(RequestOrchestrator)
        orchestrator._logger = Mock()  # type: ignore[attr-defined]

        empty_result = ParseResult(
            parsed_requests=[],
            is_valid=True,
        )

        parse_results = [empty_result]

        kept, filtered = orchestrator._filter_temporal_conflicts(parse_results)

        assert kept == 0
        assert filtered == 0


class TestTemporalInfoSchema:
    """Tests for the TemporalInfo schema in AI responses."""

    def test_temporal_info_model_exists(self):
        """TemporalInfo model should exist in ai_schemas."""
        from bunking.sync.bunk_request_processor.integration.ai_schemas import TemporalInfo

        info = TemporalInfo()
        assert info.date_mentioned is None
        assert info.is_superseded is False
        assert info.supersedes_reason is None

    def test_temporal_info_with_values(self):
        """TemporalInfo should accept values."""
        from bunking.sync.bunk_request_processor.integration.ai_schemas import TemporalInfo

        info = TemporalInfo(
            date_mentioned="6/5",
            is_superseded=True,
            supersedes_reason="changed minds",
        )
        assert info.date_mentioned == "6/5"
        assert info.is_superseded is True
        assert info.supersedes_reason == "changed minds"

    def test_ai_bunk_request_item_has_temporal_info(self):
        """AIBunkRequestItem should have temporal_info field."""
        from bunking.sync.bunk_request_processor.integration.ai_schemas import AIBunkRequestItem

        item = AIBunkRequestItem(
            request_type="bunk_with",
            target_name="Emma",
        )
        assert item.temporal_info is None  # Optional field


class TestParsedRequestTemporalFields:
    """Tests for temporal fields on ParsedRequest model."""

    def test_parsed_request_has_temporal_date(self):
        """ParsedRequest should have temporal_date field."""
        req = ParsedRequest(
            raw_text="test",
            request_type=RequestType.BUNK_WITH,
            target_name="Emma",
            age_preference=None,
            source_field="bunk_with",
            source=RequestSource.FAMILY,
            confidence=0.9,
            csv_position=1,
            metadata={},
        )
        # These fields should exist after model update
        assert hasattr(req, "temporal_date") or "temporal_date" in req.__dict__

    def test_parsed_request_has_is_superseded(self):
        """ParsedRequest should have is_superseded field."""
        req = ParsedRequest(
            raw_text="test",
            request_type=RequestType.BUNK_WITH,
            target_name="Emma",
            age_preference=None,
            source_field="bunk_with",
            source=RequestSource.FAMILY,
            confidence=0.9,
            csv_position=1,
            metadata={},
        )
        assert hasattr(req, "is_superseded") or "is_superseded" in req.__dict__

    def test_parsed_request_has_supersedes_reason(self):
        """ParsedRequest should have supersedes_reason field."""
        req = ParsedRequest(
            raw_text="test",
            request_type=RequestType.BUNK_WITH,
            target_name="Emma",
            age_preference=None,
            source_field="bunk_with",
            source=RequestSource.FAMILY,
            confidence=0.9,
            csv_position=1,
            metadata={},
        )
        assert hasattr(req, "supersedes_reason") or "supersedes_reason" in req.__dict__


class TestResolveByDateOrPosition:
    """Tests for the _resolve_by_date_or_position helper method."""

    def _create_request(
        self,
        request_type: RequestType,
        csv_position: int,
        temporal_date: datetime | None = None,
    ) -> ParsedRequest:
        """Helper to create a minimal ParsedRequest."""
        req = ParsedRequest(
            raw_text="test",
            request_type=request_type,
            target_name="SIBLING",
            age_preference=None,
            source_field="bunk_with",
            source=RequestSource.FAMILY,
            confidence=0.9,
            csv_position=csv_position,
            metadata={},
        )
        req.temporal_date = temporal_date
        req.is_superseded = False
        req.supersedes_reason = None
        return req

    def test_prefers_date_over_position(self):
        """When both have dates, use date comparison even if positions disagree."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import RequestOrchestrator

        orchestrator = RequestOrchestrator.__new__(RequestOrchestrator)

        # Position says req1 is newer, but date says req2 is newer
        req1 = self._create_request(
            RequestType.NOT_BUNK_WITH,
            csv_position=2,  # Higher position
            temporal_date=datetime(2025, 6, 4),  # But older date
        )
        req2 = self._create_request(
            RequestType.BUNK_WITH,
            csv_position=1,  # Lower position
            temporal_date=datetime(2025, 6, 5),  # But newer date
        )

        result = orchestrator._resolve_by_date_or_position([req1, req2])

        # Should use date - req2 wins
        assert result.request_type == RequestType.BUNK_WITH

    def test_falls_back_to_position_with_one_date(self):
        """When only one has a date, fall back to position."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import RequestOrchestrator

        orchestrator = RequestOrchestrator.__new__(RequestOrchestrator)

        req1 = self._create_request(
            RequestType.NOT_BUNK_WITH,
            csv_position=1,
            temporal_date=datetime(2025, 6, 4),  # Has date
        )
        req2 = self._create_request(
            RequestType.BUNK_WITH,
            csv_position=2,
            temporal_date=None,  # No date
        )

        result = orchestrator._resolve_by_date_or_position([req1, req2])

        # Should fall back to position - req2 wins
        assert result.request_type == RequestType.BUNK_WITH

    def test_falls_back_to_position_with_no_dates(self):
        """When neither has a date, use position."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import RequestOrchestrator

        orchestrator = RequestOrchestrator.__new__(RequestOrchestrator)

        req1 = self._create_request(
            RequestType.NOT_BUNK_WITH,
            csv_position=1,
            temporal_date=None,
        )
        req2 = self._create_request(
            RequestType.BUNK_WITH,
            csv_position=2,
            temporal_date=None,
        )

        result = orchestrator._resolve_by_date_or_position([req1, req2])

        # Position wins - req2
        assert result.request_type == RequestType.BUNK_WITH

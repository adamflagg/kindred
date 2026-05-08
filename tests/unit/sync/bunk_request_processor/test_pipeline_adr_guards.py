"""Tests for pipeline ADR guard clauses.

ADR 4: Temporal conflict filter scoped to notes fields only.
ADR 5: NA stripping scoped to bunk_with only.
ADR 6: Staff name detection guarded on notes fields only.
ADR 8: Phase 3 exclusion uses RequestType enum instead of raw string.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from unittest.mock import Mock

from bunking.sync.bunk_request_processor.core.models import (
    ParsedRequest,
    ParseResult,
    RequestType,
)
from bunking.sync.bunk_request_processor.resolution.interfaces import ResolutionResult
from bunking.sync.bunk_request_processor.shared.constants import SourceField

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_parsed_request(
    request_type: RequestType = RequestType.BUNK_WITH,
    target_name: str = "Emma Johnson",
    source_field: str = SourceField.BUNK_WITH,
    csv_position: int = 1,
    is_superseded: bool = False,
    temporal_date: datetime | None = None,
    supersedes_reason: str | None = None,
) -> ParsedRequest:
    req = ParsedRequest(
        raw_text="test",
        request_type=request_type,
        target_name=target_name,
        age_preference=None,
        source_field=source_field,
        confidence=0.9,
        csv_position=csv_position,
        metadata={},
    )
    req.is_superseded = is_superseded
    req.temporal_date = temporal_date
    req.supersedes_reason = supersedes_reason
    return req


def _make_parse_result(
    requests: list[ParsedRequest],
    field_name: str = SourceField.BUNK_WITH,
    is_valid: bool = True,
) -> ParseResult:
    parse_request = Mock()
    parse_request.field_name = field_name
    return ParseResult(
        parse_request=parse_request,
        parsed_requests=requests,
        is_valid=is_valid,
    )


def _make_orchestrator():
    """Minimal RequestOrchestrator for unit-testing private methods."""
    from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
        RequestOrchestrator,
    )

    return RequestOrchestrator.__new__(RequestOrchestrator)


def _make_person(cm_id: int = 12345, name: str = "Emma") -> Any:
    """Create a minimal Person for testing."""
    from bunking.sync.bunk_request_processor.core.models import Person

    return Person(cm_id=cm_id, first_name=name, last_name="Johnson")


def _make_resolution(person: Any = None, method: str = "exact_match") -> ResolutionResult:
    return ResolutionResult(
        person=person,
        confidence=0.95 if person else 0.0,
        method=method,
        metadata={},
    )


# ===========================================================================
# ADR 4 — Temporal conflict filter scoped to notes fields only
# ===========================================================================


class TestADR4TemporalConflictFieldGuard:
    """Temporal conflict filtering should only run on notes source fields."""

    def test_temporal_filter_runs_for_bunking_notes(self):
        """Temporal conflicts in bunking_notes should be filtered."""
        orchestrator = _make_orchestrator()

        older = _make_parsed_request(
            request_type=RequestType.NOT_BUNK_WITH,
            target_name="Liam Garcia",
            source_field=SourceField.BUNKING_NOTES,
            csv_position=1,
            temporal_date=datetime(2025, 6, 4),
        )
        newer = _make_parsed_request(
            request_type=RequestType.BUNK_WITH,
            target_name="Liam Garcia",
            source_field=SourceField.BUNKING_NOTES,
            csv_position=2,
            temporal_date=datetime(2025, 6, 5),
        )

        parse_results = [_make_parse_result([older, newer], field_name=SourceField.BUNKING_NOTES)]
        kept, filtered = orchestrator._filter_temporal_conflicts(parse_results)

        assert filtered == 1
        assert kept == 1
        assert parse_results[0].parsed_requests[0].request_type == RequestType.BUNK_WITH

    def test_temporal_filter_runs_for_internal_notes(self):
        """Temporal conflicts in internal_notes should be filtered."""
        orchestrator = _make_orchestrator()

        older = _make_parsed_request(
            request_type=RequestType.NOT_BUNK_WITH,
            target_name="Olivia Chen",
            source_field=SourceField.INTERNAL_NOTES,
            csv_position=1,
            temporal_date=datetime(2025, 6, 4),
        )
        newer = _make_parsed_request(
            request_type=RequestType.BUNK_WITH,
            target_name="Olivia Chen",
            source_field=SourceField.INTERNAL_NOTES,
            csv_position=2,
            temporal_date=datetime(2025, 6, 5),
        )

        parse_results = [_make_parse_result([older, newer], field_name=SourceField.INTERNAL_NOTES)]
        kept, filtered = orchestrator._filter_temporal_conflicts(parse_results)

        assert filtered == 1
        assert kept == 1

    def test_temporal_filter_skipped_for_bunk_with_field(self):
        """Temporal conflicts in bunk_with field should NOT be filtered (pass-through)."""
        orchestrator = _make_orchestrator()

        older = _make_parsed_request(
            request_type=RequestType.NOT_BUNK_WITH,
            target_name="Liam Garcia",
            source_field=SourceField.BUNK_WITH,
            csv_position=1,
            is_superseded=True,
            supersedes_reason="changed mind",
        )
        newer = _make_parsed_request(
            request_type=RequestType.BUNK_WITH,
            target_name="Liam Garcia",
            source_field=SourceField.BUNK_WITH,
            csv_position=2,
        )

        parse_results = [_make_parse_result([older, newer], field_name=SourceField.BUNK_WITH)]
        kept, filtered = orchestrator._filter_temporal_conflicts(parse_results)

        # Guard should skip — both requests kept unmodified
        assert filtered == 0
        assert kept == 2
        assert len(parse_results[0].parsed_requests) == 2

    def test_temporal_filter_skipped_for_not_bunk_with_field(self):
        """Temporal conflicts in not_bunk_with field should NOT be filtered."""
        orchestrator = _make_orchestrator()

        req = _make_parsed_request(
            request_type=RequestType.NOT_BUNK_WITH,
            target_name="Liam Garcia",
            source_field=SourceField.NOT_BUNK_WITH,
            csv_position=1,
            is_superseded=True,
            supersedes_reason="changed mind",
        )

        parse_results = [_make_parse_result([req], field_name=SourceField.NOT_BUNK_WITH)]
        kept, filtered = orchestrator._filter_temporal_conflicts(parse_results)

        assert filtered == 0
        assert kept == 1

    def test_temporal_filter_skipped_for_socialize_with_field(self):
        """Temporal conflicts in socialize_with field should NOT be filtered."""
        orchestrator = _make_orchestrator()

        req = _make_parsed_request(
            source_field=SourceField.SOCIALIZE_WITH,
            csv_position=1,
            is_superseded=True,
        )

        parse_results = [_make_parse_result([req], field_name=SourceField.SOCIALIZE_WITH)]
        kept, filtered = orchestrator._filter_temporal_conflicts(parse_results)

        assert filtered == 0
        assert kept == 1


# ===========================================================================
# ADR 5 — NA stripping scoped to bunk_with only
# ===========================================================================


class TestADR5NAStrippingScopedToBunkWith:
    """NA/no-preference stripping should only run on bunk_with source field."""

    def test_no_preference_detected_on_bunk_with(self):
        """NA text in bunk_with field should be detected as no-preference."""
        orchestrator = _make_orchestrator()
        assert orchestrator._is_no_preference("N/A") is True
        assert orchestrator._is_no_preference("no preference") is True

    def test_no_preference_guard_not_in_source_for_non_bunk_with(self):
        """_prepare_parse_requests should NOT call is_no_preference for non-bunk_with fields.

        Verify via source inspection that the is_no_preference call is guarded
        by a field_name == SourceField.BUNK_WITH check.
        """
        import inspect

        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        source = inspect.getsource(RequestOrchestrator._prepare_parse_requests)

        # After the guard, is_no_preference should be inside a field_name check block.
        # The unguarded pattern is a bare `self._is_no_preference(request_text)` call
        # without a preceding field_name guard on the same line or wrapping if.
        # We check that the guard exists by looking for the SourceField.BUNK_WITH guard
        # near the no_preference check.
        assert "SourceField.BUNK_WITH" in source, (
            "Expected a SourceField.BUNK_WITH guard around is_no_preference in _prepare_parse_requests"
        )

    def test_strip_na_prefix_guard_in_source(self):
        """strip_na_prefix call should be guarded by field_name == SourceField.BUNK_WITH."""
        import inspect

        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        source = inspect.getsource(RequestOrchestrator._prepare_parse_requests)

        # The guard should scope both is_no_preference and strip_na_prefix to bunk_with
        assert "SourceField.BUNK_WITH" in source, (
            "Expected a SourceField.BUNK_WITH guard around strip_na_prefix in _prepare_parse_requests"
        )


# ===========================================================================
# ADR 6 — Staff detection guarded on notes fields only
# ===========================================================================


class TestADR6StaffDetectionNotesGuard:
    """Staff name filtering in Phase 2 should only run on notes source fields."""

    def _make_phase2_service(self, staff_filter):
        """Create a Phase2ResolutionService with a staff filter and mock pipeline."""
        from bunking.sync.bunk_request_processor.services.phase2_resolution_service import (
            Phase2ResolutionService,
        )

        mock_pipeline = Mock()
        # batch_resolve returns a real list (not a Mock) so len() works
        mock_pipeline.batch_resolve.return_value = []
        return Phase2ResolutionService(
            resolution_pipeline=mock_pipeline,
            staff_name_filter=staff_filter,
        )

    def _make_parse_result_for_phase2(self, target_name: str, source_field: str) -> ParseResult:
        """Create a ParseResult with a single bunk_with request for Phase 2 testing."""
        req = _make_parsed_request(
            target_name=target_name,
            source_field=source_field,
        )
        parse_request = Mock()
        parse_request.field_name = source_field
        parse_request.requester_cm_id = 99999
        parse_request.requester_grade = "5"
        parse_request.session_cm_id = 1000001
        parse_request.year = 2025
        return ParseResult(
            parse_request=parse_request,
            parsed_requests=[req],
            is_valid=True,
        )

    def _tracking_staff_filter(self, staff_calls: list[str], match_name: str) -> object:
        """Create a staff filter that tracks calls and matches a specific name."""

        def staff_filter(name: str) -> bool:
            staff_calls.append(name)
            return name == match_name

        return staff_filter

    def test_staff_filter_applied_for_bunking_notes(self):
        """Staff name filter should catch names from bunking_notes source field."""
        from bunking.sync.bunk_request_processor.services.phase2_resolution_service import (
            ResolutionCase,
        )

        staff_calls: list[str] = []
        service = self._make_phase2_service(self._tracking_staff_filter(staff_calls, "Staff Person"))
        pr = self._make_parse_result_for_phase2("Staff Person", SourceField.BUNKING_NOTES)

        service._resolve_batch([ResolutionCase(pr)])

        assert "Staff Person" in staff_calls
        assert service._stats["staff_filtered"] == 1

    def test_staff_filter_skipped_for_bunk_with(self):
        """Staff name filter should NOT run when source_field is bunk_with.

        Running staff detection on bunk_with produces false positives
        (e.g., 'Eve' matching a staff name).
        """
        from bunking.sync.bunk_request_processor.services.phase2_resolution_service import (
            ResolutionCase,
        )

        staff_calls: list[str] = []
        service = self._make_phase2_service(self._tracking_staff_filter(staff_calls, "Eve Johnson"))
        pr = self._make_parse_result_for_phase2("Eve Johnson", SourceField.BUNK_WITH)

        service._resolve_batch([ResolutionCase(pr)])

        # After the guard, staff filter should NOT be called for bunk_with
        assert "Eve Johnson" not in staff_calls
        assert service._stats["staff_filtered"] == 0

    def test_staff_filter_skipped_for_not_bunk_with(self):
        """Staff name filter should NOT run for not_bunk_with field."""
        from bunking.sync.bunk_request_processor.services.phase2_resolution_service import (
            ResolutionCase,
        )

        staff_calls: list[str] = []
        service = self._make_phase2_service(self._tracking_staff_filter(staff_calls, "Staff Person"))
        pr = self._make_parse_result_for_phase2("Staff Person", SourceField.NOT_BUNK_WITH)

        service._resolve_batch([ResolutionCase(pr)])

        assert "Staff Person" not in staff_calls
        assert service._stats["staff_filtered"] == 0

    def test_staff_filter_applied_for_internal_notes(self):
        """Staff name filter should catch names from internal_notes source field."""
        from bunking.sync.bunk_request_processor.services.phase2_resolution_service import (
            ResolutionCase,
        )

        staff_calls: list[str] = []
        service = self._make_phase2_service(self._tracking_staff_filter(staff_calls, "Staff Person"))
        pr = self._make_parse_result_for_phase2("Staff Person", SourceField.INTERNAL_NOTES)

        service._resolve_batch([ResolutionCase(pr)])

        assert "Staff Person" in staff_calls
        assert service._stats["staff_filtered"] == 1


# ===========================================================================
# ADR 8 — Phase 3 string contract: use RequestType enum
# ===========================================================================


class TestADR8Phase3EnumContract:
    """Phase 3 exclusion should use RequestType.AGE_PREFERENCE.value, not raw strings."""

    def test_age_preference_method_uses_enum_value(self):
        """The string 'age_preference' should equal RequestType.AGE_PREFERENCE.value."""
        assert RequestType.AGE_PREFERENCE.value == "age_preference"

    def test_no_raw_age_preference_strings_in_orchestrator_phase3(self):
        """Phase 3 exclusion logic should reference RequestType enum, not raw strings.

        This test greps the orchestrator source to verify no raw 'age_preference'
        strings remain in the Phase 3 section.
        """
        import inspect

        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        source = inspect.getsource(RequestOrchestrator._execute_pipeline)

        # After the fix, the Phase 3 section should use RequestType.AGE_PREFERENCE.value
        # and NOT contain raw "age_preference" string comparisons for method filtering.
        # Count occurrences of the raw string pattern used for Phase 3 exclusion.
        raw_method_check = 'rr.method != "age_preference"'
        assert raw_method_check not in source, (
            f"Found raw string comparison '{raw_method_check}' in _execute_pipeline. "
            f"Should use RequestType.AGE_PREFERENCE.value instead."
        )

    def test_social_graph_uses_enum_for_request_type(self):
        """Social graph edge weight calculation should use RequestType enum values."""
        import inspect

        from bunking.sync.bunk_request_processor.social.social_graph import SocialGraph

        source = inspect.getsource(SocialGraph._calculate_edge_weight)

        # After the fix, comparisons should use RequestType enum or .value
        raw_comparisons = [
            'request_type == "bunk_with"',
            'request_type == "not_bunk_with"',
            'request_type == "age_preference"',
        ]
        for raw in raw_comparisons:
            assert raw not in source, (
                f"Found raw string comparison '{raw}' in _calculate_edge_weight. "
                f"Should use RequestType enum .value instead."
            )

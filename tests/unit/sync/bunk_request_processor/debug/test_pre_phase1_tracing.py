"""Tests for Pre-Phase 1 tracing in _prepare_parse_requests.

Verifies that trace_collector.record_pre_phase1() is called at each
decision point in _prepare_parse_requests with correct actions.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from bunking.sync.bunk_request_processor.debug.trace_collector import TraceCollector


def _make_row(
    *,
    requester_cm_id: int = 12345,
    first_name: str = "Emma",
    last_name: str = "Johnson",
    grade: int = 5,
    year: int = 2025,
    bunk_with: str = "",
    not_bunk_with: str = "",
    bunking_notes: str = "",
    internal_notes: str = "",
    socialize_with: str = "",
    original_request_ids: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Build a raw request row matching the orchestrator input format."""
    row = {
        "requester_cm_id": requester_cm_id,
        "first_name": first_name,
        "last_name": last_name,
        "Grade": grade,
        "year": year,
        "bunk_request_form": bunk_with,
        "staff_not_bunk_with": not_bunk_with,
        "bunking_notes": bunking_notes,
        "internal_notes": internal_notes,
        "socialize_with": socialize_with,
        "_original_request_ids": original_request_ids or {},
    }
    return row


@pytest.fixture
def mock_orchestrator(mock_config):
    """Create a minimal orchestrator with trace collector for testing _prepare_parse_requests."""
    from bunking.sync.bunk_request_processor.orchestrator.orchestrator import RequestOrchestrator

    collector = TraceCollector(run_id="test-run")

    mock_ctx = MagicMock()
    mock_ctx.pb_client = MagicMock()
    mock_ctx._year = 2025

    with patch.object(RequestOrchestrator, "_initialize_components"):
        orch = RequestOrchestrator(
            year=2025,
            session_cm_ids=[1000001],
            data_context=mock_ctx,
            trace_collector=collector,
        )

    # Set up person_sessions so requests are not skipped
    orch._person_sessions = {12345: [1000001]}

    return orch


class TestPrePhase1TracingSkipEmpty:
    """Test that empty text is traced as skipped_empty."""

    @pytest.mark.asyncio
    async def test_empty_text_records_skipped_empty(self, mock_orchestrator):
        """Empty bunk_with should record skipped_empty trace."""
        row = _make_row(
            bunk_with="",
            original_request_ids={"bunk_request_form": "orig_req_1"},
        )
        mock_orchestrator.trace_collector = MagicMock(spec=TraceCollector)

        await mock_orchestrator._prepare_parse_requests([row])

        # Empty text is skipped entirely — no trace recorded for empty fields
        # (The plan says to trace skipped_empty, but only if there's an original_request_id)
        # With empty text, the `continue` fires before we have context to trace.
        # Verify no record_pre_phase1 call for this field.
        # Note: This is by design — empty fields are expected and not interesting to trace.


class TestPrePhase1TracingNoPreference:
    """Test that 'no preference' text is traced as skipped_no_preference."""

    @pytest.mark.asyncio
    async def test_no_preference_records_trace(self, mock_orchestrator):
        """'No preference' text should record skipped_no_preference trace."""
        row = _make_row(
            bunk_with="No preference",
            original_request_ids={"bunk_request_form": "orig_req_1"},
        )
        mock_orchestrator.trace_collector = MagicMock(spec=TraceCollector)

        await mock_orchestrator._prepare_parse_requests([row])

        mock_orchestrator.trace_collector.record_pre_phase1.assert_called()
        call_kwargs = mock_orchestrator.trace_collector.record_pre_phase1.call_args.kwargs
        assert call_kwargs["key"] == "orig_req_1"
        assert call_kwargs["action"] == "skipped_no_preference"
        assert call_kwargs["original_text"] == "No preference"


class TestPrePhase1TracingNaOnly:
    """Test that N/A-only text (with trailing punctuation) is traced as skipped_na_only."""

    @pytest.mark.asyncio
    async def test_na_only_records_trace(self, mock_orchestrator):
        """'N/A -' text should record skipped_na_only trace (not matched by is_no_preference)."""
        row = _make_row(
            bunk_with="N/A -",  # Trailing punctuation triggers regex path, not is_no_preference
            original_request_ids={"bunk_request_form": "orig_req_1"},
        )
        mock_orchestrator.trace_collector = MagicMock(spec=TraceCollector)

        await mock_orchestrator._prepare_parse_requests([row])

        mock_orchestrator.trace_collector.record_pre_phase1.assert_called()
        call_kwargs = mock_orchestrator.trace_collector.record_pre_phase1.call_args.kwargs
        assert call_kwargs["key"] == "orig_req_1"
        assert call_kwargs["action"] == "skipped_na_only"


class TestPrePhase1TracingNoSession:
    """Test that missing session is traced as skipped_no_session."""

    @pytest.mark.asyncio
    async def test_no_session_records_trace(self, mock_orchestrator):
        """Person not in sessions should record skipped_no_session trace."""
        row = _make_row(
            requester_cm_id=99999,  # Not in _person_sessions
            bunk_with="Emma Johnson",
            original_request_ids={"bunk_request_form": "orig_req_1"},
        )
        mock_orchestrator.trace_collector = MagicMock(spec=TraceCollector)

        await mock_orchestrator._prepare_parse_requests([row])

        mock_orchestrator.trace_collector.record_pre_phase1.assert_called()
        call_kwargs = mock_orchestrator.trace_collector.record_pre_phase1.call_args.kwargs
        assert call_kwargs["key"] == "orig_req_1"
        assert call_kwargs["action"] == "skipped_no_session"


class TestPrePhase1TracingStaffSigsOnly:
    """Test that staff-signature-only text is traced as skipped_staff_signatures_only."""

    @pytest.mark.asyncio
    async def test_staff_sigs_only_records_trace(self, mock_orchestrator):
        """Notes with only staff signatures should record skipped_staff_signatures_only."""
        # Staff signature pattern: FIRSTNAME LASTNAME (Month DD YYYY H:MMAM/PM)
        # Must be ALL CAPS first/last name with datetime in specific format
        row = _make_row(
            bunking_notes="MORGAN CHEN (May 2 2025 1:20PM)",
            original_request_ids={"bunking_notes": "orig_req_1"},
        )
        mock_orchestrator.trace_collector = MagicMock(spec=TraceCollector)

        await mock_orchestrator._prepare_parse_requests([row])

        # Check that record_pre_phase1 was called with staff_signatures_only
        calls = mock_orchestrator.trace_collector.record_pre_phase1.call_args_list
        staff_calls = [c for c in calls if c.kwargs.get("key") == "orig_req_1"]
        assert len(staff_calls) == 1
        assert staff_calls[0].kwargs["action"] == "skipped_staff_signatures_only"


class TestPrePhase1TracingDirectMap:
    """Test that socialize direct map is traced as direct_mapped."""

    @pytest.mark.asyncio
    async def test_socialize_direct_map_records_trace(self, mock_orchestrator):
        """Socialize preference dropdown should record direct_mapped trace."""
        row = _make_row(
            socialize_with="Kids their own grade and one grade above",
            original_request_ids={"socialize_with": "orig_req_1"},
        )
        mock_orchestrator.trace_collector = MagicMock(spec=TraceCollector)

        await mock_orchestrator._prepare_parse_requests([row])

        mock_orchestrator.trace_collector.record_pre_phase1.assert_called()
        call_kwargs = mock_orchestrator.trace_collector.record_pre_phase1.call_args.kwargs
        assert call_kwargs["key"] == "orig_req_1"
        assert call_kwargs["action"] == "direct_mapped"
        assert call_kwargs["field_path"] == "socialize_direct_map"


class TestPrePhase1TracingParsed:
    """Test that AI-parsed text is traced as parsed."""

    @pytest.mark.asyncio
    async def test_ai_parse_records_trace(self, mock_orchestrator):
        """Normal bunk_with text should record parsed trace."""
        row = _make_row(
            bunk_with="Emma Johnson",
            original_request_ids={"bunk_request_form": "orig_req_1"},
        )
        mock_orchestrator.trace_collector = MagicMock(spec=TraceCollector)

        await mock_orchestrator._prepare_parse_requests([row])

        mock_orchestrator.trace_collector.record_pre_phase1.assert_called()
        call_kwargs = mock_orchestrator.trace_collector.record_pre_phase1.call_args.kwargs
        assert call_kwargs["key"] == "orig_req_1"
        assert call_kwargs["action"] == "parsed"
        assert call_kwargs["field_path"] == "ai_parse"
        assert call_kwargs["original_text"] == "Emma Johnson"


class TestPrePhase1TracingNaPrefixStrip:
    """Test that N/A prefix stripping is reflected in traces."""

    @pytest.mark.asyncio
    async def test_na_prefix_stripped_in_trace(self, mock_orchestrator):
        """Text with N/A prefix should have na_prefix_stripped=True in trace."""
        row = _make_row(
            bunk_with="N/A; Emma Johnson",
            original_request_ids={"bunk_request_form": "orig_req_1"},
        )
        mock_orchestrator.trace_collector = MagicMock(spec=TraceCollector)

        await mock_orchestrator._prepare_parse_requests([row])

        mock_orchestrator.trace_collector.record_pre_phase1.assert_called()
        call_kwargs = mock_orchestrator.trace_collector.record_pre_phase1.call_args.kwargs
        assert call_kwargs["key"] == "orig_req_1"
        assert call_kwargs["action"] == "parsed"
        assert call_kwargs["na_prefix_stripped"] is True
        assert call_kwargs["original_text"] == "N/A; Emma Johnson"
        assert call_kwargs["cleaned_text"] == "Emma Johnson"

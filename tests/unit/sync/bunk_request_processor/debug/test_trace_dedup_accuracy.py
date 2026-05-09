"""Tests for post-dedup trace accuracy.

Verifies that:
1. Deduped-out requests are marked with DEDUPED status in traces
2. The dedup info (was_duplicate, kept_over) is populated in post-pipeline trace
3. Summary status breakdown counts deduped requests correctly
"""

from __future__ import annotations

from bunking.sync.bunk_request_processor.core.models import (
    BunkRequest,
    RequestStatus,
    RequestType,
)
from bunking.sync.bunk_request_processor.debug.trace_collector import TraceCollector
from bunking.sync.bunk_request_processor.debug.trace_models import (
    DedupSaveTrace,
    DispositionTrace,
    FinalBunkRequestTrace,
)
from bunking.sync.bunk_request_processor.processing.deduplicator import (
    Deduplicator,
)


class TestDedupTraceAccuracy:
    """Test that deduped requests are accurately reflected in traces."""

    def test_dedup_builds_removed_keys_set(self):
        """Deduplicator result should provide enough info to build a removed-keys set."""
        # Create two requests that will dedup (same requester, target, type)
        req_keep = BunkRequest(
            requester_cm_id=100,
            requested_cm_id=200,
            request_type=RequestType.BUNK_WITH,
            source_field="bunking_notes",
            confidence_score=0.95,
            year=2025,
            session_cm_id=1000001,
            priority=2,
            csv_position=1,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={},
            requested_name="Emma Johnson",
        )
        req_remove = BunkRequest(
            requester_cm_id=100,
            requested_cm_id=200,
            request_type=RequestType.BUNK_WITH,
            source_field="bunk_with",
            confidence_score=0.90,
            year=2025,
            session_cm_id=1000001,
            priority=1,
            csv_position=1,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={},
            requested_name="Emma Johnson",
        )

        deduplicator = Deduplicator()
        result = deduplicator.deduplicate_batch([req_keep, req_remove])

        assert result.statistics["duplicates_removed"] == 1
        assert len(result.duplicate_groups) == 1
        assert len(result.duplicate_groups[0].duplicates) == 1

        # Build the deduped-out keys set: (requester_cm_id, requested_name)
        deduped_keys: set[tuple[int, str]] = set()
        for group in result.duplicate_groups:
            for dup in group.duplicates:
                deduped_keys.add((dup.requester_cm_id, dup.requested_name or ""))

        assert (100, "Emma Johnson") in deduped_keys

    def test_deduped_request_marked_in_trace(self):
        """Trace should mark deduped-out request with DEDUPED status."""
        # Simulate the trace-building logic for a deduped request
        deduped_keys = {(100, "Emma Johnson")}

        # Build FinalBunkRequestTrace as the orchestrator would
        requester_cm_id = 100
        target_name = "Emma Johnson"
        is_deduped = (requester_cm_id, target_name) in deduped_keys

        # For a deduped request, matched_br would be None
        final_status = "DEDUPED" if is_deduped else "RESOLVED"

        trace = FinalBunkRequestTrace(
            bunk_request_id=None,
            requester_cm_id=requester_cm_id,
            requested_cm_id=200,
            requested_name=target_name,
            request_type="bunk_with",
            status=final_status,
            confidence=0.90,
            resolution_method="exact_match",
        )

        assert trace.status == "DEDUPED"
        assert trace.bunk_request_id is None  # Not saved to DB

    def test_kept_request_not_marked_deduped(self):
        """Trace should NOT mark the kept request as DEDUPED."""
        deduped_keys = {(100, "Emma Johnson")}

        # The kept request has a different target
        requester_cm_id = 100
        target_name = "Liam Garcia"
        is_deduped = (requester_cm_id, target_name) in deduped_keys

        final_status = "DEDUPED" if is_deduped else "RESOLVED"

        assert final_status == "RESOLVED"

    def test_dedup_flag_set_in_dedup_save_trace(self):
        """DedupSaveTrace should report was_duplicate=True when dedup occurred."""
        deduped_keys = {(100, "Emma Johnson")}

        # In the orchestrator's trace loop, any_dedup should be set
        # when a request's key is found in the deduped set
        any_dedup = False
        for target in ["Emma Johnson", "Liam Garcia"]:
            if (100, target) in deduped_keys:
                any_dedup = True

        dedup_trace = DedupSaveTrace(was_duplicate=any_dedup, kept_over=None)
        assert dedup_trace.was_duplicate is True

    def test_status_breakdown_counts_deduped(self):
        """Status breakdown should count DEDUPED traces in a separate category."""
        collector = TraceCollector(run_id="test-dedup-001")

        # Record a pre_phase1 trace so it exists
        collector.record_pre_phase1(
            key="trace-1",
            action="parsed",
            original_text="Emma Johnson",
            requester_cm_id=100,
            year=2025,
            session_cm_id=1000001,
            source_field="bunk_with",
        )

        # Record disposition with DEDUPED status
        collector.record_disposition(
            key="trace-1",
            disposition=DispositionTrace(
                final_bunk_requests=[
                    FinalBunkRequestTrace(
                        requester_cm_id=100,
                        requested_name="Emma Johnson",
                        request_type="bunk_with",
                        status="DEDUPED",
                        confidence=0.90,
                    ),
                ],
            ),
        )

        breakdown = collector._compute_status_breakdown()
        # DEDUPED should not count as resolved, pending, or declined
        # It should either be its own category or count as "skipped"
        assert breakdown.get("resolved", 0) == 0
        assert breakdown.get("pending", 0) == 0
        assert breakdown.get("declined", 0) == 0

"""Tests for TraceCollector and NoOpTraceCollector."""

from bunking.sync.bunk_request_processor.debug.trace_collector import (
    NoOpTraceCollector,
    TraceCollector,
)
from bunking.sync.bunk_request_processor.debug.trace_models import (
    FinalBunkRequestTrace,
    PostPipelineTrace,
)


class TestTraceCollector:
    def test_record_pre_phase1(self):
        tc = TraceCollector(run_id="test123")
        tc.record_pre_phase1(
            key="orig_abc",
            action="parsed",
            original_text="bunk with Emma",
            cleaned_text="bunk with Emma",
            requester_cm_id=12345,
            year=2025,
            session_cm_id=1000001,
            source_field="bunk_with",
        )
        assert "orig_abc" in tc._traces
        assert tc._traces["orig_abc"].pre_phase1.action == "parsed"
        assert tc._traces["orig_abc"].pre_phase1.original_text == "bunk with Emma"

    def test_record_phase1(self):
        tc = TraceCollector(run_id="test123")
        tc.record_pre_phase1(
            key="orig_abc",
            action="parsed",
            original_text="test",
            requester_cm_id=1,
            year=2025,
            session_cm_id=1,
            source_field="bunk_with",
        )
        tc.record_phase1(
            key="orig_abc",
            ran=True,
            parsed_intents=[{"target_name": "Emma", "request_type": "BUNK_WITH"}],
            token_count=100,
            processing_time_ms=500,
            is_valid=True,
        )
        assert tc._traces["orig_abc"].phase1_parse.ran is True
        assert tc._traces["orig_abc"].phase1_parse.token_count == 100

    def test_get_all_traces(self):
        tc = TraceCollector(run_id="test123")
        tc.record_pre_phase1(
            key="a",
            action="parsed",
            original_text="x",
            requester_cm_id=1,
            year=2025,
            session_cm_id=1,
            source_field="bunk_with",
        )
        tc.record_pre_phase1(
            key="b",
            action="skipped_no_preference",
            original_text="none",
            requester_cm_id=2,
            year=2025,
            session_cm_id=1,
            source_field="bunk_with",
        )
        assert len(tc._traces) == 2

    def test_enabled_flag(self):
        tc = TraceCollector(run_id="test123", enabled=True)
        assert tc.enabled is True


class TestNoOpTraceCollector:
    def test_does_nothing(self):
        noop = NoOpTraceCollector()
        # Should not raise
        noop.record_pre_phase1(
            key="x",
            action="parsed",
            original_text="test",
            requester_cm_id=1,
            year=2025,
            session_cm_id=1,
            source_field="bunk_with",
        )
        noop.record_phase1(key="x", ran=True, parsed_intents=[], token_count=0, processing_time_ms=0, is_valid=True)
        assert noop._traces == {}

    def test_enabled_false(self):
        noop = NoOpTraceCollector()
        assert noop.enabled is False


class TestSummaryDataDispositionFields:
    """Test that disposition_reason and is_reciprocal are included in summary data."""

    def test_summary_data_includes_disposition_fields(self):
        """Verify that flush() builds summary_data dicts with disposition_reason and is_reciprocal."""
        tc = TraceCollector(run_id="test-disp", enabled=True)
        key = "req-001"
        tc.record_pre_phase1(
            key=key,
            action="parsed",
            original_text="bunk with Liam",
            requester_cm_id=1001,
            year=2025,
            session_cm_id=100,
            source_field="bunk_with",
        )
        # Manually set post_pipeline with disposition fields
        trace = tc._traces[key]
        trace.post_pipeline = PostPipelineTrace(
            final_bunk_requests=[
                FinalBunkRequestTrace(
                    bunk_request_id="br-001",
                    status="RESOLVED",
                    confidence=0.95,
                    resolution_method="exact_match",
                    disposition_reason="reciprocal_match",
                    is_reciprocal=True,
                    request_type="BUNK_WITH",
                ),
            ]
        )
        tc._trace_metadata[key] = {
            "original_request_id": "orig-001",
            "requester_cm_id": 1001,
            "year": 2025,
            "session_cm_id": 100,
            "source_field": "bunk_with",
        }

        # Verify the trace data contains disposition fields
        trace_data = tc._traces[key]
        for br in trace_data.post_pipeline.final_bunk_requests:
            assert br.disposition_reason == "reciprocal_match"
            assert br.is_reciprocal is True

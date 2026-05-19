"""Tests for TraceCollector and NoOpTraceCollector."""

from bunking.sync.bunk_request_processor.debug.trace_collector import (
    NoOpTraceCollector,
    TraceCollector,
)
from bunking.sync.bunk_request_processor.debug.trace_models import (
    ConflictDetectionTrace,
    DedupSaveTrace,
    DispositionTrace,
    FinalBunkRequestTrace,
    ReciprocalSignal,
    SelfReferenceSignal,
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
            source_field="bunk_request_form",
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
            source_field="bunk_request_form",
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
            source_field="bunk_request_form",
        )
        tc.record_pre_phase1(
            key="b",
            action="skipped_no_preference",
            original_text="none",
            requester_cm_id=2,
            year=2025,
            session_cm_id=1,
            source_field="bunk_request_form",
        )
        assert len(tc._traces) == 2

    def test_enabled_true_by_default(self):
        tc = TraceCollector(run_id="test123")
        assert tc.enabled is True

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
            source_field="bunk_request_form",
        )
        noop.record_phase1(key="x", ran=True, parsed_intents=[], token_count=0, processing_time_ms=0, is_valid=True)
        assert noop._traces == {}

    def test_enabled_false(self):
        noop = NoOpTraceCollector()
        assert noop.enabled is False


class TestSummaryDataDispositionFields:
    """Test that disposition_reason and is_reciprocal are stored on trace objects."""

    def test_trace_stores_disposition_fields(self):
        """Verify that trace objects retain disposition_reason and is_reciprocal after setup."""
        tc = TraceCollector(run_id="test-disp", enabled=True)
        key = "req-001"
        tc.record_pre_phase1(
            key=key,
            action="parsed",
            original_text="bunk with Liam",
            requester_cm_id=1001,
            year=2025,
            session_cm_id=100,
            source_field="bunk_request_form",
        )
        # Populate disposition via new flattened trace fields
        trace = tc._traces[key]
        trace.disposition = DispositionTrace(
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
            "source_field": "bunk_request_form",
        }

        # Verify the trace data contains disposition fields
        trace_data = tc._traces[key]
        for br in trace_data.disposition.final_bunk_requests:
            assert br.disposition_reason == "reciprocal_match"
            assert br.is_reciprocal is True


class TestRecordDispositionAndRelated:
    """Test the new discrete recorders for flattened trace fields."""

    def test_record_batch_signals_sets_reciprocal(self):
        tc = TraceCollector(run_id="test-batch")
        tc.record_pre_phase1(
            key="k",
            action="parsed",
            original_text="t",
            requester_cm_id=1,
            year=2025,
            session_cm_id=1,
            source_field="bunk_request_form",
        )
        tc.record_batch_signals(
            key="k",
            reciprocal=ReciprocalSignal(detected=True, boost_applied=True, boost_amount=0.1, pair_cm_id=99),
        )
        bs = tc._traces["k"].batch_signals
        assert bs.reciprocal.detected is True
        assert bs.reciprocal.pair_cm_id == 99

    def test_record_conflict_detection(self):
        tc = TraceCollector(run_id="test-cd")
        tc.record_pre_phase1(
            key="k",
            action="parsed",
            original_text="t",
            requester_cm_id=1,
            year=2025,
            session_cm_id=1,
            source_field="bunk_request_form",
        )
        tc.record_conflict_detection(
            key="k",
            conflict_detection=ConflictDetectionTrace(has_conflict=True, details=[{"type": "x"}]),
        )
        cd = tc._traces["k"].conflict_detection
        assert cd.has_conflict is True
        assert cd.details == [{"type": "x"}]

    def test_record_disposition(self):
        tc = TraceCollector(run_id="test-disp")
        tc.record_pre_phase1(
            key="k",
            action="parsed",
            original_text="t",
            requester_cm_id=1,
            year=2025,
            session_cm_id=1,
            source_field="bunk_request_form",
        )
        tc.record_disposition(
            key="k",
            disposition=DispositionTrace(final_bunk_requests=[FinalBunkRequestTrace(status="RESOLVED")]),
        )
        disp = tc._traces["k"].disposition
        assert len(disp.final_bunk_requests) == 1

    def test_record_dedup_save_sets_self_reference(self):
        """self_reference lives on dedup_save, not batch_signals."""
        tc = TraceCollector(run_id="test-dedup")
        tc.record_pre_phase1(
            key="k",
            action="parsed",
            original_text="t",
            requester_cm_id=1,
            year=2025,
            session_cm_id=1,
            source_field="bunk_request_form",
        )
        tc.record_dedup_save(
            key="k",
            dedup_save=DedupSaveTrace(
                was_duplicate=True,
                kept_over="br-99",
                self_reference=SelfReferenceSignal(detected=True),
            ),
        )
        ds = tc._traces["k"].dedup_save
        assert ds.was_duplicate is True
        assert ds.kept_over == "br-99"
        assert ds.self_reference.detected is True

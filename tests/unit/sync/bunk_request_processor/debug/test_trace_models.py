"""Tests for pipeline debug trace models."""

from bunking.sync.bunk_request_processor.debug.trace_models import (
    BatchSignalsTrace,
    ConflictDetectionTrace,
    DedupSaveTrace,
    DispositionTrace,
    FinalBunkRequestTrace,
    HistoricalVerificationTrace,
    Phase1Trace,
    PrePhase1Trace,
    ReciprocalSignal,
    SelfReferenceSignal,
    TraceData,
    ValidationTrace,
)


class TestPrePhase1Trace:
    def test_defaults(self):
        t = PrePhase1Trace(action="parsed", original_text="bunk with Emma")
        assert t.action == "parsed"
        assert t.skip_reason is None
        assert t.na_prefix_stripped is False

    def test_skipped(self):
        t = PrePhase1Trace(action="skipped_no_preference", skip_reason="no bunk requests", original_text="none")
        assert t.skip_reason == "no bunk requests"


class TestPhase1Trace:
    def test_not_ran(self):
        t = Phase1Trace(ran=False)
        assert t.parsed_intents == []
        assert t.token_count is None

    def test_with_intents(self):
        t = Phase1Trace(
            ran=True,
            parsed_intents=[{"target_name": "Emma", "request_type": "BUNK_WITH", "confidence": 0.95}],
            token_count=342,
            processing_time_ms=1200,
            is_valid=True,
        )
        assert len(t.parsed_intents) == 1
        assert t.token_count == 342


class TestTraceData:
    def test_full_trace_serializes(self):
        td = TraceData(
            pre_phase1=PrePhase1Trace(action="parsed", original_text="bunk with Emma"),
            phase1_parse=Phase1Trace(ran=True, is_valid=True),
            validation=ValidationTrace(),
            phase2_resolution=[],
            historical_verification=HistoricalVerificationTrace(),
            phase3_disambiguation=[],
        )
        d = td.model_dump()
        assert d["pre_phase1"]["action"] == "parsed"
        assert d["phase1_parse"]["ran"] is True

    def test_trace_data_has_four_top_level_finalization_fields(self):
        """TraceData exposes flattened batch_signals/conflict_detection/disposition/dedup_save."""
        td = TraceData()
        assert hasattr(td, "batch_signals")
        assert hasattr(td, "conflict_detection")
        assert hasattr(td, "disposition")
        assert hasattr(td, "dedup_save")

    def test_trace_data_does_not_have_post_pipeline(self):
        """post_pipeline must no longer exist on TraceData."""
        td = TraceData()
        assert not hasattr(td, "post_pipeline")
        # Also absent from serialized form
        assert "post_pipeline" not in td.model_dump()

    def test_flattened_fields_serialize(self):
        td = TraceData()
        d = td.model_dump()
        assert "batch_signals" in d
        assert "conflict_detection" in d
        assert "disposition" in d
        assert "dedup_save" in d


class TestBatchSignalsTrace:
    def test_defaults(self):
        b = BatchSignalsTrace()
        assert isinstance(b.reciprocal, ReciprocalSignal)
        assert b.reciprocal.detected is False
        assert b.reciprocal.boost_applied is False
        assert b.reciprocal.boost_amount is None
        assert b.reciprocal.pair_cm_id is None

    def test_batch_signals_does_not_have_self_reference(self):
        """self_reference lives on DedupSaveTrace, NOT BatchSignalsTrace (UI alignment)."""
        b = BatchSignalsTrace()
        assert not hasattr(b, "self_reference")


class TestConflictDetectionTrace:
    def test_defaults(self):
        c = ConflictDetectionTrace()
        assert c.has_conflict is False
        assert c.details == []


class TestDispositionTrace:
    def test_defaults(self):
        d = DispositionTrace()
        assert d.final_bunk_requests == []

    def test_with_requests(self):
        d = DispositionTrace(
            final_bunk_requests=[
                FinalBunkRequestTrace(status="RESOLVED", disposition_reason="exact"),
            ]
        )
        assert len(d.final_bunk_requests) == 1


class TestDedupSaveTrace:
    def test_defaults(self):
        d = DedupSaveTrace()
        assert d.was_duplicate is False
        assert d.kept_over is None
        assert isinstance(d.self_reference, SelfReferenceSignal)
        assert d.self_reference.detected is False

    def test_dedup_has_self_reference(self):
        """self_reference sits on dedup_save so UI DedupDetail can read it."""
        d = DedupSaveTrace(self_reference=SelfReferenceSignal(detected=True))
        assert d.self_reference.detected is True


class TestFinalBunkRequestTraceDispositionFields:
    """Tests for disposition_reason and is_reciprocal on FinalBunkRequestTrace."""

    def test_disposition_fields_in_model_dump(self):
        trace = FinalBunkRequestTrace(
            bunk_request_id="br-001",
            status="RESOLVED",
            confidence=0.95,
            resolution_method="exact_match",
            disposition_reason="reciprocal_match",
            is_reciprocal=True,
        )
        d = trace.model_dump()
        assert d["disposition_reason"] == "reciprocal_match"
        assert d["is_reciprocal"] is True
        assert d["resolution_method"] == "exact_match"

    def test_disposition_trace_final_requests_include_disposition(self):
        disp = DispositionTrace(
            final_bunk_requests=[
                FinalBunkRequestTrace(
                    status="RESOLVED",
                    disposition_reason="high_confidence_match",
                    is_reciprocal=False,
                ),
                FinalBunkRequestTrace(
                    status="DECLINED",
                    disposition_reason="target_not_attending",
                    is_reciprocal=False,
                ),
            ]
        )
        d = disp.model_dump()
        assert d["final_bunk_requests"][0]["disposition_reason"] == "high_confidence_match"
        assert d["final_bunk_requests"][1]["disposition_reason"] == "target_not_attending"

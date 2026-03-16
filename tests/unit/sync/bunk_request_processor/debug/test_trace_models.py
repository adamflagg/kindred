"""Tests for pipeline debug trace data models."""

from bunking.sync.bunk_request_processor.debug.trace_models import (
    SCHEMA_VERSION,
    HistoricalVerificationTrace,
    Phase1Trace,
    PlaceholderExpansionTrace,
    PostPipelineTrace,
    PrePhase1Trace,
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
            placeholder_expansion=PlaceholderExpansionTrace(),
            historical_verification=HistoricalVerificationTrace(),
            phase3_disambiguation=[],
            post_pipeline=PostPipelineTrace(),
        )
        d = td.model_dump()
        assert d["pre_phase1"]["action"] == "parsed"
        assert d["phase1_parse"]["ran"] is True

    def test_schema_version(self):
        assert SCHEMA_VERSION == 1

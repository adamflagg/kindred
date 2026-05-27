"""Tests for TraceCollector._compute_session_breakdown() and the extracted _resolve_trace_status helper."""

from bunking.sync.bunk_request_processor.debug.trace_collector import TraceCollector
from bunking.sync.bunk_request_processor.debug.trace_models import (
    DispositionTrace,
    FinalBunkRequestTrace,
)


def _seed_trace(
    tc: TraceCollector,
    key: str,
    session_cm_id: int,
    statuses: list[str],
) -> None:
    """Seed a trace with a given session_cm_id and a list of final bunk-request statuses.

    Uses the real seeding API:
      - record_pre_phase1() sets _trace_metadata[key]["session_cm_id"]
      - record_disposition() sets disposition.final_bunk_requests with the given statuses
    If statuses is empty the trace is left with no final_bunk_requests (→ skipped).
    """
    tc.record_pre_phase1(
        key=key,
        action="parsed",
        original_text="bunk with Emma",
        requester_cm_id=99999,
        year=2025,
        session_cm_id=session_cm_id,
        source_field="bunk_request_form",
    )
    tc.record_disposition(
        key=key,
        disposition=DispositionTrace(
            final_bunk_requests=[FinalBunkRequestTrace(status=s, request_type="BUNK_WITH") for s in statuses]
        ),
    )


class TestComputeSessionBreakdown:
    """_compute_session_breakdown() groups status counts by session_cm_id (as str keys)."""

    def test_basic_grouping_two_sessions(self) -> None:
        """Two sessions with known statuses are grouped correctly."""
        tc = TraceCollector(run_id="test-session-breakdown")

        # session 1000001: one RESOLVED + one PENDING
        _seed_trace(tc, "key-s1-resolved", session_cm_id=1000001, statuses=["RESOLVED"])
        _seed_trace(tc, "key-s1-pending", session_cm_id=1000001, statuses=["PENDING"])

        # session 1000002: one RESOLVED
        _seed_trace(tc, "key-s2-resolved", session_cm_id=1000002, statuses=["RESOLVED"])

        breakdown = tc._compute_session_breakdown()

        assert set(breakdown.keys()) == {"1000001", "1000002"}

        s1 = breakdown["1000001"]
        assert s1 == {"resolved": 1, "pending": 1, "declined": 0, "skipped": 0, "deduped": 0}

        s2 = breakdown["1000002"]
        assert s2 == {"resolved": 1, "pending": 0, "declined": 0, "skipped": 0, "deduped": 0}

    def test_global_breakdown_still_correct_after_refactor(self) -> None:
        """_compute_status_breakdown() aggregate is unchanged after the DRY refactor."""
        tc = TraceCollector(run_id="test-global-unchanged")

        _seed_trace(tc, "key-s1-resolved", session_cm_id=1000001, statuses=["RESOLVED"])
        _seed_trace(tc, "key-s1-pending", session_cm_id=1000001, statuses=["PENDING"])
        _seed_trace(tc, "key-s2-resolved", session_cm_id=1000002, statuses=["RESOLVED"])

        global_bd = tc._compute_status_breakdown()
        assert global_bd["resolved"] == 2
        assert global_bd["pending"] == 1
        assert global_bd["declined"] == 0
        assert global_bd["skipped"] == 0
        assert global_bd["deduped"] == 0

    def test_skipped_trace_counted_in_session(self) -> None:
        """A trace with no final_bunk_requests is counted as 'skipped' in its session bucket."""
        tc = TraceCollector(run_id="test-skipped")

        _seed_trace(tc, "key-skipped", session_cm_id=1000003, statuses=[])  # no final requests → skipped

        breakdown = tc._compute_session_breakdown()
        assert breakdown["1000003"]["skipped"] == 1
        assert breakdown["1000003"]["resolved"] == 0

    def test_declined_and_deduped_traces(self) -> None:
        """DECLINED and DEDUPED statuses are bucketed correctly per session."""
        tc = TraceCollector(run_id="test-declined-deduped")

        _seed_trace(tc, "key-declined", session_cm_id=2000001, statuses=["DECLINED"])
        _seed_trace(tc, "key-deduped", session_cm_id=2000001, statuses=["DEDUPED"])

        breakdown = tc._compute_session_breakdown()
        s = breakdown["2000001"]
        assert s["declined"] == 1
        assert s["deduped"] == 1
        assert s["resolved"] == 0
        assert s["pending"] == 0

    def test_priority_pending_beats_resolved_within_trace(self) -> None:
        """A single trace with both RESOLVED and PENDING bunk requests resolves to 'pending'."""
        tc = TraceCollector(run_id="test-priority-pending")

        # One trace with two bunk requests: one RESOLVED, one PENDING
        tc.record_pre_phase1(
            key="mixed",
            action="parsed",
            original_text="bunk with Emma and Liam",
            requester_cm_id=11111,
            year=2025,
            session_cm_id=3000001,
            source_field="bunk_request_form",
        )
        tc.record_disposition(
            key="mixed",
            disposition=DispositionTrace(
                final_bunk_requests=[
                    FinalBunkRequestTrace(status="RESOLVED", request_type="BUNK_WITH"),
                    FinalBunkRequestTrace(status="PENDING", request_type="BUNK_WITH"),
                ]
            ),
        )

        breakdown = tc._compute_session_breakdown()
        s = breakdown["3000001"]
        assert s["pending"] == 1
        assert s["resolved"] == 0

    def test_empty_collector_returns_empty_dict(self) -> None:
        """No traces → empty session breakdown dict (not a dict with zero counts)."""
        tc = TraceCollector(run_id="test-empty")
        breakdown = tc._compute_session_breakdown()
        assert breakdown == {}

    def test_session_keys_are_strings(self) -> None:
        """session_cm_id (int) is stored as str key in the output dict."""
        tc = TraceCollector(run_id="test-str-keys")
        _seed_trace(tc, "key-a", session_cm_id=9999999, statuses=["RESOLVED"])
        breakdown = tc._compute_session_breakdown()
        # Only the str key is present — confirms session_cm_id is stringified, never left as int.
        assert set(breakdown.keys()) == {"9999999"}

    def test_missing_metadata_falls_back_to_zero_key(self) -> None:
        """A disposition recorded for a key never seen by record_pre_phase1 has no metadata,
        so session_cm_id defaults to 0 and the trace is bucketed under the "0" key."""
        tc = TraceCollector(run_id="test-missing-meta")
        tc.record_disposition(
            key="orphan",
            disposition=DispositionTrace(
                final_bunk_requests=[FinalBunkRequestTrace(status="RESOLVED", request_type="BUNK_WITH")]
            ),
        )
        breakdown = tc._compute_session_breakdown()
        assert "0" in breakdown
        assert breakdown["0"]["resolved"] == 1

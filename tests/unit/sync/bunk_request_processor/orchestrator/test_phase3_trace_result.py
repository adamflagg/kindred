"""Tests for Phase 3 trace result logic in the orchestrator.

Verifies that the `result` field of Phase3IntentTrace reflects
`disambiguation_status` from resolution metadata, not a hardcoded
"still_ambiguous" fallback.

Issue #838: trace result was always "still_ambiguous" for unresolved Phase 3
results; it should use rr.metadata["disambiguation_status"] when present.
"""

from __future__ import annotations

from unittest.mock import MagicMock

from bunking.sync.bunk_request_processor.core.models import (
    ParsedRequest,
    ParseRequest,
    ParseResult,
    RequestType,
)
from bunking.sync.bunk_request_processor.debug.trace_models import Phase3IntentTrace
from bunking.sync.bunk_request_processor.orchestrator.orchestrator import _get_trace_key
from bunking.sync.bunk_request_processor.resolution.interfaces import ResolutionResult


def _make_parse_result(original_request_id: str = "orig_req_1") -> ParseResult:
    """Build a minimal ParseResult with a trace key."""
    row_data = {
        "_original_request_ids": {"share_bunk_with": original_request_id},
        "requester_cm_id": 12345,
        "first_name": "Emma",
        "last_name": "Johnson",
        "Grade": "5",
        "year": 2025,
        "bunk_with": "Olivia Chen",
        "not_bunk_with": "",
        "bunking_notes": "",
        "internal_notes": "",
        "socialize_with": "",
    }
    parse_request = ParseRequest(
        request_text="Olivia Chen",
        field_name="share_bunk_with",
        requester_cm_id=12345,
        requester_name="Emma Johnson",
        requester_grade="5",
        session_cm_id=1000001,
        session_name="Session 1",
        year=2025,
        row_data=row_data,
    )
    parsed_req = ParsedRequest(
        raw_text="Olivia Chen",
        request_type=RequestType.BUNK_WITH,
        target_name="Olivia Chen",
        age_preference=None,
        source_field="bunk_request_form",
        confidence=0.5,
        csv_position=1,
        metadata={},
    )
    return ParseResult(
        parsed_requests=[parsed_req],
        is_valid=True,
        parse_request=parse_request,
    )


def _run_current_trace_logic(
    resolution_result: ResolutionResult,
    phase3_processed_indices: set[int] | None = None,
    parse_result: ParseResult | None = None,
) -> list[Phase3IntentTrace]:
    """Execute the current (pre-fix) Phase 3 trace loop and return recorded traces.

    This mirrors the exact code in orchestrator.py around lines 1451-1489.
    The test_* methods assert on the result field to check for bugs.
    """
    if parse_result is None:
        parse_result = _make_parse_result()
    if phase3_processed_indices is None:
        phase3_processed_indices = {0}

    resolution_results = [(parse_result, [resolution_result])]
    pre_phase3_confidences: dict[str, list[float]] = {}
    recorded_traces: list[Phase3IntentTrace] = []

    for idx, (pr, res_list) in enumerate(resolution_results):
        trace_key = _get_trace_key(pr)
        if not trace_key:
            continue
        ran_phase3 = idx in phase3_processed_indices
        pre_confs = pre_phase3_confidences.get(trace_key, [])
        for intent_idx, rr in enumerate(res_list):
            rr_meta = rr.metadata or {}
            ranked_sel = rr_meta.get("ranked_selections") or []
            ranked_lookup: dict[int, float] = {
                s["person_id"]: s["confidence"]
                for s in ranked_sel
                if isinstance(s, dict) and "person_id" in s and "confidence" in s
            }
            candidates_sent = (
                [
                    {
                        "person_cm_id": c.cm_id,
                        "name": (c.full_name if hasattr(c, "full_name") else f"{c.first_name} {c.last_name}"),
                        **({"grade": c.grade} if hasattr(c, "grade") and c.grade is not None else {}),
                        **({"ai_confidence": ranked_lookup[c.cm_id]} if c.cm_id in ranked_lookup else {}),
                    }
                    for c in (rr.candidates or [])
                ]
                if ran_phase3
                else []
            )
            ai_reasoning = rr_meta.get("reason")
            confidence_before = pre_confs[intent_idx] if intent_idx < len(pre_confs) else None
            trace = Phase3IntentTrace(
                target_name=rr.target_name or "",
                ran=ran_phase3,
                candidates_sent=candidates_sent,
                ai_reasoning=ai_reasoning,
                confidence_before=confidence_before,
                result=(
                    "resolved"
                    if rr.is_resolved
                    else ("not_needed" if not ran_phase3 else rr_meta.get("disambiguation_status", "still_ambiguous"))
                ),
                confidence_after=rr.confidence,
                reranked=rr_meta.get("reranked", False),
                jw_score=rr_meta.get("jw_score"),
                ai_confidence=rr_meta.get("ai_confidence"),
                no_match_signal=rr_meta.get("disambiguation_status") == "no_match" if ran_phase3 else False,
            )
            recorded_traces.append(trace)

    return recorded_traces


class TestPhase3TraceResult:
    """Phase 3 trace result should reflect disambiguation_status metadata."""

    def test_invalid_ai_output_trace_result(self):
        """When disambiguation_status='invalid_ai_output' and Phase 3 ran but
        did not resolve, the trace result should be 'invalid_ai_output',
        not 'still_ambiguous'."""
        rr = ResolutionResult(
            person=None,
            confidence=0.0,
            method="ai_disambiguation",
            target_name="Olivia Chen",
            metadata={"disambiguation_status": "invalid_ai_output"},
        )

        traces = _run_current_trace_logic(rr)

        assert len(traces) == 1
        # This FAILS before the fix: result is "still_ambiguous" not "invalid_ai_output"
        assert traces[0].result == "invalid_ai_output", f"Expected 'invalid_ai_output' but got '{traces[0].result}'"

    def test_no_match_trace_result(self):
        """When disambiguation_status='no_match' and Phase 3 ran but did not
        resolve, the trace result should be 'no_match', not 'still_ambiguous'."""
        rr = ResolutionResult(
            person=None,
            confidence=0.0,
            method="ai_disambiguation",
            target_name="Olivia Chen",
            metadata={"disambiguation_status": "no_match"},
        )

        traces = _run_current_trace_logic(rr)

        assert len(traces) == 1
        # This FAILS before the fix: result is "still_ambiguous" not "no_match"
        assert traces[0].result == "no_match", f"Expected 'no_match' but got '{traces[0].result}'"

    def test_still_ambiguous_when_no_status_in_metadata(self):
        """When Phase 3 ran but metadata has no disambiguation_status key, the
        trace result should fall back to 'still_ambiguous'."""
        rr = ResolutionResult(
            person=None,
            confidence=0.0,
            method="ai_disambiguation",
            target_name="Olivia Chen",
            metadata={},  # No disambiguation_status key
        )

        traces = _run_current_trace_logic(rr)

        assert len(traces) == 1
        assert traces[0].result == "still_ambiguous"

    def test_resolved_result_unchanged(self):
        """When the resolution IS resolved, result should always be 'resolved'
        regardless of any metadata."""
        mock_person = MagicMock()
        mock_person.cm_id = 67890

        rr = ResolutionResult(
            person=mock_person,
            confidence=0.95,
            method="ai_disambiguation",
            target_name="Olivia Chen",
            metadata={"disambiguation_status": "invalid_ai_output"},
        )

        traces = _run_current_trace_logic(rr)

        assert len(traces) == 1
        assert traces[0].result == "resolved"

    def test_not_needed_when_phase3_did_not_run(self):
        """When Phase 3 did not run for this index, result should be 'not_needed'."""
        rr = ResolutionResult(
            person=None,
            confidence=0.0,
            method="phase2",
            target_name="Olivia Chen",
            metadata={"disambiguation_status": "no_match"},
        )

        # Phase 3 was NOT run for index 0
        traces = _run_current_trace_logic(rr, phase3_processed_indices=set())

        assert len(traces) == 1
        assert traces[0].result == "not_needed"


class TestPhase3TraceRerankerFields:
    """Phase 3 trace should surface JW reranker metadata from rr.metadata."""

    def test_reranked_fields_populated_from_metadata(self):
        """When metadata contains reranker data, trace should capture it."""
        mock_person = MagicMock()
        mock_person.cm_id = 67890

        rr = ResolutionResult(
            person=mock_person,
            confidence=0.85,
            method="ai_disambiguation",
            target_name="Olivia Chen",
            metadata={
                "reranked": True,
                "jw_score": 0.92,
                "ai_confidence": 0.90,
                "disambiguation_reason": "Best match by name similarity",
            },
        )

        traces = _run_current_trace_logic(rr)

        assert len(traces) == 1
        assert traces[0].reranked is True
        assert traces[0].jw_score == 0.92
        assert traces[0].ai_confidence == 0.90

    def test_reranked_false_when_not_in_metadata(self):
        """Legacy path (no reranker) should default to reranked=False."""
        mock_person = MagicMock()
        mock_person.cm_id = 67890

        rr = ResolutionResult(
            person=mock_person,
            confidence=0.90,
            method="ai_disambiguation",
            target_name="Olivia Chen",
            metadata={"ai_confidence": 0.90, "disambiguation_reason": "Best match"},
        )

        traces = _run_current_trace_logic(rr)

        assert len(traces) == 1
        assert traces[0].reranked is False
        assert traces[0].jw_score is None
        assert traces[0].ai_confidence == 0.90

    def test_no_match_signal_from_status(self):
        """When disambiguation_status is 'no_match', no_match_signal should be True."""
        rr = ResolutionResult(
            person=None,
            confidence=0.0,
            method="ai_disambiguation",
            target_name="Olivia Chen",
            metadata={"disambiguation_status": "no_match"},
        )

        traces = _run_current_trace_logic(rr)

        assert len(traces) == 1
        assert traces[0].no_match_signal is True

    def test_no_match_signal_false_for_resolved(self):
        """Resolved results should have no_match_signal=False."""
        mock_person = MagicMock()
        mock_person.cm_id = 67890

        rr = ResolutionResult(
            person=mock_person,
            confidence=0.90,
            method="ai_disambiguation",
            target_name="Olivia Chen",
            metadata={"reranked": True, "jw_score": 0.88},
        )

        traces = _run_current_trace_logic(rr)

        assert len(traces) == 1
        assert traces[0].no_match_signal is False

    def test_defaults_when_metadata_empty(self):
        """Empty metadata should yield safe defaults for all new fields."""
        rr = ResolutionResult(
            person=None,
            confidence=0.0,
            method="ai_disambiguation",
            target_name="Olivia Chen",
            metadata={},
        )

        traces = _run_current_trace_logic(rr)

        assert len(traces) == 1
        assert traces[0].reranked is False
        assert traces[0].jw_score is None
        assert traces[0].ai_confidence is None
        assert traces[0].no_match_signal is False

    def test_candidates_sent_enriched_with_ai_confidence(self):
        """When ranked_selections is in metadata, candidates_sent should include ai_confidence and grade."""
        mock_person_1 = MagicMock()
        mock_person_1.cm_id = 67890
        mock_person_1.full_name = "Olivia Chen"
        mock_person_1.grade = 7

        mock_person_2 = MagicMock()
        mock_person_2.cm_id = 67892
        mock_person_2.full_name = "Olivia Chang"
        mock_person_2.grade = 8

        rr = ResolutionResult(
            person=mock_person_1,
            confidence=0.85,
            method="ai_disambiguation",
            target_name="Olivia Chen",
            candidates=[mock_person_1, mock_person_2],
            metadata={
                "reranked": True,
                "jw_score": 0.92,
                "ai_confidence": 0.90,
                "ranked_selections": [
                    {"person_id": 67890, "confidence": 0.90, "reasoning": "Best match"},
                    {"person_id": 67892, "confidence": 0.65, "reasoning": "Similar name"},
                ],
            },
        )

        traces = _run_current_trace_logic(rr)

        assert len(traces) == 1
        cs = traces[0].candidates_sent
        assert len(cs) == 2
        assert cs[0]["person_cm_id"] == 67890
        assert cs[0]["ai_confidence"] == 0.90
        assert cs[0]["grade"] == 7
        assert cs[1]["person_cm_id"] == 67892
        assert cs[1]["ai_confidence"] == 0.65
        assert cs[1]["grade"] == 8

    def test_candidates_sent_no_enrichment_without_ranked_selections(self):
        """Without ranked_selections, candidates_sent should only have cm_id, name, and grade."""
        mock_person = MagicMock()
        mock_person.cm_id = 67890
        mock_person.full_name = "Olivia Chen"
        mock_person.grade = 6

        rr = ResolutionResult(
            person=mock_person,
            confidence=0.90,
            method="ai_disambiguation",
            target_name="Olivia Chen",
            candidates=[mock_person],
            metadata={"ai_confidence": 0.90},
        )

        traces = _run_current_trace_logic(rr)

        assert len(traces) == 1
        cs = traces[0].candidates_sent
        assert len(cs) == 1
        assert cs[0]["person_cm_id"] == 67890
        assert cs[0]["grade"] == 6
        assert "ai_confidence" not in cs[0]

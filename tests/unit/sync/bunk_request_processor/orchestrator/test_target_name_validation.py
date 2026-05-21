"""Tests for post-parse target name validation.

Verifies that _validate_target_names_in_source() rejects:
1. Hallucinated names not present in the source text
2. Unit/cabin names (Nitzanim, Galil, etc.)

And preserves:
- Names that appear in the source text (full, first-only, last-only)
- Age placeholders (older, younger, unclear)
- Empty target_name (defensive early return — age preferences and any
  other path that legitimately emits an empty target)
- age_preference request types
"""

from unittest.mock import Mock

from bunking.sync.bunk_request_processor.core.models import (
    AgePreference,
    ParsedRequest,
    ParseRequest,
    ParseResult,
    RequestType,
)


def _make_parse_request(request_text: str = "some source text") -> ParseRequest:
    """Helper to create a minimal ParseRequest."""
    return ParseRequest(
        request_text=request_text,
        field_name="Share Bunk With",
        requester_name="Emma Johnson",
        requester_cm_id=12345,
        requester_grade="5",
        session_cm_id=1234567,
        session_name="Session 1",
        year=2025,
        row_data={},
    )


def _make_parsed_request(
    target_name: str | None,
    request_type: RequestType = RequestType.BUNK_WITH,
    source_field: str = "Share Bunk With",
) -> ParsedRequest:
    """Helper to create a minimal ParsedRequest."""
    return ParsedRequest(
        raw_text="test",
        request_type=request_type,
        target_name=target_name,
        age_preference=AgePreference.OLDER if request_type == RequestType.AGE_PREFERENCE else None,
        source_field=source_field,
        confidence=0.9,
        csv_position=0,
        metadata={},
    )


def _make_parse_result(
    parsed_requests: list[ParsedRequest],
    request_text: str = "some source text",
) -> ParseResult:
    """Helper to create a ParseResult with a ParseRequest."""
    return ParseResult(
        parsed_requests=parsed_requests,
        is_valid=True,
        parse_request=_make_parse_request(request_text),
    )


def _make_orchestrator():
    """Helper to create a minimal orchestrator."""
    from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
        RequestOrchestrator,
    )

    pb = Mock()
    return RequestOrchestrator(pb=pb, year=2025, session_cm_ids=[])


class TestValidateTargetNamesInSource:
    """Test hallucination detection via input-presence validation."""

    def test_keeps_name_present_in_source(self):
        orchestrator = _make_orchestrator()
        result = _make_parse_result(
            [_make_parsed_request("Sarah Chen")],
            request_text="put her with Sarah Chen please",
        )
        kept, rejected = orchestrator._validate_target_names_in_source([result])
        assert kept == 1
        assert rejected == 0
        assert len(result.parsed_requests) == 1

    def test_keeps_first_name_only_match(self):
        orchestrator = _make_orchestrator()
        result = _make_parse_result(
            [_make_parsed_request("Sarah Chen")],
            request_text="put her with Sarah please",
        )
        kept, rejected = orchestrator._validate_target_names_in_source([result])
        assert kept == 1
        assert rejected == 0

    def test_keeps_last_name_only_match(self):
        orchestrator = _make_orchestrator()
        result = _make_parse_result(
            [_make_parsed_request("Sarah Chen")],
            request_text="the Chen family requested bunking together",
        )
        kept, rejected = orchestrator._validate_target_names_in_source([result])
        assert kept == 1
        assert rejected == 0

    def test_rejects_hallucinated_name(self):
        orchestrator = _make_orchestrator()
        result = _make_parse_result(
            [_make_parsed_request("Emma Wilson")],
            request_text="same age or older",
        )
        kept, rejected = orchestrator._validate_target_names_in_source([result])
        assert kept == 0
        assert rejected == 1
        assert len(result.parsed_requests) == 0

    def test_rejects_hallucinated_name_from_gender_notes(self):
        """Real production case: AI hallucinated names from gender identity notes."""
        orchestrator = _make_orchestrator()
        source = (
            "Sana has identified as a boy since he was 3 years old. "
            "If there was an all-gender cabin that would be their preference."
        )
        result = _make_parse_result(
            [
                _make_parsed_request("Chloe Davis", RequestType.NOT_BUNK_WITH),
                _make_parsed_request("Mia", RequestType.BUNK_WITH),
            ],
            request_text=source,
        )
        kept, rejected = orchestrator._validate_target_names_in_source([result])
        assert kept == 0
        assert rejected == 2
        assert len(result.parsed_requests) == 0

    def test_exempts_empty_target_name(self):
        """Empty target_name passes the 'if not target_name' early return —
        validation must not reject it as hallucinated. This guards any code
        path that legitimately emits an empty target (age preferences, etc.)."""
        orchestrator = _make_orchestrator()
        result = _make_parse_result(
            [_make_parsed_request("", RequestType.NOT_BUNK_WITH)],
            request_text="no trans campers please",
        )
        kept, rejected = orchestrator._validate_target_names_in_source([result])
        assert kept == 1
        assert rejected == 0

    def test_exempts_age_values(self):
        orchestrator = _make_orchestrator()
        for placeholder in ["older", "younger", "unclear"]:
            result = _make_parse_result(
                [_make_parsed_request(placeholder)],
                request_text="prefers older kids",
            )
            kept, rejected = orchestrator._validate_target_names_in_source([result])
            assert kept == 1, f"Expected placeholder '{placeholder}' to be kept"
            assert rejected == 0

    def test_exempts_age_preference_request_type(self):
        orchestrator = _make_orchestrator()
        result = _make_parse_result(
            [_make_parsed_request(None, RequestType.AGE_PREFERENCE)],
            request_text="same age or older",
        )
        kept, rejected = orchestrator._validate_target_names_in_source([result])
        assert kept == 1
        assert rejected == 0

    def test_skips_no_target_name(self):
        orchestrator = _make_orchestrator()
        result = _make_parse_result(
            [_make_parsed_request(None)],
            request_text="some text",
        )
        kept, rejected = orchestrator._validate_target_names_in_source([result])
        assert kept == 1
        assert rejected == 0

    def test_skips_invalid_result(self):
        orchestrator = _make_orchestrator()
        result = _make_parse_result(
            [_make_parsed_request("Emma Wilson")],
            request_text="no names here",
        )
        result.is_valid = False
        kept, rejected = orchestrator._validate_target_names_in_source([result])
        assert kept == 0
        assert rejected == 0

    def test_mixed_valid_and_hallucinated(self):
        """One real name + one hallucinated = keep only the real one."""
        orchestrator = _make_orchestrator()
        result = _make_parse_result(
            [
                _make_parsed_request("Sarah Chen"),
                _make_parsed_request("Emma Wilson"),
            ],
            request_text="put her with Sarah Chen",
        )
        kept, rejected = orchestrator._validate_target_names_in_source([result])
        assert kept == 1
        assert rejected == 1
        assert len(result.parsed_requests) == 1
        assert result.parsed_requests[0].target_name == "Sarah Chen"

    def test_case_insensitive_matching(self):
        orchestrator = _make_orchestrator()
        result = _make_parse_result(
            [_make_parsed_request("SARAH CHEN")],
            request_text="put her with sarah chen",
        )
        kept, rejected = orchestrator._validate_target_names_in_source([result])
        assert kept == 1
        assert rejected == 0

    def test_marks_result_invalid_when_all_rejected(self):
        orchestrator = _make_orchestrator()
        result = _make_parse_result(
            [_make_parsed_request("Emma Wilson")],
            request_text="same age or older",
        )
        orchestrator._validate_target_names_in_source([result])
        assert result.is_valid is False

    def test_punctuation_in_source_text_ignored(self):
        """Punctuation should not prevent matching."""
        orchestrator = _make_orchestrator()
        result = _make_parse_result(
            [_make_parsed_request("Sarah Chen")],
            request_text="put her with Sarah Chen, please!",
        )
        kept, rejected = orchestrator._validate_target_names_in_source([result])
        assert kept == 1
        assert rejected == 0


class TestUnitNameValidation:
    """Test that unit/cabin names are rejected as targets."""

    def test_rejects_nitzanim(self):
        orchestrator = _make_orchestrator()
        result = _make_parse_result(
            [_make_parsed_request("Nitzanim", RequestType.NOT_BUNK_WITH)],
            request_text="request to NOT be in Nitzanim",
        )
        kept, rejected = orchestrator._validate_target_names_in_source([result])
        assert kept == 0
        assert rejected == 1

    def test_rejects_all_unit_names(self):
        orchestrator = _make_orchestrator()
        for unit_name in ["Nitzanim", "Galil", "Eilat", "Haifa", "Chalutzim", "Carmel"]:
            result = _make_parse_result(
                [_make_parsed_request(unit_name, RequestType.NOT_BUNK_WITH)],
                request_text=f"not in {unit_name}",
            )
            kept, rejected = orchestrator._validate_target_names_in_source([result])
            assert rejected == 1, f"Expected {unit_name} to be rejected"

    def test_rejects_unit_name_case_insensitive(self):
        orchestrator = _make_orchestrator()
        result = _make_parse_result(
            [_make_parsed_request("NITZANIM", RequestType.NOT_BUNK_WITH)],
            request_text="NOT be in NITZANIM",
        )
        kept, rejected = orchestrator._validate_target_names_in_source([result])
        assert kept == 0
        assert rejected == 1

    def test_unit_name_rejected_even_when_in_source_text(self):
        """Unit names appear in source text but should still be rejected as person targets."""
        orchestrator = _make_orchestrator()
        result = _make_parse_result(
            [_make_parsed_request("Nitzanim", RequestType.NOT_BUNK_WITH)],
            request_text="request to NOT be in Nitzanim, did not like going to bed early",
        )
        kept, rejected = orchestrator._validate_target_names_in_source([result])
        assert kept == 0
        assert rejected == 1


class TestRoundTrip:
    """Test N/A stripping + hallucination detection working together."""

    def test_na_stripped_then_real_name_passes(self):
        """N/A prefix stripped, AI finds real name in remainder, validation passes."""
        orchestrator = _make_orchestrator()

        # Simulate what happens after N/A stripping
        result = _make_parse_result(
            [_make_parsed_request("Sarah Chen")],
            request_text="but if possible, put her with Sarah Chen",
        )
        kept, rejected = orchestrator._validate_target_names_in_source([result])
        assert kept == 1
        assert rejected == 0

    def test_na_stripped_then_hallucinated_name_rejected(self):
        """N/A prefix stripped, AI hallucinates from remainder, validation catches it."""
        orchestrator = _make_orchestrator()

        # Simulate: "N/A- same age or older" -> stripped to "same age or older"
        # AI hallucinates "Emma Wilson" from prompt examples
        result = _make_parse_result(
            [_make_parsed_request("Emma Wilson")],
            request_text="same age or older",
        )
        kept, rejected = orchestrator._validate_target_names_in_source([result])
        assert kept == 0
        assert rejected == 1


class TestPipelineStats:
    """Test that stats are tracked correctly."""

    def test_hallucination_and_unit_name_stats_tracked(self):
        orchestrator = _make_orchestrator()

        results = [
            _make_parse_result(
                [_make_parsed_request("Emma Wilson")],
                request_text="same age or older",
            ),
            _make_parse_result(
                [_make_parsed_request("Nitzanim", RequestType.NOT_BUNK_WITH)],
                request_text="NOT be in Nitzanim",
            ),
        ]
        orchestrator._validate_target_names_in_source(results)
        assert orchestrator._stats.get("hallucination_rejected", 0) == 1
        assert orchestrator._stats.get("unit_name_rejected", 0) == 1

"""Tests for "no preference" detection in orchestrator.

Verifies that fields containing only "no preference" indicators are skipped
before AI parsing, avoiding unnecessary API calls.

Patterns to detect:
- "no bunk requests" / "no bunk request"
- "no preference"
- "none"
- "n/a"
- "na"

All patterns should be case-insensitive and match the ENTIRE field value."""

from unittest.mock import Mock

import pytest


class TestNoPreferenceDetection:
    """Test that 'no preference' indicators are detected and skipped."""

    def test_no_bunk_requests_singular_skipped(self):
        """'no bunk request' should be detected as no preference."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        pb = Mock()
        orchestrator = RequestOrchestrator(pb=pb, year=2025, session_cm_ids=[])

        assert orchestrator._is_no_preference("no bunk request") is True

    def test_no_bunk_requests_plural_skipped(self):
        """'no bunk requests' should be detected as no preference."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        pb = Mock()
        orchestrator = RequestOrchestrator(pb=pb, year=2025, session_cm_ids=[])

        assert orchestrator._is_no_preference("no bunk requests") is True

    def test_no_preference_skipped(self):
        """'no preference' should be detected as no preference."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        pb = Mock()
        orchestrator = RequestOrchestrator(pb=pb, year=2025, session_cm_ids=[])

        assert orchestrator._is_no_preference("no preference") is True

    def test_none_skipped(self):
        """'none' should be detected as no preference."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        pb = Mock()
        orchestrator = RequestOrchestrator(pb=pb, year=2025, session_cm_ids=[])

        assert orchestrator._is_no_preference("none") is True

    def test_na_skipped(self):
        """'na' should be detected as no preference."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        pb = Mock()
        orchestrator = RequestOrchestrator(pb=pb, year=2025, session_cm_ids=[])

        assert orchestrator._is_no_preference("na") is True

    def test_n_a_skipped(self):
        """'n/a' should be detected as no preference."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        pb = Mock()
        orchestrator = RequestOrchestrator(pb=pb, year=2025, session_cm_ids=[])

        assert orchestrator._is_no_preference("n/a") is True

    def test_case_insensitive_matching(self):
        """No preference patterns should be case-insensitive."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        pb = Mock()
        orchestrator = RequestOrchestrator(pb=pb, year=2025, session_cm_ids=[])

        # Test various case combinations
        assert orchestrator._is_no_preference("NO BUNK REQUESTS") is True
        assert orchestrator._is_no_preference("No Preference") is True
        assert orchestrator._is_no_preference("NONE") is True
        assert orchestrator._is_no_preference("N/A") is True
        assert orchestrator._is_no_preference("NA") is True
        assert orchestrator._is_no_preference("No Bunk Request") is True

    def test_whitespace_trimmed(self):
        """Leading/trailing whitespace should be ignored."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        pb = Mock()
        orchestrator = RequestOrchestrator(pb=pb, year=2025, session_cm_ids=[])

        assert orchestrator._is_no_preference("  none  ") is True
        assert orchestrator._is_no_preference("\tno preference\n") is True
        assert orchestrator._is_no_preference(" n/a ") is True

    def test_normal_requests_not_skipped(self):
        """Normal bunk requests should NOT be detected as no preference."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        pb = Mock()
        orchestrator = RequestOrchestrator(pb=pb, year=2025, session_cm_ids=[])

        # Real bunk request names
        assert orchestrator._is_no_preference("John Smith") is False
        assert orchestrator._is_no_preference("Sarah Johnson, Mike Lee") is False
        assert orchestrator._is_no_preference("wants to bunk with Emma") is False

    def test_embedded_none_not_skipped(self):
        """'none' embedded in longer text should NOT be skipped."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        pb = Mock()
        orchestrator = RequestOrchestrator(pb=pb, year=2025, session_cm_ids=[])

        # "none" appears but is not the entire value
        assert orchestrator._is_no_preference("None of the Smith kids") is False
        assert orchestrator._is_no_preference("Has none in mind yet, maybe later") is False
        assert orchestrator._is_no_preference("not with anyone") is False

    def test_partial_match_not_skipped(self):
        """Partial matches of patterns should NOT be skipped."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        pb = Mock()
        orchestrator = RequestOrchestrator(pb=pb, year=2025, session_cm_ids=[])

        # Patterns that contain the keywords but are not exact matches
        assert orchestrator._is_no_preference("no bunk requests - see notes") is False
        assert orchestrator._is_no_preference("no preference for older kids") is False
        assert orchestrator._is_no_preference("na - will update later") is False


class TestNoPreferenceIntegration:
    """Test that no-preference detection integrates with _prepare_parse_requests."""

    @pytest.mark.asyncio
    async def test_no_preference_field_not_sent_to_ai(self):
        """Fields with 'no preference' should not create ParseRequest objects."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        pb = Mock()
        orchestrator = RequestOrchestrator(pb=pb, year=2025, session_cm_ids=[1234567])

        # Mock person_sessions to allow processing
        orchestrator._person_sessions = {12345: [1234567]}

        raw_requests = [
            {
                "requester_cm_id": 12345,
                "first_name": "Emma",
                "last_name": "Johnson",
                "bunk_request_form": "none",  # Should be skipped
                "staff_not_bunk_with": "",
                "bunking_notes": "",
                "internal_notes": "",
                "socialize_with": "",
            }
        ]

        parse_requests, pre_parsed = await orchestrator._prepare_parse_requests(raw_requests)

        # 'none' should result in NO ParseRequest objects
        assert len(parse_requests) == 0
        assert len(pre_parsed) == 0

    @pytest.mark.asyncio
    async def test_mixed_fields_only_valid_sent_to_ai(self):
        """Only bunk_with 'no preference' fields should be skipped; other fields go to AI.

        ADR 5: NA/no-preference skipping is scoped to bunk_with only.
        Non-bunk_with fields with 'n/a' or 'no preference' text are passed through
        to AI parsing since the pattern only ever matched on bunk_with in production.
        """
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        pb = Mock()
        orchestrator = RequestOrchestrator(pb=pb, year=2025, session_cm_ids=[1234567])

        # Mock person_sessions
        orchestrator._person_sessions = {12345: [1234567]}

        raw_requests = [
            {
                "requester_cm_id": 12345,
                "first_name": "Emma",
                "last_name": "Johnson",
                "bunk_request_form": "John Smith",  # Valid - should create ParseRequest
                "staff_not_bunk_with": "n/a",  # ADR 5: NOT skipped (not bunk_with), goes to AI
                "bunking_notes": "no preference",  # ADR 5: NOT skipped (not bunk_with), goes to AI
                "internal_notes": "Keep with Sarah",  # Valid - should create ParseRequest
                "socialize_with": "",  # Empty - naturally skipped
            }
        ]

        parse_requests, pre_parsed = await orchestrator._prepare_parse_requests(raw_requests)

        # ADR 5: Only bunk_with gets no-preference filtering.
        # Should have 4 ParseRequests: bunk_with, not_bunk_with, bunking_notes, internal_notes
        assert len(parse_requests) == 4

        field_names = {pr.field_name for pr in parse_requests}
        assert "bunk_request_form" in field_names
        assert "internal_notes" in field_names
        assert "staff_not_bunk_with" in field_names  # ADR 5: no longer skipped
        assert "bunking_notes" in field_names  # ADR 5: no longer skipped

    @pytest.mark.asyncio
    async def test_stat_tracking_for_skipped_no_preference(self):
        """Orchestrator should track count of skipped 'no preference' fields.

        ADR 5: NA/no-preference skipping is scoped to bunk_with only.
        Only bunk_with "none" is skipped; not_bunk_with "n/a" and
        bunking_notes "no preference" now pass through to AI parsing.
        """
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        pb = Mock()
        orchestrator = RequestOrchestrator(pb=pb, year=2025, session_cm_ids=[1234567])

        # Mock person_sessions
        orchestrator._person_sessions = {12345: [1234567]}

        raw_requests = [
            {
                "requester_cm_id": 12345,
                "first_name": "Emma",
                "last_name": "Johnson",
                "bunk_request_form": "none",  # Skipped (bunk_request_form + no-preference)
                "staff_not_bunk_with": "n/a",  # ADR 5: NOT skipped (not bunk_with)
                "bunking_notes": "no preference",  # ADR 5: NOT skipped (not bunk_with)
                "internal_notes": "",
                "socialize_with": "",
            }
        ]

        await orchestrator._prepare_parse_requests(raw_requests)

        # ADR 5: Only bunk_with field gets no-preference filtering
        assert orchestrator._stats.get("no_preference_skipped", 0) == 1


class TestStripNaPrefix:
    """Test N/A prefix stripping returns trailing text or None."""

    def test_na_semicolon_trailing_text(self):
        from bunking.sync.bunk_request_processor.shared.constants import strip_na_prefix

        assert strip_na_prefix("N/A; their own grade/younger") == "their own grade/younger"

    def test_na_dash_trailing_text(self):
        from bunking.sync.bunk_request_processor.shared.constants import strip_na_prefix

        assert strip_na_prefix("N/A- same age or older") == "same age or older"

    def test_na_spaced_dash_trailing_text(self):
        from bunking.sync.bunk_request_processor.shared.constants import strip_na_prefix

        assert strip_na_prefix("N/A - some notes here") == "some notes here"

    def test_na_em_dash_trailing_text(self):
        from bunking.sync.bunk_request_processor.shared.constants import strip_na_prefix

        assert strip_na_prefix("N/A \u2014 some text") == "some text"

    def test_na_en_dash_trailing_text(self):
        from bunking.sync.bunk_request_processor.shared.constants import strip_na_prefix

        assert strip_na_prefix("N/A \u2013 some text") == "some text"

    def test_na_comma_trailing_text(self):
        from bunking.sync.bunk_request_processor.shared.constants import strip_na_prefix

        assert strip_na_prefix("N/A, but prefer older kids") == "but prefer older kids"

    def test_na_colon_trailing_text(self):
        from bunking.sync.bunk_request_processor.shared.constants import strip_na_prefix

        assert strip_na_prefix("N/A: see notes") == "see notes"

    def test_na_without_slash_dash(self):
        from bunking.sync.bunk_request_processor.shared.constants import strip_na_prefix

        assert strip_na_prefix("NA - same age or older") == "same age or older"

    def test_case_insensitive(self):
        from bunking.sync.bunk_request_processor.shared.constants import strip_na_prefix

        assert strip_na_prefix("n/a; their own grade") == "their own grade"
        assert strip_na_prefix("Na- older kids") == "older kids"

    def test_bare_na_returns_none(self):
        from bunking.sync.bunk_request_processor.shared.constants import strip_na_prefix

        assert strip_na_prefix("N/A") is None

    def test_bare_na_with_whitespace_returns_none(self):
        from bunking.sync.bunk_request_processor.shared.constants import strip_na_prefix

        assert strip_na_prefix("  N/A  ") is None

    def test_na_separator_whitespace_only_returns_none(self):
        from bunking.sync.bunk_request_processor.shared.constants import strip_na_prefix

        assert strip_na_prefix("N/A -   ") is None

    def test_not_na_prefix_returns_none(self):
        from bunking.sync.bunk_request_processor.shared.constants import strip_na_prefix

        assert strip_na_prefix("Nancy Smith") is None
        assert strip_na_prefix("Nathan Lee") is None
        assert strip_na_prefix("John Smith") is None

    def test_empty_string_returns_none(self):
        from bunking.sync.bunk_request_processor.shared.constants import strip_na_prefix

        assert strip_na_prefix("") is None

    def test_na_with_real_name_after(self):
        from bunking.sync.bunk_request_processor.shared.constants import strip_na_prefix

        result = strip_na_prefix("N/A - but if possible, put her with Sarah Chen")
        assert result == "but if possible, put her with Sarah Chen"


class TestNaPrefixStrippingInPrepare:
    """Test that _prepare_parse_requests strips N/A prefixes before AI."""

    @pytest.mark.asyncio
    async def test_na_prefix_stripped_before_ai(self):
        """N/A-prefixed text should have prefix stripped, remainder sent to AI."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        pb = Mock()
        orchestrator = RequestOrchestrator(pb=pb, year=2025, session_cm_ids=[1234567])
        orchestrator._person_sessions = {12345: [1234567]}

        raw_requests = [
            {
                "requester_cm_id": 12345,
                "first_name": "Emma",
                "last_name": "Johnson",
                "bunk_request_form": "N/A; their own grade/younger",
                "staff_not_bunk_with": "",
                "bunking_notes": "",
                "internal_notes": "",
                "socialize_with": "",
            }
        ]

        parse_requests, pre_parsed = await orchestrator._prepare_parse_requests(raw_requests)

        assert len(parse_requests) == 1
        assert parse_requests[0].request_text == "their own grade/younger"

    @pytest.mark.asyncio
    async def test_na_dash_prefix_stripped(self):
        """N/A with dash should have prefix stripped."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        pb = Mock()
        orchestrator = RequestOrchestrator(pb=pb, year=2025, session_cm_ids=[1234567])
        orchestrator._person_sessions = {12345: [1234567]}

        raw_requests = [
            {
                "requester_cm_id": 12345,
                "first_name": "Emma",
                "last_name": "Johnson",
                "bunk_request_form": "N/A- same age or older",
                "staff_not_bunk_with": "",
                "bunking_notes": "",
                "internal_notes": "",
                "socialize_with": "",
            }
        ]

        parse_requests, pre_parsed = await orchestrator._prepare_parse_requests(raw_requests)

        assert len(parse_requests) == 1
        assert parse_requests[0].request_text == "same age or older"

    @pytest.mark.asyncio
    async def test_na_whitespace_only_after_separator_skipped(self):
        """N/A with separator but only whitespace after should produce no request."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        pb = Mock()
        orchestrator = RequestOrchestrator(pb=pb, year=2025, session_cm_ids=[1234567])
        orchestrator._person_sessions = {12345: [1234567]}

        raw_requests = [
            {
                "requester_cm_id": 12345,
                "first_name": "Emma",
                "last_name": "Johnson",
                "bunk_request_form": "N/A -   ",
                "staff_not_bunk_with": "",
                "bunking_notes": "",
                "internal_notes": "",
                "socialize_with": "",
            }
        ]

        parse_requests, pre_parsed = await orchestrator._prepare_parse_requests(raw_requests)

        # N/A with no meaningful trailing text -> no parse request
        assert len(parse_requests) == 0

    @pytest.mark.asyncio
    async def test_normal_text_unchanged(self):
        """Non-N/A text should pass through unchanged."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        pb = Mock()
        orchestrator = RequestOrchestrator(pb=pb, year=2025, session_cm_ids=[1234567])
        orchestrator._person_sessions = {12345: [1234567]}

        raw_requests = [
            {
                "requester_cm_id": 12345,
                "first_name": "Emma",
                "last_name": "Johnson",
                "bunk_request_form": "Sarah Chen",
                "staff_not_bunk_with": "",
                "bunking_notes": "",
                "internal_notes": "",
                "socialize_with": "",
            }
        ]

        parse_requests, pre_parsed = await orchestrator._prepare_parse_requests(raw_requests)

        assert len(parse_requests) == 1
        assert parse_requests[0].request_text == "Sarah Chen"

    @pytest.mark.asyncio
    async def test_na_prefix_stripped_stat_tracked(self):
        """Orchestrator should track count of N/A-stripped fields.

        ADR 5: NA prefix stripping is scoped to bunk_with only.
        The not_bunk_with "N/A- same age" now passes through unchanged.
        """
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        pb = Mock()
        orchestrator = RequestOrchestrator(pb=pb, year=2025, session_cm_ids=[1234567])
        orchestrator._person_sessions = {12345: [1234567]}

        raw_requests = [
            {
                "requester_cm_id": 12345,
                "first_name": "Emma",
                "last_name": "Johnson",
                "bunk_request_form": "N/A; their own grade",  # Stripped (bunk_with field)
                "staff_not_bunk_with": "N/A- same age",  # ADR 5: NOT stripped (not bunk_with)
                "bunking_notes": "",
                "internal_notes": "",
                "socialize_with": "",
            }
        ]

        await orchestrator._prepare_parse_requests(raw_requests)

        # ADR 5: Only bunk_with field gets NA prefix stripping
        assert orchestrator._stats.get("na_prefix_stripped", 0) == 1

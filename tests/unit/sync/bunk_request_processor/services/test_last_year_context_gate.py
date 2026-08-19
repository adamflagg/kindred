"""Tests for the temporal gate that admits a request to the prior-year bunkmate path (#2457).

``Phase2ResolutionService._has_last_year_context`` is the ONLY gate on
``_try_prior_bunkmate_resolution`` — the highest-confidence resolution the
pipeline has (0.95 full name / 0.90 first name). It tested one string,
``"last year"``, so a parent writing "last summer" never reached it.

Two things are pinned here:

1. the gate admits the common phrasings, not just ``last year``;
2. the keyword branch and the raw-text branch test the SAME patterns. They
   disagreed: the keyword list carried ``from before`` and the raw-text
   fallback did not, so the same phrase was admitted or refused depending on
   which branch saw it.

The raw-text branch is the live one. ``keywords_found`` reaches
``ParsedRequest.metadata`` from a single producer whose schema asks the model
for *priority* keywords, never temporal markers, so the keyword branch has
never fired in production — a test that only exercised it would pass against a
gate that still drops every real request.
"""

from unittest.mock import Mock

import pytest

from bunking.sync.bunk_request_processor.core.models import ParsedRequest, RequestType
from bunking.sync.bunk_request_processor.services.phase2_resolution_service import (
    LAST_YEAR_CONTEXT_PATTERNS,
    Phase2ResolutionService,
)

WIDENED_PHRASINGS = [
    "last year",
    "last summer",
    "previous year",
    "previous summer",
    "last yr",
]


def _service() -> Phase2ResolutionService:
    return Phase2ResolutionService(resolution_pipeline=Mock())


def _parsed(raw_text: str, keywords: list[str] | None = None) -> ParsedRequest:
    metadata: dict[str, object] = {}
    if keywords is not None:
        metadata["keywords_found"] = keywords
    return ParsedRequest(
        raw_text=raw_text,
        request_type=RequestType.BUNK_WITH,
        target_name="Emma",
        age_preference=None,
        source_field="bunk_request_form",
        confidence=0.8,
        csv_position=1,
        metadata=metadata,
    )


class TestRawTextBranchIsWidened:
    """The live branch. A gate widened only in the keyword list is a no-op."""

    @pytest.mark.parametrize("phrasing", WIDENED_PHRASINGS)
    def test_phrasing_in_raw_text_admits_the_request(self, phrasing):
        parsed = _parsed(f"Please put her with Emma from {phrasing}")

        assert _service()._has_last_year_context(parsed) is True

    @pytest.mark.parametrize("phrasing", WIDENED_PHRASINGS)
    def test_phrasing_is_matched_case_insensitively(self, phrasing):
        parsed = _parsed(f"Bunk with Emma from {phrasing.upper()}")

        assert _service()._has_last_year_context(parsed) is True

    @pytest.mark.parametrize(
        "text",
        [
            "Bunk with Emma",
            "She was in cabin 7 before",  # bare "before" must NOT admit
            "Bunk with Emma, she was here in 2024",  # a bare year must NOT admit
            "Emma had a great 2025",
        ],
    )
    def test_text_without_a_temporal_marker_is_not_admitted(self, text):
        """Over-widening is as much a defect as under-widening.

        Bare ``before`` and a bare year number appear in unrelated contexts, and
        the resolver only ever looks at ``year - 1`` anyway.
        """
        assert _service()._has_last_year_context(_parsed(text)) is False


class TestBothBranchesTestTheSamePatterns:
    """The two branches must not disagree about what counts as temporal context."""

    @pytest.mark.parametrize("pattern", LAST_YEAR_CONTEXT_PATTERNS)
    def test_pattern_admits_from_raw_text_alone(self, pattern):
        assert _service()._has_last_year_context(_parsed(f"bunk with Emma {pattern}")) is True

    @pytest.mark.parametrize("pattern", LAST_YEAR_CONTEXT_PATTERNS)
    def test_pattern_admits_from_keywords_alone(self, pattern):
        parsed = _parsed("bunk with Emma", keywords=[pattern])

        assert _service()._has_last_year_context(parsed) is True

    def test_from_before_is_carried_by_both_branches(self):
        """The asymmetry that existed: keywords admitted it, raw text did not."""
        assert "from before" in LAST_YEAR_CONTEXT_PATTERNS
        assert _service()._has_last_year_context(_parsed("bunk with Emma from before")) is True
        assert _service()._has_last_year_context(_parsed("bunk with Emma", keywords=["from before"])) is True

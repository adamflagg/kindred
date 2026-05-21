"""Tests for the is_first_requested helper and detect_first_request.

Replaces the previous PriorityCalculator's slot-0 selection logic with a
boolean producer signal. Only family BUNK_WITH requests can be first-pick;
other types/sources always return False.
"""

import pytest

from bunking.sync.bunk_request_processor.core.models import (
    AgePreference,
    ParsedRequest,
    RequestType,
)
from bunking.sync.bunk_request_processor.processing.first_request_detector import (
    detect_first_request,
    is_first_requested,
)
from bunking.sync.bunk_request_processor.shared.constants import SourceField


def _family_bunk_with(
    raw_text: str = "Emma Johnson",
    csv_position: int = 1,
) -> ParsedRequest:
    return ParsedRequest(
        raw_text=raw_text,
        request_type=RequestType.BUNK_WITH,
        target_name="Emma Johnson",
        age_preference=None,
        source_field=SourceField.BUNK_REQUEST_FORM,
        confidence=1.0,
        csv_position=csv_position,
        metadata={},
    )


class TestNoKeywordPath:
    """csv_position == 1 wins slot 0 when no request in the list has a keyword."""

    def test_first_position_no_keyword_anywhere(self) -> None:
        first = _family_bunk_with(raw_text="Emma Johnson", csv_position=1)
        second = _family_bunk_with(raw_text="Liam Garcia", csv_position=2)
        assert is_first_requested(first, [first, second]) is True
        assert is_first_requested(second, [first, second]) is False

    def test_second_position_no_keyword_anywhere(self) -> None:
        first = _family_bunk_with(raw_text="Emma Johnson", csv_position=1)
        second = _family_bunk_with(raw_text="Liam Garcia", csv_position=2)
        assert is_first_requested(second, [first, second]) is False


class TestKeywordPath:
    """A priority keyword promotes that specific request to first-pick, even
    if not at position 1, and demotes anyone else without a keyword."""

    def test_keyword_at_position_two_wins(self) -> None:
        first = _family_bunk_with(raw_text="Emma Johnson", csv_position=1)
        second = _family_bunk_with(raw_text="Liam Garcia must have", csv_position=2)
        assert is_first_requested(first, [first, second]) is False
        assert is_first_requested(second, [first, second]) is True

    def test_keyword_at_position_one_still_wins(self) -> None:
        first = _family_bunk_with(raw_text="Emma Johnson must have", csv_position=1)
        second = _family_bunk_with(raw_text="Liam Garcia", csv_position=2)
        assert is_first_requested(first, [first, second]) is True
        assert is_first_requested(second, [first, second]) is False

    def test_multiple_keyword_requests_all_first(self) -> None:
        # Two top picks named — both flagged. Intentional: parent saying
        # "must have Emma and Liam" reads as both being top picks.
        first = _family_bunk_with(raw_text="Emma Johnson must have", csv_position=1)
        second = _family_bunk_with(raw_text="Liam Garcia very important", csv_position=2)
        third = _family_bunk_with(raw_text="Olivia Chen", csv_position=3)
        assert is_first_requested(first, [first, second, third]) is True
        assert is_first_requested(second, [first, second, third]) is True
        assert is_first_requested(third, [first, second, third]) is False

    def test_keyword_case_insensitive(self) -> None:
        req = _family_bunk_with(raw_text="Emma Johnson MUST HAVE", csv_position=1)
        assert is_first_requested(req, [req]) is True

    @pytest.mark.parametrize(
        "keyword",
        [
            "must have",
            "very important",
            "top priority",
            "essential",
            "critical",
            "urgent",
            "first choice",
            "most important",
            "must be with",
            "#1",
            # OBR-validated additions
            "highest priority",
            "biggest request",
            "only request",
            "(priority)",
        ],
    )
    def test_all_priority_keywords_recognized(self, keyword: str) -> None:
        req = _family_bunk_with(raw_text=f"Emma Johnson {keyword}", csv_position=2)
        other = _family_bunk_with(raw_text="Liam Garcia", csv_position=1)
        assert is_first_requested(req, [req, other]) is True

    def test_allcaps_important_triggers(self) -> None:
        # IMPORTANT (all-caps) is a case-sensitive match: 7 occurrences in OBR corpus.
        req = _family_bunk_with(raw_text="Olivia Chen IMPORTANT", csv_position=2)
        other = _family_bunk_with(raw_text="Samuel Johnson", csv_position=1)
        assert is_first_requested(req, [req, other]) is True

    def test_allcaps_important_inline_triggers(self) -> None:
        # Mirrors real corpus pattern: "1) EMMA JOHNSON (highest priority) 2) Liam Garcia"
        req = _family_bunk_with(raw_text="1) Riley Sam IMPORTANT request 2) Liam Garcia", csv_position=2)
        other = _family_bunk_with(raw_text="Olivia Chen", csv_position=1)
        assert is_first_requested(req, [req, other]) is True


class TestNewKeywordsCaseInsensitive:
    """OBR-added keywords are matched case-insensitively (lowercased before scan)."""

    def test_highest_priority_uppercase(self) -> None:
        req = _family_bunk_with(raw_text="Emma Johnson (HIGHEST PRIORITY)", csv_position=2)
        other = _family_bunk_with(raw_text="Liam Garcia", csv_position=1)
        assert is_first_requested(req, [req, other]) is True

    def test_biggest_request_mixed_case(self) -> None:
        req = _family_bunk_with(raw_text="Her Biggest Request is Olivia Chen", csv_position=2)
        other = _family_bunk_with(raw_text="Riley Sam", csv_position=1)
        assert is_first_requested(req, [req, other]) is True

    def test_only_request_lowercase(self) -> None:
        req = _family_bunk_with(raw_text="our only request is Olivia Chen", csv_position=2)
        other = _family_bunk_with(raw_text="Emma Johnson", csv_position=1)
        assert is_first_requested(req, [req, other]) is True

    def test_priority_in_parens_inline(self) -> None:
        # Mirrors corpus: "1. Emma Johnson (priority) 2. Liam Garcia"
        req = _family_bunk_with(raw_text="1. Riley Sam (priority) 2. Samuel Johnson", csv_position=2)
        other = _family_bunk_with(raw_text="Liam Garcia", csv_position=1)
        assert is_first_requested(req, [req, other]) is True


class TestImportantCaseSensitivity:
    """IMPORTANT is case-sensitive: only the ALL-CAPS spelling triggers.
    Lowercase 'important' and mixed-case 'Important' must NOT trigger."""

    def test_lowercase_important_does_not_trigger(self) -> None:
        # "important" (lowercase) is a soft/common word — not a priority signal.
        req = _family_bunk_with(raw_text="it is important to Eliana that she be with her cousin", csv_position=2)
        other = _family_bunk_with(raw_text="Emma Johnson", csv_position=1)
        # No keyword → falls through to csv_position logic; position=2 → False.
        assert is_first_requested(req, [req, other]) is False

    def test_mixed_case_important_does_not_trigger(self) -> None:
        req = _family_bunk_with(raw_text="Liam Garcia Important", csv_position=2)
        other = _family_bunk_with(raw_text="Olivia Chen", csv_position=1)
        assert is_first_requested(req, [req, other]) is False

    def test_titlecase_important_does_not_trigger(self) -> None:
        req = _family_bunk_with(raw_text="Riley Sam - Important request", csv_position=2)
        other = _family_bunk_with(raw_text="Samuel Johnson", csv_position=1)
        assert is_first_requested(req, [req, other]) is False

    def test_unimportant_does_not_trigger(self) -> None:
        # "UNIMPORTANT" contains "IMPORTANT" as substring — must NOT trigger.
        req = _family_bunk_with(raw_text="Olivia Chen UNIMPORTANT stuff", csv_position=2)
        other = _family_bunk_with(raw_text="Emma Johnson", csv_position=1)
        assert is_first_requested(req, [req, other]) is False

    def test_importantly_does_not_trigger(self) -> None:
        # "IMPORTANTLY" contains "IMPORTANT" as substring — must NOT trigger.
        req = _family_bunk_with(raw_text="IMPORTANTLY, Liam Garcia", csv_position=2)
        other = _family_bunk_with(raw_text="Riley Sam", csv_position=1)
        assert is_first_requested(req, [req, other]) is False


class TestSoftMarkersExcluded:
    """Soft markers ('if possible', 'ideally', 'would prefer', 'hoping') are
    deliberately excluded — they signal flexibility, not urgency."""

    @pytest.mark.parametrize(
        "soft_phrase",
        [
            "if possible",
            "ideally",
            "would prefer",
            "hoping",
            "would love",
            "would be great",
        ],
    )
    def test_soft_marker_does_not_trigger(self, soft_phrase: str) -> None:
        req = _family_bunk_with(raw_text=f"Emma Johnson {soft_phrase}", csv_position=2)
        other = _family_bunk_with(raw_text="Liam Garcia", csv_position=1)
        # Soft marker present but no hard keyword → csv_position=2 → False.
        assert is_first_requested(req, [req, other]) is False


class TestNonFamilyBunkWithReturnsFalse:
    """Only family BUNK_WITH requests can be first-pick — every other
    type/source returns False regardless of position or keyword."""

    def test_not_bunk_with_returns_false(self) -> None:
        req = ParsedRequest(
            raw_text="Riley Sam must have",  # keyword present
            request_type=RequestType.NOT_BUNK_WITH,
            target_name="Riley Sam",
            age_preference=None,
            source_field=SourceField.BUNK_REQUEST_FORM,
            confidence=1.0,
            csv_position=1,  # first position
            metadata={},
        )
        assert is_first_requested(req, [req]) is False

    def test_age_preference_returns_false(self) -> None:
        req = ParsedRequest(
            raw_text="older",
            request_type=RequestType.AGE_PREFERENCE,
            target_name=None,
            age_preference=AgePreference.OLDER,
            source_field=SourceField.BUNK_REQUEST_FORM,
            confidence=1.0,
            csv_position=1,
            metadata={},
        )
        assert is_first_requested(req, [req]) is False

    def test_staff_not_bunk_with_returns_false(self) -> None:
        req = ParsedRequest(
            raw_text="Samuel Johnson",
            request_type=RequestType.NOT_BUNK_WITH,
            target_name="Samuel Johnson",
            age_preference=None,
            source_field=SourceField.STAFF_NOT_BUNK_WITH,
            confidence=1.0,
            csv_position=1,
            metadata={},
        )
        assert is_first_requested(req, [req]) is False

    def test_socialize_with_returns_false(self) -> None:
        req = ParsedRequest(
            raw_text="younger",
            request_type=RequestType.AGE_PREFERENCE,
            target_name=None,
            age_preference=AgePreference.YOUNGER,
            source_field=SourceField.SOCIALIZE_WITH,
            confidence=1.0,
            csv_position=1,
            metadata={},
        )
        assert is_first_requested(req, [req]) is False

    def test_internal_notes_returns_false(self) -> None:
        req = ParsedRequest(
            raw_text="Olivia Chen must have",
            request_type=RequestType.BUNK_WITH,
            target_name="Olivia Chen",
            age_preference=None,
            source_field=SourceField.INTERNAL_NOTES,
            confidence=1.0,
            csv_position=1,
            metadata={},
        )
        assert is_first_requested(req, [req]) is False


class TestEdgeCases:
    def test_solo_first_pick_is_first(self) -> None:
        # Only one bunk_with request — it's automatically the first pick.
        req = _family_bunk_with(raw_text="Emma Johnson", csv_position=1)
        assert is_first_requested(req, [req]) is True

    def test_solo_non_first_position_no_keyword_is_not_first(self) -> None:
        # csv_position=2 but no position-1 request in the list. This is a
        # malformed state but we follow the spec literally: position 1 wins,
        # otherwise the keyword path must trigger.
        req = _family_bunk_with(raw_text="Emma Johnson", csv_position=2)
        assert is_first_requested(req, [req]) is False

    def test_empty_raw_text_not_first(self) -> None:
        # No keyword possible on empty text; csv_position decides.
        req = _family_bunk_with(raw_text="", csv_position=2)
        first = _family_bunk_with(raw_text="Emma Johnson", csv_position=1)
        assert is_first_requested(req, [first, req]) is False

    def test_keyword_in_other_list_does_not_promote_this_one(self) -> None:
        # The keyword detection is scoped to family BUNK_WITH only. A staff
        # note containing "must have" should NOT prevent the family list's
        # first-by-position rule from firing.
        family_first = _family_bunk_with(raw_text="Emma Johnson", csv_position=1)
        family_second = _family_bunk_with(raw_text="Liam Garcia", csv_position=2)
        staff_note = ParsedRequest(
            raw_text="must have a quiet bunkmate",
            request_type=RequestType.BUNK_WITH,
            target_name="quiet bunkmate",
            age_preference=None,
            source_field=SourceField.INTERNAL_NOTES,
            confidence=1.0,
            csv_position=1,
            metadata={},
        )
        all_reqs = [family_first, family_second, staff_note]
        assert is_first_requested(family_first, all_reqs) is True
        assert is_first_requested(family_second, all_reqs) is False
        assert is_first_requested(staff_note, all_reqs) is False


# ---------------------------------------------------------------------------
# TG-3: detect_first_request — DetectionResult with priority_keyword_detected
# ---------------------------------------------------------------------------


def _make_parsed_request(
    raw_text: str = "bunk with Liam",
    csv_position: int = 1,
) -> ParsedRequest:
    """Family BUNK_WITH request factory for detect_first_request tests."""
    return ParsedRequest(
        raw_text=raw_text,
        request_type=RequestType.BUNK_WITH,
        target_name="Liam Garcia",
        age_preference=None,
        source_field=SourceField.BUNK_REQUEST_FORM,
        confidence=1.0,
        csv_position=csv_position,
        metadata={},
    )


def test_priority_keyword_detected_is_true_when_keyword_matches() -> None:
    """Explicit priority keyword at non-position-1 sets both flags True."""
    # csv_position=2 proves the boolean is keyword-driven, not positional
    parsed = _make_parsed_request(
        raw_text="Liam is our top priority",
        csv_position=2,
    )
    result = detect_first_request(parsed, family_siblings=[])
    assert result.is_first_requested is True
    assert result.priority_keyword_detected is True


def test_priority_keyword_detected_is_false_for_positional_fallback() -> None:
    """No keyword present → positional fallback; priority_keyword_detected must be False."""
    parsed = _make_parsed_request(
        raw_text="bunk with Olivia Chen",  # no priority keyword
        csv_position=1,  # positional fallback fires
    )
    result = detect_first_request(parsed, family_siblings=[])
    assert result.is_first_requested is True
    assert result.priority_keyword_detected is False


def test_priority_keyword_detected_is_false_when_sibling_outscores() -> None:
    """Sibling has keyword → this row loses; priority_keyword_detected must be False."""
    parsed = _make_parsed_request(raw_text="bunk with Riley Sam", csv_position=1)
    sibling = _make_parsed_request(raw_text="MUST HAVE Samuel Johnson", csv_position=2)
    result = detect_first_request(parsed, family_siblings=[sibling])
    assert result.is_first_requested is False  # sibling's keyword wins
    assert result.priority_keyword_detected is False  # this row has no keyword


# ---------------------------------------------------------------------------
# Fix 2: detect_first_request early-return paths (non-BUNK_REQUEST_FORM source
# and non-BUNK_WITH request type)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "override",
    [
        {"source_field": SourceField.BUNKING_NOTES},
        {"source_field": SourceField.INTERNAL_NOTES},
        {"source_field": SourceField.STAFF_NOT_BUNK_WITH},
    ],
)
def test_detect_first_request_non_bunk_request_form_source_returns_false(
    override: dict[str, object],
) -> None:
    """Non-BUNK_REQUEST_FORM source always returns (False, False) early."""
    parsed = ParsedRequest(
        raw_text="MUST HAVE Emma Johnson",
        request_type=RequestType.BUNK_WITH,
        target_name="Emma Johnson",
        age_preference=None,
        source_field=override["source_field"],  # type: ignore[arg-type]
        confidence=1.0,
        csv_position=1,
        metadata={},
    )
    result = detect_first_request(parsed, family_siblings=[])
    assert result.is_first_requested is False
    assert result.priority_keyword_detected is False


def test_detect_first_request_non_bunk_with_request_type_returns_false() -> None:
    """Non-BUNK_WITH request type always returns (False, False) early."""
    parsed = ParsedRequest(
        raw_text="MUST HAVE Liam Garcia",
        request_type=RequestType.AGE_PREFERENCE,
        target_name=None,
        age_preference=None,
        source_field=SourceField.BUNK_REQUEST_FORM,
        confidence=1.0,
        csv_position=1,
        metadata={},
    )
    result = detect_first_request(parsed, family_siblings=[])
    assert result.is_first_requested is False
    assert result.priority_keyword_detected is False


# ---------------------------------------------------------------------------
# Fix 3: detect_first_request when BOTH parsed and a sibling have a priority
# keyword — own keyword fires first, result is (True, True)
# ---------------------------------------------------------------------------


def test_detect_first_request_own_keyword_wins_over_sibling_keyword() -> None:
    """Both rows have a priority keyword; own keyword fires first → (True, True)."""
    parsed = _make_parsed_request(raw_text="MUST HAVE Olivia Chen", csv_position=2)
    sibling = _make_parsed_request(raw_text="top priority Liam Garcia", csv_position=1)
    result = detect_first_request(parsed, family_siblings=[sibling])
    assert result.is_first_requested is True
    assert result.priority_keyword_detected is True

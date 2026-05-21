"""Tests for BaseMatchStrategy shared functionality.

After the AI Config (Unified) Phase 2 cleanup, BaseMatchStrategy no longer
takes a `config` arg — session-adjustment values are class attributes on the
subclasses (Fuzzy / Phonetic), with the base class providing defaults.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import pytest

# Add the parent directory to the path
test_dir = Path(__file__).resolve().parent
project_root = test_dir.parent.parent.parent.parent.parent
sys.path.insert(0, str(project_root))

from bunking.sync.bunk_request_processor.core.models import Person
from bunking.sync.bunk_request_processor.resolution.interfaces import ResolutionResult


def create_concrete_strategy():
    """Create a concrete subclass of BaseMatchStrategy for testing."""
    from bunking.sync.bunk_request_processor.resolution.strategies.base_match_strategy import (
        BaseMatchStrategy,
    )

    class ConcreteMatchStrategy(BaseMatchStrategy):
        """Concrete implementation for testing base class methods."""

        def resolve(
            self,
            name,
            requester_cm_id,
            session_cm_id=None,
            year=None,
            candidates=None,
            attendee_info=None,
            all_persons=None,
        ):
            """Dummy resolve implementation - not used in base class tests."""
            return ResolutionResult(confidence=0.0, method=self.name)

    from unittest.mock import Mock

    mock_person_repo = Mock()
    mock_attendee_repo = Mock()
    return ConcreteMatchStrategy(mock_person_repo, mock_attendee_repo)


class TestBaseMatchStrategyFilterSelfReferences:
    """Test _filter_self_references method"""

    @pytest.fixture
    def base_strategy(self):
        return create_concrete_strategy()

    def test_filters_out_requester_from_matches(self, base_strategy):
        """Should remove the requester from the matches list"""
        requester_cm_id = 12345
        matches = [
            Person(cm_id=12345, first_name="John", last_name="Smith"),
            Person(cm_id=67890, first_name="Jane", last_name="Doe"),
            Person(cm_id=11111, first_name="Bob", last_name="Wilson"),
        ]

        result = base_strategy._filter_self_references(matches, requester_cm_id)

        assert len(result) == 2
        assert all(p.cm_id != requester_cm_id for p in result)
        assert result[0].cm_id == 67890
        assert result[1].cm_id == 11111

    def test_returns_empty_list_when_only_requester_matches(self, base_strategy):
        """Should return empty list if only match is the requester"""
        requester_cm_id = 12345
        matches = [Person(cm_id=12345, first_name="John", last_name="Smith")]

        result = base_strategy._filter_self_references(matches, requester_cm_id)

        assert result == []

    def test_returns_all_when_requester_not_in_matches(self, base_strategy):
        """Should return all matches when requester is not in list"""
        requester_cm_id = 99999
        matches = [
            Person(cm_id=12345, first_name="John", last_name="Smith"),
            Person(cm_id=67890, first_name="Jane", last_name="Doe"),
        ]

        result = base_strategy._filter_self_references(matches, requester_cm_id)

        assert len(result) == 2

    def test_handles_empty_matches_list(self, base_strategy):
        """Should handle empty matches list gracefully"""
        result = base_strategy._filter_self_references([], 12345)

        assert result == []


class TestBaseMatchStrategyApplySessionAdjustment:
    """Test _apply_session_adjustment uses class-attribute defaults.

    Base class defaults: same_session_boost=0.05, different_session_penalty=-0.10,
    not_enrolled_penalty=-0.05. Subclasses (Fuzzy / Phonetic) override.
    """

    @pytest.fixture
    def base_strategy(self):
        return create_concrete_strategy()

    def test_boosts_confidence_for_same_session(self, base_strategy):
        """Should boost confidence when person is in same session"""
        person = Person(cm_id=12345, first_name="John", last_name="Smith")
        session_cm_id = 1000002
        attendee_info = {12345: {"session_cm_id": 1000002}}

        result = base_strategy._apply_session_adjustment(
            base_confidence=0.70,
            person=person,
            session_cm_id=session_cm_id,
            attendee_info=attendee_info,
        )

        assert result == pytest.approx(0.75)  # 0.70 + 0.05 boost (base default)

    def test_penalizes_confidence_for_different_session(self, base_strategy):
        """Should penalize confidence when person is in different session"""
        person = Person(cm_id=12345, first_name="John", last_name="Smith")
        session_cm_id = 1000002
        attendee_info = {12345: {"session_cm_id": 1000003}}  # Different session

        result = base_strategy._apply_session_adjustment(
            base_confidence=0.70,
            person=person,
            session_cm_id=session_cm_id,
            attendee_info=attendee_info,
        )

        assert result == pytest.approx(0.60)  # 0.70 - 0.10 penalty (base default)

    def test_slight_penalty_when_no_session_info(self, base_strategy):
        """Should apply slight penalty when person not in attendee_info"""
        person = Person(cm_id=12345, first_name="John", last_name="Smith")
        session_cm_id = 1000002
        attendee_info: dict[int, Any] = {}  # Person not in attendee info

        result = base_strategy._apply_session_adjustment(
            base_confidence=0.70,
            person=person,
            session_cm_id=session_cm_id,
            attendee_info=attendee_info,
        )

        assert result == pytest.approx(0.65)  # 0.70 - 0.05 not-enrolled penalty

    def test_slight_penalty_when_attendee_info_is_none(self, base_strategy):
        """Should apply slight penalty when attendee_info is None"""
        person = Person(cm_id=12345, first_name="John", last_name="Smith")

        result = base_strategy._apply_session_adjustment(
            base_confidence=0.70,
            person=person,
            session_cm_id=1000002,
            attendee_info=None,
        )

        assert result == pytest.approx(0.65)

    def test_slight_penalty_when_no_session_cm_id(self, base_strategy):
        """Should apply slight penalty when session_cm_id is None"""
        person = Person(cm_id=12345, first_name="John", last_name="Smith")
        attendee_info = {12345: {"session_cm_id": 1000002}}

        result = base_strategy._apply_session_adjustment(
            base_confidence=0.70,
            person=person,
            session_cm_id=None,
            attendee_info=attendee_info,
        )

        assert result == pytest.approx(0.65)


class TestBaseMatchStrategyBuildAmbiguousResult:
    """Test _build_ambiguous_result method"""

    @pytest.fixture
    def base_strategy(self):
        strategy = create_concrete_strategy()
        strategy._strategy_name = "test_strategy"
        return strategy

    def test_creates_result_with_candidates(self, base_strategy):
        """Should create ResolutionResult with candidates"""
        candidates = [
            Person(cm_id=12345, first_name="John", last_name="Smith"),
            Person(cm_id=67890, first_name="John", last_name="Smythe"),
        ]

        result = base_strategy._build_ambiguous_result(
            matches=candidates,
            confidence=0.4,
            reason="multiple_matches",
        )

        assert not result.is_resolved
        assert result.is_ambiguous
        assert len(result.candidates) == 2
        assert result.confidence == 0.4
        assert result.metadata.get("ambiguity_reason") == "multiple_matches"
        assert result.metadata.get("match_count") == 2

    def test_includes_extra_metadata(self, base_strategy):
        """Should include extra_metadata in result"""
        candidates = [Person(cm_id=12345, first_name="John", last_name="Smith")]

        result = base_strategy._build_ambiguous_result(
            matches=candidates,
            confidence=0.5,
            reason="unclear_match",
            extra_metadata={"algorithm": "soundex", "variant": "Smith"},
        )

        assert result.metadata.get("algorithm") == "soundex"
        assert result.metadata.get("variant") == "Smith"
        assert result.metadata.get("ambiguity_reason") == "unclear_match"

    def test_sets_strategy_name_as_method(self, base_strategy):
        """Should set the strategy name as the method"""
        candidates = [Person(cm_id=12345, first_name="John", last_name="Smith")]

        result = base_strategy._build_ambiguous_result(
            matches=candidates,
            confidence=0.4,
            reason="test_reason",
        )

        assert result.method == "test_strategy"


class TestIsExactOrCloseFirstName:
    """Gate helper for first-name-only auto-resolve decisions."""

    def test_exact_first_name_match_case_insensitive(self):
        from bunking.sync.bunk_request_processor.resolution.strategies.base_match_strategy import (
            _is_exact_or_close_first_name,
        )

        assert _is_exact_or_close_first_name("Liam", "Liam", None) is True
        assert _is_exact_or_close_first_name("liam", "LIAM", None) is True

    def test_exact_preferred_name_match(self):
        from bunking.sync.bunk_request_processor.resolution.strategies.base_match_strategy import (
            _is_exact_or_close_first_name,
        )

        # Madison "Maddie" — target "Maddie" matches preferred, not first
        assert _is_exact_or_close_first_name("Maddie", "Madison", "Maddie") is True

    def test_close_spelling_via_jaro_winkler_passes(self):
        from bunking.sync.bunk_request_processor.resolution.strategies.base_match_strategy import (
            _is_exact_or_close_first_name,
        )

        # Cathryn vs Catherine — JW similarity ~0.905 (just above the 0.90 gate)
        assert _is_exact_or_close_first_name("Cathryn", "Catherine", None) is True

    def test_distant_nickname_form_mismatch_fails(self):
        from bunking.sync.bunk_request_processor.resolution.strategies.base_match_strategy import (
            _is_exact_or_close_first_name,
        )

        # Bobby vs Robert — completely different string, JW ~0.41
        assert _is_exact_or_close_first_name("Bobby", "Robert", None) is False

    def test_distant_nickname_form_mismatch_fails_against_preferred_too(self):
        from bunking.sync.bunk_request_processor.resolution.strategies.base_match_strategy import (
            _is_exact_or_close_first_name,
        )

        # Jo vs Josephine — JW ~0.79, still below 0.90 gate
        assert _is_exact_or_close_first_name("Jo", "Josephine", "Josephine") is False

    def test_close_spelling_against_preferred(self):
        from bunking.sync.bunk_request_processor.resolution.strategies.base_match_strategy import (
            _is_exact_or_close_first_name,
        )

        # Target close to preferred (JW("Liz", "Lizzy") ~0.906, passes gate)
        assert _is_exact_or_close_first_name("Liz", "Elizabeth", "Lizzy") is True

    def test_empty_target_fails(self):
        from bunking.sync.bunk_request_processor.resolution.strategies.base_match_strategy import (
            _is_exact_or_close_first_name,
        )

        assert _is_exact_or_close_first_name("", "Liam", None) is False

    def test_empty_candidate_first_fails(self):
        from bunking.sync.bunk_request_processor.resolution.strategies.base_match_strategy import (
            _is_exact_or_close_first_name,
        )

        assert _is_exact_or_close_first_name("Liam", "", None) is False

    def test_empty_candidate_first_with_matching_preferred_passes(self):
        from bunking.sync.bunk_request_processor.resolution.strategies.base_match_strategy import (
            _is_exact_or_close_first_name,
        )

        assert _is_exact_or_close_first_name("Liam", "", "Liam") is True

    def test_empty_candidate_first_with_close_preferred_passes(self):
        from bunking.sync.bunk_request_processor.resolution.strategies.base_match_strategy import (
            _is_exact_or_close_first_name,
        )

        # JW("Cathryn","Catherine") ~0.905 — close-spelling against preferred
        # when first_name is empty must still pass.
        assert _is_exact_or_close_first_name("Cathryn", "", "Catherine") is True

    def test_none_preferred_handled(self):
        from bunking.sync.bunk_request_processor.resolution.strategies.base_match_strategy import (
            _is_exact_or_close_first_name,
        )

        assert _is_exact_or_close_first_name("Liam", "Liam", None) is True


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

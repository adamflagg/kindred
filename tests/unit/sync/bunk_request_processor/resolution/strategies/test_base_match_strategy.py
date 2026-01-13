"""Test-Driven Development for BaseMatchStrategy

Tests the shared base class functionality for name resolution strategies.
These tests are written BEFORE implementation per TDD methodology."""

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


def create_concrete_strategy(config=None):
    """Create a concrete subclass of BaseMatchStrategy for testing."""
    from bunking.sync.bunk_request_processor.resolution.strategies.base_match_strategy import (
        BaseMatchStrategy,
    )

    class ConcreteMatchStrategy(BaseMatchStrategy):
        """Concrete implementation for testing base class methods."""

        def resolve(self, name, requester_cm_id, session_cm_id=None, year=None):
            """Dummy resolve implementation - not used in base class tests."""
            return ResolutionResult(confidence=0.0, method=self.name)

    from unittest.mock import Mock

    mock_person_repo = Mock()
    mock_attendee_repo = Mock()
    return ConcreteMatchStrategy(mock_person_repo, mock_attendee_repo, config or {})


class TestBaseMatchStrategyFilterSelfReferences:
    """Test _filter_self_references method"""

    @pytest.fixture
    def base_strategy(self):
        """Create a BaseMatchStrategy with minimal config"""
        return create_concrete_strategy(config={})

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


class TestBaseMatchStrategyDisambiguateWithSessionContext:
    """Test _disambiguate_with_session_context method"""

    @pytest.fixture
    def base_strategy(self):
        """Create a BaseMatchStrategy with session_match confidence config"""
        return create_concrete_strategy(config={"session_match": 0.85})

    def test_resolves_single_match_in_same_session(self, base_strategy):
        """Should resolve when exactly one candidate is in same session"""
        matches = [
            Person(cm_id=12345, first_name="John", last_name="Smith"),
            Person(cm_id=67890, first_name="John", last_name="Smythe"),
        ]
        session_cm_id = 1000002
        attendee_info = {
            12345: {"session_cm_id": 1000002},  # Same session
            67890: {"session_cm_id": 1000003},  # Different session
        }

        result = base_strategy._disambiguate_with_session_context(
            matches=matches,
            requester_cm_id=99999,
            session_cm_id=session_cm_id,
            year=2025,
            attendee_info=attendee_info,
        )

        assert result.is_resolved
        assert result.person.cm_id == 12345
        assert result.confidence == 0.85  # From config
        assert result.metadata.get("session_match") == "exact"

    def test_returns_unresolved_when_multiple_in_same_session(self, base_strategy):
        """Should return unresolved when multiple candidates in same session"""
        matches = [
            Person(cm_id=12345, first_name="John", last_name="Smith"),
            Person(cm_id=67890, first_name="John", last_name="Smythe"),
        ]
        session_cm_id = 1000002
        attendee_info = {
            12345: {"session_cm_id": 1000002},  # Same session
            67890: {"session_cm_id": 1000002},  # Also same session
        }

        result = base_strategy._disambiguate_with_session_context(
            matches=matches,
            requester_cm_id=99999,
            session_cm_id=session_cm_id,
            year=2025,
            attendee_info=attendee_info,
        )

        assert not result.is_resolved
        assert result.confidence == 0.0

    def test_returns_unresolved_when_none_in_same_session(self, base_strategy):
        """Should return unresolved when no candidates in same session"""
        matches = [
            Person(cm_id=12345, first_name="John", last_name="Smith"),
            Person(cm_id=67890, first_name="John", last_name="Smythe"),
        ]
        session_cm_id = 1000002
        attendee_info = {
            12345: {"session_cm_id": 1000003},  # Different session
            67890: {"session_cm_id": 1000004},  # Also different session
        }

        result = base_strategy._disambiguate_with_session_context(
            matches=matches,
            requester_cm_id=99999,
            session_cm_id=session_cm_id,
            year=2025,
            attendee_info=attendee_info,
        )

        assert not result.is_resolved
        assert result.confidence == 0.0

    def test_handles_missing_attendee_info(self, base_strategy):
        """Should handle None attendee_info gracefully"""
        matches = [Person(cm_id=12345, first_name="John", last_name="Smith")]

        result = base_strategy._disambiguate_with_session_context(
            matches=matches,
            requester_cm_id=99999,
            session_cm_id=1000002,
            year=2025,
            attendee_info=None,
        )

        assert not result.is_resolved
        assert result.confidence == 0.0


class TestBaseMatchStrategyCalculateBaseConfidence:
    """Test _calculate_base_confidence method"""

    @pytest.fixture
    def base_strategy(self):
        """Create a BaseMatchStrategy with various confidence config values"""
        config = {
            "nickname_base": 0.85,
            "normalized_base": 0.80,
            "soundex_base": 0.70,
            "metaphone_base": 0.65,
            "default_base": 0.75,
        }
        return create_concrete_strategy(config=config)

    def test_returns_configured_value_for_known_match_type(self, base_strategy):
        """Should return config value for known match types"""
        assert base_strategy._calculate_base_confidence("nickname") == 0.85
        assert base_strategy._calculate_base_confidence("normalized") == 0.80
        assert base_strategy._calculate_base_confidence("soundex") == 0.70
        assert base_strategy._calculate_base_confidence("metaphone") == 0.65

    def test_returns_default_for_unknown_match_type(self, base_strategy):
        """Should return default_base for unknown match types"""
        assert base_strategy._calculate_base_confidence("unknown_type") == 0.75
        assert base_strategy._calculate_base_confidence("") == 0.75

    def test_uses_fallback_when_config_missing(self):
        """Should use hardcoded fallback when config key is missing"""
        strategy = create_concrete_strategy(config={})  # Empty config

        # Should use fallback value (0.75) when config is empty
        result = strategy._calculate_base_confidence("nickname")
        assert result == 0.75  # Default fallback


class TestBaseMatchStrategyApplySessionAdjustment:
    """Test _apply_session_adjustment method"""

    @pytest.fixture
    def base_strategy(self):
        """Create a BaseMatchStrategy with session adjustment config"""
        config = {
            "same_session_boost": 0.05,
            "different_session_penalty": -0.20,
            "no_session_penalty": -0.05,
        }
        return create_concrete_strategy(config=config)

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

        assert result == pytest.approx(0.75)  # 0.70 + 0.05 boost

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

        assert result == pytest.approx(0.50)  # 0.70 - 0.20 penalty

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

        assert result == pytest.approx(0.65)  # 0.70 - 0.05 penalty

    def test_slight_penalty_when_attendee_info_is_none(self, base_strategy):
        """Should apply slight penalty when attendee_info is None"""
        person = Person(cm_id=12345, first_name="John", last_name="Smith")

        result = base_strategy._apply_session_adjustment(
            base_confidence=0.70,
            person=person,
            session_cm_id=1000002,
            attendee_info=None,
        )

        assert result == pytest.approx(0.65)  # 0.70 - 0.05 penalty

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

        assert result == pytest.approx(0.65)  # 0.70 - 0.05 penalty


class TestBaseMatchStrategyBuildAmbiguousResult:
    """Test _build_ambiguous_result method"""

    @pytest.fixture
    def base_strategy(self):
        """Create a BaseMatchStrategy"""
        strategy = create_concrete_strategy(config={})
        # Set a strategy name for testing
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


class TestBaseMatchStrategyIntegration:
    """Integration tests for BaseMatchStrategy"""

    @pytest.fixture
    def full_config(self):
        """Return a complete config with all values"""
        return {
            "nickname_base": 0.85,
            "spelling_base": 0.85,
            "normalized_base": 0.80,
            "soundex_base": 0.70,
            "metaphone_base": 0.65,
            "default_base": 0.75,
            "session_match": 0.85,
            "same_session_boost": 0.05,
            "different_session_penalty": -0.20,
            "no_session_penalty": -0.05,
        }

    @pytest.fixture
    def base_strategy(self, full_config):
        """Create a fully configured BaseMatchStrategy"""
        return create_concrete_strategy(config=full_config)

    def test_confidence_calculation_workflow(self, base_strategy):
        """Test full workflow: base confidence + session adjustment"""
        person = Person(cm_id=12345, first_name="John", last_name="Smith")
        attendee_info = {12345: {"session_cm_id": 1000002}}

        # Get base confidence for nickname match
        base = base_strategy._calculate_base_confidence("nickname")
        assert base == 0.85

        # Apply session adjustment (same session)
        adjusted = base_strategy._apply_session_adjustment(
            base_confidence=base,
            person=person,
            session_cm_id=1000002,
            attendee_info=attendee_info,
        )
        assert adjusted == pytest.approx(0.90)  # 0.85 + 0.05 boost

    def test_filter_then_disambiguate_workflow(self, base_strategy):
        """Test workflow: filter self, then disambiguate"""
        requester_cm_id = 99999
        session_cm_id = 1000002
        matches = [
            Person(cm_id=99999, first_name="Self", last_name="Requester"),
            Person(cm_id=12345, first_name="John", last_name="Smith"),
            Person(cm_id=67890, first_name="John", last_name="Smythe"),
        ]
        attendee_info = {
            12345: {"session_cm_id": 1000002},  # Same session
            67890: {"session_cm_id": 1000003},  # Different session
        }

        # Filter out self
        filtered = base_strategy._filter_self_references(matches, requester_cm_id)
        assert len(filtered) == 2

        # Disambiguate by session
        result = base_strategy._disambiguate_with_session_context(
            matches=filtered,
            requester_cm_id=requester_cm_id,
            session_cm_id=session_cm_id,
            year=2025,
            attendee_info=attendee_info,
        )

        assert result.is_resolved
        assert result.person.cm_id == 12345


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

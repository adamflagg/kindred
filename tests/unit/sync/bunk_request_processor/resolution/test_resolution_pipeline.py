"""Test-Driven Development for ResolutionPipeline

Tests the orchestration of multiple resolution strategies."""

import sys
from pathlib import Path
from unittest.mock import Mock

import pytest

# Add the parent directory to the path
test_dir = Path(__file__).resolve().parent
project_root = test_dir.parent.parent.parent.parent
sys.path.insert(0, str(project_root))

from bunking.sync.bunk_request_processor.core.models import Person
from bunking.sync.bunk_request_processor.resolution.interfaces import ResolutionResult, ResolutionStrategy
from bunking.sync.bunk_request_processor.resolution.resolution_pipeline import ResolutionPipeline


class MockStrategy(ResolutionStrategy):
    """Mock strategy for testing"""

    def __init__(self, name: str, result: ResolutionResult):
        self._name = name
        self._result = result

    def resolve(
        self, name: str, requester_cm_id: int, session_cm_id: int | None = None, year: int | None = None
    ) -> ResolutionResult:
        return self._result

    @property
    def name(self) -> str:
        return self._name


class TestResolutionPipeline:
    """Test the ResolutionPipeline orchestration"""

    @pytest.fixture
    def mock_repositories(self):
        """Create mock repositories"""
        mock_person_repo = Mock()
        mock_attendee_repo = Mock()
        return mock_person_repo, mock_attendee_repo

    @pytest.fixture
    def pipeline(self, mock_repositories):
        """Create a ResolutionPipeline with mocked dependencies"""
        person_repo, attendee_repo = mock_repositories
        # Mock attendee repo to return None by default (no session found)
        attendee_repo.get_by_person_and_year.return_value = None
        return ResolutionPipeline(person_repo, attendee_repo)

    def test_single_strategy_success(self, pipeline):
        """Test pipeline with single successful strategy"""
        # Create a successful resolution
        person = Person(cm_id=12345, first_name="John", last_name="Doe")
        result = ResolutionResult(person=person, confidence=0.95, method="exact_match")

        # Add mock strategy
        strategy = MockStrategy("exact", result)
        pipeline.add_strategy(strategy)

        # Test resolution
        final_result = pipeline.resolve("John Doe", requester_cm_id=67890, year=2025)

        assert final_result.is_resolved
        assert final_result.person.cm_id == 12345
        assert final_result.confidence == 0.95
        assert final_result.method == "exact_match"

    def test_fallback_to_second_strategy(self, pipeline):
        """Test pipeline falls back when first strategy fails"""
        # First strategy fails
        fail_result = ResolutionResult(confidence=0.0, method="exact_match")

        # Second strategy succeeds
        person = Person(cm_id=12345, first_name="John", last_name="Doe")
        success_result = ResolutionResult(person=person, confidence=0.85, method="fuzzy_match")

        # Add strategies
        pipeline.add_strategy(MockStrategy("exact", fail_result))
        pipeline.add_strategy(MockStrategy("fuzzy", success_result))

        # Test resolution
        final_result = pipeline.resolve("John Doe", requester_cm_id=67890, year=2025)

        assert final_result.is_resolved
        assert final_result.person.cm_id == 12345
        assert final_result.confidence == 0.85
        assert final_result.method == "fuzzy_match"

    def test_all_strategies_fail(self, pipeline):
        """Test when all strategies fail to resolve"""
        # Both strategies fail
        fail1 = ResolutionResult(confidence=0.0, method="exact_match")
        fail2 = ResolutionResult(confidence=0.0, method="fuzzy_match")

        pipeline.add_strategy(MockStrategy("exact", fail1))
        pipeline.add_strategy(MockStrategy("fuzzy", fail2))

        # Test resolution
        final_result = pipeline.resolve("Unknown Person", requester_cm_id=67890, year=2025)

        assert not final_result.is_resolved
        assert final_result.person is None
        assert final_result.confidence == 0.0

    def test_ambiguous_result_handling(self, pipeline):
        """Test handling of ambiguous results with multiple candidates"""
        # Create multiple candidates
        candidates = [
            Person(cm_id=12345, first_name="John", last_name="Smith"),
            Person(cm_id=67890, first_name="John", last_name="Smith"),
        ]

        ambiguous_result = ResolutionResult(
            candidates=candidates,
            confidence=0.5,
            method="exact_match",
            metadata={"ambiguity_reason": "multiple_matches"},
        )

        pipeline.add_strategy(MockStrategy("exact", ambiguous_result))

        # Test resolution
        final_result = pipeline.resolve("John Smith", requester_cm_id=11111, year=2025)

        assert not final_result.is_resolved
        assert final_result.is_ambiguous
        assert len(final_result.candidates) == 2
        assert final_result.metadata["ambiguity_reason"] == "multiple_matches"

    def test_confidence_threshold(self, pipeline):
        """Test minimum confidence threshold"""
        # Low confidence result
        person = Person(cm_id=12345, first_name="John", last_name="Doe")
        low_conf_result = ResolutionResult(person=person, confidence=0.4, method="fuzzy_match")

        pipeline.add_strategy(MockStrategy("fuzzy", low_conf_result))
        pipeline.set_minimum_confidence(0.6)

        # Test resolution
        final_result = pipeline.resolve("John Doe", requester_cm_id=67890, year=2025)

        # Should not be considered resolved due to low confidence
        assert not final_result.is_resolved
        assert final_result.needs_review

    def test_cache_integration(self, pipeline, mock_repositories):
        """Test that pipeline uses cache when available"""
        person_repo, _ = mock_repositories

        # Mock cache
        mock_cache = Mock()
        pipeline.set_cache(mock_cache)

        # Cache hit - use the actual method name from ResolutionPipeline
        cached_person = Person(cm_id=12345, first_name="John", last_name="Doe")
        cached_result = ResolutionResult(person=cached_person, confidence=0.95, method="cache")
        mock_cache.get_cached_resolution.return_value = cached_result

        # Test resolution
        final_result = pipeline.resolve("John Doe", requester_cm_id=67890, year=2025)

        assert final_result.is_resolved
        assert final_result.person.cm_id == 12345
        assert final_result.method == "cache"

        # Verify cache was checked
        mock_cache.get_cached_resolution.assert_called_once()

    def test_session_context_passed_to_strategies(self, pipeline, mock_repositories):
        """Test that session context is passed through to strategies"""
        _, attendee_repo = mock_repositories

        # Mock getting session for requester
        attendee_repo.get_by_person_and_year.return_value = {
            "person_cm_id": 67890,
            "session_cm_id": 1000002,
            "year": 2025,
        }

        # Create mock strategy that tracks calls
        mock_strategy = Mock(spec=ResolutionStrategy)
        mock_strategy.name = "test"
        mock_strategy.resolve.return_value = ResolutionResult()

        pipeline.add_strategy(mock_strategy)

        # Test resolution
        pipeline.resolve("John Doe", requester_cm_id=67890, year=2025)

        # Verify strategy was called with session context
        mock_strategy.resolve.assert_called_once_with(
            name="John Doe", requester_cm_id=67890, session_cm_id=1000002, year=2025
        )

    def test_strategy_ordering(self, pipeline):
        """Test that strategies are tried in order"""
        call_order = []

        def make_strategy(name: str, success: bool) -> Mock:
            strategy = Mock(spec=ResolutionStrategy)
            strategy.name = name

            def resolve(*args, **kwargs):
                call_order.append(name)
                if success:
                    return ResolutionResult(
                        person=Person(cm_id=12345, first_name="Test", last_name="User"), confidence=0.9, method=name
                    )
                return ResolutionResult()

            strategy.resolve = resolve
            return strategy

        # Add strategies in specific order
        pipeline.add_strategy(make_strategy("exact", False))
        pipeline.add_strategy(make_strategy("fuzzy", False))
        pipeline.add_strategy(make_strategy("phonetic", True))
        pipeline.add_strategy(make_strategy("ai", False))  # Should not be called

        # Test resolution
        result = pipeline.resolve("Test User", requester_cm_id=67890, year=2025)

        # Verify order and early termination
        assert call_order == ["exact", "fuzzy", "phonetic"]
        assert result.method == "phonetic"


class TestBatchResolveFirstNameInitialPattern:
    """Test that batch_resolve handles 'FirstName Initial' patterns (e.g., 'Joe C').

    - Detects when second part is a single character (initial)
    - Gets candidates by first name only
    - Filters by last_name[0].upper() == initial
    """

    @pytest.fixture
    def mock_repositories(self):
        """Create mock repositories"""
        mock_person_repo = Mock()
        mock_attendee_repo = Mock()
        return mock_person_repo, mock_attendee_repo

    @pytest.fixture
    def pipeline(self, mock_repositories):
        """Create a ResolutionPipeline with mocked dependencies"""
        person_repo, attendee_repo = mock_repositories
        # Mock attendee repo to return empty dict for bulk_get_sessions_for_persons
        attendee_repo.bulk_get_sessions_for_persons.return_value = {}
        # Mock person repo's phonetic matching to return empty list by default
        person_repo.get_all_for_phonetic_matching.return_value = []
        return ResolutionPipeline(person_repo, attendee_repo)

    def test_first_name_initial_pattern_resolves_single_match(self, pipeline, mock_repositories):
        """Verify 'Joe C' resolves to 'Joe Carter' when it's the only Joe with last name starting with C.

        This is the core bug: modular code passes 'Joe C' as find_by_name('Joe', 'C')
        which won't match. It should detect single-char second part as an initial and
        filter candidates where last_name[0].upper() == 'C'.
        """
        person_repo, _ = mock_repositories

        # Setup: Multiple people named Joe with different last names
        joe_carter = Person(cm_id=11111, first_name="Joe", last_name="Carter")
        joe_smith = Person(cm_id=22222, first_name="Joe", last_name="Smith")
        joe_brown = Person(cm_id=33333, first_name="Joe", last_name="Brown")

        # find_by_name("Joe", "C") should return nothing (no last name "C")
        # but find_by_first_name("Joe") should return all Joes
        person_repo.find_by_name.return_value = []  # No match for "Joe C" as literal
        person_repo.find_by_first_name.return_value = [joe_carter, joe_smith, joe_brown]

        # Add a mock strategy that returns the candidates it receives
        class CandidateCapturingStrategy(ResolutionStrategy):
            def __init__(self):
                self.captured_candidates = None

            @property
            def name(self):
                return "capturing"

            def resolve(self, name, requester_cm_id, session_cm_id=None, year=None):
                return ResolutionResult()

            def resolve_with_context(  # type: ignore[override]
                self, name, requester_cm_id, session_cm_id, year, candidates, attendee_info, all_persons=None
            ):
                self.captured_candidates = candidates
                # If we got exactly one candidate, return it as resolved
                if candidates and len(candidates) == 1:
                    return ResolutionResult(person=candidates[0], confidence=0.90, method="first_name_initial")
                elif candidates and len(candidates) > 1:
                    return ResolutionResult(candidates=candidates, confidence=0.5, method="first_name_initial")
                return ResolutionResult()

        strategy = CandidateCapturingStrategy()
        pipeline.add_strategy(strategy)

        # Test: batch_resolve with "Joe C" pattern
        requests = [("Joe C", 99999, None, 2025)]
        results = pipeline.batch_resolve(requests)

        # Assert: Should have found and filtered to Joe Carter
        assert strategy.captured_candidates is not None, "Strategy should have received candidates"
        assert len(strategy.captured_candidates) == 1, (
            f"Should filter to 1 candidate (Joe Carter), got {len(strategy.captured_candidates)}"
        )
        assert strategy.captured_candidates[0].cm_id == 11111, "Should have filtered to Joe Carter (cm_id=11111)"
        assert results[0].is_resolved, "Should resolve to Joe Carter"
        assert results[0].person.cm_id == 11111

    def test_first_name_initial_pattern_multiple_matches(self, pipeline, mock_repositories):
        """Verify 'Joe C' returns multiple candidates when multiple Joes have C last names."""
        person_repo, _ = mock_repositories

        # Setup: Two people named Joe with last names starting with C
        joe_carter = Person(cm_id=11111, first_name="Joe", last_name="Carter")
        joe_chen = Person(cm_id=44444, first_name="Joe", last_name="Chen")
        joe_smith = Person(cm_id=22222, first_name="Joe", last_name="Smith")

        person_repo.find_by_name.return_value = []  # No literal "Joe C"
        person_repo.find_by_first_name.return_value = [joe_carter, joe_chen, joe_smith]

        class CandidateCapturingStrategy(ResolutionStrategy):
            def __init__(self):
                self.captured_candidates = None

            @property
            def name(self):
                return "capturing"

            def resolve(self, name, requester_cm_id, session_cm_id=None, year=None):
                return ResolutionResult()

            def resolve_with_context(  # type: ignore[override]
                self, name, requester_cm_id, session_cm_id, year, candidates, attendee_info, all_persons=None
            ):
                self.captured_candidates = candidates
                if candidates and len(candidates) > 1:
                    return ResolutionResult(candidates=candidates, confidence=0.5, method="first_name_initial")
                return ResolutionResult()

        strategy = CandidateCapturingStrategy()
        pipeline.add_strategy(strategy)

        requests = [("Joe C", 99999, None, 2025)]
        results = pipeline.batch_resolve(requests)

        # Assert: Should have 2 candidates (Carter and Chen, both start with C)
        assert strategy.captured_candidates is not None
        assert len(strategy.captured_candidates) == 2, (
            f"Should have 2 candidates with 'C' last names, got {len(strategy.captured_candidates)}"
        )

        captured_ids = {c.cm_id for c in strategy.captured_candidates}
        assert captured_ids == {11111, 44444}, "Should have Joe Carter and Joe Chen, not Joe Smith"

        # Should be ambiguous with multiple matches
        assert results[0].is_ambiguous

    def test_regular_two_part_name_still_works(self, pipeline, mock_repositories):
        """Verify 'Joe Smith' (full last name, not just initial) still works normally."""
        person_repo, _ = mock_repositories

        joe_smith = Person(cm_id=22222, first_name="Joe", last_name="Smith")

        # Regular name lookup should work
        person_repo.find_by_name.return_value = [joe_smith]

        class CandidateCapturingStrategy(ResolutionStrategy):
            def __init__(self):
                self.captured_candidates = None

            @property
            def name(self):
                return "capturing"

            def resolve(self, name, requester_cm_id, session_cm_id=None, year=None):
                return ResolutionResult()

            def resolve_with_context(  # type: ignore[override]
                self, name, requester_cm_id, session_cm_id, year, candidates, attendee_info, all_persons=None
            ):
                self.captured_candidates = candidates
                if candidates and len(candidates) == 1:
                    return ResolutionResult(person=candidates[0], confidence=0.95, method="exact")
                return ResolutionResult()

        strategy = CandidateCapturingStrategy()
        pipeline.add_strategy(strategy)

        requests = [("Joe Smith", 99999, None, 2025)]
        results = pipeline.batch_resolve(requests)

        # Assert: Normal name lookup should work
        assert strategy.captured_candidates is not None
        assert len(strategy.captured_candidates) == 1
        assert results[0].is_resolved
        assert results[0].person.cm_id == 22222


class TestBatchResolveAttendeeInfoFormat:
    """Test that batch_resolve passes attendee_info to strategies in the correct format.

    BUG (Parity Tracker Line 241): batch_resolve() builds attendee_info with:
    - Tuple keys: (cm_id, year)
    - Int values: session_id

    But strategies expect:
    - Int keys: cm_id
    - Dict values: {'session_cm_id': ..., 'school': ..., 'grade': ..., 'city': ..., 'state': ...}

    This causes all `if cm_id in attendee_info` checks to fail silently,
    negating the batch pre-loading optimization.
    """

    @pytest.fixture
    def mock_repositories(self):
        """Create mock repositories"""
        mock_person_repo = Mock()
        mock_attendee_repo = Mock()
        return mock_person_repo, mock_attendee_repo

    @pytest.fixture
    def pipeline(self, mock_repositories):
        """Create a ResolutionPipeline with mocked dependencies"""
        person_repo, attendee_repo = mock_repositories
        # Mock person repo's phonetic matching to return empty list by default
        person_repo.get_all_for_phonetic_matching.return_value = []
        return ResolutionPipeline(person_repo, attendee_repo)

    def test_attendee_info_uses_cm_id_keys_not_tuples(self, pipeline, mock_repositories):
        """Verify attendee_info uses cm_id (int) as keys, not (cm_id, year) tuples.

        The current bug: batch_resolve() builds:
            {(12345, 2025): 1000002}  # Tuple key!

        Should be:
            {12345: {'session_cm_id': 1000002, ...}}  # Int key!
        """
        person_repo, attendee_repo = mock_repositories

        # Setup: A person with session info
        john_doe = Person(cm_id=12345, first_name="John", last_name="Doe")
        person_repo.find_by_name.return_value = [john_doe]

        # Mock bulk_get_sessions_for_persons to return session mapping
        attendee_repo.bulk_get_sessions_for_persons.return_value = {
            12345: 1000002,  # person_cm_id -> session_cm_id
            99999: 1000002,  # requester also in same session
        }

        # Strategy that captures the attendee_info format
        class AttendeeInfoCapturingStrategy(ResolutionStrategy):
            def __init__(self):
                self.captured_attendee_info = None

            @property
            def name(self):
                return "capturing"

            def resolve(self, name, requester_cm_id, session_cm_id=None, year=None):
                return ResolutionResult()

            def resolve_with_context(  # type: ignore[override]
                self, name, requester_cm_id, session_cm_id, year, candidates, attendee_info, all_persons=None
            ):
                self.captured_attendee_info = attendee_info
                if candidates:
                    return ResolutionResult(person=candidates[0], confidence=0.90, method="test")
                return ResolutionResult()

        strategy = AttendeeInfoCapturingStrategy()
        pipeline.add_strategy(strategy)

        # Test: batch_resolve with year context
        requests = [("John Doe", 99999, None, 2025)]
        pipeline.batch_resolve(requests)

        # Assert: attendee_info should have cm_id keys (int), not tuples
        assert strategy.captured_attendee_info is not None, "Strategy should receive attendee_info"

        # Check that 12345 (int) is a valid key
        assert 12345 in strategy.captured_attendee_info, (
            f"attendee_info should have int key 12345, got keys: {list(strategy.captured_attendee_info.keys())}"
        )

        # Check that (12345, 2025) tuple is NOT a key (the bug we're fixing)
        assert (12345, 2025) not in strategy.captured_attendee_info, (
            "attendee_info should NOT have tuple keys like (12345, 2025)"
        )

    def test_attendee_info_values_are_dicts_not_ints(self, pipeline, mock_repositories):
        """Verify attendee_info values are dicts with session_cm_id, not raw ints.

        The current bug: batch_resolve() builds:
            {(12345, 2025): 1000002}  # Raw int value!

        Should be:
            {12345: {'session_cm_id': 1000002, ...}}  # Dict value!

        Strategies call attendee_info[cm_id].get('session_cm_id') which fails
        on int values.
        """
        person_repo, attendee_repo = mock_repositories

        john_doe = Person(cm_id=12345, first_name="John", last_name="Doe")
        person_repo.find_by_name.return_value = [john_doe]

        attendee_repo.bulk_get_sessions_for_persons.return_value = {
            12345: 1000002,
            99999: 1000002,
        }

        class AttendeeInfoCapturingStrategy(ResolutionStrategy):
            def __init__(self):
                self.captured_attendee_info = None

            @property
            def name(self):
                return "capturing"

            def resolve(self, name, requester_cm_id, session_cm_id=None, year=None):
                return ResolutionResult()

            def resolve_with_context(  # type: ignore[override]
                self, name, requester_cm_id, session_cm_id, year, candidates, attendee_info, all_persons=None
            ):
                self.captured_attendee_info = attendee_info
                return ResolutionResult(
                    person=candidates[0] if candidates else None, confidence=0.90 if candidates else 0.0, method="test"
                )

        strategy = AttendeeInfoCapturingStrategy()
        pipeline.add_strategy(strategy)

        requests = [("John Doe", 99999, None, 2025)]
        pipeline.batch_resolve(requests)

        assert strategy.captured_attendee_info is not None

        # Get the value for cm_id 12345 (after key format is fixed)
        # First ensure key exists
        if 12345 in strategy.captured_attendee_info:
            value = strategy.captured_attendee_info[12345]

            # Value should be a dict, not an int
            assert isinstance(value, dict), f"attendee_info[12345] should be dict, got {type(value).__name__}: {value}"

            # Value should have 'session_cm_id' key
            assert "session_cm_id" in value, (
                f"attendee_info[12345] should have 'session_cm_id' key, got keys: {list(value.keys())}"
            )

            # The session_cm_id should be correct
            assert value["session_cm_id"] == 1000002, f"session_cm_id should be 1000002, got {value['session_cm_id']}"

    def test_session_disambiguation_uses_preloaded_attendee_info(self, pipeline, mock_repositories):
        """Verify that session disambiguation actually uses pre-loaded attendee_info
        instead of falling back to DB queries.

        This tests the real-world impact: if attendee_info format is wrong,
        strategies silently fall back to DB queries, negating the optimization.
        """
        person_repo, attendee_repo = mock_repositories

        # Two Johns - one in session 1, one in session 2
        john_session1 = Person(cm_id=11111, first_name="John", last_name="Doe")
        john_session2 = Person(cm_id=22222, first_name="John", last_name="Doe")

        person_repo.find_by_name.return_value = [john_session1, john_session2]

        # Session mapping: john_session1 is in session 1000002
        attendee_repo.bulk_get_sessions_for_persons.return_value = {
            11111: 1000002,  # John in session 1
            22222: 1000003,  # John in session 2
            99999: 1000002,  # Requester in session 1
        }

        class SessionDisambiguatingStrategy(ResolutionStrategy):
            """Strategy that disambiguates by session using attendee_info"""

            def __init__(self):
                self.used_attendee_info = False
                self.fell_back_to_db = False

            @property
            def name(self):
                return "session_disambiguator"

            def resolve(self, name, requester_cm_id, session_cm_id=None, year=None):
                return ResolutionResult()

            def resolve_with_context(  # type: ignore[override]
                self, name, requester_cm_id, session_cm_id, year, candidates, attendee_info, all_persons=None
            ):
                if not candidates or len(candidates) <= 1:
                    return ResolutionResult(
                        person=candidates[0] if candidates else None,
                        confidence=0.90 if candidates else 0.0,
                        method=self.name,
                    )

                # Try to disambiguate by session using attendee_info
                # This mimics what fuzzy_match.py:703 does
                same_session_matches = []
                if attendee_info and session_cm_id:
                    for candidate in candidates:
                        if candidate.cm_id in attendee_info:
                            info = attendee_info[candidate.cm_id]
                            if isinstance(info, dict) and info.get("session_cm_id") == session_cm_id:
                                same_session_matches.append(candidate)
                                self.used_attendee_info = True

                if len(same_session_matches) == 1:
                    return ResolutionResult(
                        person=same_session_matches[0],
                        confidence=0.85,
                        method=self.name,
                        metadata={"session_match": True},
                    )

                # Ambiguous - return all candidates
                return ResolutionResult(candidates=candidates, confidence=0.5, method=self.name)

        strategy = SessionDisambiguatingStrategy()
        pipeline.add_strategy(strategy)

        # Requester is in session 1000002, so should resolve to john_session1
        requests = [("John Doe", 99999, 1000002, 2025)]
        results = pipeline.batch_resolve(requests)

        # Assert: Strategy should have successfully used attendee_info
        assert strategy.used_attendee_info, (
            "Strategy should have successfully used attendee_info for session disambiguation"
        )

        # Assert: Should have resolved to the John in the same session
        assert results[0].is_resolved, "Should resolve when session disambiguation succeeds"
        assert results[0].person.cm_id == 11111, "Should resolve to john_session1 (cm_id=11111) who is in same session"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

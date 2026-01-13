"""Tests for ranked candidate passthrough to Phase 3.

Gap addressed: MONOLITH_PARITY_TRACKER.md Section 4 - Disambiguation
    "5-candidate limit" - candidates should be ranked before [:5] slice
    so Phase 3 gets the TOP 5 by relevance, not arbitrary DB order.

FIX: smart_resolve_candidates should return ranked candidates even when
not auto-resolving, so Phase 3 gets the best 5 candidates."""

from __future__ import annotations

from typing import Any
from unittest.mock import Mock

import pytest

from bunking.sync.bunk_request_processor.core.models import Person


def _create_person(
    cm_id: int,
    first_name: str = "Test",
    last_name: str = "Person",
    grade: int = 5,
) -> Person:
    """Helper to create Person objects for testing."""
    return Person(
        cm_id=cm_id,
        first_name=first_name,
        last_name=last_name,
        grade=grade,
    )


def _create_config() -> dict[str, Any]:
    """Create default smart resolution config."""
    return {
        "enabled": True,
        "significant_connection_threshold": 5,
        "min_connections_for_auto_resolve": 3,
        "min_confidence_for_auto_resolve": 0.85,
        "mutual_request_bonus": 10,
        "common_friends_weight": 1.0,
        "historical_bunking_weight": 0.8,
        "connection_score_weight": 0.7,
    }


class TestRankedCandidatePassthrough:
    """Tests that verify candidates are ranked by social score before
    being passed to Phase 3 disambiguation.

    The [:5] slice should take the TOP 5 candidates by relevance,
    not the first 5 in arbitrary DB order.
    """

    def test_smart_resolve_returns_ranked_candidates_when_not_auto_resolving(self):
        """When smart_resolve_candidates cannot auto-resolve (no clear winner),
        it should STILL return candidates ranked by social score.

        This allows the caller to use ranked candidates for Phase 3,
        so the [:5] slice takes the TOP 5 by relevance.

        FIX REQUIRED: Change smart_resolve_candidates return type from:
            Optional[Tuple[int, float, str]]
        to:
            Tuple[Optional[Tuple[int, float, str]], List[Person]]

        The second element is always the candidates sorted by social score.
        """
        from bunking.sync.bunk_request_processor.social.social_graph import SocialGraph

        pb = Mock()
        graph = SocialGraph(pb, year=2025, session_cm_ids=[1000002])
        graph._initialized = True

        import networkx as nx

        G = nx.Graph()
        # Candidate 200 has 3 common friends with requester (score: 3)
        G.add_edges_from(
            [
                (100, 300),
                (100, 400),
                (100, 500),
                (200, 300),
                (200, 400),
                (200, 500),  # 3 common friends
            ]
        )
        # Candidate 250 has 2 common friends (score: 2)
        G.add_edges_from(
            [
                (250, 300),
                (250, 400),  # 2 common friends
            ]
        )
        # Candidate 260 has 1 common friend (score: 1)
        G.add_edge(260, 300)
        # Candidate 270 has no connections (score: 0)
        G.add_node(270)
        # Candidate 280 has 4 common friends (score: 4) - HIGHEST after mutual
        G.add_edges_from(
            [
                (100, 600),
                (100, 700),
                (100, 800),
                (100, 900),
                (280, 300),
                (280, 400),
                (280, 500),
                (280, 600),  # 4 common friends
            ]
        )
        graph.graphs[1000002] = G

        config = _create_config()

        # 6 candidates in "DB order" (arbitrary)
        candidates = [
            _create_person(cm_id=270, first_name="Zara"),  # Score: 0
            _create_person(cm_id=250, first_name="Yara"),  # Score: 2
            _create_person(cm_id=200, first_name="Sarah"),  # Score: 3
            _create_person(cm_id=260, first_name="Xara"),  # Score: 1
            _create_person(cm_id=280, first_name="Tara"),  # Score: 4 (BEST)
            _create_person(cm_id=290, first_name="Vara"),  # Score: 0 (not in graph)
        ]

        # None of them have mutual requests - no auto-resolution
        result = graph.smart_resolve_candidates(
            name="Sarah",
            candidates=candidates,
            requester_cm_id=100,
            session_cm_id=1000002,
            config=config,
            mutual_request_cm_ids=set(),
        )

        # CRITICAL: Even when not auto-resolving, we need ranked candidates
        # New return type: Tuple[Optional[Tuple[...]], List[Person]]
        assert isinstance(result, tuple), "smart_resolve_candidates should return a tuple"
        assert len(result) == 2, "Tuple should have 2 elements: (auto_result, ranked_candidates)"

        auto_result, ranked_candidates = result

        # Auto-resolution failed (no clear winner meeting thresholds)
        assert auto_result is None, "Should not auto-resolve without clear winner"

        # But we should have ranked candidates
        assert isinstance(ranked_candidates, list), "Should return list of ranked candidates"
        assert len(ranked_candidates) == len(candidates), "Should return all candidates ranked"

        # Candidates should be sorted by score (highest first)
        ranked_cm_ids = [p.cm_id for p in ranked_candidates]
        # Expected order by score: 280 (4), 200 (3), 250 (2), 260 (1), 270 (0), 290 (0)
        assert ranked_cm_ids[0] == 280, f"Highest-scoring candidate should be first, got {ranked_cm_ids[0]}"
        assert ranked_cm_ids[1] == 200, f"Second-highest should be second, got {ranked_cm_ids[1]}"
        assert ranked_cm_ids[2] == 250, f"Third-highest should be third, got {ranked_cm_ids[2]}"

    def test_phase2_service_uses_ranked_candidates_from_smart_resolution(self):
        """Phase2ResolutionService should use ranked candidates from
        smart_resolve_candidates, so ambiguous results going to Phase 3
        have candidates ranked by social relevance.

        This ensures the [:5] slice in Phase 3 takes TOP 5, not first 5.
        """
        # This is an integration test that verifies the flow
        # Will be implemented after smart_resolve_candidates is updated
        pytest.skip("Requires updated smart_resolve_candidates implementation")

    def test_ranked_candidates_preserve_top_5_when_slicing(self):
        """Verify that when we have 8 candidates and slice to 5,
        we get the TOP 5 by score, not the first 5 in DB order.

        Before fix: candidates[0:5] = first 5 in DB order
        After fix: candidates[0:5] = top 5 by social score
        """
        from bunking.sync.bunk_request_processor.social.social_graph import SocialGraph

        pb = Mock()
        graph = SocialGraph(pb, year=2025, session_cm_ids=[1000002])
        graph._initialized = True

        import networkx as nx

        G = nx.Graph()

        # Create 8 candidates with varying scores
        # The BEST candidate (cm_id=800) has 10 common friends
        # and is at position 7 in the "DB order" list
        scores = {
            100: 2,  # requester
            200: 1,
            210: 2,
            220: 0,
            230: 3,
            240: 1,
            250: 0,
            800: 10,  # BEST candidate - but at position 7 in list
        }

        # Add edges to create these scores
        common_friends_base = 1000
        for cm_id, score in scores.items():
            if cm_id == 100:  # requester
                for i in range(10):  # requester knows 10 friends
                    G.add_edge(100, common_friends_base + i)
            else:
                for i in range(score):
                    G.add_edge(cm_id, common_friends_base + i)  # candidate knows some of them

        graph.graphs[1000002] = G
        config = _create_config()

        # 8 candidates in "DB order" (arbitrary)
        # The best one (800) is at the END
        candidates = [
            _create_person(cm_id=200),
            _create_person(cm_id=210),
            _create_person(cm_id=220),
            _create_person(cm_id=230),
            _create_person(cm_id=240),
            _create_person(cm_id=250),
            _create_person(cm_id=800),  # BEST - at position 6 (0-indexed)
        ]

        result = graph.smart_resolve_candidates(
            name="Test",
            candidates=candidates,
            requester_cm_id=100,
            session_cm_id=1000002,
            config=config,
            mutual_request_cm_ids=set(),
        )

        # Get ranked candidates
        assert isinstance(result, tuple) and len(result) == 2
        auto_result, ranked_candidates = result

        # Take top 5 (simulating the [:5] slice in Phase 3)
        top_5 = ranked_candidates[:5]
        top_5_cm_ids = [p.cm_id for p in top_5]

        # The BEST candidate (800 with score 10) MUST be in top 5
        assert 800 in top_5_cm_ids, f"Best candidate (800) should be in top 5, but got {top_5_cm_ids}"

        # In fact, 800 should be FIRST (highest score)
        assert top_5_cm_ids[0] == 800, f"Best candidate should be first, got {top_5_cm_ids[0]}"

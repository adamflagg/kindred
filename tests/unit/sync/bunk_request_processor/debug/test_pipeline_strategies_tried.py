"""Component 4: batch_resolve populates pipeline_strategies_tried on the winning
ResolutionResult's metadata, with sub_method taken from each strategy's
sub_method / ambiguity_reason metadata.

Downstream debug_pipeline_traces.phase2_resolution[*].pipeline_strategies_tried
(field already declared in trace_models.Phase2FinalResult) is populated from
this metadata in the trace recorder (Task 6)."""

from __future__ import annotations

from unittest.mock import Mock

import pytest

from bunking.sync.bunk_request_processor.core.models import Person
from bunking.sync.bunk_request_processor.resolution.resolution_pipeline import ResolutionPipeline
from bunking.sync.bunk_request_processor.resolution.strategies.fuzzy_match import FuzzyMatchStrategy


@pytest.fixture
def fuzzy_only_pipeline():
    """ResolutionPipeline with just FuzzyMatchStrategy and minimal mocked repos.

    Pool setup mirrors the original cascade case: searching "Katherine" with no
    full-name match → falls into _try_normalized_search → merge fallback returns
    a single same-session Katherine after disambiguation.
    """
    person_repo = Mock()
    attendee_repo = Mock()

    person_repo.name_cache = None
    person_repo.find_by_name.return_value = []
    person_repo.find_by_normalized_name.return_value = []
    person_repo.find_by_first_and_parent_surname.return_value = []
    person_repo.find_by_cm_id.return_value = None
    person_repo.get_all_for_phonetic_matching.return_value = []

    same_session_katherine = Person(cm_id=100, first_name="Katherine", last_name="Smith")
    other_katherine = Person(cm_id=101, first_name="Katherine", last_name="Other")
    kate = Person(cm_id=200, first_name="Kate", last_name="Chen")

    def first_name_search(name, year=None):
        n = name.lower()
        if n == "katherine":
            return [same_session_katherine, other_katherine]
        if n == "kate":
            return [kate]
        return []

    person_repo.find_by_first_name.side_effect = first_name_search

    attendee_repo.get_by_person_and_year.return_value = None
    attendee_repo.bulk_get_sessions_for_persons.return_value = {
        100: 1000001,
        101: 1000002,
        200: 1000003,
        999: 1000001,
    }

    pipeline = ResolutionPipeline(person_repository=person_repo, attendee_repository=attendee_repo)
    pipeline.add_strategy(FuzzyMatchStrategy(person_repo, attendee_repo))
    return pipeline


def test_batch_resolve_records_pipeline_strategies_tried(fuzzy_only_pipeline):
    """After batch_resolve, the winning result's metadata['pipeline_strategies_tried']
    is a non-empty list with strategy + sub_method + confidence + flags."""
    results = fuzzy_only_pipeline.batch_resolve([("Katherine", 999, 1000001, 2026)])
    assert len(results) == 1
    result = results[0]

    assert result.metadata is not None
    strategies = result.metadata.get("pipeline_strategies_tried")
    assert strategies, f"expected non-empty pipeline_strategies_tried, got {strategies!r}"
    assert isinstance(strategies, list)
    assert len(strategies) >= 1

    entry = strategies[0]
    for key in ("strategy", "sub_method", "confidence", "candidate_count", "resolved", "ambiguous"):
        assert key in entry, f"missing key {key!r} in strategy entry {entry!r}"


def test_pipeline_strategies_tried_records_sub_method(fuzzy_only_pipeline):
    """sub_method is taken directly from the strategy's sub_method metadata."""
    results = fuzzy_only_pipeline.batch_resolve([("Katherine", 999, 1000001, 2026)])
    result = results[0]

    strategies = result.metadata.get("pipeline_strategies_tried", [])
    # Fuzzy merge fallback sets sub_method='first_name_merged'. Session-disambiguation
    # single match sets sub_method='session_disambiguated'. Either is valid here.
    fuzzy_entry = next((s for s in strategies if s["strategy"] == "fuzzy_match"), None)
    assert fuzzy_entry is not None
    assert fuzzy_entry["sub_method"] in {
        "first_name_merged",
        "session_disambiguated",
    }, f"unexpected sub_method: {fuzzy_entry['sub_method']!r}"


def test_winning_entry_in_strategies_tried_matches_final_result(fuzzy_only_pipeline):
    """The resolved entry's strategy and confidence match the final result."""
    results = fuzzy_only_pipeline.batch_resolve([("Katherine", 999, 1000001, 2026)])
    result = results[0]
    assert result.is_resolved

    strategies = result.metadata.get("pipeline_strategies_tried", [])
    winning = next((s for s in strategies if s.get("resolved")), None)
    assert winning is not None, f"no resolved entry found in {strategies!r}"
    assert winning["strategy"] == result.method
    assert winning["confidence"] == pytest.approx(result.confidence)


def test_strategies_tried_records_unresolved_attempt_when_no_match(fuzzy_only_pipeline):
    """Even when the strategy returns 0.0/no-match, the attempt is recorded."""
    results = fuzzy_only_pipeline.batch_resolve([("Xqyzzyzzy", 999, 1000001, 2026)])
    result = results[0]
    strategies = (result.metadata or {}).get("pipeline_strategies_tried")
    assert strategies, "expected the no-match attempt to still appear in the list"
    assert all(not s.get("resolved") for s in strategies)

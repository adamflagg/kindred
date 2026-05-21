"""Tests for disambiguation_reranker module.

Tests cover:
- Full name cases: JW floor pass/fail, compound names, confidence capping
- First-name-only cases: confidence cap, no JW filtering
- Edge cases: missing person, ai_no_match=True, empty candidates
"""

from bunking.sync.bunk_request_processor.core.models import Person
from bunking.sync.bunk_request_processor.services.disambiguation_reranker import (
    FIRST_NAME_ONLY_CONFIDENCE_CAP,
    JW_LAST_NAME_FLOOR,
    _last_name_jw_score,
    rerank_disambiguation_candidates,
)


def _make_person(cm_id: int, first: str, last: str) -> Person:
    return Person(cm_id=cm_id, first_name=first, last_name=last)


# ---------------------------------------------------------------------------
# _last_name_jw_score unit tests
# ---------------------------------------------------------------------------


class TestLastNameJwScore:
    def test_exact_match_returns_one(self):
        assert _last_name_jw_score("Korsunsky", "Korsunsky") == 1.0

    def test_suffix_match_returns_one(self):
        # "Godoy" is a suffix word of "Godoy Abbott"
        assert _last_name_jw_score("Godoy", "Godoy Abbott") == 1.0

    def test_similar_names_above_floor(self):
        # "korsunky" vs "Korsunsky" — close enough
        score = _last_name_jw_score("korsunky", "Korsunsky")
        assert score >= JW_LAST_NAME_FLOOR

    def test_unrelated_names_below_floor(self):
        score = _last_name_jw_score("Zabel", "Mulshine")
        assert score < JW_LAST_NAME_FLOOR

    def test_hyphenated_candidate_part_match(self):
        # "Mohl" is a part of "Tucker-Mohl"
        score = _last_name_jw_score("Mohl", "Tucker-Mohl")
        assert score >= JW_LAST_NAME_FLOOR

    def test_hyphenated_target_part_match(self):
        # "Tucker-Mohl" target vs "Tucker-Mohl" candidate
        score = _last_name_jw_score("Tucker-Mohl", "Tucker-Mohl")
        assert score == 1.0

    def test_empty_target_returns_zero(self):
        assert _last_name_jw_score("", "Smith") == 0.0

    def test_empty_candidate_returns_zero(self):
        assert _last_name_jw_score("Smith", "") == 0.0


# ---------------------------------------------------------------------------
# Full name cases
# ---------------------------------------------------------------------------


class TestFullNameCases:
    def test_correct_candidate_passes_floor(self):
        """Rafa korsunky → picks Korsunsky person (JW close enough)."""
        persons = [_make_person(1, "Rafa", "Korsunsky")]
        ai_ranked = [(1, 0.85)]
        result = rerank_disambiguation_candidates(ai_ranked, "Rafa korsunky", persons)
        assert result is not None
        assert result.person.cm_id == 1
        assert result.jw_score is not None
        assert result.jw_score >= JW_LAST_NAME_FLOOR

    def test_wrong_last_name_filtered(self):
        """Kieran Zabel → Mulshine candidate rejected (JW too low)."""
        persons = [_make_person(2, "Kieran", "Mulshine")]
        ai_ranked = [(2, 0.90)]
        result = rerank_disambiguation_candidates(ai_ranked, "Kieran Zabel", persons)
        assert result is None

    def test_second_ai_pick_wins_when_first_has_wrong_last_name(self):
        """Elise Tucker-Mohl: Goldman-Mohl (JW fail) rejected, Tucker-Mohl wins."""
        persons = [
            _make_person(10, "Elise", "Goldman-Mohl"),
            _make_person(11, "Elise", "Tucker-Mohl"),
        ]
        # AI ranked Goldman-Mohl first, Tucker-Mohl second
        ai_ranked = [(10, 0.80), (11, 0.70)]
        result = rerank_disambiguation_candidates(ai_ranked, "Elise Tucker-Mohl", persons)
        assert result is not None
        assert result.person.cm_id == 11
        assert result.person.last_name == "Tucker-Mohl"

    def test_partial_compound_name_passes(self):
        """Ruben Godoy → Godoy Abbott: suffix match, JW = 1.0."""
        persons = [_make_person(20, "Ruben", "Godoy Abbott")]
        ai_ranked = [(20, 0.75)]
        result = rerank_disambiguation_candidates(ai_ranked, "Ruben Godoy", persons)
        assert result is not None
        assert result.person.cm_id == 20
        assert result.jw_score == 1.0

    def test_all_candidates_below_floor_returns_none(self):
        """All candidates fail JW floor → None."""
        persons = [
            _make_person(30, "Anna", "Rodriguez"),
            _make_person(31, "Anna", "Martinez"),
        ]
        ai_ranked = [(30, 0.80), (31, 0.75)]
        result = rerank_disambiguation_candidates(ai_ranked, "Anna Williams", persons)
        assert result is None

    def test_confidence_capped_by_jw(self):
        """Final confidence = min(ai_conf, max(0.3, jw_score)).

        If jw_score is 0.75 and ai_conf is 0.95, final = min(0.95, max(0.3, 0.75)) = 0.75.
        """
        # Use a name pair where JW will be ~0.75 (below ai_conf)
        # "Smith" vs "Smyth" — similar but not identical
        persons = [_make_person(40, "Joe", "Smyth")]
        ai_ranked = [(40, 0.95)]
        result = rerank_disambiguation_candidates(ai_ranked, "Joe Smith", persons)
        assert result is not None
        assert result.ai_confidence == 0.95
        # confidence should be <= ai_confidence
        assert result.confidence <= result.ai_confidence
        # confidence should be >= 0.3
        assert result.confidence >= 0.3

    def test_empty_candidates_returns_none(self):
        """Empty person list → None."""
        result = rerank_disambiguation_candidates([(1, 0.9)], "Jane Doe", [])
        assert result is None

    def test_result_has_reasoning_string(self):
        """RerankedResult should have a non-empty reasoning field."""
        persons = [_make_person(50, "Sam", "Jones")]
        ai_ranked = [(50, 0.80)]
        result = rerank_disambiguation_candidates(ai_ranked, "Sam Jones", persons)
        assert result is not None
        assert isinstance(result.reasoning, str)
        assert len(result.reasoning) > 0


# ---------------------------------------------------------------------------
# First-name-only cases
# ---------------------------------------------------------------------------


class TestFirstNameOnlyCases:
    def test_single_word_caps_confidence(self):
        """Single first-name target: confidence capped at FIRST_NAME_ONLY_CONFIDENCE_CAP."""
        persons = [_make_person(60, "Emma", "Johnson")]
        ai_ranked = [(60, 0.95)]
        result = rerank_disambiguation_candidates(ai_ranked, "Emma", persons)
        assert result is not None
        assert result.confidence == FIRST_NAME_ONLY_CONFIDENCE_CAP
        assert result.ai_confidence == 0.95

    def test_single_word_skips_jw_filtering(self):
        """First-name-only: no JW filtering applied, jw_score is None."""
        persons = [_make_person(61, "Liam", "Garcia")]
        ai_ranked = [(61, 0.80)]
        result = rerank_disambiguation_candidates(ai_ranked, "Liam", persons)
        assert result is not None
        assert result.jw_score is None
        assert result.person.cm_id == 61

    def test_single_word_uses_ai_top_pick(self):
        """First-name-only: picks AI's first matching person in list."""
        persons = [
            _make_person(70, "Olivia", "Chen"),
            _make_person(71, "Olivia", "Smith"),
        ]
        # AI ranks 71 first
        ai_ranked = [(71, 0.85), (70, 0.60)]
        result = rerank_disambiguation_candidates(ai_ranked, "Olivia", persons)
        assert result is not None
        assert result.person.cm_id == 71


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------


class TestEdgeCases:
    def test_ai_no_match_returns_none(self):
        """ai_no_match=True → always returns None."""
        persons = [_make_person(80, "Alex", "Taylor")]
        ai_ranked = [(80, 0.90)]
        result = rerank_disambiguation_candidates(ai_ranked, "Alex Taylor", persons, ai_no_match=True)
        assert result is None

    def test_empty_ai_ranked_returns_none(self):
        """Empty ai_ranked list → None."""
        persons = [_make_person(81, "Chris", "Brown")]
        result = rerank_disambiguation_candidates([], "Chris Brown", persons)
        assert result is None

    def test_candidate_person_id_not_in_list_skipped(self):
        """cm_id in ai_ranked but not in candidate_persons → skipped."""
        persons = [_make_person(90, "Dana", "White")]
        # AI ranked cm_id 99 which is not in persons
        ai_ranked = [(99, 0.90), (90, 0.70)]
        result = rerank_disambiguation_candidates(ai_ranked, "Dana White", persons)
        assert result is not None
        assert result.person.cm_id == 90

    def test_unknown_person_id_only_returns_none(self):
        """All cm_ids in ai_ranked absent from persons → None."""
        persons = [_make_person(100, "Eve", "Adams")]
        ai_ranked = [(999, 0.90)]
        result = rerank_disambiguation_candidates(ai_ranked, "Eve Adams", persons)
        assert result is None

    def test_reranked_result_dataclass_fields(self):
        """RerankedResult has all expected fields."""
        persons = [_make_person(110, "Max", "Weber")]
        ai_ranked = [(110, 0.88)]
        result = rerank_disambiguation_candidates(ai_ranked, "Max Weber", persons)
        assert result is not None
        assert hasattr(result, "person")
        assert hasattr(result, "confidence")
        assert hasattr(result, "ai_confidence")
        assert hasattr(result, "jw_score")
        assert hasattr(result, "reasoning")

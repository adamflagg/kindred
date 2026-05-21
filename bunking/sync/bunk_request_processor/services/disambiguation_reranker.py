"""Disambiguation JW Re-ranker

Post-AI validation step that checks each ranked candidate's last name
against the Phase 1 parsed name using Jaro-Winkler similarity.
Candidates with JW < JW_LAST_NAME_FLOOR are filtered out.
First-name-only targets use AI's top pick but confidence is capped.
"""

from dataclasses import dataclass

from ..core.models import Person
from ..shared.name_utils import last_name_jw_raw_score, parse_name, split_last_name_words

# Minimum JW similarity for a candidate's last name to pass the filter
JW_LAST_NAME_FLOOR = 0.70

# Maximum confidence assigned when target is first-name-only
FIRST_NAME_ONLY_CONFIDENCE_CAP = 0.50


@dataclass
class RerankedResult:
    """Result from the JW re-ranking step."""

    person: Person
    confidence: float
    ai_confidence: float
    jw_score: float | None
    reasoning: str


def _last_name_jw_score(target_last: str, candidate_last: str) -> float:
    """Compute the best JW similarity between target and candidate last names.

    Handles compound/hyphenated names:
    1. Word prefix match → 1.0 (e.g. "Godoy" matches "Godoy Abbott")
    2. JW on normalized forms + hyphen-split parts via last_name_jw_raw_score
    """
    if not target_last or not candidate_last:
        return 0.0

    target_words = split_last_name_words(target_last)
    candidate_words = split_last_name_words(candidate_last)

    # Strategy 1: prefix match (e.g. "Godoy" matches "Godoy Abbott" — first word prefix)
    if target_words and candidate_words:
        if target_words == candidate_words:
            return 1.0
        if len(target_words) <= len(candidate_words):
            prefix = candidate_words[: len(target_words)]
            if target_words == prefix:
                return 1.0
        if len(candidate_words) <= len(target_words):
            prefix = target_words[: len(candidate_words)]
            if candidate_words == prefix:
                return 1.0

    # Strategy 2: JW on normalized forms (including hyphen-split parts)
    return last_name_jw_raw_score(target_last, candidate_last)


def rerank_disambiguation_candidates(
    ai_ranked: list[tuple[int, float]],
    target_name: str,
    candidate_persons: list[Person],
    ai_no_match: bool = False,
) -> RerankedResult | None:
    """Re-rank AI disambiguation candidates using JW last-name similarity.

    Args:
        ai_ranked: Ordered list of (cm_id, ai_confidence) from AI, best first.
        target_name: The raw name string from Phase 1 parsing.
        candidate_persons: List of Person objects that were offered as candidates.
        ai_no_match: True if AI indicated no match was found.

    Returns:
        RerankedResult with the best passing candidate, or None if no candidate passes.
    """
    if ai_no_match or not ai_ranked:
        return None

    # Build lookup: cm_id → Person
    person_by_id: dict[int, Person] = {p.cm_id: p for p in candidate_persons}

    parsed = parse_name(target_name)

    # First-name-only target: use AI's top pick, cap confidence
    if not parsed.is_complete:
        for cm_id, ai_conf in ai_ranked:
            person = person_by_id.get(cm_id)
            if person is None:
                continue
            capped = min(ai_conf, FIRST_NAME_ONLY_CONFIDENCE_CAP)
            return RerankedResult(
                person=person,
                confidence=capped,
                ai_confidence=ai_conf,
                jw_score=None,
                reasoning=f"First-name-only target '{target_name}'; using AI top pick, confidence capped at {FIRST_NAME_ONLY_CONFIDENCE_CAP}",
            )
        return None

    # Full name: score each AI candidate by JW last name, filter by floor
    passing: list[tuple[Person, float, float]] = []  # (person, jw_score, ai_conf)
    for cm_id, ai_conf in ai_ranked:
        person = person_by_id.get(cm_id)
        if person is None:
            continue
        jw = _last_name_jw_score(parsed.last, person.last_name)
        if jw >= JW_LAST_NAME_FLOOR:
            passing.append((person, jw, ai_conf))

    if not passing:
        return None

    # Pick best by combined score (JW * 0.5 + ai_conf * 0.5)
    best_person, best_jw, best_ai_conf = max(passing, key=lambda t: t[1] * 0.5 + t[2] * 0.5)

    # Final confidence: min(ai_confidence, max(0.3, jw_score))
    final_confidence = min(best_ai_conf, max(0.3, best_jw))

    return RerankedResult(
        person=best_person,
        confidence=final_confidence,
        ai_confidence=best_ai_conf,
        jw_score=best_jw,
        reasoning=(
            f"JW last-name score {best_jw:.2f} for '{parsed.last}' vs '{best_person.last_name}'; "
            f"ai_conf={best_ai_conf:.2f}, final_conf={final_confidence:.2f}"
        ),
    )

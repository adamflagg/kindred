"""Base match strategy for name resolution.

Provides shared functionality for FuzzyMatchStrategy and PhoneticMatchStrategy,
including session disambiguation, confidence calculation, and result building.

Tunable confidence/boost values live as module-level constants on the concrete
strategy modules (`fuzzy_match.py` and `phonetic_match.py`). The PB-driven
config injection point was removed in the AI Config (Unified) Phase 2 cleanup —
see `docs/reference/solver-config-decisions.md`. GATE_DEMOTION_CONFIDENCE
(0.5) is a control-flow sentinel chosen so disposition rule 8 routes the result
to PENDING regardless of the bunk_with/not_bunk_with thresholds — it's not a
tunable knob."""

from __future__ import annotations

from typing import Any

import jellyfish

from ...core.models import Person
from ...data.repositories import AttendeeRepository, PersonRepository
from ..interfaces import ResolutionResult, ResolutionStrategy

# Default values used by BaseMatchStrategy's session-adjustment when a
# subclass doesn't override `_default_*` class attributes.
DEFAULT_CONFIDENCE = 0.75
DEFAULT_SESSION_MATCH = 0.80
DEFAULT_SAME_SESSION_BOOST = 0.05
DEFAULT_DIFFERENT_SESSION_PENALTY = -0.10
DEFAULT_NOT_ENROLLED_PENALTY = -0.05


class BaseMatchStrategy(ResolutionStrategy):
    """Base class for name resolution strategies with shared disambiguation logic.

    Provides common functionality for:
    - Filtering self-references from matches
    - Session-based disambiguation
    - Building consistent ambiguous results

    Subclasses override the `_default_*` class attributes to set strategy-
    specific session-adjustment values.
    """

    # Subclass-overridable session-adjustment values.
    _default_same_session_boost: float = DEFAULT_SAME_SESSION_BOOST
    _default_different_session_penalty: float = DEFAULT_DIFFERENT_SESSION_PENALTY
    _default_not_enrolled_penalty: float = DEFAULT_NOT_ENROLLED_PENALTY

    def __init__(
        self,
        person_repository: PersonRepository,
        attendee_repository: AttendeeRepository,
    ):
        """Initialize the base match strategy.

        Args:
            person_repository: Repository for person data access
            attendee_repository: Repository for attendee data access
        """
        self.person_repo = person_repository
        self.attendee_repo = attendee_repository

        # Allow subclasses to set their strategy name
        self._strategy_name = "base_match"

    @property
    def name(self) -> str:
        """Strategy name for logging"""
        return self._strategy_name

    def _filter_self_references(self, matches: list[Person], requester_cm_id: int) -> list[Person]:
        """Filter out the requester from the matches list.

        Args:
            matches: List of candidate persons
            requester_cm_id: The person making the request

        Returns:
            Filtered list without the requester
        """
        return [m for m in matches if m.cm_id != requester_cm_id]

    def _apply_session_adjustment(
        self,
        base_confidence: float,
        person: Person,
        session_cm_id: int | None,
        attendee_info: dict[int, dict[str, Any]] | None,
    ) -> float:
        """Apply session-based confidence adjustment.

        Args:
            base_confidence: Starting confidence value
            person: The matched person
            session_cm_id: The requester's session
            attendee_info: Pre-loaded attendee info

        Returns:
            Adjusted confidence value
        """
        if not session_cm_id or not attendee_info:
            return base_confidence + self._default_not_enrolled_penalty

        person_info = attendee_info.get(person.cm_id)
        if not person_info:
            return base_confidence + self._default_not_enrolled_penalty

        person_session = person_info.get("session_cm_id")

        if person_session == session_cm_id:
            return base_confidence + self._default_same_session_boost
        return base_confidence + self._default_different_session_penalty

    def _apply_session_adjustment_simple(
        self, base_confidence: float, person_session: int | None, requester_session: int | None
    ) -> float:
        """Apply session-based confidence adjustment using session IDs directly.

        This is a simplified version for when we have session IDs already looked up.

        Args:
            base_confidence: Starting confidence value
            person_session: Session the matched person is in
            requester_session: Session the requester is in

        Returns:
            Adjusted confidence value
        """
        if requester_session is None or person_session is None:
            return base_confidence + self._default_not_enrolled_penalty

        if person_session == requester_session:
            return base_confidence + self._default_same_session_boost
        return base_confidence + self._default_different_session_penalty

    def _build_ambiguous_result(
        self,
        matches: list[Person],
        confidence: float,
        reason: str,
        extra_metadata: dict[str, Any] | None = None,
    ) -> ResolutionResult:
        """Build a consistent ambiguous result.

        Args:
            matches: List of candidate persons
            confidence: Confidence score for the ambiguous result
            reason: Reason for ambiguity
            extra_metadata: Additional metadata to include

        Returns:
            ResolutionResult with candidates and proper metadata
        """
        metadata = {
            "ambiguity_reason": reason,
            "match_count": len(matches),
        }

        if extra_metadata:
            metadata.update(extra_metadata)

        return ResolutionResult(
            candidates=matches,
            confidence=confidence,
            method=self.name,
            metadata=metadata,
        )


# Module-level helper — gate for first-name-only auto-resolve decisions.
# Threshold of 0.90 deliberately tighter than the general JW threshold used
# by _try_jaro_winkler_first_name (which targets full-name matching).
_FIRST_NAME_CLOSE_SPELLING_THRESHOLD = 0.90

# Confidence value the gate stamps on demoted candidates. Chosen so disposition
# rule 8 routes the result to PENDING regardless of bunk_with vs not_bunk_with
# request type (both thresholds sit at 0.80+).
GATE_DEMOTION_CONFIDENCE = 0.5


def _is_exact_or_close_first_name(target_first: str, cand_first: str, cand_pref: str | None) -> bool:
    """Gate for first-name-only auto-resolve.

    Returns True when the target first-name token is:
      - exactly equal to candidate's first_name (case-insensitive), OR
      - exactly equal to candidate's preferred_name (case-insensitive), OR
      - close in spelling (Jaro-Winkler similarity >= 0.90) to either.

    Used by _try_normalized_search to demote nickname-table inferences and
    distant fuzzy matches to ambiguous (PENDING) when the AI provided only
    a first name to work with.
    """
    t = target_first.strip().lower()
    f = (cand_first or "").strip().lower()
    p = (cand_pref or "").strip().lower()
    if not t or (not f and not p):
        return False
    if (f and t == f) or (p and t == p):
        return True
    sim_f = jellyfish.jaro_winkler_similarity(t, f) if f else 0.0
    sim_p = jellyfish.jaro_winkler_similarity(t, p) if p else 0.0
    return max(sim_f, sim_p) >= _FIRST_NAME_CLOSE_SPELLING_THRESHOLD

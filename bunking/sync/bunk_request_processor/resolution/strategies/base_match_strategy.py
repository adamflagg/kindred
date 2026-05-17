"""Base match strategy for name resolution.

Provides shared functionality for FuzzyMatchStrategy and PhoneticMatchStrategy,
including session disambiguation, confidence calculation, and result building.

All confidence values are loaded from PocketBase config to avoid hardcoding."""

from __future__ import annotations

from abc import abstractmethod
from typing import Any

from ...core.models import Person
from ...data.repositories import AttendeeRepository, PersonRepository
from ..interfaces import ResolutionResult, ResolutionStrategy

# Default fallback values when config is missing
DEFAULT_CONFIDENCE = 0.75
DEFAULT_SESSION_MATCH = 0.80
DEFAULT_SAME_SESSION_BOOST = 0.05
DEFAULT_DIFFERENT_SESSION_PENALTY = -0.10
DEFAULT_NOT_ENROLLED_PENALTY = -0.05  # Person not in attendee list for this year


class BaseMatchStrategy(ResolutionStrategy):
    """Base class for name resolution strategies with shared disambiguation logic.

    Provides common functionality for:
    - Filtering self-references from matches
    - Session-based disambiguation
    - Config-driven confidence calculation
    - Building consistent ambiguous results
    """

    # Subclasses override these to set strategy-specific defaults
    # Subclass-overridable session-adjustment defaults.
    # These are fallbacks when config keys are missing — subclasses should
    # override them to set strategy-specific values.
    _default_same_session_boost: float = DEFAULT_SAME_SESSION_BOOST
    _default_different_session_penalty: float = DEFAULT_DIFFERENT_SESSION_PENALTY
    _default_not_enrolled_penalty: float = DEFAULT_NOT_ENROLLED_PENALTY

    def __init__(
        self,
        person_repository: PersonRepository,
        attendee_repository: AttendeeRepository,
        config: dict[str, Any] | None = None,
    ):
        """Initialize the base match strategy.

        Args:
            person_repository: Repository for person data access
            attendee_repository: Repository for attendee data access
            config: Strategy-specific confidence config from PocketBase
        """
        self.person_repo = person_repository
        self.attendee_repo = attendee_repository
        self.config = config or {}

        # Allow subclasses to set their strategy name
        self._strategy_name = "base_match"

    @property
    def name(self) -> str:
        """Strategy name for logging"""
        return self._strategy_name

    @abstractmethod
    def resolve(
        self,
        name: str,
        requester_cm_id: int,
        session_cm_id: int | None = None,
        year: int | None = None,
    ) -> ResolutionResult:
        """Attempt to resolve a name. Must be implemented by subclasses."""
        pass

    def _filter_self_references(self, matches: list[Person], requester_cm_id: int) -> list[Person]:
        """Filter out the requester from the matches list.

        Args:
            matches: List of candidate persons
            requester_cm_id: The person making the request

        Returns:
            Filtered list without the requester
        """
        return [m for m in matches if m.cm_id != requester_cm_id]

    def _disambiguate_with_session_context(
        self,
        matches: list[Person],
        requester_cm_id: int,
        session_cm_id: int,
        year: int,
        attendee_info: dict[int, dict[str, Any]] | None,
    ) -> ResolutionResult:
        """Try to disambiguate using session information from pre-loaded data.

        Args:
            matches: List of candidate persons
            requester_cm_id: The person making the request
            session_cm_id: The session to match against
            year: Year context
            attendee_info: Pre-loaded attendee info {person_cm_id: {'session_cm_id': ...}}

        Returns:
            ResolutionResult - resolved if exactly one match in same session
        """
        if not attendee_info:
            return ResolutionResult(confidence=0.0, method=self.name)

        # Filter by same session using pre-loaded attendee info
        same_session_matches = []
        for m in matches:
            person_info = attendee_info.get(m.cm_id)
            if person_info and person_info.get("session_cm_id") == session_cm_id:
                same_session_matches.append(m)

        if len(same_session_matches) == 1:
            # Get session_match confidence from config with fallback
            confidence = self.config.get("session_match", DEFAULT_SESSION_MATCH)
            return ResolutionResult(
                person=same_session_matches[0],
                confidence=confidence,
                method=self.name,
                metadata={"session_match": "exact"},
            )

        return ResolutionResult(confidence=0.0, method=self.name)

    def _calculate_base_confidence(self, match_type: str) -> float:
        """Calculate base confidence for a match type from config.

        Args:
            match_type: The type of match (nickname, normalized, soundex, etc.)

        Returns:
            Base confidence value from config, or default fallback
        """
        # Map match type to config key
        config_key = f"{match_type}_base"

        # Try to get from config, fall back to default_base, then hardcoded default
        if config_key in self.config:
            return float(self.config[config_key])

        return float(self.config.get("default_base", DEFAULT_CONFIDENCE))

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
        # If no session context available (missing data), apply slight penalty
        if not session_cm_id or not attendee_info:
            penalty = float(self._get_confidence("not_enrolled_penalty", self._default_not_enrolled_penalty))
            return base_confidence + penalty

        person_info = attendee_info.get(person.cm_id)

        # If person not enrolled as attendee this year, apply penalty
        if not person_info:
            penalty = float(self._get_confidence("not_enrolled_penalty", self._default_not_enrolled_penalty))
            return base_confidence + penalty

        person_session = person_info.get("session_cm_id")

        if person_session == session_cm_id:
            # Same session - apply boost
            boost = float(self._get_confidence("same_session_boost", self._default_same_session_boost))
            return base_confidence + boost
        else:
            # Different session - apply penalty
            penalty = float(self._get_confidence("different_session_penalty", self._default_different_session_penalty))
            return base_confidence + penalty

    def _get_confidence(self, key: str, default: float) -> float:
        """Get confidence value from config with fallback to default.

        Args:
            key: Config key like 'soundex_base', 'session_match', etc.
            default: Default value if not in config

        Returns:
            Confidence value from config or default
        """
        return float(self.config.get(key, default))

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
        if requester_session is None:
            # No session context - apply slight penalty
            penalty = float(self._get_confidence("not_enrolled_penalty", self._default_not_enrolled_penalty))
            return base_confidence + penalty

        if person_session is None:
            # Person not in known session - apply slight penalty
            penalty = float(self._get_confidence("not_enrolled_penalty", self._default_not_enrolled_penalty))
            return base_confidence + penalty

        if person_session == requester_session:
            # Same session - apply boost
            boost = float(self._get_confidence("same_session_boost", self._default_same_session_boost))
            return base_confidence + boost
        else:
            # Different session - apply penalty
            penalty = float(self._get_confidence("different_session_penalty", self._default_different_session_penalty))
            return base_confidence + penalty

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
    import jellyfish  # local import to mirror existing pattern in fuzzy_match.py:538

    t = target_first.strip().lower()
    f = (cand_first or "").strip().lower()
    p = (cand_pref or "").strip().lower()
    if not t or not f:
        return False
    if t == f or (p and t == p):
        return True
    sim_f = jellyfish.jaro_winkler_similarity(t, f)
    sim_p = jellyfish.jaro_winkler_similarity(t, p) if p else 0.0
    return max(sim_f, sim_p) >= _FIRST_NAME_CLOSE_SPELLING_THRESHOLD

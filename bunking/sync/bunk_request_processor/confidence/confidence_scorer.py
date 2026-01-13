"""Native V2 Confidence Scorer - Direct implementation without adapter pattern

This replaces the ConfidenceScorerAdapter with a native implementation
that works directly with V2 models and data structures."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from ..core.models import ParsedRequest, RequestSource, RequestType
from ..resolution.interfaces import ResolutionResult
from .social_graph_signals import SocialGraphSignals

logger = logging.getLogger(__name__)


@dataclass
class V2ConfidenceSignals:
    """All signals that contribute to confidence scoring in V2"""

    # AI parsing signals
    ai_parse_confidence: float = 0.0
    request_clarity: float = 0.0
    match_certainty: str = "none"  # exact, partial, ambiguous, none
    requires_clarification: bool = False
    ambiguity_reason: str | None = None

    # Name matching signals
    name_match_exact: bool = False
    name_match_unique: bool = False
    name_disambiguation_score: float = 0.0

    # Context signals
    same_session: bool = False
    grade_proximity: int = 999  # Grade difference
    age_proximity: float = 999.0  # Age difference in years

    # Social signals
    mutual_request: bool = False
    prior_year_together: bool = False
    common_friends: int = 0

    # NetworkX social graph signals
    in_ego_network: bool = False
    social_distance: int = 999
    shared_connections: int = 0
    network_density: float = 0.0
    ego_network_size: int = 0

    # Request metadata
    source_type: str = "parent"
    has_specific_names: bool = False

    # Validation signals
    found_in_current_year: bool = False
    found_in_previous_year_only: bool = False


class ConfidenceScorer:
    """Native V2 confidence scorer without adapter overhead"""

    def __init__(
        self,
        config: dict[str, Any] | None = None,
        attendee_repo: Any | None = None,
        social_graph_signals: SocialGraphSignals | None = None,
        person_repo: Any | None = None,
    ):
        """Initialize the V2 confidence scorer.

        Args:
            config: Configuration for scoring weights and thresholds
            attendee_repo: Repository for attendee validation
            social_graph_signals: Service for social network signals
            person_repo: Repository for person data (grade, birth_date)
        """
        self.config = config or {}
        self.attendee_repo = attendee_repo
        self.social_graph_signals = social_graph_signals
        self.person_repo = person_repo

        # Extract scoring config
        self.scoring_config = self.config.get("confidence_scoring", {})

    def score_parsed_request(
        self, parsed_request: ParsedRequest, resolution_result: ResolutionResult | None = None
    ) -> float:
        """Calculate confidence score for a parsed request.

        Args:
            parsed_request: The parsed request from Phase 1
            resolution_result: Optional resolution result from Phase 2

        Returns:
            Confidence score between 0.0 and 1.0
        """
        # Build confidence signals
        signals = self._build_signals_from_parsed_request(parsed_request, resolution_result)

        # Calculate score based on request type
        return self._calculate_score(signals, parsed_request.request_type)

    def score_resolution(
        self, parsed_request: ParsedRequest, resolution_result: ResolutionResult, requester_cm_id: int, year: int
    ) -> float:
        """Calculate confidence score for a resolution result.

            if ai_provided_id and target_cm_id:
                confidence = min(1.0, confidence + 0.15)

        Args:
            parsed_request: The original parsed request
            resolution_result: The resolution result from Phase 2
            requester_cm_id: The requester's CM ID
            year: The year being processed

        Returns:
            Confidence score between 0.0 and 1.0
        """
        # Build comprehensive signals including social
        signals = self._build_signals_from_resolution(parsed_request, resolution_result, requester_cm_id, year)

        # Calculate base score
        score = self._calculate_score(signals, parsed_request.request_type)

        if self._has_ai_provided_id(parsed_request, resolution_result):
            # Get ai_boost from config, default to 0.15
            ai_boost = self.scoring_config.get("ai_boost", 0.15)
            score = min(1.0, score + ai_boost)
            logger.debug(f"Applied AI confidence boost: +{ai_boost} -> {score:.2f}")

        return score

    def _has_ai_provided_id(self, parsed_request: ParsedRequest, resolution_result: ResolutionResult) -> bool:
        """Check if AI provided a valid person ID that was resolved.

            if ai_provided_id and target_cm_id:

        Args:
            parsed_request: The parsed request with potential AI metadata
            resolution_result: The resolution result

        Returns:
            True if both conditions are met:
            1. AI provided a person ID (ai_provided_person_id flag)
            2. Target was successfully resolved
        """
        # Check if resolution was successful
        if not resolution_result or not resolution_result.is_resolved:
            return False

        # Check for ai_provided_person_id flag in parsed request metadata
        metadata = parsed_request.metadata or {}
        if metadata.get("ai_provided_person_id"):
            return True

        # Also check resolution result metadata (for AI-resolved cases)
        result_metadata = resolution_result.metadata or {}
        return bool(result_metadata.get("ai_provided_person_id"))

    def _build_signals_from_parsed_request(
        self, parsed_request: ParsedRequest, resolution_result: ResolutionResult | None
    ) -> V2ConfidenceSignals:
        """Build confidence signals from parsed request and optional resolution"""
        signals = V2ConfidenceSignals()

        # AI parsing signals
        signals.ai_parse_confidence = parsed_request.confidence
        signals.request_clarity = parsed_request.confidence

        # Source type
        signals.source_type = self._map_source_type(parsed_request.source)

        # Request-specific signals
        if parsed_request.request_type == RequestType.AGE_PREFERENCE:
            signals.has_specific_names = False
        else:
            signals.has_specific_names = bool(parsed_request.target_name)

        # Resolution signals if available
        if resolution_result:
            if resolution_result.is_resolved:
                signals.match_certainty = "exact" if resolution_result.confidence > 0.9 else "partial"
                signals.name_match_exact = resolution_result.method == "exact_match"
                signals.name_match_unique = resolution_result.method in ["exact_match", "unique_fuzzy"]
                signals.name_disambiguation_score = resolution_result.confidence
            elif resolution_result.is_ambiguous:
                signals.match_certainty = "ambiguous"
                signals.requires_clarification = True
                candidates_list = resolution_result.candidates or []
                signals.ambiguity_reason = f"{len(candidates_list)} candidates"
            else:
                signals.match_certainty = "none"

        return signals

    def _build_signals_from_resolution(
        self, parsed_request: ParsedRequest, resolution_result: ResolutionResult, requester_cm_id: int, year: int
    ) -> V2ConfidenceSignals:
        """Build comprehensive signals including social and validation"""
        # Start with basic signals
        signals = self._build_signals_from_parsed_request(parsed_request, resolution_result)

        # Add resolution-specific signals
        if resolution_result.is_resolved and resolution_result.person:
            target_cm_id = resolution_result.person.cm_id

            # Validate attendee enrollment
            if self.attendee_repo:
                attendee_record = self.attendee_repo.get_by_person_and_year(target_cm_id, year)
                if attendee_record:
                    signals.found_in_current_year = True
                    logger.debug(f"Person {target_cm_id} found enrolled in year {year}")
                else:
                    # Check previous year
                    prev_record = self.attendee_repo.get_by_person_and_year(target_cm_id, year - 1)
                    if prev_record:
                        signals.found_in_previous_year_only = True
                        logger.debug(f"Person {target_cm_id} found in previous year only")

            # Add social graph signals
            if self.social_graph_signals:
                social_data = self.social_graph_signals.get_signals(requester_cm_id, target_cm_id)

                signals.in_ego_network = social_data.get("in_ego_network", False)
                signals.social_distance = social_data.get("social_distance", 999)
                signals.shared_connections = social_data.get("shared_connections", 0)
                signals.network_density = social_data.get("network_density", 0.0)
                signals.ego_network_size = social_data.get("ego_network_size", 0)

            # Calculate grade and age proximity
            if self.person_repo:
                requester = self.person_repo.find_by_cm_id(requester_cm_id)
                if requester:
                    target = resolution_result.person

                    # Grade proximity: abs difference between grades
                    if requester.grade is not None and target.grade is not None:
                        try:
                            signals.grade_proximity = abs(int(requester.grade) - int(target.grade))
                        except (ValueError, TypeError) as e:
                            logger.debug(f"Error calculating grade proximity: {e}")

                    # Age proximity: difference in years from birth dates
                    if requester.birth_date and target.birth_date:
                        try:
                            delta = abs((requester.birth_date - target.birth_date).days)
                            signals.age_proximity = delta / 365.25  # Years
                        except (ValueError, TypeError) as e:
                            logger.debug(f"Error calculating age proximity: {e}")

        return signals

    def _calculate_score(self, signals: V2ConfidenceSignals, request_type: RequestType) -> float:
        """Calculate confidence score based on request type"""
        if request_type == RequestType.BUNK_WITH:
            return self._score_bunk_with(signals)
        elif request_type == RequestType.NOT_BUNK_WITH:
            return self._score_not_bunk_with(signals)
        elif request_type == RequestType.AGE_PREFERENCE:
            return self._score_age_preference(signals)
        else:
            return self._score_generic(signals)

    def _score_bunk_with(self, signals: V2ConfidenceSignals) -> float:
        """Score positive bunking requests"""
        # Get weights from config
        weights = self.scoring_config.get("bunk_with", {}).get(
            "weights", {"name_match": 0.70, "ai_parsing": 0.15, "context": 0.10, "reciprocal_bonus": 0.05}
        )

        # Name matching score
        match_scores = {"exact": 1.0, "partial": 0.7, "ambiguous": 0.4, "none": 0.0}
        name_score = match_scores.get(signals.match_certainty, 0.0)

        # AI parsing score
        ai_score = signals.ai_parse_confidence

        # Get context scores from config (with defaults)
        bunk_with_context = self.scoring_config.get("bunk_with", {}).get("context_scores", {})
        base_context_score = bunk_with_context.get("base", 0.5)
        current_year_score = bunk_with_context.get("current_year", 0.8)
        previous_year_only_score = bunk_with_context.get("previous_year_only", 0.4)
        social_signal_bonus = bunk_with_context.get("social_signal_bonus", 0.1)

        # Social config
        social_config = self.scoring_config.get("bunk_with", {}).get("social", {})
        max_distance_for_bonus = social_config.get("max_distance_for_bonus", 2)

        # Context score
        context_score = base_context_score

        # Found in current year is critical
        if signals.found_in_current_year:
            context_score = current_year_score
        elif signals.found_in_previous_year_only:
            context_score = previous_year_only_score

        # Social signals bonus
        if signals.in_ego_network:
            context_score = min(1.0, context_score + social_signal_bonus)
        if signals.social_distance <= max_distance_for_bonus:
            context_score = min(1.0, context_score + social_signal_bonus)

        # Reciprocal bonus (not implemented yet)
        reciprocal_score = 0.0

        # Weighted combination
        score = (
            weights["name_match"] * name_score
            + weights["ai_parsing"] * ai_score
            + weights["context"] * context_score
            + weights["reciprocal_bonus"] * reciprocal_score
        )

        final_score: float = min(1.0, max(0.0, score))
        return final_score

    def _score_not_bunk_with(self, signals: V2ConfidenceSignals) -> float:
        """Score negative bunking requests"""
        # Similar to bunk_with but with different thresholds
        weights = self.scoring_config.get("not_bunk_with", {}).get(
            "weights", {"name_match": 0.75, "ai_parsing": 0.20, "context": 0.05}
        )

        # Name matching is more critical for negative requests
        match_scores = {"exact": 1.0, "partial": 0.6, "ambiguous": 0.3, "none": 0.0}
        name_score = match_scores.get(signals.match_certainty, 0.0)

        # Get context scores from config (with defaults)
        not_bunk_context = self.scoring_config.get("not_bunk_with", {}).get("context_scores", {})
        current_year_score = not_bunk_context.get("current_year", 0.7)
        previous_year_score = not_bunk_context.get("previous_year_only", 0.3)

        # AI and context scores
        ai_score = signals.ai_parse_confidence
        context_score = current_year_score if signals.found_in_current_year else previous_year_score

        # Weighted combination
        score = (
            weights["name_match"] * name_score + weights["ai_parsing"] * ai_score + weights["context"] * context_score
        )

        final_not_bunk: float = min(1.0, max(0.0, score))
        return final_not_bunk

    def _score_age_preference(self, signals: V2ConfidenceSignals) -> float:
        """Score age preference requests - only AI parsing matters"""
        # For age preferences, we rely entirely on AI parsing
        # since there's no name to resolve
        return signals.ai_parse_confidence

    def _score_generic(self, signals: V2ConfidenceSignals) -> float:
        """Generic scoring for unknown request types"""
        # Average of available signals
        scores = [
            signals.ai_parse_confidence,
            0.5 if signals.match_certainty == "partial" else 1.0 if signals.match_certainty == "exact" else 0.0,
            0.8 if signals.found_in_current_year else 0.3,
        ]
        return sum(scores) / len(scores)

    def _map_source_type(self, source: RequestSource) -> str:
        """Map V2 RequestSource to string for signals"""
        source_map = {RequestSource.FAMILY: "parent", RequestSource.STAFF: "counselor", RequestSource.NOTES: "staff"}
        return source_map.get(source, "parent")

    def create_signals_for_disambiguation(
        self, parsed_request: ParsedRequest, candidates: list[Any], requester_cm_id: int
    ) -> V2ConfidenceSignals:
        """Create confidence signals for Phase 3 disambiguation.

        Args:
            parsed_request: The original parsed request
            candidates: List of candidate persons
            requester_cm_id: The requester's CM ID

        Returns:
            V2ConfidenceSignals for scoring disambiguation results
        """
        signals = V2ConfidenceSignals()

        # Base signals from parsed request
        signals.ai_parse_confidence = parsed_request.confidence
        signals.has_specific_names = bool(parsed_request.target_name)
        signals.source_type = self._map_source_type(parsed_request.source)

        # Disambiguation context
        signals.match_certainty = "ambiguous"
        signals.requires_clarification = True
        signals.ambiguity_reason = f"{len(candidates)} candidates found"

        # Could add social signals for each candidate if needed

        return signals

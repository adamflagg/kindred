"""Reciprocal Detector - Detects bidirectional bunk requests

Identifies when two campers have requested to bunk with each other,
which increases confidence and priority."""

from __future__ import annotations

from dataclasses import dataclass

from ..core.models import BunkRequest, RequestType


@dataclass
class ReciprocalPair:
    """Represents a pair of reciprocal requests"""

    request1: BunkRequest
    request2: BunkRequest
    is_mutual: bool
    combined_priority: int
    confidence_boost: float


class ReciprocalDetector:
    """Detects and handles reciprocal bunk requests"""

    def __init__(self, confidence_boost: float = 0.1):
        """Initialize the detector.

        Args:
            confidence_boost: Amount to boost confidence for reciprocal requests
        """
        self.confidence_boost = confidence_boost

    def detect_reciprocals(self, requests: list[BunkRequest]) -> list[ReciprocalPair]:
        """Detect reciprocal request pairs in a list of requests.

        Args:
            requests: List of bunk requests to analyze

        Returns:
            List of detected reciprocal pairs
        """
        pairs = []
        processed_pairs: set[tuple[int, int]] = set()

        # Filter to only relevant requests (no placeholders, age preferences)
        eligible_requests = [
            r
            for r in requests
            if not r.is_placeholder
            and r.request_type in (RequestType.BUNK_WITH, RequestType.NOT_BUNK_WITH)
            and r.requested_cm_id is not None
        ]

        # Build lookup map for efficiency
        request_map: dict[tuple[int, int | None, RequestType, int], BunkRequest] = {}
        for request in eligible_requests:
            # We already filtered for requested_cm_id is not None above
            requested_cm_id = request.requested_cm_id
            if requested_cm_id is None:
                continue
            key = (request.requester_cm_id, requested_cm_id, request.request_type, request.session_cm_id)
            request_map[key] = request

        # Find reciprocal pairs
        for request in eligible_requests:
            requested_cm_id = request.requested_cm_id
            if requested_cm_id is None:
                continue
            # Look for the reciprocal
            reciprocal_key = (
                requested_cm_id,  # Swapped
                request.requester_cm_id,  # Swapped
                request.request_type,  # Same type
                request.session_cm_id,  # Same session
            )

            if reciprocal_key in request_map:
                # Check if we've already processed this pair
                pair_id: tuple[int, int] = (
                    min(request.requester_cm_id, requested_cm_id),
                    max(request.requester_cm_id, requested_cm_id),
                )
                if pair_id not in processed_pairs:
                    reciprocal = request_map[reciprocal_key]

                    pair = ReciprocalPair(
                        request1=request,
                        request2=reciprocal,
                        is_mutual=True,
                        combined_priority=request.priority + reciprocal.priority,
                        confidence_boost=self.confidence_boost,
                    )

                    pairs.append(pair)
                    processed_pairs.add(pair_id)

        return pairs

    def apply_reciprocal_boost(self, requests: list[BunkRequest]) -> None:
        """Apply confidence boost to reciprocal pairs and update metadata.

        This modifies the requests in-place.

        Args:
            requests: List of bunk requests to process
        """
        pairs = self.detect_reciprocals(requests)

        for pair in pairs:
            # Boost confidence (cap at 1.0)
            pair.request1.confidence_score = min(1.0, pair.request1.confidence_score + self.confidence_boost)
            pair.request2.confidence_score = min(1.0, pair.request2.confidence_score + self.confidence_boost)

            # Update metadata
            pair.request1.metadata["is_reciprocal"] = True
            pair.request1.metadata["reciprocal_with"] = pair.request2.requester_cm_id
            pair.request1.metadata["reciprocal_boost"] = self.confidence_boost

            pair.request2.metadata["is_reciprocal"] = True
            pair.request2.metadata["reciprocal_with"] = pair.request1.requester_cm_id
            pair.request2.metadata["reciprocal_boost"] = self.confidence_boost

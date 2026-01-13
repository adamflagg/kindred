#!/usr/bin/env python3
"""
Conflict detection for bunking requests.
Identifies opposing directional requests and other conflicts that require manual review.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class RequestConflict:
    """Represents a conflict between requests"""

    conflict_type: str  # opposing_directions, age_vs_explicit, resolved_by_staff
    conflict_group_id: str
    person_a: int
    person_b: int | None
    request_a_id: str
    request_b_id: str | None
    description: str
    resolution_suggestion: str | None = None
    auto_resolvable: bool = False
    confidence: float = 0.0


class ConflictDetector:
    """Detect conflicts between bunking requests"""

    def __init__(self) -> None:
        self.conflicts: list[RequestConflict] = []

    def detect_conflicts(self, requests: list[dict[str, Any]]) -> list[RequestConflict]:
        """Detect all conflicts in a set of requests

        Args:
            requests: List of bunk request dictionaries

        Returns:
            List of detected conflicts
        """
        self.conflicts = []

        # Group requests by person for easier conflict detection
        requests_by_person = self._group_by_person(requests)

        # Check for opposing directional requests
        self._detect_opposing_directions(requests_by_person)

        # Check for age preference conflicts
        self._detect_age_preference_conflicts(requests_by_person)

        # Check for not-with conflicts in friend groups
        self._detect_friend_group_conflicts(requests_by_person)

        return self.conflicts

    def _group_by_person(self, requests: list[dict[str, Any]]) -> dict[int, list[dict[str, Any]]]:
        """Group requests by requester person ID"""
        grouped: dict[int, list[dict[str, Any]]] = {}
        for request in requests:
            person_id = request.get("requester_person_cm_id")
            if person_id:
                if person_id not in grouped:
                    grouped[person_id] = []
                grouped[person_id].append(request)
        return grouped

    def _detect_opposing_directions(self, requests_by_person: dict[int, list[dict[str, Any]]]) -> None:
        """Detect A wants B but B doesn't want A conflicts"""

        # Build a map of all positive and negative requests
        positive_requests = {}  # (requester, target) -> request
        negative_requests = {}  # (requester, target) -> request

        for person_id, person_requests in requests_by_person.items():
            for request in person_requests:
                if request["request_type"] == "bunk_with" and request.get("requested_person_cm_id"):
                    key = (person_id, request["requested_person_cm_id"])
                    positive_requests[key] = request
                elif request["request_type"] == "not_bunk_with" and request.get("requested_person_cm_id"):
                    key = (person_id, request["requested_person_cm_id"])
                    negative_requests[key] = request

        # Check for opposing directions
        for (person_a, person_b), positive_request in positive_requests.items():
            # Check if B has a negative request about A
            reverse_key = (person_b, person_a)
            if reverse_key in negative_requests:
                negative_request = negative_requests[reverse_key]

                # Check if there's a recent staff note resolving this
                resolution = self._check_staff_resolution(positive_request, negative_request)

                conflict = RequestConflict(
                    conflict_type="opposing_directions",
                    conflict_group_id=f"conflict_{person_a}_{person_b}_{datetime.now().timestamp()}",
                    person_a=person_a,
                    person_b=person_b,
                    request_a_id=positive_request["id"],
                    request_b_id=negative_request["id"],
                    description=f"Person {person_a} wants to bunk with {person_b}, but {person_b} doesn't want to bunk with {person_a}",
                    resolution_suggestion=resolution["suggestion"] if resolution else None,
                    auto_resolvable=resolution["auto_resolvable"] if resolution else False,
                    confidence=resolution["confidence"] if resolution else 0.0,
                )
                self.conflicts.append(conflict)

    def _check_staff_resolution(
        self, positive_request: dict[str, Any], negative_request: dict[str, Any]
    ) -> dict[str, Any] | None:
        """Check if staff has already resolved this conflict

        Returns dict with:
            - suggestion: Resolution suggestion
            - auto_resolvable: Whether to auto-resolve
            - confidence: Confidence in resolution
        """
        # Look for "spoke to family" or similar in parse notes or AI reasoning
        all_notes = []

        # Collect all relevant notes
        for request in [positive_request, negative_request]:
            if request.get("parse_notes"):
                all_notes.append(request["parse_notes"])
            if request.get("manual_notes"):
                all_notes.append(request["manual_notes"])
            # Check AI reasoning if available
            if request.get("ai_reasoning"):
                try:
                    import json

                    reasoning = json.loads(request["ai_reasoning"])
                    if reasoning.get("notes"):
                        all_notes.append(reasoning["notes"])
                except (KeyError, TypeError):
                    pass

        # Look for resolution patterns
        resolution_patterns = [
            (r"spoke\s+(?:to|with)\s+(?:the\s+)?famil", "Staff spoke with family"),
            (r"parent\s+(?:agreed|confirmed|approved)", "Parent approved"),
            (r"resolved|addressed|handled", "Issue has been resolved"),
            (r"false\s+alarm|misunderstanding", "Was a misunderstanding"),
        ]

        combined_notes = " ".join(all_notes).lower()

        for pattern, suggestion in resolution_patterns:
            if re.search(pattern, combined_notes):
                # Check if resolution is recent (has a date)
                date_match = re.search(r"\(([^)]+\d{4}[^)]*)\)", " ".join(all_notes))
                if date_match:
                    return {
                        "suggestion": f"{suggestion} - {date_match.group(1)}",
                        "auto_resolvable": True,
                        "confidence": 0.90,
                    }
                else:
                    return {
                        "suggestion": suggestion,
                        "auto_resolvable": False,  # No date, needs review
                        "confidence": 0.70,
                    }

        return None

    def _detect_age_preference_conflicts(self, requests_by_person: dict[int, list[dict[str, Any]]]) -> None:
        """Detect conflicts between age preferences and explicit bunk requests"""

        for person_id, person_requests in requests_by_person.items():
            # Find age preferences
            age_prefs = [r for r in person_requests if r["request_type"] == "age_preference"]
            bunk_withs = [r for r in person_requests if r["request_type"] == "bunk_with"]

            if not age_prefs or not bunk_withs:
                continue

            age_pref = age_prefs[0]  # Should only be one per person
            target_direction = age_pref.get("age_preference_target", "")

            # Check each bunk_with request
            for bunk_request in bunk_withs:
                target_person = bunk_request.get("requested_person_cm_id")
                if not target_person:
                    continue

                # Would need grade/age info to properly check
                # For now, flag if explicit age preference exists with high-priority bunk requests
                if age_pref.get("source_detail") == "explicit" and bunk_request.get("priority", 0) >= 8:
                    conflict = RequestConflict(
                        conflict_type="age_vs_explicit",
                        conflict_group_id=f"age_conflict_{person_id}_{datetime.now().timestamp()}",
                        person_a=person_id,
                        person_b=target_person,
                        request_a_id=age_pref["id"],
                        request_b_id=bunk_request["id"],
                        description=f"Person {person_id} has explicit age preference '{target_direction}' but also high-priority request for specific person",
                        resolution_suggestion="Check if requested person matches age preference",
                        auto_resolvable=False,
                        confidence=0.60,
                    )
                    self.conflicts.append(conflict)

    def _detect_friend_group_conflicts(self, requests_by_person: dict[int, list[dict[str, Any]]]) -> None:
        """Detect when someone in a friend group has a not_bunk_with for another member"""

        # First, identify friend groups (mutual bunk_with requests)
        friend_groups = self._identify_friend_groups(requests_by_person)

        # Then check for not_bunk_with within groups
        for group in friend_groups:
            for person_id in group:
                if person_id not in requests_by_person:
                    continue

                # Check if this person has not_bunk_with for anyone in the group
                for request in requests_by_person[person_id]:
                    if request["request_type"] == "not_bunk_with":
                        target = request.get("requested_person_cm_id")
                        if target in group:
                            conflict = RequestConflict(
                                conflict_type="friend_group_conflict",
                                conflict_group_id=f"group_conflict_{person_id}_{target}_{datetime.now().timestamp()}",
                                person_a=person_id,
                                person_b=target,
                                request_a_id=request["id"],
                                request_b_id=None,
                                description=f"Person {person_id} is in a friend group but has 'not_bunk_with' for member {target}",
                                resolution_suggestion="Review friend group composition",
                                auto_resolvable=False,
                                confidence=0.80,
                            )
                            self.conflicts.append(conflict)

    def _identify_friend_groups(self, requests_by_person: dict[int, list[dict[str, Any]]]) -> list[set[int]]:
        """Identify groups of people with mutual bunk requests"""
        groups = []
        processed = set()

        for person_id, person_requests in requests_by_person.items():
            if person_id in processed:
                continue

            # Find all positive requests
            positive_targets = set()
            for request in person_requests:
                if request["request_type"] == "bunk_with" and request.get("requested_person_cm_id"):
                    positive_targets.add(request["requested_person_cm_id"])

            if not positive_targets:
                continue

            # Check for mutual requests to form groups
            group = {person_id}
            for target in positive_targets:
                if target in requests_by_person:
                    # Check if target also requests person_id
                    for target_request in requests_by_person[target]:
                        if (
                            target_request["request_type"] == "bunk_with"
                            and target_request.get("requested_person_cm_id") == person_id
                        ):
                            group.add(target)
                            break

            if len(group) > 1:
                groups.append(group)
                processed.update(group)

        return groups

    def mark_conflicts_on_requests(self, requests: list[dict[str, Any]], conflicts: list[RequestConflict]) -> None:
        """Update requests with conflict information

        Modifies requests in-place to add conflict_group_id
        """
        # Build map of request IDs to conflicts
        request_conflicts = {}
        for conflict in conflicts:
            if conflict.request_a_id:
                request_conflicts[conflict.request_a_id] = conflict
            if conflict.request_b_id:
                request_conflicts[conflict.request_b_id] = conflict

        # Update requests
        for request in requests:
            request_id = request.get("id")
            if request_id in request_conflicts:
                conflict = request_conflicts[request_id]
                request["conflict_group_id"] = conflict.conflict_group_id
                request["requires_manual_review"] = not conflict.auto_resolvable
                if conflict.resolution_suggestion:
                    existing_reason = request.get("manual_review_reason", "")
                    request["manual_review_reason"] = (
                        f"{existing_reason}; {conflict.description}" if existing_reason else conflict.description
                    )

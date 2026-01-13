"""Solution Analysis - Pure functions for analyzing solver results.

These functions are extracted from DirectBunkingSolver to enable unit testing
without requiring full solver setup. All functions are pure - they take explicit
parameters and have no side effects.
"""

from __future__ import annotations

from collections import defaultdict
from typing import TYPE_CHECKING, Any

from bunking.utils.age_preference import is_age_preference_satisfied

if TYPE_CHECKING:
    from bunking.models_v2 import DirectBunk, DirectBunkAssignment, DirectBunkRequest


def calculate_satisfied_requests(
    assignments: list[DirectBunkAssignment],
    requests_by_person: dict[int, list[DirectBunkRequest]],
    person_by_cm_id: dict[int, Any],
) -> dict[int, list[str]]:
    """Calculate which requests were satisfied by the given assignments.

    Args:
        assignments: List of bunk assignments (person_cm_id -> bunk_cm_id)
        requests_by_person: Dict mapping person CM ID to their requests
        person_by_cm_id: Dict mapping person CM ID to person object

    Returns:
        Dict mapping person CM ID to list of satisfied request IDs
    """
    # Build assignment lookup
    person_to_bunk = {a.person_cm_id: a.bunk_cm_id for a in assignments}

    satisfied: dict[int, list[str]] = defaultdict(list)

    for person_cm_id, requests in requests_by_person.items():
        if person_cm_id not in person_to_bunk:
            continue

        person_bunk = person_to_bunk[person_cm_id]

        for request in requests:
            if request.request_type == "bunk_with":
                if (
                    request.requested_person_cm_id
                    and request.requested_person_cm_id in person_to_bunk
                    and person_to_bunk[request.requested_person_cm_id] == person_bunk
                ):
                    satisfied[person_cm_id].append(request.id)

            elif request.request_type == "not_bunk_with":
                if (
                    request.requested_person_cm_id
                    and request.requested_person_cm_id in person_to_bunk
                    and person_to_bunk[request.requested_person_cm_id] != person_bunk
                ):
                    satisfied[person_cm_id].append(request.id)

            elif request.request_type == "age_preference":
                # Check if they have bunkmates matching their preference
                person = person_by_cm_id.get(person_cm_id)
                preference = request.age_preference_target

                if preference and person and person.grade is not None:
                    # Collect grades of all bunkmates (excluding the requester)
                    bunkmate_grades = []
                    for pid, bunk_id in person_to_bunk.items():
                        if bunk_id == person_bunk and pid != person_cm_id:
                            bunkmate = person_by_cm_id.get(pid)
                            if bunkmate and bunkmate.grade is not None:
                                bunkmate_grades.append(bunkmate.grade)

                    # Use shared utility for consistent satisfaction logic
                    is_satisfied, _ = is_age_preference_satisfied(person.grade, bunkmate_grades, preference)
                    if is_satisfied:
                        satisfied[person_cm_id].append(request.id)

    return dict(satisfied)


def calculate_field_level_stats(
    satisfied_requests: dict[int, list[str]],
    requests_by_person: dict[int, list[DirectBunkRequest]],
) -> dict[str, Any]:
    """Calculate request satisfaction statistics broken down by CSV source field.

    Args:
        satisfied_requests: Dict mapping person CM ID to satisfied request IDs
        requests_by_person: Dict mapping person CM ID to their requests

    Returns:
        Dict with field-level stats, explicit CSV stats, and summary
    """
    # Define explicit CSV fields
    explicit_csv_fields = {
        "share_bunk_with",
        "do_not_share_with",
        "bunking_notes",
        "internal_notes",
    }

    # Initialize field stats
    field_stats: dict[str, dict[str, Any]] = {
        "share_bunk_with": {"total": 0, "satisfied": 0, "satisfaction_rate": 0.0},
        "do_not_share_with": {"total": 0, "satisfied": 0, "satisfaction_rate": 0.0},
        "bunking_notes": {"total": 0, "satisfied": 0, "satisfaction_rate": 0.0},
        "internal_notes": {"total": 0, "satisfied": 0, "satisfaction_rate": 0.0},
        "socialize_preference": {"total": 0, "satisfied": 0, "satisfaction_rate": 0.0},
        "other": {"total": 0, "satisfied": 0, "satisfaction_rate": 0.0},
    }

    # Track stats by explicit vs other
    explicit_stats = {"total": 0, "satisfied": 0}

    # Build satisfied request lookup
    satisfied_req_ids: set[str] = set()
    for req_list in satisfied_requests.values():
        satisfied_req_ids.update(req_list)

    # Process all requests
    for requests in requests_by_person.values():
        for request in requests:
            # Get source fields
            source_fields: list[str] = []
            if hasattr(request, "ai_reasoning") and isinstance(request.ai_reasoning, dict):
                source_fields = request.ai_reasoning.get("csv_source_fields", [])
            if not source_fields and hasattr(request, "csv_source_fields") and request.csv_source_fields:
                source_fields = request.csv_source_fields
            if not source_fields and hasattr(request, "source_field") and request.source_field:
                source_fields = [request.source_field]
            if not source_fields:
                source_fields = ["other"]

            # Check if explicit
            is_explicit = any(field in explicit_csv_fields for field in source_fields)

            # Update stats for each source field
            for field in source_fields:
                field_key = field if field in field_stats else "other"
                field_stats[field_key]["total"] += 1

                if request.id in satisfied_req_ids:
                    field_stats[field_key]["satisfied"] += 1

            # Update explicit vs other stats
            if is_explicit:
                explicit_stats["total"] += 1
                if request.id in satisfied_req_ids:
                    explicit_stats["satisfied"] += 1

    # Calculate satisfaction rates
    for field_data in field_stats.values():
        if field_data["total"] > 0:
            field_data["satisfaction_rate"] = field_data["satisfied"] / field_data["total"]

    # Calculate explicit satisfaction rate
    explicit_satisfaction_rate = 0.0
    if explicit_stats["total"] > 0:
        explicit_satisfaction_rate = explicit_stats["satisfied"] / explicit_stats["total"]

    # Count campers with unsatisfied explicit requests
    campers_with_unsatisfied_explicit = 0
    for requests in requests_by_person.values():
        has_explicit = False
        has_satisfied_explicit = False

        for request in requests:
            # Get source fields
            source_fields = []
            if hasattr(request, "ai_reasoning") and isinstance(request.ai_reasoning, dict):
                source_fields = request.ai_reasoning.get("csv_source_fields", [])
            if not source_fields and hasattr(request, "csv_source_fields") and request.csv_source_fields:
                source_fields = request.csv_source_fields
            if not source_fields and hasattr(request, "source_field") and request.source_field:
                source_fields = [request.source_field]

            # Check if explicit
            is_explicit = any(field in explicit_csv_fields for field in source_fields)
            if is_explicit:
                has_explicit = True
                if request.id in satisfied_req_ids:
                    has_satisfied_explicit = True

        if has_explicit and not has_satisfied_explicit:
            campers_with_unsatisfied_explicit += 1

    total_requests = sum(f["total"] for f in field_stats.values())
    total_satisfied = sum(f["satisfied"] for f in field_stats.values())

    return {
        "by_field": field_stats,
        "explicit_csv_requests": {
            "total": explicit_stats["total"],
            "satisfied": explicit_stats["satisfied"],
            "satisfaction_rate": explicit_satisfaction_rate,
            "campers_with_unsatisfied_explicit": campers_with_unsatisfied_explicit,
        },
        "summary": {
            "total_requests": total_requests,
            "total_satisfied": total_satisfied,
            "overall_satisfaction_rate": (total_satisfied / total_requests if total_requests > 0 else 0.0),
        },
    }


def analyze_bunk_health(
    bunk_cm_id: int,
    person_cm_ids: list[int],
    satisfied_requests: dict[int, list[str]],
    requests_by_person: dict[int, list[DirectBunkRequest]],
) -> dict[str, Any]:
    """Analyze the social health of a single bunk.

    Args:
        bunk_cm_id: CampMinder ID of the bunk
        person_cm_ids: List of person CM IDs assigned to this bunk
        satisfied_requests: Dict mapping person CM ID to satisfied request IDs
        requests_by_person: Dict mapping person CM ID to their requests

    Returns:
        Dict with cohesion_score, isolated_count, isolated_campers,
        satisfaction_rate, and warnings
    """
    health: dict[str, Any] = {
        "cohesion_score": 0,
        "isolated_count": 0,
        "isolated_campers": [],
        "satisfaction_rate": 0.0,
        "warnings": [],
    }

    # Count connections within the bunk
    connections: set[tuple[int, int]] = set()  # Use set to avoid double counting
    isolated_campers: list[int] = []
    person_connection_count: dict[int, int] = defaultdict(int)

    # Count all bunk_with connections
    for person_cm_id in person_cm_ids:
        if person_cm_id in requests_by_person:
            for request in requests_by_person[person_cm_id]:
                if request.request_type == "bunk_with" and request.requested_person_cm_id in person_cm_ids:
                    # Add connection (order doesn't matter)
                    sorted_pair = sorted([person_cm_id, request.requested_person_cm_id])
                    conn: tuple[int, int] = (sorted_pair[0], sorted_pair[1])
                    connections.add(conn)
                    person_connection_count[person_cm_id] += 1
                    person_connection_count[request.requested_person_cm_id] += 1

    # Find isolated campers
    for person_cm_id in person_cm_ids:
        if person_connection_count[person_cm_id] == 0:
            isolated_campers.append(person_cm_id)

    connection_count = len(connections)
    total_possible_connections = len(person_cm_ids) * (len(person_cm_ids) - 1) / 2

    health["isolated_count"] = len(isolated_campers)
    health["isolated_campers"] = isolated_campers

    # Calculate cohesion score (density of connections)
    if total_possible_connections > 0:
        health["cohesion_score"] = int((connection_count / total_possible_connections) * 100)

    # Calculate satisfaction rate for this bunk
    bunk_requests = 0
    bunk_satisfied = 0
    for person_cm_id in person_cm_ids:
        if person_cm_id in requests_by_person:
            bunk_requests += len(requests_by_person[person_cm_id])
            bunk_satisfied += len(satisfied_requests.get(person_cm_id, []))

    if bunk_requests > 0:
        health["satisfaction_rate"] = bunk_satisfied / bunk_requests

    return health


def analyze_level_progressions(
    person_to_bunk: dict[int, int],
) -> dict[str, int] | None:
    """Analyze level progressions for returning campers.

    Args:
        person_to_bunk: Dict mapping person CM ID to bunk CM ID

    Returns:
        Dict with 'up', 'flat', 'down' counts, or None if no historical data
    """
    # This would require historical data which we may not have
    # Return None for now - can be implemented when historical data is available
    return None


def get_bunk_name(bunks: list[DirectBunk], bunk_cm_id: int) -> str:
    """Get bunk name from CM ID.

    Args:
        bunks: List of bunk objects
        bunk_cm_id: CampMinder ID of the bunk

    Returns:
        Bunk name, or "Bunk {id}" if not found
    """
    for bunk in bunks:
        if bunk.campminder_id == bunk_cm_id:
            return bunk.name
    return f"Bunk {bunk_cm_id}"


def analyze_solution(
    assignments: list[DirectBunkAssignment],
    satisfied_requests: dict[int, list[str]],
    requests_by_person: dict[int, list[DirectBunkRequest]],
    requests: list[DirectBunkRequest],
    bunks: list[DirectBunk],
) -> dict[str, Any]:
    """Perform post-solve analysis to generate warnings and insights.

    Args:
        assignments: List of bunk assignments
        satisfied_requests: Dict mapping person CM ID to satisfied request IDs
        requests_by_person: Dict mapping person CM ID to their requests
        requests: Full list of all requests
        bunks: List of bunk objects

    Returns:
        Dict with bunk_health, session_metrics, warnings, and field_level_stats
    """
    analysis: dict[str, Any] = {
        "bunk_health": {},
        "session_metrics": {
            "total_isolated": 0,
            "level_progressions": {"up": 0, "flat": 0, "down": 0},
            "overall_satisfaction": 0.0,
        },
        "warnings": [],
        "field_level_stats": calculate_field_level_stats(satisfied_requests, requests_by_person),
    }

    # Build assignment lookup
    person_to_bunk = {a.person_cm_id: a.bunk_cm_id for a in assignments}
    bunk_to_persons: dict[int, list[int]] = defaultdict(list)
    for person_cm_id, bunk_cm_id in person_to_bunk.items():
        bunk_to_persons[bunk_cm_id].append(person_cm_id)

    # Analyze each bunk
    total_isolated = 0
    for bunk_cm_id, person_cm_ids in bunk_to_persons.items():
        bunk_health = analyze_bunk_health(bunk_cm_id, person_cm_ids, satisfied_requests, requests_by_person)
        analysis["bunk_health"][str(bunk_cm_id)] = bunk_health
        total_isolated += bunk_health["isolated_count"]

        # Generate bunk-level warnings
        bunk_name = get_bunk_name(bunks, bunk_cm_id)
        if bunk_health["isolated_count"] > 3:
            analysis["warnings"].append(
                {
                    "type": "isolated",
                    "severity": "high",
                    "affected": [str(pid) for pid in bunk_health["isolated_campers"]],
                    "message": f"Bunk {bunk_name} has {bunk_health['isolated_count']} isolated campers",
                    "suggestion": "Consider moving them with campers from their request list",
                }
            )
        elif bunk_health["cohesion_score"] < 30:
            analysis["warnings"].append(
                {
                    "type": "low_cohesion",
                    "severity": "low",
                    "affected": [str(bunk_cm_id)],
                    "message": f"Bunk {bunk_name} has low social cohesion ({bunk_health['cohesion_score']}%)",
                    "suggestion": "Consider swapping isolated campers",
                }
            )

    analysis["session_metrics"]["total_isolated"] = total_isolated

    # Calculate overall satisfaction
    total_requests = len(requests)
    total_satisfied = sum(len(reqs) for reqs in satisfied_requests.values())
    if total_requests > 0:
        analysis["session_metrics"]["overall_satisfaction"] = total_satisfied / total_requests

    # Analyze level progressions (if historical data available)
    level_progression = analyze_level_progressions(person_to_bunk)
    if level_progression:
        analysis["session_metrics"]["level_progressions"] = level_progression

    return analysis

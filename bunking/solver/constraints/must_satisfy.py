"""
Must Satisfy One Request Constraints - Meta-constraint aggregator.

This module aggregates satisfaction variables from specialized request modules
(bunk_requests.py, age_preference.py) and enforces that each camper has at
least one request satisfied.

The MECHANICS of request satisfaction are handled by:
- bunk_requests.py: bunk_with, not_bunk_with
- age_preference.py: age_preference

This module handles:
1. Request filtering (which requests count as "explicit")
2. Aggregating satisfaction variables from specialized modules
3. Enforcing "at least one satisfied" as a soft constraint
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from .age_preference import add_age_preference_satisfaction_vars
from .base import SolverContext
from .bunk_requests import add_bunk_request_satisfaction_vars

if TYPE_CHECKING:
    from bunking.models_v2 import DirectBunkRequest

logger = logging.getLogger(__name__)

# CSV fields that contain explicit camper requests (not inferred preferences)
EXPLICIT_CSV_FIELDS = {"share_bunk_with", "do_not_share_with", "bunking_notes", "internal_notes"}


def add_must_satisfy_one_request_constraints(ctx: SolverContext) -> None:
    """Add constraints to ensure each camper has at least one request satisfied.

    This is a META-CONSTRAINT that:
    1. Filters requests to only include explicit camper requests
    2. Delegates to specialized modules for satisfaction variable creation
    3. Aggregates satisfaction variables and requires at least one satisfied

    Rules:
    - If camper has bunk_with or not_bunk_with requests, at least one must be satisfied
    - If camper has ONLY age_preference requests, age preference must be satisfied
    - Campers with no requests have no constraint
    """
    if ctx.is_constraint_disabled("must_satisfy_one"):
        logger.info("Must-satisfy-one constraints DISABLED via debug settings")
        return

    # Get configuration values
    enabled = ctx.config.get_constraint("must_satisfy_one", "enabled", default=1)
    fallback_to_age = ctx.config.get_constraint("must_satisfy_one", "fallback_to_age", default=1)
    if not enabled:
        return

    logger.info("=== Must Satisfy One Request Constraints ===")
    logger.info(f"Total campers in solver: {len(ctx.person_ids)}")
    logger.info(f"Campers with requests: {len(ctx.input.requests_by_person)}")

    # Get configuration for handling impossible requests
    ignore_impossible = ctx.config.get_bool("constraint.must_satisfy_one.ignore_impossible_requests", default=True)

    # Step 1: Filter and categorize requests per person
    bunk_requests_by_person: dict[int, list[DirectBunkRequest]] = {}
    age_requests_by_person: dict[int, list[DirectBunkRequest]] = {}

    for person_cm_id, requests in ctx.input.requests_by_person.items():
        if person_cm_id not in ctx.person_idx_map:
            continue

        # Use validated requests if configured to ignore impossible ones
        if ignore_impossible and person_cm_id in ctx.possible_requests:
            requests_to_use = ctx.possible_requests[person_cm_id]
        else:
            requests_to_use = requests

        # Skip if no possible requests
        if ignore_impossible and len(requests_to_use) == 0:
            if len(ctx.impossible_requests.get(person_cm_id, [])) > 0:
                logger.debug(f"Skipping must-satisfy-one for {person_cm_id} - all requests are impossible")
            continue

        # Filter and categorize requests
        bunk_reqs, age_reqs = _filter_and_categorize_requests(requests_to_use)

        if bunk_reqs:
            bunk_requests_by_person[person_cm_id] = bunk_reqs
        if age_reqs:
            age_requests_by_person[person_cm_id] = age_reqs

    # Step 2: Get satisfaction variables from specialized modules
    bunk_sat_vars = add_bunk_request_satisfaction_vars(ctx, bunk_requests_by_person)

    # Only get age preference vars for campers with NO bunk requests (or if fallback enabled)
    age_only_requests: dict[int, list[DirectBunkRequest]] = {}
    if fallback_to_age:
        for person_cm_id, age_reqs in age_requests_by_person.items():
            if person_cm_id not in bunk_requests_by_person:
                age_only_requests[person_cm_id] = age_reqs

    age_sat_vars, _ = add_age_preference_satisfaction_vars(ctx, age_only_requests)

    # Step 3: Aggregate and add "at least one satisfied" constraint per camper
    constraints_added = 0
    campers_without_requests: list[int] = []

    for person_cm_id in ctx.person_ids:
        if person_cm_id not in ctx.input.requests_by_person:
            campers_without_requests.append(person_cm_id)
            continue

        # Combine satisfaction vars from both modules
        all_sat_vars = []
        all_sat_vars.extend(bunk_sat_vars.get(person_cm_id, []))
        all_sat_vars.extend(age_sat_vars.get(person_cm_id, []))

        if not all_sat_vars:
            logger.debug(f"Camper {person_cm_id} has no satisfaction variables")
            continue

        # Add soft constraint: at least one request must be satisfied
        violation = ctx.model.NewBoolVar(f"must_satisfy_violation_{person_cm_id}")

        # violation = 1 when sum(satisfaction_vars) == 0
        # violation = 0 when sum(satisfaction_vars) >= 1
        ctx.model.Add(sum(all_sat_vars) == 0).OnlyEnforceIf(violation)
        ctx.model.Add(sum(all_sat_vars) >= 1).OnlyEnforceIf(violation.Not())

        # Add as soft constraint with configurable penalty
        weight = ctx.config.get_soft_constraint_weight("must_satisfy_one", default=100000)
        ctx.soft_constraint_violations[f"must_satisfy_{person_cm_id}"] = (violation, weight)

        constraints_added += 1

    logger.info(f"Must-satisfy-one soft constraints added for {constraints_added} campers")
    logger.info(f"Campers without requests: {len(campers_without_requests)}")

    if ignore_impossible:
        skipped_count = sum(
            1
            for person_cm_id in ctx.person_ids
            if person_cm_id in ctx.possible_requests
            and len(ctx.possible_requests[person_cm_id]) == 0
            and len(ctx.impossible_requests.get(person_cm_id, [])) > 0
        )
        if skipped_count > 0:
            logger.info(f"Campers with only impossible requests: {skipped_count}")


def _filter_and_categorize_requests(
    requests: list[DirectBunkRequest],
) -> tuple[list[DirectBunkRequest], list[DirectBunkRequest]]:
    """Filter requests to explicit sources and categorize by type.

    Args:
        requests: All requests for a camper

    Returns:
        Tuple of (bunk_requests, age_requests) filtered for explicit sources
    """
    bunk_requests: list[DirectBunkRequest] = []
    age_requests: list[DirectBunkRequest] = []

    for request in requests:
        # Check if request comes from explicit CSV fields
        request_csv_fields = getattr(request, "csv_source_fields", None)
        if not request_csv_fields and hasattr(request, "ai_reasoning") and isinstance(request.ai_reasoning, dict):
            request_csv_fields = request.ai_reasoning.get("csv_source_fields", None)

        if request_csv_fields:
            # Check if ANY of the csv_source_fields are explicit fields
            is_explicit = any(field in EXPLICIT_CSV_FIELDS for field in request_csv_fields)
            if not is_explicit:
                logger.debug(f"Skipping request from {request_csv_fields} for must-satisfy-one (non-explicit)")
                continue
        else:
            # Fallback to old source_field check
            if hasattr(request, "source_field") and request.source_field not in EXPLICIT_CSV_FIELDS:
                # Special handling for backward compatibility
                if request.source_field in ["Request", "multiple_fields"]:
                    pass  # These are likely explicit requests from CSV
                else:
                    logger.debug(f"Skipping request from {request.source_field} field for must-satisfy-one")
                    continue

        # Categorize by request type
        if request.request_type in ["bunk_with", "not_bunk_with"]:
            bunk_requests.append(request)
        elif request.request_type == "age_preference":
            # Only include age preferences from explicit CSV fields (not socialize_preference)
            if (
                request_csv_fields
                and "socialize_preference" not in request_csv_fields
                or (
                    not request_csv_fields
                    and hasattr(request, "source_field")
                    and request.source_field != "socialize_preference"
                )
            ):
                age_requests.append(request)

    return bunk_requests, age_requests

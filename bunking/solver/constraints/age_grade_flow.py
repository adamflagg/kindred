"""
Age/Grade Flow Objective - Encourage natural age/grade progression across cabin numbers.

Uses TARGET GRADE DISTRIBUTION approach:
1. Sort campers by grade for each gender/session
2. Divide into N groups (one per bunk)
3. Calculate target average grade for each bunk
4. Give bonus for camper being in bunk with matching target grade

This eliminates the "middle bunk double bonus" problem from pairwise comparisons
and naturally handles skewed grade distributions.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from typing import TYPE_CHECKING, Any

from ..bunk_ordering import get_bunk_rank
from .base import SolverContext

if TYPE_CHECKING:
    from bunking.models_v2 import DirectBunk

logger = logging.getLogger(__name__)


def add_age_grade_flow_objective(ctx: SolverContext, objective_terms: list[Any]) -> None:
    """Add objective terms to encourage age/grade flow from low to high cabin numbers.

    Uses TARGET GRADE DISTRIBUTION approach:
    1. Sort campers by grade for each gender/session
    2. Divide into N groups (one per bunk)
    3. Calculate target average grade for each bunk
    4. Give bonus for camper being in bunk with matching target grade

    Args:
        ctx: Solver context with model, assignments, and mappings
        objective_terms: List to append bonus terms to
    """
    # Check if age/grade flow is enabled in config
    grade_target_weight = ctx.config.get_soft_constraint_weight("age_grade_flow", default=300)
    if grade_target_weight <= 0:
        return

    logger.info(f"Adding target grade distribution incentives (weight: {grade_target_weight})")

    # Group bunks by gender AND session
    bunks_by_gender_session: dict[tuple[str, int], list[DirectBunk]] = defaultdict(list)

    for bunk in ctx.bunks:
        if bunk.gender in ["M", "F"]:  # Only process single-gender bunks
            key = (bunk.gender, bunk.session_cm_id)
            bunks_by_gender_session[key].append(bunk)

    # Sort bunks by level within each gender/session group
    def bunk_sort_key(bunk: DirectBunk) -> tuple[int, int]:
        rank = get_bunk_rank(bunk.name)
        if rank is None:
            return (999, 0)
        return rank

    for key in bunks_by_gender_session:
        bunks_by_gender_session[key].sort(key=bunk_sort_key)

    total_incentives_added = 0

    # Process each gender/session group
    for (gender, session_cm_id), session_bunks in bunks_by_gender_session.items():
        if len(session_bunks) < 2:
            continue

        # Get campers for this gender/session, sorted by grade (then age)
        group_campers = sorted(
            [
                p
                for p in ctx.persons
                if p.campminder_person_id in ctx.person_idx_map
                and p.gender == gender
                and p.session_cm_id == session_cm_id
                and p.grade is not None
            ],
            key=lambda p: (p.grade, p.age),
        )

        if not group_campers:
            continue

        num_bunks = len(session_bunks)
        campers_per_bunk = len(group_campers) / num_bunks

        # Calculate target grade for each bunk based on ideal distribution
        bunk_targets: dict[int, float] = {}  # bunk_cm_id -> target_grade

        for bunk_idx, bunk in enumerate(session_bunks):
            start = int(bunk_idx * campers_per_bunk)
            end = int((bunk_idx + 1) * campers_per_bunk)
            # Handle last bunk getting any remainder
            if bunk_idx == num_bunks - 1:
                end = len(group_campers)

            slice_campers = group_campers[start:end]

            if slice_campers:
                avg_grade = sum(c.grade for c in slice_campers) / len(slice_campers)
                bunk_targets[bunk.campminder_id] = avg_grade

        # Log target distribution
        target_str = ", ".join(f"{b.name}={bunk_targets.get(b.campminder_id, 0):.2f}" for b in session_bunks)
        logger.info(f"Target grades for {gender}: {target_str}")

        # Calculate grade range for normalization
        all_grades = [c.grade for c in group_campers]
        min_grade = min(all_grades)
        max_grade = max(all_grades)
        grade_range = max(1, max_grade - min_grade)

        # Add incentives for each camper-bunk pair
        # DEBUG: Track bonuses for specific bunks
        debug_bunk_bonuses: dict[str, dict[int, int]] = {}  # bunk_name -> {grade: total_bonus}

        for camper in group_campers:
            person_idx = ctx.person_idx_map.get(camper.campminder_person_id)
            if person_idx is None:
                continue

            for bunk in session_bunks:
                target = bunk_targets.get(bunk.campminder_id)
                if target is None:
                    continue

                bunk_idx = ctx.bunk_idx_map[bunk.campminder_id]

                # Calculate fit: 1.0 when perfect match, 0.0 when max distance
                grade_diff = abs(camper.grade - target)
                fit_score = max(0.0, 1.0 - grade_diff / grade_range)

                # Convert to integer bonus
                bonus = int(fit_score * grade_target_weight)

                if bonus > 0:
                    objective_terms.append(bonus * ctx.assignments[(person_idx, bunk_idx)])
                    total_incentives_added += 1

                    # DEBUG: Track for G-6B and G-7
                    if bunk.name in ("G-6B", "G-7"):
                        if bunk.name not in debug_bunk_bonuses:
                            debug_bunk_bonuses[bunk.name] = {}
                        grade = camper.grade
                        if grade not in debug_bunk_bonuses[bunk.name]:
                            debug_bunk_bonuses[bunk.name][grade] = 0
                        debug_bunk_bonuses[bunk.name][grade] += bonus

        # DEBUG: Log bonuses for G-6B and G-7
        for bunk_name in ["G-6B", "G-7"]:
            if bunk_name in debug_bunk_bonuses:
                logger.info(f"DEBUG {bunk_name} bonuses by grade: {debug_bunk_bonuses[bunk_name]}")

    logger.info(f"Added {total_incentives_added} target grade incentives")

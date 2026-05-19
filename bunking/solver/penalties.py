"""Single source of truth for solver penalty config reads.

Constraint modules (which add OR-Tools cost terms) AND post-solve
evaluators (which replicate the score) must use the same values.
This module is the only place these keys are read so the two paths
cannot drift out of sync (which previously caused B1/B2/B3/B4 — the
displayed score showed magnitudes 30-100x lower than what the solver
was actually optimizing).

Canonical keys:
- constraint.cabin_minimum_occupancy.penalty

(``constraint.cabin_capacity.penalty`` was removed in PR #1226 along with the
soft cabin-capacity constraint path. ``constraint.cabin_minimum_occupancy.min``
was removed in PR #1331 — the threshold is now the hardcoded
``MIN_BUNK_OCCUPANCY`` constant; ``min_occupancy_threshold()`` is preserved as
a thin wrapper so existing call sites and the centralization invariant tests
keep working. ``constraint.grade_spread.penalty`` was removed in Phase 2 along
with the soft grade_spread path; the threshold is now the hardcoded
``MAX_UNIQUE_GRADES_PER_BUNK`` constant.)

All accessors use ``ConfigLoader.get_instance()`` so they pick up the
active loader (real PocketBase-backed loader in production, a
``MockConfigLoader`` injected via ``ConfigLoader.use(...)`` in tests).
"""

from __future__ import annotations

from bunking.config import ConfigLoader
from bunking.solver.constants import MIN_BUNK_OCCUPANCY


def min_occupancy_penalty() -> int:
    """Penalty per camper of under-occupancy deficit."""
    return ConfigLoader.get_instance().get_int("constraint.cabin_minimum_occupancy.penalty")


def min_occupancy_threshold() -> int:
    """Minimum acceptable cabin occupancy (campers per cabin).

    Hardcoded to ``MIN_BUNK_OCCUPANCY`` — the value was never tuned at runtime
    and is now a code-only constant. Kept as a function so existing call sites
    that import this accessor (constraint module, post-solve evaluators, tests
    that pin the centralization invariant) keep working without churn.
    """
    return MIN_BUNK_OCCUPANCY

"""Single source of truth for solver penalty config reads.

Constraint modules (which add OR-Tools cost terms) AND post-solve
evaluators (which replicate the score) must use the same values.
This module is the only place these keys are read so the two paths
cannot drift out of sync (which previously caused B1/B2/B3/B4 — the
displayed score showed magnitudes 30-100x lower than what the solver
was actually optimizing).

Canonical keys:
- constraint.cabin_minimum_occupancy.penalty
- constraint.cabin_minimum_occupancy.min
- constraint.grade_spread.penalty

(``constraint.cabin_capacity.penalty`` was removed in Phase 2 along with the
soft cabin-capacity constraint path — the solver enforces capacity as a hard
constraint, so there is no over-capacity penalty term to read.)

All accessors use ``ConfigLoader.get_instance()`` so they pick up the
active loader (real PocketBase-backed loader in production, a
``MockConfigLoader`` injected via ``ConfigLoader.use(...)`` in tests).
"""

from __future__ import annotations

from bunking.config import ConfigLoader


def min_occupancy_penalty() -> int:
    """Penalty per camper of under-occupancy deficit."""
    return ConfigLoader.get_instance().get_int("constraint.cabin_minimum_occupancy.penalty")


def grade_spread_penalty() -> int:
    """Penalty per excess unique grade beyond the configured maximum."""
    return ConfigLoader.get_instance().get_int("constraint.grade_spread.penalty")


def min_occupancy_threshold() -> int:
    """Minimum acceptable cabin occupancy (campers per cabin)."""
    return ConfigLoader.get_instance().get_int("constraint.cabin_minimum_occupancy.min")

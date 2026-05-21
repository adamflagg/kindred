"""Test the centralized penalty accessors.

These accessors are the single source of truth for solver penalty config reads.
Constraint modules (which add OR-Tools cost terms) and post-solve evaluators
(which replicate the score) must read penalties through these functions so the
two paths cannot drift out of sync.
"""

from bunking.solver.penalties import (
    min_occupancy_penalty,
    min_occupancy_threshold,
)


def _set(mock_config: object, key: str, value: int) -> None:
    """Set a key on the MockConfigLoader (no .set helper exists)."""
    mock_config._config[key] = value  # type: ignore[attr-defined]


def test_min_occupancy_penalty_reads_canonical_key(mock_config):
    _set(mock_config, "constraint.cabin_minimum_occupancy.penalty", 678)
    assert min_occupancy_penalty() == 678


def test_min_occupancy_threshold_returns_hardcoded_constant(mock_config):
    """After Phase 2 cleanup the threshold is hardcoded — the accessor returns
    MIN_BUNK_OCCUPANCY (=8) regardless of config. Tests that previously set
    `constraint.cabin_minimum_occupancy.min` to a different value should not
    expect that value to be honored.
    """
    from bunking.solver.constants import MIN_BUNK_OCCUPANCY

    _set(mock_config, "constraint.cabin_minimum_occupancy.min", 7)
    assert min_occupancy_threshold() == MIN_BUNK_OCCUPANCY == 8


def test_min_occupancy_uses_get_instance(mock_config):
    """The accessor must read via ConfigLoader.get_instance(), not a snapshot."""
    _set(mock_config, "constraint.cabin_minimum_occupancy.penalty", 1)
    assert min_occupancy_penalty() == 1
    _set(mock_config, "constraint.cabin_minimum_occupancy.penalty", 2)
    # If the accessor cached the previous read, this would still return 1.
    assert min_occupancy_penalty() == 2

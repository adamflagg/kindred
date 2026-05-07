"""Test the centralized penalty accessors.

These accessors are the single source of truth for solver penalty config reads.
Constraint modules (which add OR-Tools cost terms) and post-solve evaluators
(which replicate the score) must read penalties through these functions so the
two paths cannot drift out of sync.
"""

from __future__ import annotations

import pytest

from bunking.config import ConfigLoader
from bunking.solver.penalties import (
    cabin_capacity_penalty,
    grade_spread_penalty,
    min_occupancy_penalty,
    min_occupancy_threshold,
)


def _set(mock_config, key: str, value: int) -> None:
    """Set a key on the MockConfigLoader (no .set helper exists)."""
    mock_config._config[key] = value


def test_cabin_capacity_penalty_reads_canonical_key(mock_config):
    _set(mock_config, "constraint.cabin_capacity.penalty", 12345)
    assert cabin_capacity_penalty() == 12345


def test_min_occupancy_penalty_reads_canonical_key(mock_config):
    _set(mock_config, "constraint.cabin_minimum_occupancy.penalty", 678)
    assert min_occupancy_penalty() == 678


def test_grade_spread_penalty_reads_canonical_key(mock_config):
    _set(mock_config, "constraint.grade_spread.penalty", 9999)
    assert grade_spread_penalty() == 9999


def test_min_occupancy_threshold_reads_canonical_key(mock_config):
    _set(mock_config, "constraint.cabin_minimum_occupancy.min", 7)
    assert min_occupancy_threshold() == 7


def test_accessors_use_get_instance(mock_config):
    """The accessors must read via ConfigLoader.get_instance(), not a snapshot."""
    _set(mock_config, "constraint.cabin_capacity.penalty", 1)
    assert cabin_capacity_penalty() == 1
    _set(mock_config, "constraint.cabin_capacity.penalty", 2)
    # If the accessor cached the previous read, this would still return 1.
    assert cabin_capacity_penalty() == 2

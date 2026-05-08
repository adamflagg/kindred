"""Tests for solver capacity constants.

Phase 2 cleanup: cabin capacity collapses from 4 PB config keys + 1 Pydantic
default into 2 hardcoded constants. These tests pin the values so a future
change to either is a deliberate code edit, not config drift.
"""

from __future__ import annotations


def test_default_bunk_capacity_is_12():
    from bunking.solver.constants import DEFAULT_BUNK_CAPACITY

    assert DEFAULT_BUNK_CAPACITY == 12


def test_max_bunk_capacity_is_14():
    from bunking.solver.constants import MAX_BUNK_CAPACITY

    assert MAX_BUNK_CAPACITY == 14


def test_max_strictly_greater_than_default():
    """The staff-edit ceiling must exceed the solver standard so manual overrides
    have headroom (the 12→13/14 staff judgment-call workflow)."""
    from bunking.solver.constants import DEFAULT_BUNK_CAPACITY, MAX_BUNK_CAPACITY

    assert MAX_BUNK_CAPACITY > DEFAULT_BUNK_CAPACITY

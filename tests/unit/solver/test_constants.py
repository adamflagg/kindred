"""Tests for solver capacity and occupancy constants.

Phase 2 cleanup: cabin capacity collapses from 4 PB config keys + 1 Pydantic
default into 2 hardcoded constants; cabin minimum occupancy collapses from 5
PB config keys into 2 hardcoded constants (+ keeps the `penalty` knob). These
tests pin the values so a future change is a deliberate code edit, not config
drift.
"""


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


def test_min_bunk_occupancy_is_8():
    from bunking.solver.constants import MIN_BUNK_OCCUPANCY

    assert MIN_BUNK_OCCUPANCY == 8


def test_preferred_bunk_occupancy_is_10():
    from bunking.solver.constants import PREFERRED_BUNK_OCCUPANCY

    assert PREFERRED_BUNK_OCCUPANCY == 10


def test_preferred_strictly_greater_than_min():
    """Soft-underfill penalty path requires preferred > min so there is a
    non-empty (min, preferred] band where the per-spot penalty applies."""
    from bunking.solver.constants import MIN_BUNK_OCCUPANCY, PREFERRED_BUNK_OCCUPANCY

    assert PREFERRED_BUNK_OCCUPANCY > MIN_BUNK_OCCUPANCY


def test_default_capacity_strictly_greater_than_preferred_occupancy():
    """Sanity: a bunk's hard cap must exceed the soft-fill target. Otherwise
    every used bunk would carry an underfill penalty even when fully loaded."""
    from bunking.solver.constants import DEFAULT_BUNK_CAPACITY, PREFERRED_BUNK_OCCUPANCY

    assert DEFAULT_BUNK_CAPACITY > PREFERRED_BUNK_OCCUPANCY

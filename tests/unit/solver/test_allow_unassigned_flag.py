"""Task 4: allow_unassigned flag on DirectSolverInput (#1609).

Verifies the new field exists and defaults to False — so that all existing
full-solve code paths are unaffected.
"""

from bunking.models_v2 import DirectSolverInput


def test_allow_unassigned_defaults_false():
    inp = DirectSolverInput(persons=[], requests=[], bunks=[])
    assert inp.allow_unassigned is False

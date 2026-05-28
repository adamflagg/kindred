"""The `allow_unassigned` field was removed: the solver always requires every
working-set camper to be placed.
"""

from bunking.models_v2 import DirectSolverInput


def test_direct_solver_input_does_not_expose_allow_unassigned() -> None:
    assert "allow_unassigned" not in DirectSolverInput.model_fields

import inspect

from api.services.solver_runner import run_solver_task_v2


def test_run_solver_task_v2_accepts_respect_locks():
    """run_solver_task_v2 should accept a respect_locks parameter."""
    sig = inspect.signature(run_solver_task_v2)
    assert "respect_locks" in sig.parameters
    # Default should be True
    assert sig.parameters["respect_locks"].default is True


def test_run_solver_task_v2_accepts_partial_resolve_params():
    """run_solver_task_v2 should accept locked_bunk_cm_ids and allow_overflow (#1609)."""
    sig = inspect.signature(run_solver_task_v2)
    assert "locked_bunk_cm_ids" in sig.parameters
    assert sig.parameters["locked_bunk_cm_ids"].default is None
    assert "allow_overflow" in sig.parameters
    assert sig.parameters["allow_overflow"].default is False

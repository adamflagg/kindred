import inspect

from api.services.solver_runner import run_solver_task_v2


def test_run_solver_task_v2_accepts_respect_locks():
    """run_solver_task_v2 should accept a respect_locks parameter."""
    sig = inspect.signature(run_solver_task_v2)
    assert "respect_locks" in sig.parameters
    # Default should be True
    assert sig.parameters["respect_locks"].default is True

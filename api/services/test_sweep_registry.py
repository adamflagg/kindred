"""TDD tests for in-memory sweep registry."""

from api.services.sweep_registry import SweepRegistry


def test_register_creates_entry() -> None:
    reg = SweepRegistry()
    reg.register("sw_1")
    assert reg.is_cancelled("sw_1") is False


def test_unregistered_sweep_is_not_cancelled() -> None:
    """Defensive: unknown sweep_id reads as not-cancelled."""
    reg = SweepRegistry()
    assert reg.is_cancelled("unknown") is False


def test_cancel_marks_sweep_cancelled() -> None:
    reg = SweepRegistry()
    reg.register("sw_1")
    reg.cancel("sw_1")
    assert reg.is_cancelled("sw_1") is True


def test_cancel_unknown_sweep_is_noop() -> None:
    reg = SweepRegistry()
    reg.cancel("unknown")  # must not raise


def test_release_clears_entry() -> None:
    reg = SweepRegistry()
    reg.register("sw_1")
    reg.cancel("sw_1")
    reg.release("sw_1")
    assert reg.is_cancelled("sw_1") is False  # back to default

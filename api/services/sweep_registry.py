"""In-process sweep cancellation registry.

Sweep cancel state intentionally lives in process memory only — a process
restart kills any in-flight sweep anyway, and the value of cancelling
across a restart is zero.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass


@dataclass
class _SweepState:
    cancelled: bool = False


class SweepRegistry:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._sweeps: dict[str, _SweepState] = {}

    def register(self, sweep_id: str) -> None:
        with self._lock:
            self._sweeps[sweep_id] = _SweepState()

    def cancel(self, sweep_id: str) -> None:
        with self._lock:
            state = self._sweeps.get(sweep_id)
            if state is not None:
                state.cancelled = True

    def is_cancelled(self, sweep_id: str) -> bool:
        with self._lock:
            state = self._sweeps.get(sweep_id)
            return state is not None and state.cancelled

    def release(self, sweep_id: str) -> None:
        with self._lock:
            self._sweeps.pop(sweep_id, None)


# Process-wide singleton (mirrors the in-memory `solver_runs` dict pattern).
sweep_registry = SweepRegistry()

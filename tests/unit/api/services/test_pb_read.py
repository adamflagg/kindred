import ast
import asyncio
import threading
import time
from pathlib import Path

import pytest

from api.services.pb_read import PB_READ_CONCURRENCY, pb_read

# WRITES stay outside the limit so a staff save never queues behind a season rebuild. Each name is the first
# positional argument of an `asyncio.to_thread` call that writes: commit_aid_writes (batch commit + change log),
# record_change (one aid_change_log row).
_WRITE_CALLEES = {"commit_aid_writes", "record_change"}


def _bare_to_thread_reads(root: Path, pattern: str) -> list[str]:
    paths = sorted(root.glob(pattern))
    assert paths, f"no {pattern} under {root}: the scan would pass vacuously"
    offenders: list[str] = []
    for path in paths:
        for node in ast.walk(ast.parse(path.read_text())):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            if not (isinstance(func, ast.Attribute) and func.attr == "to_thread"):
                continue
            if not (isinstance(func.value, ast.Name) and func.value.id == "asyncio"):
                continue
            first = node.args[0] if node.args else None
            if isinstance(first, ast.Name) and first.id in _WRITE_CALLEES:
                continue
            offenders.append(f"{path}:{node.lineno}")
    return offenders


@pytest.mark.asyncio
async def test_no_more_than_four_reads_run_at_once() -> None:
    running = 0
    peak = 0
    lock = threading.Lock()

    def read() -> None:
        nonlocal running, peak
        with lock:
            running += 1
            peak = max(peak, running)
        time.sleep(0.02)
        with lock:
            running -= 1

    await asyncio.gather(*(pb_read(read) for _ in range(20)))
    assert peak == PB_READ_CONCURRENCY == 4


@pytest.mark.asyncio
async def test_a_failed_read_releases_its_slot() -> None:
    def boom() -> None:
        raise RuntimeError("pb down")

    for _ in range(PB_READ_CONCURRENCY + 1):
        with pytest.raises(RuntimeError):
            await pb_read(boom)
    assert await pb_read(lambda: 7) == 7


def test_camperships_reads_go_through_pb_read() -> None:
    """Every asyncio.to_thread in a Camperships service is a WRITE (commit_aid_writes, record_change), which stays
    outside the limit so a save never queues behind a rebuild."""
    offenders = _bare_to_thread_reads(Path(__file__).resolve().parents[4] / "api" / "services", "financial_aid_*.py")
    assert offenders == []

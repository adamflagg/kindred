"""Old solver run logs are pruned when the API starts, not only after a solve.

Pruning on write alone leaves expired logs on disk through the off-season,
when nothing solves. Pruning at startup means every deploy or restart also
clears them.
"""

from __future__ import annotations

import os
import time
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

DAY = 86_400


def _write(path: Path, age_days: float) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("{}")
    mtime = time.time() - age_days * DAY
    os.utime(path, (mtime, mtime))
    return path


@pytest.mark.asyncio
async def test_startup_prunes_expired_solver_logs(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from api import main

    monkeypatch.chdir(tmp_path)
    expired = _write(tmp_path / "logs/solver/session_1_solver_log_20250101_000000.json", age_days=31)
    recent = _write(tmp_path / "logs/solver/session_1_solver_log_20250301_000000.json", age_days=29)

    settings = SimpleNamespace(skip_pb_auth=True, pocketbase_url="http://pb.invalid")
    with (
        patch.object(main, "get_settings", return_value=settings),
        patch.object(main, "close_connection", MagicMock()),
    ):
        async with main.lifespan(MagicMock()):
            assert not expired.exists(), "an expired run log must be gone once the API has started"
            assert recent.exists()


@pytest.mark.asyncio
async def test_startup_without_a_solver_logs_dir_is_fine(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from api import main

    monkeypatch.chdir(tmp_path)
    settings = SimpleNamespace(skip_pb_auth=True, pocketbase_url="http://pb.invalid")
    with (
        patch.object(main, "get_settings", return_value=settings),
        patch.object(main, "close_connection", MagicMock()),
    ):
        async with main.lifespan(MagicMock()):
            pass

    assert not (tmp_path / "logs").exists(), "startup must not create the logs dir just to prune it"

"""Solver run logs under ``logs/solver/`` are kept for 30 days, then pruned.

Each solve writes a JSON run log, and nothing used to delete them. They sit on
a persisted volume outside the app's RBAC, so keeping them forever keeps every
past run's detail readable to anyone with host access. Each time a new run log
is written, run logs older than the retention window are deleted. Only files
named like a solver run log are touched; anything else in the directory, and
anything reached through a symlink, is left alone. A pruning failure is logged
and never fails the solve that triggered it.
"""

import logging
import os
import time
from pathlib import Path

import pytest

from bunking.solver.logging import SOLVER_LOG_RETENTION_DAYS, ConstraintLogger, prune_solver_logs

DAY = 86_400


def _touch(path: Path, age_days: float, now: float) -> Path:
    path.write_text("{}")
    mtime = now - age_days * DAY
    os.utime(path, (mtime, mtime))
    return path


@pytest.fixture
def logs_dir(tmp_path: Path) -> Path:
    d = tmp_path / "logs" / "solver"
    d.mkdir(parents=True)
    return d


def test_retention_is_thirty_days() -> None:
    assert SOLVER_LOG_RETENTION_DAYS == 30


def test_prunes_run_logs_older_than_retention_and_keeps_the_rest(logs_dir: Path) -> None:
    now = time.time()
    old = _touch(logs_dir / "session_1000001_solver_log_20260801_101500.json", 31, now)
    old_with_run_id = _touch(
        logs_dir / "session_1000002_solver_log_20260801_101500_0f8c7e9a-3b1d-4c55-9a2e-1d2c3b4a5f60.json", 45, now
    )
    recent = _touch(logs_dir / "session_1000001_solver_log_20260910_101500.json", 29, now)
    model_export = _touch(logs_dir / "model_session_1000001.txt", 90, now)
    other_json = _touch(logs_dir / "notes.json", 90, now)
    near_miss = _touch(logs_dir / "session_1000001_solver_log_20260801_101500.json.bak", 90, now)

    deleted = prune_solver_logs(logs_dir, now=now)

    assert deleted == 2
    assert not old.exists()
    assert not old_with_run_id.exists()
    assert recent.exists()
    assert model_export.exists(), "only solver run logs are pruned"
    assert other_json.exists()
    assert near_miss.exists()


def test_never_follows_symlinks_or_leaves_the_directory(logs_dir: Path, tmp_path: Path) -> None:
    now = time.time()
    outside = tmp_path / "elsewhere"
    outside.mkdir()
    target = _touch(outside / "session_1000001_solver_log_20260101_000000.json", 90, now)
    link = logs_dir / "session_1000003_solver_log_20260101_000000.json"
    link.symlink_to(target)
    os.utime(link, (now - 90 * DAY, now - 90 * DAY), follow_symlinks=False)
    nested = logs_dir / "archive"
    nested.mkdir()
    nested_old = _touch(nested / "session_1000001_solver_log_20260101_000000.json", 90, now)

    deleted = prune_solver_logs(logs_dir, now=now)

    assert deleted == 0
    assert link.is_symlink(), "a symlink is never removed"
    assert target.exists(), "the symlink's target is never touched"
    assert nested_old.exists(), "pruning does not recurse"


def test_missing_directory_is_a_no_op(tmp_path: Path) -> None:
    assert prune_solver_logs(tmp_path / "absent") == 0


def test_save_to_file_prunes_old_run_logs(logs_dir: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    now = time.time()
    old = _touch(logs_dir / "session_1000001_solver_log_20260801_101500.json", 31, now)
    recent = _touch(logs_dir / "session_1000001_solver_log_20260910_101500.json", 29, now)
    monkeypatch.chdir(tmp_path)

    written = ConstraintLogger().save_to_file(1000001, solver_run_id="run-1")

    assert Path(written).exists()
    assert not old.exists()
    assert recent.exists()


def test_pruning_failure_is_logged_and_does_not_fail_the_save(
    logs_dir: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    now = time.time()
    old = _touch(logs_dir / "session_1000001_solver_log_20260801_101500.json", 31, now)
    monkeypatch.chdir(tmp_path)

    def refuse(self: Path, missing_ok: bool = False) -> None:
        raise PermissionError(13, "Permission denied", str(self))

    monkeypatch.setattr(Path, "unlink", refuse)

    with caplog.at_level(logging.WARNING, logger="bunking.solver.logging"):
        written = ConstraintLogger().save_to_file(1000001)

    assert Path(written).exists(), "the new run log is still written"
    assert old.exists()
    warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert warnings, "a pruning failure is logged"
    assert any("PermissionError" in r.getMessage() for r in warnings)


def test_directory_scan_failure_does_not_fail_the_save(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.chdir(tmp_path)

    def broken_scandir(path: object) -> None:
        raise OSError(5, "Input/output error")

    monkeypatch.setattr("bunking.solver.logging.os.scandir", broken_scandir)

    with caplog.at_level(logging.WARNING, logger="bunking.solver.logging"):
        written = ConstraintLogger().save_to_file(1000001)

    assert Path(written).exists()
    assert any("OSError" in r.getMessage() for r in caplog.records if r.levelno == logging.WARNING)

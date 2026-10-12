"""Files kindred-api creates are private to the uid it runs as.

Every kindred container runs as the same nonroot uid, and the only file read
across containers (PocketBase's SQLite, which kindred-api opens read-only) is
read by that same uid. So the api process creates files with umask 0o077:
owner read/write, nothing for group or other.

The umask is set at import of the ``api`` package, the earliest point the
uvicorn entry point reaches app code. The images are distroless, so there is
no shell in which to run ``umask`` first.
"""

from __future__ import annotations

import os
import stat
import subprocess
import sys
from pathlib import Path

import pytest

from api.file_modes import PRIVATE_UMASK, restrict_new_files

pytestmark = pytest.mark.skipif(sys.platform == "win32", reason="POSIX file modes")

REPO_ROOT = Path(__file__).resolve().parents[3]


def _mode(path: Path) -> int:
    return stat.S_IMODE(path.stat().st_mode)


def test_private_umask_withholds_group_and_other() -> None:
    assert PRIVATE_UMASK == 0o077


def test_restrict_new_files_makes_new_files_and_dirs_owner_only(tmp_path: Path) -> None:
    before = os.umask(0o022)
    try:
        previous = restrict_new_files()
        assert previous == 0o022

        new_file = tmp_path / "solver_log.json"
        new_file.write_text("{}")
        new_dir = tmp_path / "logs" / "solver"
        new_dir.mkdir(parents=True)

        assert _mode(new_file) == 0o600
        assert _mode(new_dir) == 0o700
    finally:
        os.umask(before)


def test_restrict_new_files_leaves_existing_files_alone(tmp_path: Path) -> None:
    existing = tmp_path / "existing.json"
    existing.write_text("{}")
    existing.chmod(0o644)

    before = os.umask(0o022)
    try:
        restrict_new_files()
    finally:
        os.umask(before)

    assert _mode(existing) == 0o644


def test_importing_the_api_package_applies_the_private_umask() -> None:
    """The uvicorn entry imports ``api.main``, so ``api/__init__`` runs first.

    A fresh interpreter with a permissive umask must come out of
    ``import api`` with the private one.
    """
    probe = "import os; os.umask(0o022); import api; print(oct(os.umask(0)))"
    result = subprocess.run(
        [sys.executable, "-c", probe],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    assert result.stdout.strip() == oct(0o077)

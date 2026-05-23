"""Guard against orphaned test files outside the configured testpath.

CI runs ``pytest tests/`` and ``testpaths = ["tests"]``. Any committed
``test_*.py`` / ``*_test.py`` outside ``tests/`` is invisible to every gate — the
``api/services/`` colocated-orphan incident (2026-05) had 209 tests run by nothing.
This test fails closed if such a file reappears.
"""

import fnmatch
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
TEST_GLOBS = ("test_*.py", "*_test.py")  # mirrors pyproject [tool.pytest] python_files


def _tracked_test_files() -> list[str]:
    out = subprocess.run(
        ["git", "ls-files", "*.py"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    return [
        line for line in out.stdout.splitlines() if any(fnmatch.fnmatch(Path(line).name, glob) for glob in TEST_GLOBS)
    ]


def test_no_test_files_outside_testpath() -> None:
    """Every committed test file must live under tests/ (the configured testpath)."""
    orphans = [f for f in _tracked_test_files() if not f.startswith("tests/")]
    assert not orphans, (
        "Test files found outside the configured testpath 'tests/'. CI runs "
        "`pytest tests/`, so these would never run. Move them under tests/:\n" + "\n".join(orphans)
    )

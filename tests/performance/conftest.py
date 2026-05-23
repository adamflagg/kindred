"""
Performance test configuration.

These modules drive a running stack (localhost:8080); the *_test.py files among them
match pytest's collection pattern. Skip them when SKIP_POCKETBASE_TESTS is set (CI /
pre-push) so `pytest tests/` neither imports nor runs them; they run in CD against the
booted stack.
"""

from tests._env import is_truthy_env

# collect_ignore_glob prevents *import/collection* (not just runtime skip), which matters
# here: this dir has NO pytest_collection_modifyitems backup, and load_test.py /
# quick_load_test.py match python_files=*_test.py, so a bad glob would import them under
# the gate. They live DIRECTLY in tests/performance/ (no subdir), and "**/*.py" only
# matches files under a subdirectory (the "**/" requires a path separator) — so the
# top-level "*.py" entry is required to actually gate them. (#1621)
if is_truthy_env("SKIP_POCKETBASE_TESTS"):
    collect_ignore_glob = ["*.py", "**/*.py"]

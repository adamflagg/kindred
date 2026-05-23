"""
Performance test configuration.

These modules drive a running stack (localhost:8080); the *_test.py files among them
match pytest's collection pattern. Skip them when SKIP_POCKETBASE_TESTS is set (CI /
pre-push) so `pytest tests/` neither imports nor runs them; they run in CD against the
booted stack.
"""

import os

if os.environ.get("SKIP_POCKETBASE_TESTS") == "true":
    collect_ignore_glob = ["**/*.py"]

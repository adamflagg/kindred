"""
Integration test configuration.

The sync/ integration tests require external services (PocketBase, solver service).
Skip them when SKIP_POCKETBASE_TESTS is set. The solver/ integration tests are pure
Python (DirectSolverInput fixtures, no network) and always run.
"""

import os

import pytest

# Skip only the server-dependent sync integration tests when the gate is set.
if os.environ.get("SKIP_POCKETBASE_TESTS") == "true":
    collect_ignore_glob = ["sync/**"]


def pytest_collection_modifyitems(config, items):
    """Skip server-dependent sync integration tests when SKIP_POCKETBASE_TESTS is set."""
    if os.environ.get("SKIP_POCKETBASE_TESTS") == "true":
        skip_pb = pytest.mark.skip(reason="SKIP_POCKETBASE_TESTS is set")
        for item in items:
            if "integration/sync" in str(item.fspath):
                item.add_marker(skip_pb)

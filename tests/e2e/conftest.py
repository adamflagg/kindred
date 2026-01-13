"""
End-to-end test configuration.

These tests require all services running (PocketBase, solver service, frontend).
Skip them when SKIP_POCKETBASE_TESTS is set.
"""

from __future__ import annotations

import os

import pytest

# Skip all e2e tests when SKIP_POCKETBASE_TESTS is set
if os.environ.get("SKIP_POCKETBASE_TESTS") == "true":
    collect_ignore_glob = ["**/*.py"]


def pytest_collection_modifyitems(config, items):
    """Skip e2e tests when SKIP_POCKETBASE_TESTS is set."""
    if os.environ.get("SKIP_POCKETBASE_TESTS") == "true":
        skip_pb = pytest.mark.skip(reason="SKIP_POCKETBASE_TESTS is set")
        for item in items:
            if "e2e" in str(item.fspath):
                item.add_marker(skip_pb)

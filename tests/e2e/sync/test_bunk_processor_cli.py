"""E2E tests for bunk request processor CLI.

These tests run the actual CLI command and verify it completes without errors.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest

# Get project root relative to this test file
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent

pytestmark = pytest.mark.skipif(
    os.environ.get("SKIP_POCKETBASE_TESTS", "true").lower() == "true",
    reason="E2E tests require running services",
)


class TestBunkProcessorCLI:
    """E2E tests for CLI execution."""

    def test_cli_help(self) -> None:
        """CLI shows help without errors."""
        result = subprocess.run(
            [
                "uv",
                "run",
                "python",
                "-m",
                "bunking.sync.bunk_request_processor.process_requests",
                "--help",
            ],
            capture_output=True,
            text=True,
            cwd=str(PROJECT_ROOT),
            timeout=30,
        )
        assert result.returncode == 0
        assert "process" in result.stdout.lower() or "usage" in result.stdout.lower()

    def test_cli_dry_run_session_1(self) -> None:
        """CLI executes dry run for session 1."""
        env = os.environ.copy()
        env["PYTHONPATH"] = str(PROJECT_ROOT)

        result = subprocess.run(
            [
                "uv",
                "run",
                "python",
                "-m",
                "bunking.sync.bunk_request_processor.process_requests",
                "--session",
                "1",
                "--test-limit",
                "1",
                "--dry-run",
            ],
            capture_output=True,
            text=True,
            cwd=str(PROJECT_ROOT),
            env=env,
            timeout=120,
        )

        # Either success or no requests to process is acceptable
        assert result.returncode == 0, f"CLI failed: {result.stderr}"

    def test_cli_with_invalid_args_fails(self) -> None:
        """CLI fails with invalid arguments."""
        result = subprocess.run(
            [
                "uv",
                "run",
                "python",
                "-m",
                "bunking.sync.bunk_request_processor.process_requests",
                "--invalid-flag-that-does-not-exist",
            ],
            capture_output=True,
            text=True,
            cwd=str(PROJECT_ROOT),
            timeout=30,
        )
        # Should fail with non-zero exit code for invalid args
        assert result.returncode != 0

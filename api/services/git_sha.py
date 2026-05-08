"""Git SHA capture for solver run tagging.

Resolution order:
  1. ``KINDRED_GIT_SHA`` env var (set at Docker build time)
  2. ``git rev-parse HEAD`` (local dev)
  3. literal ``"unknown"``

Cached on first call. Process restart re-reads.
"""

from __future__ import annotations

import os
import subprocess

_cached_sha: str | None = None


def _read_git_sha() -> str:
    env = os.environ.get("KINDRED_GIT_SHA")
    if env:
        return env.strip()
    try:
        out = subprocess.check_output(
            ["git", "rev-parse", "HEAD"],  # noqa: S607 — git is intentionally PATH-resolved for local-dev fallback
            stderr=subprocess.DEVNULL,
        )
        return out.decode().strip()
    except subprocess.CalledProcessError, FileNotFoundError:
        return "unknown"


def get_git_sha() -> str:
    global _cached_sha
    if _cached_sha is None:
        _cached_sha = _read_git_sha()
    return _cached_sha

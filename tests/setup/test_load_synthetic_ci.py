"""Tests for scripts/setup/load_synthetic_ci.py — CI seed loader (issue #1623).

The loader gunzips the committed artifact into PocketBase's data dir before the
stack boots / the data-dependent suites run. The result must be openable exactly
the way the metrics code opens it (read-only + `PRAGMA journal_mode=WAL` no-op).

Also guards that the committed MANIFEST's target years still match what the
retention tests assert, so regenerating the fixture with a different window fails
loudly instead of silently breaking CD.
"""

import importlib
import json
import sqlite3
from pathlib import Path

import pytest

_REPO_ROOT = Path(__file__).resolve().parents[2]
ARTIFACT = _REPO_ROOT / "tests" / "fixtures" / "synthetic_pb" / "data.db.gz"
MANIFEST = _REPO_ROOT / "tests" / "fixtures" / "synthetic_pb" / "MANIFEST.json"


@pytest.fixture
def loader():
    return importlib.import_module("scripts.setup.load_synthetic_ci")


def test_artifact_and_manifest_are_committed():
    assert ARTIFACT.is_file(), "synthetic artifact must be committed"
    assert MANIFEST.is_file(), "synthetic manifest must be committed"


def test_manifest_years_match_retention_expectation():
    """The retention suite asserts years == [2023, 2024, 2025, 2026]."""
    manifest = json.loads(MANIFEST.read_text())
    assert manifest["target_years"] == [2023, 2024, 2025, 2026]


def test_load_writes_openable_wal_db(loader, tmp_path):
    dest = tmp_path / "pb" / "data.db"
    loader.load_synthetic(ARTIFACT, dest)
    assert dest.is_file()

    # Opens exactly like api/services/metrics_sql_connection.get_connection():
    conn = sqlite3.connect(f"file:{dest}?mode=ro", uri=True)
    conn.execute("PRAGMA journal_mode=WAL")  # must be a no-op, not a write -> no error
    conn.execute("PRAGMA query_only=ON")
    (n_persons,) = conn.execute("SELECT count(*) FROM persons").fetchone()
    conn.close()
    assert n_persons > 0


def test_load_missing_artifact_raises(loader, tmp_path):
    with pytest.raises(FileNotFoundError):
        loader.load_synthetic(tmp_path / "nope.db.gz", tmp_path / "out.db")

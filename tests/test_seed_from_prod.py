"""Tests for scripts/setup/seed_from_prod.py — production-to-dev database seeding.

New approach: inject application data from a prod DB copy into a clean dev DB.
Dev auth/system tables are never touched — only data tables are copied.

Tests:
- Data tables are copied (row counts match)
- System tables (_superusers, _collections, etc.) are NOT touched
- users table is NOT touched
- WAL/SHM cleanup on prod DB
- Dry-run mode (no changes to dev DB)
- Schema mismatch handling (extra tables in prod/dev)
- Missing file errors
"""

from __future__ import annotations

import sqlite3
import types
from pathlib import Path

import pytest

# ---------------------------------------------------------------------------
# Schema helpers — create minimal PocketBase-like databases for testing
# ---------------------------------------------------------------------------

# System tables that should NEVER be copied from prod
SYSTEM_TABLES = [
    "_superusers",
    "_collections",
    "_externalAuths",
    "_authOrigins",
    "_mfas",
    "_otps",
    "_migrations",
    "_params",
]


def _create_base_schema(cur: sqlite3.Cursor) -> None:
    """Create the minimal system tables that every PocketBase DB has."""
    cur.execute("""
        CREATE TABLE _superusers (
            id TEXT PRIMARY KEY,
            email TEXT NOT NULL,
            password TEXT NOT NULL,
            tokenKey TEXT NOT NULL DEFAULT ''
        )
    """)
    cur.execute("""
        CREATE TABLE _collections (
            id TEXT PRIMARY KEY,
            name TEXT UNIQUE NOT NULL,
            system BOOLEAN DEFAULT 0,
            options JSON DEFAULT '{}'
        )
    """)
    cur.execute("""
        CREATE TABLE _externalAuths (
            id TEXT PRIMARY KEY,
            provider TEXT DEFAULT ''
        )
    """)
    cur.execute("""
        CREATE TABLE _authOrigins (
            id TEXT PRIMARY KEY,
            fingerprint TEXT DEFAULT ''
        )
    """)
    cur.execute("""
        CREATE TABLE _mfas (
            id TEXT PRIMARY KEY,
            method TEXT DEFAULT ''
        )
    """)
    cur.execute("""
        CREATE TABLE _otps (
            id TEXT PRIMARY KEY,
            password TEXT DEFAULT ''
        )
    """)
    cur.execute("""
        CREATE TABLE _migrations (
            file VARCHAR(255) PRIMARY KEY NOT NULL,
            applied INTEGER NOT NULL
        )
    """)
    cur.execute("""
        CREATE TABLE _params (
            id TEXT PRIMARY KEY,
            value JSON DEFAULT '{}'
        )
    """)
    cur.execute("""
        CREATE TABLE users (
            id TEXT PRIMARY KEY,
            email TEXT NOT NULL DEFAULT '',
            name TEXT DEFAULT ''
        )
    """)


def _create_data_tables(cur: sqlite3.Cursor) -> None:
    """Create sample data tables that would exist in both dev and prod."""
    cur.execute("""
        CREATE TABLE persons (
            id TEXT PRIMARY KEY,
            cm_id TEXT NOT NULL DEFAULT '',
            first_name TEXT DEFAULT '',
            last_name TEXT DEFAULT '',
            year INTEGER DEFAULT 0
        )
    """)
    cur.execute("""
        CREATE TABLE attendees (
            id TEXT PRIMARY KEY,
            person_id TEXT NOT NULL DEFAULT '',
            session TEXT DEFAULT '',
            year INTEGER DEFAULT 0
        )
    """)
    cur.execute("""
        CREATE TABLE bunks (
            id TEXT PRIMARY KEY,
            name TEXT DEFAULT '',
            gender TEXT DEFAULT ''
        )
    """)
    cur.execute("""
        CREATE TABLE config (
            id TEXT PRIMARY KEY,
            key TEXT DEFAULT '',
            value TEXT DEFAULT ''
        )
    """)


def _create_dev_db(db_path: str) -> None:
    """Create a clean dev database with system tables and empty data tables."""
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    _create_base_schema(cur)
    _create_data_tables(cur)

    # Dev superuser (should be preserved after seeding)
    cur.execute(
        "INSERT INTO _superusers (id, email, password, tokenKey) "
        "VALUES ('dev_admin', 'admin@camp.local', '$2a$10$devhash', 'devTokenKey')"
    )
    # Dev collections (should be preserved)
    cur.execute("INSERT INTO _collections (id, name, system) VALUES ('col_users', 'users', 1)")
    cur.execute("INSERT INTO _collections (id, name, system) VALUES ('col_persons', 'persons', 0)")
    # Dev user (should be preserved)
    cur.execute("INSERT INTO users (id, email, name) VALUES ('dev_user1', 'dev@example.com', 'Dev User')")
    # Dev params (should be preserved)
    cur.execute("INSERT INTO _params (id, value) VALUES ('param1', '{\"key\": \"dev_value\"}')")
    # Dev migrations (should be preserved)
    cur.execute("INSERT INTO _migrations VALUES ('1640988000_init.go', 1)")
    cur.execute("INSERT INTO _migrations VALUES ('1500000001_persons.js', 1)")

    conn.commit()
    conn.close()


def _create_prod_db(db_path: str) -> None:
    """Create a prod database with system tables and populated data tables."""
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    _create_base_schema(cur)
    _create_data_tables(cur)

    # Prod superuser (different from dev — should NOT end up in dev)
    cur.execute(
        "INSERT INTO _superusers (id, email, password, tokenKey) "
        "VALUES ('prod_admin', 'real-admin@camp.org', '$2a$10$prodhash', 'prodTokenKey')"
    )
    # Prod collections
    cur.execute("INSERT INTO _collections (id, name, system) VALUES ('col_users', 'users', 1)")
    # Prod users (should NOT be copied)
    cur.execute("INSERT INTO users (id, email, name) VALUES ('prod_user1', 'alice@camp.org', 'Alice')")
    cur.execute("INSERT INTO users (id, email, name) VALUES ('prod_user2', 'bob@camp.org', 'Bob')")
    # Prod params (should NOT be copied)
    cur.execute("INSERT INTO _params (id, value) VALUES ('param1', '{\"key\": \"prod_value\"}')")
    # Prod migrations (should NOT be copied)
    cur.execute("INSERT INTO _migrations VALUES ('1640988000_init.go', 1)")

    # Prod DATA — this IS what should be copied
    cur.execute("INSERT INTO persons VALUES ('p1', 'CM001', 'Emma', 'Johnson', 2025)")
    cur.execute("INSERT INTO persons VALUES ('p2', 'CM002', 'Liam', 'Garcia', 2025)")
    cur.execute("INSERT INTO persons VALUES ('p3', 'CM003', 'Olivia', 'Chen', 2025)")
    cur.execute("INSERT INTO attendees VALUES ('a1', 'CM001', 'Session 1', 2025)")
    cur.execute("INSERT INTO attendees VALUES ('a2', 'CM002', 'Session 2', 2025)")
    cur.execute("INSERT INTO bunks VALUES ('b1', 'B-1', 'M')")
    cur.execute("INSERT INTO bunks VALUES ('b2', 'G-1', 'F')")
    cur.execute("INSERT INTO config VALUES ('c1', 'season_id', '2025')")

    conn.commit()
    conn.close()


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def dev_and_prod(tmp_path: Path) -> tuple[str, str]:
    """Create a dev DB and a prod DB, returning their paths."""
    dev_path = str(tmp_path / "data.db")
    prod_path = str(tmp_path / "data-prod.db")
    _create_dev_db(dev_path)
    _create_prod_db(prod_path)
    return dev_path, prod_path


@pytest.fixture
def seed_module():
    """Import the seed_from_prod module."""
    import importlib

    return importlib.import_module("scripts.setup.seed_from_prod")


# ---------------------------------------------------------------------------
# Tests: Data table copying
# ---------------------------------------------------------------------------


class TestDataTableCopying:
    """Test that data tables are copied from prod to dev."""

    def test_persons_copied(self, dev_and_prod: tuple[str, str], seed_module: types.ModuleType) -> None:
        dev_db, prod_db = dev_and_prod
        seed_module.seed_from_prod(dev_db=dev_db, prod_db=prod_db)

        conn = sqlite3.connect(dev_db)
        rows = conn.execute("SELECT id, first_name, last_name FROM persons ORDER BY id").fetchall()
        conn.close()

        assert len(rows) == 3
        assert rows[0] == ("p1", "Emma", "Johnson")
        assert rows[1] == ("p2", "Liam", "Garcia")
        assert rows[2] == ("p3", "Olivia", "Chen")

    def test_attendees_copied(self, dev_and_prod: tuple[str, str], seed_module: types.ModuleType) -> None:
        dev_db, prod_db = dev_and_prod
        seed_module.seed_from_prod(dev_db=dev_db, prod_db=prod_db)

        conn = sqlite3.connect(dev_db)
        count = conn.execute("SELECT COUNT(*) FROM attendees").fetchone()[0]
        conn.close()
        assert count == 2

    def test_bunks_copied(self, dev_and_prod: tuple[str, str], seed_module: types.ModuleType) -> None:
        dev_db, prod_db = dev_and_prod
        seed_module.seed_from_prod(dev_db=dev_db, prod_db=prod_db)

        conn = sqlite3.connect(dev_db)
        count = conn.execute("SELECT COUNT(*) FROM bunks").fetchone()[0]
        conn.close()
        assert count == 2

    def test_config_copied(self, dev_and_prod: tuple[str, str], seed_module: types.ModuleType) -> None:
        dev_db, prod_db = dev_and_prod
        seed_module.seed_from_prod(dev_db=dev_db, prod_db=prod_db)

        conn = sqlite3.connect(dev_db)
        row = conn.execute("SELECT key, value FROM config").fetchone()
        conn.close()
        assert row == ("season_id", "2025")

    def test_dev_data_replaced_not_merged(self, tmp_path: Path, seed_module: types.ModuleType) -> None:
        """Existing dev data should be deleted before copying prod data."""
        dev_path = str(tmp_path / "data.db")
        prod_path = str(tmp_path / "data-prod.db")
        _create_dev_db(dev_path)
        _create_prod_db(prod_path)

        # Insert some pre-existing data into dev
        conn = sqlite3.connect(dev_path)
        conn.execute("INSERT INTO persons VALUES ('old1', 'CM999', 'Old', 'Data', 2024)")
        conn.commit()
        conn.close()

        seed_module.seed_from_prod(dev_db=dev_path, prod_db=prod_path)

        conn = sqlite3.connect(dev_path)
        ids = [r[0] for r in conn.execute("SELECT id FROM persons ORDER BY id").fetchall()]
        conn.close()

        # Old dev data should be gone, only prod data present
        assert "old1" not in ids
        assert ids == ["p1", "p2", "p3"]

    def test_empty_prod_table_clears_dev_table(self, tmp_path: Path, seed_module: types.ModuleType) -> None:
        """If a prod data table is empty, dev table should also become empty."""
        dev_path = str(tmp_path / "data.db")
        prod_path = str(tmp_path / "data-prod.db")
        _create_dev_db(dev_path)
        _create_prod_db(prod_path)

        # Add data to dev config table
        conn = sqlite3.connect(dev_path)
        conn.execute("INSERT INTO config VALUES ('dc1', 'dev_key', 'dev_val')")
        conn.commit()
        conn.close()

        # Clear prod config table
        conn = sqlite3.connect(prod_path)
        conn.execute("DELETE FROM config")
        conn.commit()
        conn.close()

        seed_module.seed_from_prod(dev_db=dev_path, prod_db=prod_path)

        conn = sqlite3.connect(dev_path)
        count = conn.execute("SELECT COUNT(*) FROM config").fetchone()[0]
        conn.close()
        assert count == 0


# ---------------------------------------------------------------------------
# Tests: System tables NOT touched
# ---------------------------------------------------------------------------


class TestSystemTablesPreserved:
    """Test that system tables in the dev DB are never modified."""

    def test_superusers_preserved(self, dev_and_prod: tuple[str, str], seed_module: types.ModuleType) -> None:
        dev_db, prod_db = dev_and_prod
        seed_module.seed_from_prod(dev_db=dev_db, prod_db=prod_db)

        conn = sqlite3.connect(dev_db)
        row = conn.execute("SELECT id, email FROM _superusers").fetchone()
        conn.close()

        assert row[0] == "dev_admin"
        assert row[1] == "admin@camp.local"

    def test_collections_preserved(self, dev_and_prod: tuple[str, str], seed_module: types.ModuleType) -> None:
        dev_db, prod_db = dev_and_prod
        seed_module.seed_from_prod(dev_db=dev_db, prod_db=prod_db)

        conn = sqlite3.connect(dev_db)
        names = sorted(r[0] for r in conn.execute("SELECT name FROM _collections").fetchall())
        conn.close()

        assert "persons" in names
        assert "users" in names

    def test_migrations_preserved(self, dev_and_prod: tuple[str, str], seed_module: types.ModuleType) -> None:
        dev_db, prod_db = dev_and_prod
        seed_module.seed_from_prod(dev_db=dev_db, prod_db=prod_db)

        conn = sqlite3.connect(dev_db)
        files = [r[0] for r in conn.execute("SELECT file FROM _migrations").fetchall()]
        conn.close()

        assert "1640988000_init.go" in files
        assert "1500000001_persons.js" in files

    def test_params_preserved(self, dev_and_prod: tuple[str, str], seed_module: types.ModuleType) -> None:
        dev_db, prod_db = dev_and_prod
        seed_module.seed_from_prod(dev_db=dev_db, prod_db=prod_db)

        conn = sqlite3.connect(dev_db)
        row = conn.execute("SELECT value FROM _params WHERE id = 'param1'").fetchone()
        conn.close()

        assert "dev_value" in row[0]

    def test_users_preserved(self, dev_and_prod: tuple[str, str], seed_module: types.ModuleType) -> None:
        """The users table (OAuth auth records) should NOT be touched."""
        dev_db, prod_db = dev_and_prod
        seed_module.seed_from_prod(dev_db=dev_db, prod_db=prod_db)

        conn = sqlite3.connect(dev_db)
        rows = conn.execute("SELECT id, email FROM users").fetchall()
        conn.close()

        assert len(rows) == 1
        assert rows[0] == ("dev_user1", "dev@example.com")

    def test_external_auths_preserved(self, dev_and_prod: tuple[str, str], seed_module: types.ModuleType) -> None:
        dev_db, prod_db = dev_and_prod

        # Add a dev external auth record
        conn = sqlite3.connect(dev_db)
        conn.execute("INSERT INTO _externalAuths (id, provider) VALUES ('ea_dev', 'oidc')")
        conn.commit()
        conn.close()

        seed_module.seed_from_prod(dev_db=dev_db, prod_db=prod_db)

        conn = sqlite3.connect(dev_db)
        row = conn.execute("SELECT id FROM _externalAuths").fetchone()
        conn.close()
        assert row[0] == "ea_dev"


# ---------------------------------------------------------------------------
# Tests: WAL/SHM cleanup on prod DB
# ---------------------------------------------------------------------------


class TestWalCleanup:
    """Test that WAL and SHM files are cleaned up on the prod DB."""

    def test_removes_prod_wal_and_shm(self, dev_and_prod: tuple[str, str], seed_module: types.ModuleType) -> None:
        dev_db, prod_db = dev_and_prod
        prod_path = Path(prod_db)

        # Create fake WAL/SHM files
        wal = prod_path.with_name(prod_path.name + "-wal")
        shm = prod_path.with_name(prod_path.name + "-shm")
        wal.write_bytes(b"\x00" * 100)
        shm.write_bytes(b"\x00" * 32)

        seed_module.seed_from_prod(dev_db=dev_db, prod_db=prod_db)

        assert not wal.exists()
        assert not shm.exists()
        assert prod_path.exists()


# ---------------------------------------------------------------------------
# Tests: Dry-run mode
# ---------------------------------------------------------------------------


class TestDryRun:
    """Test that dry-run mode reports changes without modifying either DB."""

    def test_dry_run_does_not_copy_data(self, dev_and_prod: tuple[str, str], seed_module: types.ModuleType) -> None:
        dev_db, prod_db = dev_and_prod
        seed_module.seed_from_prod(dev_db=dev_db, prod_db=prod_db, dry_run=True)

        conn = sqlite3.connect(dev_db)
        count = conn.execute("SELECT COUNT(*) FROM persons").fetchone()[0]
        conn.close()
        # Dev persons should still be empty (no pre-existing data in fixture)
        assert count == 0

    def test_dry_run_preserves_dev_superusers(
        self, dev_and_prod: tuple[str, str], seed_module: types.ModuleType
    ) -> None:
        dev_db, prod_db = dev_and_prod
        seed_module.seed_from_prod(dev_db=dev_db, prod_db=prod_db, dry_run=True)

        conn = sqlite3.connect(dev_db)
        row = conn.execute("SELECT email FROM _superusers").fetchone()
        conn.close()
        assert row[0] == "admin@camp.local"

    def test_dry_run_returns_summary(self, dev_and_prod: tuple[str, str], seed_module: types.ModuleType) -> None:
        dev_db, prod_db = dev_and_prod
        result = seed_module.seed_from_prod(dev_db=dev_db, prod_db=prod_db, dry_run=True)

        assert isinstance(result, dict)
        assert "tables_copied" in result
        assert isinstance(result["tables_copied"], dict)
        # Should report the counts that WOULD be copied
        assert result["tables_copied"]["persons"] == 3
        assert result["tables_copied"]["attendees"] == 2


# ---------------------------------------------------------------------------
# Tests: Schema mismatch handling
# ---------------------------------------------------------------------------


class TestSchemaMismatch:
    """Test handling when prod and dev have different sets of data tables."""

    def test_extra_prod_table_fails_by_default(
        self,
        tmp_path: Path,
        seed_module: types.ModuleType,
    ) -> None:
        """Default (strict) behavior: prod-only data tables abort the seed.

        Silently skipping a prod table drops a whole collection of rows from
        the dev DB, which masks bugs like #1338 where a section silently
        renders empty. Fail fast so the drift is visible (#1339 ask #2).
        """
        dev_path = str(tmp_path / "data.db")
        prod_path = str(tmp_path / "data-prod.db")
        _create_dev_db(dev_path)
        _create_prod_db(prod_path)

        # Add an extra table to prod that dev doesn't have
        conn = sqlite3.connect(prod_path)
        conn.execute("CREATE TABLE legacy_table (id TEXT PRIMARY KEY, data TEXT)")
        conn.execute("INSERT INTO legacy_table VALUES ('l1', 'old data')")
        conn.commit()
        conn.close()

        with pytest.raises(SystemExit):
            seed_module.seed_from_prod(dev_db=dev_path, prod_db=prod_path)

    def test_extra_prod_table_skipped_with_warning_when_allow_skip(
        self,
        tmp_path: Path,
        seed_module: types.ModuleType,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        """allow_skip=True restores the legacy warn-and-continue behavior."""
        dev_path = str(tmp_path / "data.db")
        prod_path = str(tmp_path / "data-prod.db")
        _create_dev_db(dev_path)
        _create_prod_db(prod_path)

        # Add an extra table to prod that dev doesn't have
        conn = sqlite3.connect(prod_path)
        conn.execute("CREATE TABLE legacy_table (id TEXT PRIMARY KEY, data TEXT)")
        conn.execute("INSERT INTO legacy_table VALUES ('l1', 'old data')")
        conn.commit()
        conn.close()

        result = seed_module.seed_from_prod(dev_db=dev_path, prod_db=prod_path, allow_skip=True)

        # Should still succeed — other tables should be copied
        assert result["tables_copied"]["persons"] == 3
        # The extra table should be listed in skipped
        assert "legacy_table" in result.get("skipped_prod_only", [])

        captured = capsys.readouterr()
        assert "legacy_table" in captured.out

    def test_extra_dev_table_fails_by_default(
        self,
        tmp_path: Path,
        seed_module: types.ModuleType,
    ) -> None:
        """Default (strict) behavior also fails on dev-only data tables.

        A new collection added to dev that prod doesn't have yet leaves dev
        out of parity. Same hard-error treatment as prod-only tables.
        """
        dev_path = str(tmp_path / "data.db")
        prod_path = str(tmp_path / "data-prod.db")
        _create_dev_db(dev_path)
        _create_prod_db(prod_path)

        # Add an extra table to dev that prod doesn't have
        conn = sqlite3.connect(dev_path)
        conn.execute("CREATE TABLE new_feature (id TEXT PRIMARY KEY, data TEXT)")
        conn.commit()
        conn.close()

        with pytest.raises(SystemExit):
            seed_module.seed_from_prod(dev_db=dev_path, prod_db=prod_path)

    def test_extra_dev_table_skipped_when_allow_skip(
        self,
        tmp_path: Path,
        seed_module: types.ModuleType,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        """allow_skip=True permits dev-only tables (left empty in dev)."""
        dev_path = str(tmp_path / "data.db")
        prod_path = str(tmp_path / "data-prod.db")
        _create_dev_db(dev_path)
        _create_prod_db(prod_path)

        # Add an extra table to dev that prod doesn't have
        conn = sqlite3.connect(dev_path)
        conn.execute("CREATE TABLE new_feature (id TEXT PRIMARY KEY, data TEXT)")
        conn.commit()
        conn.close()

        result = seed_module.seed_from_prod(dev_db=dev_path, prod_db=prod_path, allow_skip=True)

        # Should still succeed
        assert result["tables_copied"]["persons"] == 3
        assert "new_feature" in result.get("skipped_dev_only", [])

        captured = capsys.readouterr()
        assert "new_feature" in captured.out

    def test_matching_tables_still_copied_despite_mismatches(
        self, tmp_path: Path, seed_module: types.ModuleType
    ) -> None:
        """With allow_skip=True, common tables copy even when extras exist on both sides."""
        dev_path = str(tmp_path / "data.db")
        prod_path = str(tmp_path / "data-prod.db")
        _create_dev_db(dev_path)
        _create_prod_db(prod_path)

        # Add extras to both sides
        conn = sqlite3.connect(dev_path)
        conn.execute("CREATE TABLE dev_only (id TEXT PRIMARY KEY)")
        conn.commit()
        conn.close()

        conn = sqlite3.connect(prod_path)
        conn.execute("CREATE TABLE prod_only (id TEXT PRIMARY KEY)")
        conn.commit()
        conn.close()

        seed_module.seed_from_prod(dev_db=dev_path, prod_db=prod_path, allow_skip=True)

        # Common tables should still be copied
        conn = sqlite3.connect(dev_path)
        count = conn.execute("SELECT COUNT(*) FROM persons").fetchone()[0]
        conn.close()
        assert count == 3


# ---------------------------------------------------------------------------
# Tests: Column-level schema drift (within shared tables)
# ---------------------------------------------------------------------------


class TestColumnDrift:
    """Schema drift inside a shared table — prod has a column dev doesn't (or vice versa).

    This is the failure mode that caused #1339 in practice: PR #1384 dropped a
    column from dev's schema, but prod hadn't been redeployed, so the column
    survived in the prod DB copy. The old bulk `INSERT ... SELECT *` crashed
    with a column-count mismatch; the rollback left dev's state frozen at
    whatever the previous successful seed left, and the user couldn't tell
    the seed had failed.
    """

    def _add_column_to_prod(self, prod_path: str, table: str, column: str) -> None:
        conn = sqlite3.connect(prod_path)
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} TEXT DEFAULT ''")
        conn.commit()
        conn.close()

    def test_column_drift_fails_by_default(self, tmp_path: Path, seed_module: types.ModuleType) -> None:
        """Default (strict) behavior: prod having an extra column on a shared table fails."""
        dev_path = str(tmp_path / "data.db")
        prod_path = str(tmp_path / "data-prod.db")
        _create_dev_db(dev_path)
        _create_prod_db(prod_path)

        # Simulate post-#1384 state: prod still has a column dev's migrations dropped.
        self._add_column_to_prod(prod_path, "persons", "legacy_field")

        with pytest.raises(SystemExit):
            seed_module.seed_from_prod(dev_db=dev_path, prod_db=prod_path)

    def test_column_drift_error_message_names_table_and_column(
        self,
        tmp_path: Path,
        seed_module: types.ModuleType,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        """The strict failure message should name the drifted table and column."""
        dev_path = str(tmp_path / "data.db")
        prod_path = str(tmp_path / "data-prod.db")
        _create_dev_db(dev_path)
        _create_prod_db(prod_path)
        self._add_column_to_prod(prod_path, "persons", "legacy_field")

        with pytest.raises(SystemExit):
            seed_module.seed_from_prod(dev_db=dev_path, prod_db=prod_path)

        captured = capsys.readouterr()
        assert "persons" in captured.out
        assert "legacy_field" in captured.out

    def test_column_drift_with_allow_skip_copies_intersection(
        self, tmp_path: Path, seed_module: types.ModuleType
    ) -> None:
        """With allow_skip=True, the drifted column is dropped from the copy.

        Intersection-copy means: ignore the column that exists only in prod
        (or only in dev). The remaining shared columns are copied normally.
        """
        dev_path = str(tmp_path / "data.db")
        prod_path = str(tmp_path / "data-prod.db")
        _create_dev_db(dev_path)
        _create_prod_db(prod_path)
        self._add_column_to_prod(prod_path, "persons", "legacy_field")

        result = seed_module.seed_from_prod(dev_db=dev_path, prod_db=prod_path, allow_skip=True)

        # persons should still get its 3 prod rows
        assert result["tables_copied"]["persons"] == 3

        # The drifted column should be listed in the per-table drift summary
        column_drift = result.get("column_drift", {})
        assert "persons" in column_drift
        assert "legacy_field" in column_drift["persons"]["prod_only"]

    def test_column_drift_with_allow_skip_actually_copies_data(
        self, tmp_path: Path, seed_module: types.ModuleType
    ) -> None:
        """Intersection-copy must produce dev rows with the shared-column data."""
        dev_path = str(tmp_path / "data.db")
        prod_path = str(tmp_path / "data-prod.db")
        _create_dev_db(dev_path)
        _create_prod_db(prod_path)
        self._add_column_to_prod(prod_path, "persons", "legacy_field")

        seed_module.seed_from_prod(dev_db=dev_path, prod_db=prod_path, allow_skip=True)

        # Verify dev persons rows were actually copied with shared-column data
        conn = sqlite3.connect(dev_path)
        rows = conn.execute("SELECT cm_id, first_name FROM persons ORDER BY cm_id").fetchall()
        conn.close()
        assert rows == [("CM001", "Emma"), ("CM002", "Liam"), ("CM003", "Olivia")]

    def test_column_drift_dev_only_column_also_handled(self, tmp_path: Path, seed_module: types.ModuleType) -> None:
        """Symmetric case: dev has a column prod doesn't. Strict still fails; allow_skip copies intersection."""
        dev_path = str(tmp_path / "data.db")
        prod_path = str(tmp_path / "data-prod.db")
        _create_dev_db(dev_path)
        _create_prod_db(prod_path)

        # Dev migrations added a new column prod hasn't deployed yet
        conn = sqlite3.connect(dev_path)
        conn.execute("ALTER TABLE persons ADD COLUMN new_field TEXT DEFAULT ''")
        conn.commit()
        conn.close()

        with pytest.raises(SystemExit):
            seed_module.seed_from_prod(dev_db=dev_path, prod_db=prod_path)

        result = seed_module.seed_from_prod(dev_db=dev_path, prod_db=prod_path, allow_skip=True)
        assert result["tables_copied"]["persons"] == 3
        assert "new_field" in result["column_drift"]["persons"]["dev_only"]


# ---------------------------------------------------------------------------
# Tests: Missing file errors
# ---------------------------------------------------------------------------


class TestMissingFiles:
    """Test error handling for missing database files."""

    def test_missing_dev_db_raises(self, tmp_path: Path, seed_module: types.ModuleType) -> None:
        prod_path = str(tmp_path / "data-prod.db")
        _create_prod_db(prod_path)

        with pytest.raises(SystemExit):
            seed_module.seed_from_prod(
                dev_db=str(tmp_path / "nonexistent.db"),
                prod_db=prod_path,
            )

    def test_missing_prod_db_raises(self, tmp_path: Path, seed_module: types.ModuleType) -> None:
        dev_path = str(tmp_path / "data.db")
        _create_dev_db(dev_path)

        with pytest.raises(SystemExit):
            seed_module.seed_from_prod(
                dev_db=dev_path,
                prod_db=str(tmp_path / "nonexistent.db"),
            )


# ---------------------------------------------------------------------------
# Tests: Return value / summary
# ---------------------------------------------------------------------------


class TestReturnValue:
    """Test the return value summary from seed_from_prod."""

    def test_returns_summary_with_table_counts(
        self, dev_and_prod: tuple[str, str], seed_module: types.ModuleType
    ) -> None:
        dev_db, prod_db = dev_and_prod
        result = seed_module.seed_from_prod(dev_db=dev_db, prod_db=prod_db)

        assert isinstance(result, dict)
        assert "tables_copied" in result
        tables = result["tables_copied"]
        assert tables["persons"] == 3
        assert tables["attendees"] == 2
        assert tables["bunks"] == 2
        assert tables["config"] == 1

    def test_summary_excludes_system_tables(self, dev_and_prod: tuple[str, str], seed_module: types.ModuleType) -> None:
        dev_db, prod_db = dev_and_prod
        result = seed_module.seed_from_prod(dev_db=dev_db, prod_db=prod_db)

        tables = result["tables_copied"]
        for sys_table in SYSTEM_TABLES + ["users"]:
            assert sys_table not in tables

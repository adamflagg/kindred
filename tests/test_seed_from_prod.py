"""Tests for scripts/setup/seed_from_prod.py — production-to-dev database seeding.

Tests all patching operations:
- Superuser replacement (bcrypt hash, correct email)
- OAuth2 credential replacement in _collections JSON
- User/auth/MFA/OTP record cleanup
- Token secret regeneration
- Stale migration cleanup
- Ghost table removal
- Dry-run mode (no changes)
- Missing env var handling (error)
- WAL checkpoint
- .initialized marker creation

Uses temp SQLite databases with minimal PocketBase-like schema.
"""

from __future__ import annotations

import json
import os
import sqlite3
from pathlib import Path
from unittest.mock import patch

import bcrypt
import pytest

# ---------------------------------------------------------------------------
# Helpers to build a minimal PocketBase-like SQLite database for testing
# ---------------------------------------------------------------------------


def _create_test_db(db_path: str, *, include_ghost_table: bool = False) -> None:
    """Create a minimal PocketBase-like data.db for testing.

    Includes: _superusers, _collections (with users row), users,
    _externalAuths, _authOrigins, _mfas, _otps, _migrations.
    """
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    # _superusers
    cur.execute("""
        CREATE TABLE _superusers (
            id TEXT PRIMARY KEY,
            email TEXT NOT NULL,
            password TEXT NOT NULL,
            tokenKey TEXT NOT NULL,
            emailVisibility BOOLEAN DEFAULT 0,
            verified BOOLEAN DEFAULT 1,
            created TEXT DEFAULT '',
            updated TEXT DEFAULT ''
        )
    """)
    cur.execute(
        "INSERT INTO _superusers (id, email, password, tokenKey, created, updated) "
        "VALUES ('prod_admin_id', 'adam@tawonga.camp', '$2a$10$prodhashedpw', "
        "'prodTokenKey123', '2025-01-01', '2025-01-01')"
    )

    # _collections — users row with OAuth2 config in options JSON
    cur.execute("""
        CREATE TABLE _collections (
            id TEXT PRIMARY KEY,
            system BOOLEAN DEFAULT 0,
            type TEXT DEFAULT 'base',
            name TEXT UNIQUE NOT NULL,
            fields JSON DEFAULT '[]',
            indexes JSON DEFAULT '[]',
            listRule TEXT,
            viewRule TEXT,
            createRule TEXT,
            updateRule TEXT,
            deleteRule TEXT,
            options JSON DEFAULT '{}',
            created TEXT DEFAULT '',
            updated TEXT DEFAULT ''
        )
    """)
    users_options = {
        "oauth2": {
            "enabled": True,
            "providers": [
                {
                    "name": "oidc",
                    "clientId": "prod-client-id-999",
                    "clientSecret": "prod-client-secret-xyz",
                    "authURL": "https://id.flagg.cloud/authorize",
                    "tokenURL": "https://id.flagg.cloud/api/oidc/token",
                    "userInfoURL": "",
                    "displayName": "Pocket ID",
                    "pkce": True,
                }
            ],
        },
        "authToken": {"secret": "old_auth_secret_aaa", "duration": 604800},
        "passwordResetToken": {"secret": "old_reset_secret_bbb", "duration": 1800},
        "emailChangeToken": {"secret": "old_email_secret_ccc", "duration": 1800},
        "verificationToken": {"secret": "old_verify_secret_ddd", "duration": 259200},
        "fileToken": {"secret": "old_file_secret_eee", "duration": 180},
    }
    cur.execute(
        "INSERT INTO _collections (id, system, type, name, options) VALUES ('users_col_id', 1, 'auth', 'users', ?)",
        (json.dumps(users_options),),
    )
    # Add a non-users collection to verify it's not modified
    cur.execute(
        "INSERT INTO _collections (id, system, type, name, options) "
        "VALUES ('other_col_id', 0, 'base', 'persons', '{}')",
    )

    if include_ghost_table:
        # Ghost table: exists in _collections and as a real table, but no migration file
        cur.execute(
            "INSERT INTO _collections (id, system, type, name, options) "
            "VALUES ('ghost_col_id', 0, 'base', 'geo_aliases', '{}')",
        )
        cur.execute("CREATE TABLE geo_aliases (id TEXT PRIMARY KEY, name TEXT)")
        cur.execute("INSERT INTO geo_aliases VALUES ('g1', 'test')")

    # users (auth records)
    cur.execute("""
        CREATE TABLE users (
            id TEXT PRIMARY KEY,
            email TEXT NOT NULL,
            name TEXT DEFAULT '',
            password TEXT DEFAULT '',
            tokenKey TEXT DEFAULT '',
            avatar TEXT DEFAULT '',
            emailVisibility BOOLEAN DEFAULT 0,
            verified BOOLEAN DEFAULT 0,
            created TEXT DEFAULT '',
            updated TEXT DEFAULT ''
        )
    """)
    cur.execute("INSERT INTO users (id, email, name) VALUES ('user1', 'alice@example.com', 'Alice')")
    cur.execute("INSERT INTO users (id, email, name) VALUES ('user2', 'bob@example.com', 'Bob')")

    # _externalAuths
    cur.execute("""
        CREATE TABLE _externalAuths (
            id TEXT PRIMARY KEY,
            collectionRef TEXT DEFAULT '',
            recordRef TEXT DEFAULT '',
            provider TEXT DEFAULT '',
            providerId TEXT DEFAULT '',
            created TEXT DEFAULT '',
            updated TEXT DEFAULT ''
        )
    """)
    cur.execute(
        "INSERT INTO _externalAuths (id, collectionRef, recordRef, provider, providerId) "
        "VALUES ('ea1', 'users_col_id', 'user1', 'oidc', 'oidc-id-1')"
    )

    # _authOrigins
    cur.execute("""
        CREATE TABLE _authOrigins (
            id TEXT PRIMARY KEY,
            collectionRef TEXT DEFAULT '',
            recordRef TEXT DEFAULT '',
            fingerprint TEXT DEFAULT '',
            created TEXT DEFAULT '',
            updated TEXT DEFAULT ''
        )
    """)
    cur.execute(
        "INSERT INTO _authOrigins (id, collectionRef, recordRef, fingerprint) "
        "VALUES ('ao1', 'users_col_id', 'user1', 'fp123')"
    )

    # _mfas
    cur.execute("""
        CREATE TABLE _mfas (
            id TEXT PRIMARY KEY,
            collectionRef TEXT DEFAULT '',
            recordRef TEXT DEFAULT '',
            method TEXT DEFAULT '',
            created TEXT DEFAULT '',
            updated TEXT DEFAULT ''
        )
    """)
    cur.execute(
        "INSERT INTO _mfas (id, collectionRef, recordRef, method) VALUES ('mfa1', 'users_col_id', 'user1', 'totp')"
    )

    # _otps
    cur.execute("""
        CREATE TABLE _otps (
            id TEXT PRIMARY KEY,
            collectionRef TEXT DEFAULT '',
            recordRef TEXT DEFAULT '',
            password TEXT DEFAULT '',
            sentTo TEXT DEFAULT '',
            created TEXT DEFAULT '',
            updated TEXT DEFAULT ''
        )
    """)
    cur.execute(
        "INSERT INTO _otps (id, collectionRef, recordRef, password, sentTo) "
        "VALUES ('otp1', 'users_col_id', 'user1', 'hashed', 'alice@example.com')"
    )

    # _migrations
    cur.execute("""
        CREATE TABLE _migrations (
            file VARCHAR(255) PRIMARY KEY NOT NULL,
            applied INTEGER NOT NULL
        )
    """)
    # Insert some migration entries — some exist on disk, some stale
    cur.execute("INSERT INTO _migrations VALUES ('1640988000_init.go', 1)")
    cur.execute("INSERT INTO _migrations VALUES ('1500000001_person_tag_defs.js', 1)")
    cur.execute("INSERT INTO _migrations VALUES ('1500000015_persons.js', 1)")
    # Stale: migration file removed from codebase
    cur.execute("INSERT INTO _migrations VALUES ('1500000051_geo_aliases.js', 1)")
    # Another stale one
    cur.execute("INSERT INTO _migrations VALUES ('9999999999_nonexistent.js', 1)")

    conn.commit()
    conn.close()


def _env_vars(
    *,
    email: str = "admin@camp.local",
    password: str = "campbunking123",
    client_id: str = "dev-client-id-123",
    client_secret: str = "dev-client-secret-456",
) -> dict[str, str]:
    """Return env vars dict for patching os.environ."""
    return {
        "POCKETBASE_ADMIN_EMAIL": email,
        "POCKETBASE_ADMIN_PASSWORD": password,
        "OIDC_CLIENT_ID": client_id,
        "OIDC_CLIENT_SECRET": client_secret,
    }


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def tmp_project(tmp_path: Path) -> Path:
    """Create a temp project layout with data.db and migration files."""
    # Create pb_data dir
    pb_data = tmp_path / "pocketbase" / "pb_data"
    pb_data.mkdir(parents=True)

    # Create data.db
    db_path = pb_data / "data.db"
    _create_test_db(str(db_path))

    # Create pb_migrations dir with some "existing" migration files
    migrations_dir = tmp_path / "pocketbase" / "pb_migrations"
    migrations_dir.mkdir()
    # These files "exist on disk" — matching entries in _migrations are kept
    (migrations_dir / "1500000001_person_tag_defs.js").write_text("// migration")
    (migrations_dir / "1500000015_persons.js").write_text("// migration")
    # Note: 1500000051_geo_aliases.js is NOT created = stale entry
    # Note: 9999999999_nonexistent.js is NOT created = stale entry
    # Go migrations are never stale (PocketBase built-in)

    return tmp_path


@pytest.fixture()
def tmp_project_with_ghost(tmp_path: Path) -> Path:
    """Like tmp_project but with a ghost table in the DB."""
    pb_data = tmp_path / "pocketbase" / "pb_data"
    pb_data.mkdir(parents=True)

    db_path = pb_data / "data.db"
    _create_test_db(str(db_path), include_ghost_table=True)

    migrations_dir = tmp_path / "pocketbase" / "pb_migrations"
    migrations_dir.mkdir()
    (migrations_dir / "1500000001_person_tag_defs.js").write_text("// migration")
    (migrations_dir / "1500000015_persons.js").write_text("// migration")
    # No geo_aliases migration file — it was removed

    return tmp_path


# ---------------------------------------------------------------------------
# Import the module under test
# ---------------------------------------------------------------------------


@pytest.fixture()
def seed_module():
    """Import the seed_from_prod module."""
    import importlib

    mod = importlib.import_module("scripts.setup.seed_from_prod")
    return mod


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestSuperuserReplacement:
    """Test that prod superusers are replaced with a dev superuser."""

    def test_replaces_prod_superuser(self, tmp_project: Path, seed_module) -> None:
        db_path = str(tmp_project / "pocketbase" / "pb_data" / "data.db")
        env = _env_vars()

        with patch.dict(os.environ, env, clear=False):
            seed_module.seed_from_prod(
                data_db=db_path,
                project_root=str(tmp_project),
                dry_run=False,
            )

        conn = sqlite3.connect(db_path)
        rows = conn.execute("SELECT id, email, password, tokenKey FROM _superusers").fetchall()
        conn.close()

        assert len(rows) == 1
        row = rows[0]
        assert row[1] == "admin@camp.local"
        # Password should be a valid bcrypt hash
        assert row[2].startswith("$2")
        assert bcrypt.checkpw(b"campbunking123", row[2].encode())
        # tokenKey should be regenerated (not the prod value)
        assert row[3] != "prodTokenKey123"
        assert len(row[3]) > 10

    def test_superuser_id_is_valid(self, tmp_project: Path, seed_module) -> None:
        """Superuser ID should be a valid PocketBase-style ID."""
        db_path = str(tmp_project / "pocketbase" / "pb_data" / "data.db")
        env = _env_vars()

        with patch.dict(os.environ, env, clear=False):
            seed_module.seed_from_prod(
                data_db=db_path,
                project_root=str(tmp_project),
                dry_run=False,
            )

        conn = sqlite3.connect(db_path)
        row = conn.execute("SELECT id FROM _superusers").fetchone()
        conn.close()

        # PocketBase IDs are 15-char alphanumeric strings
        assert row[0] is not None
        assert len(row[0]) == 15


class TestOAuth2CredentialReplacement:
    """Test that OAuth2 client credentials in _collections are replaced."""

    def test_replaces_client_id_and_secret(self, tmp_project: Path, seed_module) -> None:
        db_path = str(tmp_project / "pocketbase" / "pb_data" / "data.db")
        env = _env_vars(client_id="new-dev-client", client_secret="new-dev-secret")

        with patch.dict(os.environ, env, clear=False):
            seed_module.seed_from_prod(
                data_db=db_path,
                project_root=str(tmp_project),
                dry_run=False,
            )

        conn = sqlite3.connect(db_path)
        row = conn.execute("SELECT options FROM _collections WHERE name = 'users'").fetchone()
        conn.close()

        options = json.loads(row[0])
        provider = options["oauth2"]["providers"][0]
        assert provider["clientId"] == "new-dev-client"
        assert provider["clientSecret"] == "new-dev-secret"

    def test_preserves_other_oauth2_fields(self, tmp_project: Path, seed_module) -> None:
        """Non-credential OAuth2 fields (authURL, displayName, etc.) should be preserved."""
        db_path = str(tmp_project / "pocketbase" / "pb_data" / "data.db")
        env = _env_vars()

        with patch.dict(os.environ, env, clear=False):
            seed_module.seed_from_prod(
                data_db=db_path,
                project_root=str(tmp_project),
                dry_run=False,
            )

        conn = sqlite3.connect(db_path)
        row = conn.execute("SELECT options FROM _collections WHERE name = 'users'").fetchone()
        conn.close()

        options = json.loads(row[0])
        provider = options["oauth2"]["providers"][0]
        assert provider["authURL"] == "https://id.flagg.cloud/authorize"
        assert provider["displayName"] == "Pocket ID"
        assert provider["pkce"] is True

    def test_does_not_modify_other_collections(self, tmp_project: Path, seed_module) -> None:
        db_path = str(tmp_project / "pocketbase" / "pb_data" / "data.db")
        env = _env_vars()

        with patch.dict(os.environ, env, clear=False):
            seed_module.seed_from_prod(
                data_db=db_path,
                project_root=str(tmp_project),
                dry_run=False,
            )

        conn = sqlite3.connect(db_path)
        row = conn.execute("SELECT options FROM _collections WHERE name = 'persons'").fetchone()
        conn.close()

        assert row[0] == "{}"


class TestTokenSecretRegeneration:
    """Test that token secrets in users collection options are regenerated."""

    def test_regenerates_all_token_secrets(self, tmp_project: Path, seed_module) -> None:
        db_path = str(tmp_project / "pocketbase" / "pb_data" / "data.db")
        env = _env_vars()

        with patch.dict(os.environ, env, clear=False):
            seed_module.seed_from_prod(
                data_db=db_path,
                project_root=str(tmp_project),
                dry_run=False,
            )

        conn = sqlite3.connect(db_path)
        row = conn.execute("SELECT options FROM _collections WHERE name = 'users'").fetchone()
        conn.close()

        options = json.loads(row[0])
        old_secrets = {
            "authToken": "old_auth_secret_aaa",
            "passwordResetToken": "old_reset_secret_bbb",
            "emailChangeToken": "old_email_secret_ccc",
            "verificationToken": "old_verify_secret_ddd",
            "fileToken": "old_file_secret_eee",
        }
        for key, old_val in old_secrets.items():
            new_secret = options[key]["secret"]
            assert new_secret != old_val, f"{key} secret was not regenerated"
            assert len(new_secret) >= 30, f"{key} secret too short"

    def test_preserves_token_durations(self, tmp_project: Path, seed_module) -> None:
        db_path = str(tmp_project / "pocketbase" / "pb_data" / "data.db")
        env = _env_vars()

        with patch.dict(os.environ, env, clear=False):
            seed_module.seed_from_prod(
                data_db=db_path,
                project_root=str(tmp_project),
                dry_run=False,
            )

        conn = sqlite3.connect(db_path)
        row = conn.execute("SELECT options FROM _collections WHERE name = 'users'").fetchone()
        conn.close()

        options = json.loads(row[0])
        assert options["authToken"]["duration"] == 604800
        assert options["passwordResetToken"]["duration"] == 1800
        assert options["fileToken"]["duration"] == 180


class TestUserAuthCleanup:
    """Test that all user/auth records are deleted."""

    def test_deletes_all_users(self, tmp_project: Path, seed_module) -> None:
        db_path = str(tmp_project / "pocketbase" / "pb_data" / "data.db")
        env = _env_vars()

        with patch.dict(os.environ, env, clear=False):
            seed_module.seed_from_prod(
                data_db=db_path,
                project_root=str(tmp_project),
                dry_run=False,
            )

        conn = sqlite3.connect(db_path)
        count = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        conn.close()
        assert count == 0

    def test_deletes_all_external_auths(self, tmp_project: Path, seed_module) -> None:
        db_path = str(tmp_project / "pocketbase" / "pb_data" / "data.db")
        env = _env_vars()

        with patch.dict(os.environ, env, clear=False):
            seed_module.seed_from_prod(
                data_db=db_path,
                project_root=str(tmp_project),
                dry_run=False,
            )

        conn = sqlite3.connect(db_path)
        count = conn.execute("SELECT COUNT(*) FROM _externalAuths").fetchone()[0]
        conn.close()
        assert count == 0

    def test_deletes_all_auth_origins(self, tmp_project: Path, seed_module) -> None:
        db_path = str(tmp_project / "pocketbase" / "pb_data" / "data.db")
        env = _env_vars()

        with patch.dict(os.environ, env, clear=False):
            seed_module.seed_from_prod(
                data_db=db_path,
                project_root=str(tmp_project),
                dry_run=False,
            )

        conn = sqlite3.connect(db_path)
        count = conn.execute("SELECT COUNT(*) FROM _authOrigins").fetchone()[0]
        conn.close()
        assert count == 0

    def test_deletes_all_mfas(self, tmp_project: Path, seed_module) -> None:
        db_path = str(tmp_project / "pocketbase" / "pb_data" / "data.db")
        env = _env_vars()

        with patch.dict(os.environ, env, clear=False):
            seed_module.seed_from_prod(
                data_db=db_path,
                project_root=str(tmp_project),
                dry_run=False,
            )

        conn = sqlite3.connect(db_path)
        count = conn.execute("SELECT COUNT(*) FROM _mfas").fetchone()[0]
        conn.close()
        assert count == 0

    def test_deletes_all_otps(self, tmp_project: Path, seed_module) -> None:
        db_path = str(tmp_project / "pocketbase" / "pb_data" / "data.db")
        env = _env_vars()

        with patch.dict(os.environ, env, clear=False):
            seed_module.seed_from_prod(
                data_db=db_path,
                project_root=str(tmp_project),
                dry_run=False,
            )

        conn = sqlite3.connect(db_path)
        count = conn.execute("SELECT COUNT(*) FROM _otps").fetchone()[0]
        conn.close()
        assert count == 0


class TestStaleMigrationCleanup:
    """Test that stale _migrations entries are removed."""

    def test_removes_stale_js_migrations(self, tmp_project: Path, seed_module) -> None:
        db_path = str(tmp_project / "pocketbase" / "pb_data" / "data.db")
        env = _env_vars()

        with patch.dict(os.environ, env, clear=False):
            seed_module.seed_from_prod(
                data_db=db_path,
                project_root=str(tmp_project),
                dry_run=False,
            )

        conn = sqlite3.connect(db_path)
        files = [r[0] for r in conn.execute("SELECT file FROM _migrations").fetchall()]
        conn.close()

        # Stale JS migrations should be removed
        assert "1500000051_geo_aliases.js" not in files
        assert "9999999999_nonexistent.js" not in files

    def test_keeps_valid_js_migrations(self, tmp_project: Path, seed_module) -> None:
        db_path = str(tmp_project / "pocketbase" / "pb_data" / "data.db")
        env = _env_vars()

        with patch.dict(os.environ, env, clear=False):
            seed_module.seed_from_prod(
                data_db=db_path,
                project_root=str(tmp_project),
                dry_run=False,
            )

        conn = sqlite3.connect(db_path)
        files = [r[0] for r in conn.execute("SELECT file FROM _migrations").fetchall()]
        conn.close()

        assert "1500000001_person_tag_defs.js" in files
        assert "1500000015_persons.js" in files

    def test_keeps_go_migrations(self, tmp_project: Path, seed_module) -> None:
        """Go migrations are PocketBase built-ins, never stale."""
        db_path = str(tmp_project / "pocketbase" / "pb_data" / "data.db")
        env = _env_vars()

        with patch.dict(os.environ, env, clear=False):
            seed_module.seed_from_prod(
                data_db=db_path,
                project_root=str(tmp_project),
                dry_run=False,
            )

        conn = sqlite3.connect(db_path)
        files = [r[0] for r in conn.execute("SELECT file FROM _migrations").fetchall()]
        conn.close()

        assert "1640988000_init.go" in files


class TestGhostTableRemoval:
    """Test that ghost tables (in DB but no migration file) are removed."""

    def test_drops_ghost_table_and_collection_entry(self, tmp_project_with_ghost: Path, seed_module) -> None:
        db_path = str(tmp_project_with_ghost / "pocketbase" / "pb_data" / "data.db")
        env = _env_vars()

        with patch.dict(os.environ, env, clear=False):
            seed_module.seed_from_prod(
                data_db=db_path,
                project_root=str(tmp_project_with_ghost),
                dry_run=False,
            )

        conn = sqlite3.connect(db_path)

        # _collections entry should be gone
        count = conn.execute("SELECT COUNT(*) FROM _collections WHERE name = 'geo_aliases'").fetchone()[0]
        assert count == 0

        # Actual table should be dropped
        tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
        assert "geo_aliases" not in tables

        conn.close()

    def test_does_not_remove_active_collections(self, tmp_project_with_ghost: Path, seed_module) -> None:
        """Collections with matching migration files should NOT be removed."""
        db_path = str(tmp_project_with_ghost / "pocketbase" / "pb_data" / "data.db")
        env = _env_vars()

        with patch.dict(os.environ, env, clear=False):
            seed_module.seed_from_prod(
                data_db=db_path,
                project_root=str(tmp_project_with_ghost),
                dry_run=False,
            )

        conn = sqlite3.connect(db_path)
        names = [r[0] for r in conn.execute("SELECT name FROM _collections").fetchall()]
        conn.close()

        assert "users" in names
        assert "persons" in names

    def test_multi_table_migration_not_flagged_as_ghost(self, tmp_path: Path, seed_module) -> None:
        """Collections created by a multi-table migration should NOT be removed.

        e.g., family_camp_derived_tables.js creates family_camp_adults,
        family_camp_registrations, family_camp_medical — none of those names
        match the migration filename, but they are NOT ghosts.
        """
        pb_data = tmp_path / "pocketbase" / "pb_data"
        pb_data.mkdir(parents=True)
        db_path = str(pb_data / "data.db")
        _create_test_db(db_path)

        # Add multi-table collections to the DB (like family_camp_derived)
        conn = sqlite3.connect(db_path)
        conn.execute(
            "INSERT INTO _collections (id, system, type, name, options) "
            "VALUES ('fc_adults', 0, 'base', 'family_camp_adults', '{}')"
        )
        conn.execute(
            "INSERT INTO _collections (id, system, type, name, options) "
            "VALUES ('fc_regs', 0, 'base', 'family_camp_registrations', '{}')"
        )
        conn.execute(
            "INSERT INTO _collections (id, system, type, name, options) "
            "VALUES ('fc_med', 0, 'base', 'family_camp_medical', '{}')"
        )
        # Record the migration as applied
        conn.execute("INSERT INTO _migrations VALUES ('1500000035_family_camp_derived_tables.js', 1)")
        conn.commit()
        conn.close()

        migrations_dir = tmp_path / "pocketbase" / "pb_migrations"
        migrations_dir.mkdir(exist_ok=True)
        (migrations_dir / "1500000001_person_tag_defs.js").write_text("// m")
        (migrations_dir / "1500000015_persons.js").write_text("// m")
        # The multi-table migration file exists on disk
        (migrations_dir / "1500000035_family_camp_derived_tables.js").write_text("// m")

        env = _env_vars()
        with patch.dict(os.environ, env, clear=False):
            result = seed_module.seed_from_prod(
                data_db=db_path,
                project_root=str(tmp_path),
                dry_run=False,
            )

        assert result["ghost_tables_removed"] == 0

        conn = sqlite3.connect(db_path)
        names = [r[0] for r in conn.execute("SELECT name FROM _collections WHERE system = 0").fetchall()]
        conn.close()

        assert "family_camp_adults" in names
        assert "family_camp_registrations" in names
        assert "family_camp_medical" in names


class TestDryRun:
    """Test that dry-run mode reports changes without modifying the database."""

    def test_dry_run_does_not_modify_superusers(self, tmp_project: Path, seed_module) -> None:
        db_path = str(tmp_project / "pocketbase" / "pb_data" / "data.db")
        env = _env_vars()

        with patch.dict(os.environ, env, clear=False):
            seed_module.seed_from_prod(
                data_db=db_path,
                project_root=str(tmp_project),
                dry_run=True,
            )

        conn = sqlite3.connect(db_path)
        row = conn.execute("SELECT email FROM _superusers").fetchone()
        conn.close()
        assert row[0] == "adam@tawonga.camp"

    def test_dry_run_does_not_delete_users(self, tmp_project: Path, seed_module) -> None:
        db_path = str(tmp_project / "pocketbase" / "pb_data" / "data.db")
        env = _env_vars()

        with patch.dict(os.environ, env, clear=False):
            seed_module.seed_from_prod(
                data_db=db_path,
                project_root=str(tmp_project),
                dry_run=True,
            )

        conn = sqlite3.connect(db_path)
        count = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        conn.close()
        assert count == 2

    def test_dry_run_does_not_modify_oauth2(self, tmp_project: Path, seed_module) -> None:
        db_path = str(tmp_project / "pocketbase" / "pb_data" / "data.db")
        env = _env_vars()

        with patch.dict(os.environ, env, clear=False):
            seed_module.seed_from_prod(
                data_db=db_path,
                project_root=str(tmp_project),
                dry_run=True,
            )

        conn = sqlite3.connect(db_path)
        row = conn.execute("SELECT options FROM _collections WHERE name = 'users'").fetchone()
        conn.close()

        options = json.loads(row[0])
        assert options["oauth2"]["providers"][0]["clientId"] == "prod-client-id-999"

    def test_dry_run_does_not_touch_initialized_marker(self, tmp_project: Path, seed_module) -> None:
        db_path = str(tmp_project / "pocketbase" / "pb_data" / "data.db")
        marker = tmp_project / "pocketbase" / "pb_data" / ".initialized"
        env = _env_vars()

        with patch.dict(os.environ, env, clear=False):
            seed_module.seed_from_prod(
                data_db=db_path,
                project_root=str(tmp_project),
                dry_run=True,
            )

        assert not marker.exists()


class TestMissingEnvVars:
    """Test error handling for missing required environment variables."""

    @pytest.mark.parametrize(
        "missing_var",
        [
            "POCKETBASE_ADMIN_EMAIL",
            "POCKETBASE_ADMIN_PASSWORD",
            "OIDC_CLIENT_ID",
            "OIDC_CLIENT_SECRET",
        ],
    )
    def test_raises_on_missing_env_var(self, tmp_project: Path, seed_module, missing_var: str) -> None:
        db_path = str(tmp_project / "pocketbase" / "pb_data" / "data.db")
        env = _env_vars()
        del env[missing_var]

        # Also clear from actual env in case it's set
        clean_env = {k: v for k, v in os.environ.items() if k != missing_var}
        clean_env.update(env)

        with patch.dict(os.environ, clean_env, clear=True):
            with pytest.raises(SystemExit):
                seed_module.seed_from_prod(
                    data_db=db_path,
                    project_root=str(tmp_project),
                    dry_run=False,
                )


class TestInitializedMarker:
    """Test that .initialized marker file is created after successful patching."""

    def test_creates_initialized_marker(self, tmp_project: Path, seed_module) -> None:
        db_path = str(tmp_project / "pocketbase" / "pb_data" / "data.db")
        marker = tmp_project / "pocketbase" / "pb_data" / ".initialized"
        env = _env_vars()

        assert not marker.exists()

        with patch.dict(os.environ, env, clear=False):
            seed_module.seed_from_prod(
                data_db=db_path,
                project_root=str(tmp_project),
                dry_run=False,
            )

        assert marker.exists()


class TestWalCleanup:
    """Test that WAL and SHM files are removed after checkpoint."""

    def test_removes_wal_and_shm_files(self, tmp_project: Path, seed_module) -> None:
        db_path = tmp_project / "pocketbase" / "pb_data" / "data.db"
        wal_path = db_path.with_name("data.db-wal")
        shm_path = db_path.with_name("data.db-shm")

        # Create fake WAL/SHM files (as if copied from prod)
        wal_path.write_bytes(b"\x00" * 100)
        shm_path.write_bytes(b"\x00" * 32)

        env = _env_vars()
        with patch.dict(os.environ, env, clear=False):
            seed_module.seed_from_prod(
                data_db=str(db_path),
                project_root=str(tmp_project),
                dry_run=False,
            )

        assert not wal_path.exists()
        assert not shm_path.exists()
        assert db_path.exists()  # data.db itself still exists


class TestReturnValue:
    """Test the return value / summary from seed_from_prod."""

    def test_returns_summary_dict(self, tmp_project: Path, seed_module) -> None:
        db_path = str(tmp_project / "pocketbase" / "pb_data" / "data.db")
        env = _env_vars()

        with patch.dict(os.environ, env, clear=False):
            result = seed_module.seed_from_prod(
                data_db=db_path,
                project_root=str(tmp_project),
                dry_run=False,
            )

        assert isinstance(result, dict)
        assert "superusers_deleted" in result
        assert "users_deleted" in result
        assert "external_auths_deleted" in result
        assert "auth_origins_deleted" in result
        assert "mfas_deleted" in result
        assert "otps_deleted" in result
        assert "stale_migrations_removed" in result
        assert "ghost_tables_removed" in result

    def test_summary_counts_are_correct(self, tmp_project: Path, seed_module) -> None:
        db_path = str(tmp_project / "pocketbase" / "pb_data" / "data.db")
        env = _env_vars()

        with patch.dict(os.environ, env, clear=False):
            result = seed_module.seed_from_prod(
                data_db=db_path,
                project_root=str(tmp_project),
                dry_run=False,
            )

        assert result["superusers_deleted"] == 1
        assert result["users_deleted"] == 2
        assert result["external_auths_deleted"] == 1
        assert result["auth_origins_deleted"] == 1
        assert result["mfas_deleted"] == 1
        assert result["otps_deleted"] == 1
        assert result["stale_migrations_removed"] == 2  # geo_aliases + nonexistent
        assert result["ghost_tables_removed"] == 0  # no ghost tables in base fixture


class TestDbFileValidation:
    """Test validation of the database file path."""

    def test_raises_on_missing_db_file(self, tmp_project: Path, seed_module) -> None:
        env = _env_vars()

        with patch.dict(os.environ, env, clear=False):
            with pytest.raises(SystemExit):
                seed_module.seed_from_prod(
                    data_db="/nonexistent/path/data.db",
                    project_root=str(tmp_project),
                    dry_run=False,
                )

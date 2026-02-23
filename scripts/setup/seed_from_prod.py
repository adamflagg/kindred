#!/usr/bin/env python3
"""Patch a production PocketBase data.db for local development use.

Operates directly on SQLite — no running PocketBase needed. Reads env vars
for dev credentials and applies all patches in a single transaction.

Usage:
    uv run python scripts/setup/seed_from_prod.py [--data-db PATH] [--dry-run]
"""

from __future__ import annotations

import argparse
import json
import os
import secrets
import sqlite3
import sys
from pathlib import Path

import bcrypt

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _generate_pb_id() -> str:
    """Generate a PocketBase-style 15-character alphanumeric ID."""
    # PocketBase uses 'r' + 14 hex chars from randomblob(7)
    return "r" + secrets.token_hex(7)


def _generate_token_key() -> str:
    """Generate a random token key (50 chars, URL-safe base64)."""
    return secrets.token_urlsafe(37)[:50]


def _generate_token_secret() -> str:
    """Generate a random token secret (50 chars, URL-safe base64)."""
    return secrets.token_urlsafe(37)[:50]


def _hash_password(password: str) -> str:
    """Hash a password using bcrypt (matching PocketBase's format)."""
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def _get_required_env(name: str) -> str:
    """Get a required environment variable or exit with an error."""
    value = os.environ.get(name)
    if not value:
        print(f"ERROR: Required environment variable {name} is not set")
        sys.exit(1)
    return value


def _get_migration_files_on_disk(project_root: str) -> set[str]:
    """Get the set of JS migration filenames that exist on disk."""
    migrations_dir = Path(project_root) / "pocketbase" / "pb_migrations"
    if not migrations_dir.is_dir():
        return set()
    return {f.name for f in migrations_dir.glob("*.js")}


def _get_collection_names_from_migrations(migration_files: set[str]) -> set[str]:
    """Extract collection names from migration filenames.

    Migration files follow the pattern: 1500000006_bunks.js
    The collection name is derived from the part after the number prefix.
    """
    names = set()
    for f in migration_files:
        # Strip .js extension and the numeric prefix
        stem = f.removesuffix(".js")
        parts = stem.split("_", 1)
        if len(parts) == 2:
            names.add(parts[1])
    return names


# ---------------------------------------------------------------------------
# Core patching functions
# ---------------------------------------------------------------------------


def _patch_superuser(cur: sqlite3.Cursor, email: str, password: str) -> int:
    """Delete prod superusers and insert a dev superuser."""
    count: int = cur.execute("SELECT COUNT(*) FROM _superusers").fetchone()[0]
    cur.execute("DELETE FROM _superusers")

    now = "2025-01-01 00:00:00.000Z"
    cur.execute(
        "INSERT INTO _superusers (id, email, password, tokenKey, emailVisibility, "
        "verified, created, updated) VALUES (?, ?, ?, ?, 0, 1, ?, ?)",
        (
            _generate_pb_id(),
            email,
            _hash_password(password),
            _generate_token_key(),
            now,
            now,
        ),
    )
    return count


def _patch_oauth2_credentials(cur: sqlite3.Cursor, client_id: str, client_secret: str) -> None:
    """Replace OAuth2 client credentials in the users collection options."""
    row = cur.execute("SELECT options FROM _collections WHERE name = 'users'").fetchone()
    if not row:
        return

    options = json.loads(row[0])

    # Update OAuth2 provider credentials
    providers = options.get("oauth2", {}).get("providers", [])
    for provider in providers:
        provider["clientId"] = client_id
        provider["clientSecret"] = client_secret

    # Regenerate token secrets
    for token_key in (
        "authToken",
        "passwordResetToken",
        "emailChangeToken",
        "verificationToken",
        "fileToken",
    ):
        if token_key in options:
            options[token_key]["secret"] = _generate_token_secret()

    cur.execute(
        "UPDATE _collections SET options = ? WHERE name = 'users'",
        (json.dumps(options),),
    )


def _delete_all(cur: sqlite3.Cursor, table: str) -> int:
    """Delete all rows from a table and return the count deleted."""
    count: int = cur.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]  # noqa: S608
    cur.execute(f"DELETE FROM {table}")  # noqa: S608
    return count


def _clean_stale_migrations(cur: sqlite3.Cursor, migration_files_on_disk: set[str]) -> int:
    """Remove _migrations entries for JS files that no longer exist on disk."""
    rows = cur.execute("SELECT file FROM _migrations WHERE file LIKE '%.js'").fetchall()

    stale = [r[0] for r in rows if r[0] not in migration_files_on_disk]
    for f in stale:
        cur.execute("DELETE FROM _migrations WHERE file = ?", (f,))
    return len(stale)


def _find_stale_migration_names(cur: sqlite3.Cursor, migration_files_on_disk: set[str]) -> set[str]:
    """Find migration names (suffix after numeric prefix) for stale JS entries.

    A stale migration is one recorded in _migrations but whose file no longer
    exists on disk.
    """
    rows = cur.execute("SELECT file FROM _migrations WHERE file LIKE '%.js'").fetchall()
    stale_files = [r[0] for r in rows if r[0] not in migration_files_on_disk]
    return _get_collection_names_from_migrations(set(stale_files))


def _clean_ghost_tables(cur: sqlite3.Cursor, migration_files_on_disk: set[str]) -> list[str]:
    """Drop non-system collections whose creating migration was removed.

    A ghost table is a collection that still exists in _collections (and as a
    real SQLite table) but whose migration file was deleted from the codebase.
    We detect these by finding stale _migrations entries and checking if the
    collection name extracted from the stale filename matches a _collections row.

    Single migrations that create multiple tables (e.g., family_camp_derived_tables
    creating family_camp_adults, family_camp_medical, family_camp_registrations)
    are safe because the stale name ("geo_aliases") won't match unrelated tables.
    """
    stale_names = _find_stale_migration_names(cur, migration_files_on_disk)

    # Get non-system collection names from the database
    rows = cur.execute("SELECT name FROM _collections WHERE system = 0").fetchall()
    db_collections = {r[0] for r in rows}

    # Ghost = collection name matches a stale migration name exactly
    ghosts = sorted(db_collections & stale_names)

    for ghost in ghosts:
        cur.execute("DELETE FROM _collections WHERE name = ?", (ghost,))
        cur.execute(f"DROP TABLE IF EXISTS [{ghost}]")

    return ghosts


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------


def seed_from_prod(
    *,
    data_db: str,
    project_root: str,
    dry_run: bool = False,
) -> dict[str, object]:
    """Patch a production data.db for dev use.

    Args:
        data_db: Path to the data.db file to patch.
        project_root: Path to the project root (for finding migration files).
        dry_run: If True, report what would change without modifying.

    Returns:
        Summary dict with counts of changes made.
    """
    # Validate inputs
    if not Path(data_db).is_file():
        print(f"ERROR: Database file not found: {data_db}")
        sys.exit(1)

    # Read required env vars
    admin_email = _get_required_env("POCKETBASE_ADMIN_EMAIL")
    admin_password = _get_required_env("POCKETBASE_ADMIN_PASSWORD")
    client_id = _get_required_env("OIDC_CLIENT_ID")
    client_secret = _get_required_env("OIDC_CLIENT_SECRET")

    # Get migration files on disk for stale migration / ghost table detection
    migration_files = _get_migration_files_on_disk(project_root)

    # WAL checkpoint — consolidate WAL into main db before modifying
    conn = sqlite3.connect(data_db)
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    conn.close()

    # Reopen for patching
    conn = sqlite3.connect(data_db)
    cur = conn.cursor()

    summary: dict[str, object] = {}

    if dry_run:
        # Report what would change without modifying
        summary["superusers_deleted"] = cur.execute("SELECT COUNT(*) FROM _superusers").fetchone()[0]
        summary["users_deleted"] = cur.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        summary["external_auths_deleted"] = cur.execute("SELECT COUNT(*) FROM _externalAuths").fetchone()[0]
        summary["auth_origins_deleted"] = cur.execute("SELECT COUNT(*) FROM _authOrigins").fetchone()[0]
        summary["mfas_deleted"] = cur.execute("SELECT COUNT(*) FROM _mfas").fetchone()[0]
        summary["otps_deleted"] = cur.execute("SELECT COUNT(*) FROM _otps").fetchone()[0]

        # Count stale migrations
        rows = cur.execute("SELECT file FROM _migrations WHERE file LIKE '%.js'").fetchall()
        stale = [r[0] for r in rows if r[0] not in migration_files]
        summary["stale_migrations_removed"] = len(stale)

        # Count ghost tables
        stale_names = _find_stale_migration_names(cur, migration_files)
        db_cols = {r[0] for r in cur.execute("SELECT name FROM _collections WHERE system = 0").fetchall()}
        ghosts = sorted(db_cols & stale_names)
        summary["ghost_tables_removed"] = len(ghosts)

        conn.close()

        print("DRY RUN — no changes made")
        _print_summary(summary, admin_email, dry_run=True)
        return summary

    # Apply all patches in a transaction
    try:
        # 1. Replace superuser
        summary["superusers_deleted"] = _patch_superuser(cur, admin_email, admin_password)

        # 2. Patch OAuth2 credentials + regenerate token secrets
        _patch_oauth2_credentials(cur, client_id, client_secret)

        # 3-6. Delete auth-related records
        summary["users_deleted"] = _delete_all(cur, "users")
        summary["external_auths_deleted"] = _delete_all(cur, "_externalAuths")
        summary["auth_origins_deleted"] = _delete_all(cur, "_authOrigins")
        summary["mfas_deleted"] = _delete_all(cur, "_mfas")
        summary["otps_deleted"] = _delete_all(cur, "_otps")

        # 7. Clean ghost tables
        ghosts = _clean_ghost_tables(cur, migration_files)
        summary["ghost_tables_removed"] = len(ghosts)
        if ghosts:
            summary["ghost_table_names"] = ghosts

        # 8. Clean stale migrations
        summary["stale_migrations_removed"] = _clean_stale_migrations(cur, migration_files)

        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    # Touch .initialized marker
    pb_data_dir = Path(data_db).parent
    (pb_data_dir / ".initialized").touch()

    _print_summary(summary, admin_email)
    return summary


def _print_summary(summary: dict[str, object], admin_email: str, *, dry_run: bool = False) -> None:
    """Print a summary of changes made (or would be made)."""
    prefix = "Would" if dry_run else "Done"
    print(f"\n{'=' * 50}")
    print(f"  {prefix} patch production database for dev use")
    print(f"{'=' * 50}")
    print(f"  Superuser: {admin_email}")
    print(f"  Superusers replaced: {summary['superusers_deleted']}")
    print(f"  Users deleted: {summary['users_deleted']}")
    print(f"  External auths deleted: {summary['external_auths_deleted']}")
    print(f"  Auth origins deleted: {summary['auth_origins_deleted']}")
    print(f"  MFAs deleted: {summary['mfas_deleted']}")
    print(f"  OTPs deleted: {summary['otps_deleted']}")
    print(f"  Stale migrations removed: {summary['stale_migrations_removed']}")
    print(f"  Ghost tables removed: {summary['ghost_tables_removed']}")
    ghost_names = summary.get("ghost_table_names")
    if isinstance(ghost_names, list):
        for name in ghost_names:
            print(f"    - {name}")
    print(f"{'=' * 50}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(description="Patch a production PocketBase data.db for local dev use.")
    parser.add_argument(
        "--data-db",
        default=None,
        help="Path to data.db (default: pocketbase/pb_data/data.db)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report what would change without modifying",
    )
    parser.add_argument(
        "--project-root",
        default=None,
        help="Project root directory (default: auto-detect)",
    )
    args = parser.parse_args()

    # Auto-detect project root
    if args.project_root:
        project_root = args.project_root
    else:
        # Walk up from this script's location to find the project root
        project_root = str(Path(__file__).resolve().parent.parent.parent)

    # Default data_db path
    if args.data_db:
        data_db = args.data_db
    else:
        data_db = str(Path(project_root) / "pocketbase" / "pb_data" / "data.db")

    # Load .env from project root
    env_file = Path(project_root) / ".env"
    if env_file.is_file():
        from dotenv import load_dotenv

        load_dotenv(env_file)

    seed_from_prod(
        data_db=data_db,
        project_root=project_root,
        dry_run=args.dry_run,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

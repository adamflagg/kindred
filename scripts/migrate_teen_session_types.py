"""One-time migration: flip CIT/SIT camp_sessions from session_type=training to scit.

Usage:
    uv run python scripts/migrate_teen_session_types.py --dry-run
    uv run python scripts/migrate_teen_session_types.py

Idempotent: re-running after a successful run is a no-op.

Matches the classification logic in pocketbase/sync/sessions.go so future syncs
produce the same result. TLI sessions are not touched (already classified as 'tli').
"""

from __future__ import annotations

import argparse
import os
import re
import sys

from bunking.logging_config import configure_logging, get_logger
from pocketbase import PocketBase

_SCIT_PATTERN = re.compile(
    r"\b(?:scit|cit|sit)\b|counselor[-\s]+in[-\s]+training|specialist[-\s]+in[-\s]+training",
    re.IGNORECASE,
)


def classify_new_session_type(name: str, current_type: str) -> str:
    """Return the new session_type for a session given its name and current type.

    Mirrors the Go sync's isSCITSessionName for CIT/SIT:
      - If name matches CIT/SIT AND current type is 'training' -> 'scit'
      - Otherwise returns current_type unchanged (idempotent)
    """
    if current_type == "scit":
        return "scit"

    if _SCIT_PATTERN.search(name) and current_type == "training":
        return "scit"
    return current_type


def run_migration(pb: PocketBase, dry_run: bool) -> list[tuple[str, str, str]]:
    """Scan all camp_sessions and update CIT/SIT rows from training -> scit.

    Returns a list of (record_id, old_type, new_type) tuples for rows that
    need to change (or would change, in dry-run mode).
    """
    records = pb.collection("camp_sessions").get_full_list()
    updates: list[tuple[str, str, str]] = []

    for rec in records:
        old_type = getattr(rec, "session_type", "")
        name = getattr(rec, "name", "")
        new_type = classify_new_session_type(name, old_type)
        if new_type != old_type:
            updates.append((rec.id, old_type, new_type))
            if not dry_run:
                pb.collection("camp_sessions").update(rec.id, {"session_type": new_type})

    return updates


def main() -> int:
    configure_logging()
    logger = get_logger(__name__)

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Report changes without applying")
    parser.add_argument(
        "--pb-url",
        default=os.environ.get("POCKETBASE_URL", "http://127.0.0.1:8090"),
        help="PocketBase URL (default: $POCKETBASE_URL or http://127.0.0.1:8090)",
    )
    args = parser.parse_args()

    email = os.environ.get("POCKETBASE_ADMIN_EMAIL")
    password = os.environ.get("POCKETBASE_ADMIN_PASSWORD")
    if not email or not password:
        logger.error("POCKETBASE_ADMIN_EMAIL and POCKETBASE_ADMIN_PASSWORD must be set.")
        return 1

    pb = PocketBase(args.pb_url)
    pb.collection("_superusers").auth_with_password(email, password)

    mode = "DRY RUN" if args.dry_run else "APPLYING"
    logger.info(f"[{mode}] Scanning camp_sessions for CIT/SIT rows classified as 'training'...")

    updates = run_migration(pb, dry_run=args.dry_run)

    if not updates:
        logger.info("No changes needed. Already migrated (or no matching rows).")
        return 0

    verb = "Would update" if args.dry_run else "Updated"
    logger.info(f"{verb} {len(updates)} row(s):")
    for rec_id, old, new in updates:
        logger.info(f"  {rec_id}: {old} -> {new}")

    if args.dry_run:
        logger.info("Re-run without --dry-run to apply.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

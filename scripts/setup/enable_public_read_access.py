#!/usr/bin/env python3
"""
Enable public read access for PocketBase collections while keeping write operations authenticated.
This allows the React frontend to read data without login while CampMinder sync remains secure.
"""

from __future__ import annotations

import os
import sys

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

# Note: ClientResponseError import may show as attr-defined error due to
# pocketbase library not exporting it explicitly, but it works at runtime
from pocketbase.client import ClientResponseError  # type: ignore[attr-defined]

from pocketbase import PocketBase
from scripts.utils.auth import authenticate_pocketbase


def update_collection_rules(pb: PocketBase, collection_name: str) -> bool:
    """Update a collection to allow public read access."""
    try:
        # Get the collection
        collection = pb.collections.get_one(collection_name)

        # Update rules to allow public read but require auth for write
        updates = {
            "listRule": "",  # Empty string means public access
            "viewRule": "",  # Empty string means public access
            "createRule": "@request.auth.id != ''",  # Require authentication
            "updateRule": "@request.auth.id != ''",  # Require authentication
            "deleteRule": "@request.auth.id != ''",  # Require authentication
        }

        # Update the collection
        pb.collections.update(collection.id, updates)
        print(f"✓ Updated {collection_name}: public read, authenticated write")
        return True

    except ClientResponseError as e:
        print(f"✗ Failed to update {collection_name}: {e}")
        if hasattr(e, "data"):
            print(f"  Details: {e.data}")
        return False
    except Exception as e:
        print(f"✗ Unexpected error updating {collection_name}: {e}")
        return False


def main() -> None:
    """Main function to update all collection rules."""
    # Initialize PocketBase client
    try:
        pb = authenticate_pocketbase()
        print("✓ Authenticated with PocketBase as admin")
    except Exception as e:
        print(f"✗ Failed to authenticate: {e}")
        sys.exit(1)

    # Collections that need public read access
    collections = [
        # Core collections for frontend
        "sessions",
        "bunks",
        "bunk_plans",
        "persons",
        "attendees",
        "bunk_assignments",
        "requests",  # Bunking requests
        # Reference collections
        "divisions",
        "session_programs",
        # UI state collections (read-only for frontend)
        "solver_runs",
        # Enhanced Hybrid collections
        "bunk_assignments_draft",
        "saved_scenarios",
        "planning_sessions",
        # Keep these write-only from backend
        # "sync_logs" - backend only
    ]

    print("\nUpdating collection rules...")
    success_count = 0

    for collection in collections:
        if update_collection_rules(pb, collection):
            success_count += 1

    print(f"\n✓ Successfully updated {success_count}/{len(collections)} collections")

    if success_count < len(collections):
        print("⚠ Some collections failed to update. Check the errors above.")
        sys.exit(1)
    else:
        print("\n✓ All collections now allow public read access!")
        print("  - Frontend can read without authentication")
        print("  - Write operations still require authentication")


if __name__ == "__main__":
    main()

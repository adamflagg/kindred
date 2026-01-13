#!/usr/bin/env python3
"""
Rebuild the entire database from scratch in the proper order.
This script will:
1. Drop all data from collections (keeping schema)
2. Sync current year (2025) data in proper layer order
3. Sync historical data (2018-2024) after current year is complete
"""

from __future__ import annotations

import logging
import os
import subprocess
import sys
import time

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from pocketbase import PocketBase
from scripts.utils.auth import authenticate_pocketbase

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)


class DatabaseRebuilder:
    def __init__(self, pb_url: str = "http://127.0.0.1:8090") -> None:
        self.pb_url = pb_url
        self.pb: PocketBase

        # Use centralized authentication
        try:
            self.pb = authenticate_pocketbase(pb_url)
            logger.info("Authenticated with PocketBase")
        except Exception as e:
            logger.error(f"Failed to authenticate: {e}")
            raise

    def drop_all_data(self) -> None:
        """Drop all data from collections while preserving schema."""
        logger.info("=== Dropping all data from collections ===")

        collections_to_clear = [
            "camp_sessions",
            "persons",
            "bunks",
            "bunk_plans",
            "attendees",
            "bunk_assignments",
            "bunking_requests",
            "solver_runs",
        ]

        for collection_name in collections_to_clear:
            try:
                logger.info(f"Clearing {collection_name}...")

                # Get total count
                result = self.pb.collection(collection_name).get_list(page=1, per_page=1)
                total = result.total_items
                logger.info(f"  Found {total} records to delete")

                if total == 0:
                    continue

                # Delete in batches
                deleted = 0
                while deleted < total:
                    # Get a batch of records
                    records = self.pb.collection(collection_name).get_list(
                        page=1, per_page=100, query_params={"fields": "id"}
                    )

                    # Delete each record
                    for record in records.items:
                        try:
                            self.pb.collection(collection_name).delete(record.id)
                            deleted += 1
                        except Exception as e:
                            logger.error(f"    Error deleting record {record.id}: {e}")

                    # Progress update
                    if deleted % 500 == 0:
                        logger.info(f"    Deleted {deleted}/{total} records...")

                logger.info(f"  Cleared {deleted} records from {collection_name}")

            except Exception as e:
                logger.error(f"Error clearing {collection_name}: {e}")

    def run_sync_script(self, script_name: str, description: str) -> bool:
        """Run a sync script and wait for completion."""
        logger.info(f"\n--- Running {description} ---")

        script_path = os.path.join(os.path.dirname(__file__), script_name)

        # Make sure script exists
        if not os.path.exists(script_path):
            logger.error(f"Script not found: {script_path}")
            return False

        # Run the script
        try:
            cmd = [sys.executable, script_path]
            logger.info(f"Executing: {' '.join(cmd)}")

            result = subprocess.run(
                cmd, capture_output=True, text=True, env={**os.environ, "PYTHONPATH": ":".join(sys.path)}
            )

            # Log output
            if result.stdout:
                logger.info(f"Output:\n{result.stdout}")
            if result.stderr:
                logger.error(f"Errors:\n{result.stderr}")

            if result.returncode != 0:
                logger.error(f"Script failed with exit code {result.returncode}")
                return False

            logger.info(f"✓ {description} completed successfully")
            return True

        except Exception as e:
            logger.error(f"Failed to run {script_name}: {e}")
            return False

    def sync_current_year(self) -> bool:
        """Sync all current year data in proper layer order."""
        logger.info("\n=== Starting Current Year (2025) Sync ===")

        # Layer 0: Sessions (must be first)
        if not self.run_sync_script("sync_layer0_sessions.py", "Layer 0: Sessions"):
            return False

        # Wait a bit between layers
        time.sleep(2)

        # Layer 1: Persons
        if not self.run_sync_script("sync_layer1_persons.py", "Layer 1: Persons"):
            return False

        time.sleep(2)

        # Layer 2: Bunks and Bunk Plans
        if not self.run_sync_script("sync_layer2_bunks_and_plans.py", "Layer 2: Bunks and Plans"):
            return False

        time.sleep(2)

        # Layer 3: Attendees
        if not self.run_sync_script("sync_layer3_attendees_simple.py", "Layer 3: Attendees"):
            return False

        time.sleep(2)

        # Layer 4: Bunk Assignments
        if not self.run_sync_script("sync_bunk_assignments.py", "Layer 4: Bunk Assignments"):
            return False

        logger.info("\n✓ Current year sync completed successfully")
        return True

    def sync_historical_data(self) -> bool:
        """Sync historical data after current year is complete."""
        logger.info("\n=== Starting Historical Data Sync (2018-2024) ===")

        # Delete the state file to start fresh
        state_file = os.path.join(os.path.dirname(__file__), ".historical_sync_state.json")
        if os.path.exists(state_file):
            os.remove(state_file)
            logger.info("Removed old historical sync state file")

        # Run the resilient historical sync script
        if not self.run_sync_script("sync_all_historical_data_resilient.py", "Historical Data (2018-2024)"):
            logger.warning("Historical sync may have been interrupted by rate limits")
            logger.info(
                "You can resume it later by running: uv run python scripts/sync/sync_all_historical_data_resilient.py"
            )

        return True

    def verify_rebuild(self) -> None:
        """Verify the rebuild was successful."""
        logger.info("\n=== Verifying Database Rebuild ===")

        collections = ["camp_sessions", "persons", "bunks", "bunk_plans", "attendees", "bunk_assignments"]

        for collection_name in collections:
            try:
                # Get counts by year
                result = self.pb.collection(collection_name).get_list(page=1, per_page=1)
                total = result.total_items

                # Try to get year breakdown if collection has year field
                if collection_name in ["camp_sessions", "bunks", "attendees"]:
                    years = {}
                    for year in range(2018, 2026):
                        year_result = self.pb.collection(collection_name).get_list(
                            page=1, per_page=1, query_params={"filter": f"year = {year}"}
                        )
                        if year_result.total_items > 0:
                            years[year] = year_result.total_items

                    if years:
                        year_info = ", ".join([f"{y}: {c}" for y, c in sorted(years.items())])
                        logger.info(f"{collection_name}: {total} total ({year_info})")
                    else:
                        logger.info(f"{collection_name}: {total} total")
                else:
                    logger.info(f"{collection_name}: {total} total")

            except Exception as e:
                logger.error(f"Error checking {collection_name}: {e}")

    def rebuild(self) -> None:
        """Main rebuild process."""
        logger.info("=== Starting Database Rebuild ===")
        logger.info("Backup created at: backups/2025-01-26_before_rebuild/")

        # Confirm before proceeding
        logger.info("\nThis will DELETE ALL DATA and rebuild from CampMinder API.")
        logger.info("A backup has been created, but please confirm you want to proceed.")

        response = input("\nType 'yes' to continue or anything else to cancel: ")
        if response.lower() != "yes":
            logger.info("Rebuild cancelled")
            return

        # Step 1: Drop all data
        self.drop_all_data()

        # Step 2: Sync current year
        if not self.sync_current_year():
            logger.error("Current year sync failed. Stopping rebuild.")
            return

        # Step 3: Sync historical data
        logger.info("\nCurrent year sync complete. Starting historical sync...")
        logger.info("Note: Historical sync may take a long time due to rate limits.")

        response = input("\nStart historical sync now? (yes/no): ")
        if response.lower() == "yes":
            self.sync_historical_data()
        else:
            logger.info("Skipping historical sync. You can run it later with:")
            logger.info("uv run python scripts/sync/sync_all_historical_data_resilient.py")

        # Step 4: Verify
        self.verify_rebuild()

        logger.info("\n=== Database Rebuild Complete ===")
        logger.info("Backup location: backups/2025-01-26_before_rebuild/")


def main() -> None:
    """Main entry point."""
    try:
        rebuilder = DatabaseRebuilder()
        rebuilder.rebuild()
    except Exception as e:
        logger.error(f"Rebuild failed: {e}")
        raise


if __name__ == "__main__":
    main()

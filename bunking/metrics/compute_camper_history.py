#!/usr/bin/env python3
"""Compute Camper History - CLI entry point for camper history computation.

This script provides a command-line interface for computing camper history
records and writing them to PocketBase.

Usage:
    uv run python -m bunking.metrics.compute_camper_history --year 2025
    uv run python -m bunking.metrics.compute_camper_history --year 2025 --dry-run
    uv run python -m bunking.metrics.compute_camper_history --year 2025 --stats-output /tmp/stats.json
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from pathlib import Path
from typing import Any

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from bunking.logging_config import configure_logging, get_logger
from bunking.metrics.camper_history import (
    CamperHistoryComputer,
    CamperHistoryWriter,
    PocketBaseDataContext,
)
from pocketbase import PocketBase

logger = get_logger(__name__)


def parse_args(args: list[str] | None = None) -> argparse.Namespace:
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(description="Compute camper history records for a specific year")

    parser.add_argument("--year", type=int, required=True, help="Year to compute history for")

    parser.add_argument("--dry-run", action="store_true", help="Compute but don't write to database")

    parser.add_argument(
        "--stats-output",
        type=str,
        help="Write JSON stats to this file (for Go integration)",
    )

    parser.add_argument("--debug", action="store_true", help="Enable debug logging")

    return parser.parse_args(args)


def write_stats_output(stats_file: str, stats: dict[str, Any], success: bool) -> None:
    """Write stats to JSON file for Go integration.

    Args:
        stats_file: Path to write stats JSON.
        stats: Statistics dictionary.
        success: Whether processing was successful.
    """
    output = {
        "success": success,
        "created": stats.get("created", 0),
        "updated": 0,  # Camper history is computed, not updated
        "skipped": 0,
        "deleted": stats.get("deleted", 0),
        "errors": stats.get("errors", 0),
    }
    with open(stats_file, "w") as f:
        json.dump(output, f)
    logger.info(f"Wrote stats to {stats_file}")


def load_configuration() -> dict[str, Any]:
    """Load configuration from environment variables.

    Required:
    - POCKETBASE_ADMIN_EMAIL
    - POCKETBASE_ADMIN_PASSWORD

    Optional:
    - POCKETBASE_URL (default: http://127.0.0.1:8090)
    """
    config: dict[str, Any] = {
        "pb_url": os.getenv("POCKETBASE_URL", "http://127.0.0.1:8090"),
        "pb_email": os.getenv("POCKETBASE_ADMIN_EMAIL"),
        "pb_password": os.getenv("POCKETBASE_ADMIN_PASSWORD"),
    }

    if not config["pb_email"] or not config["pb_password"]:
        raise ValueError(
            "Missing required PocketBase credentials. "
            "Set POCKETBASE_ADMIN_EMAIL and POCKETBASE_ADMIN_PASSWORD environment variables."
        )

    return config


def main() -> None:
    """Main entry point."""
    args = parse_args()

    # Configure logging
    log_level = logging.DEBUG if args.debug else logging.INFO
    configure_logging("camper_history", log_level)

    logger.info(f"Computing camper history for year {args.year}")

    try:
        # Load configuration
        config = load_configuration()

        # Connect to PocketBase
        pb = PocketBase(config["pb_url"])
        pb.collection("_superusers").auth_with_password(config["pb_email"], config["pb_password"])
        logger.info("Authenticated with PocketBase")

        # Create data context and compute history
        data_context = PocketBaseDataContext(pb, args.year)
        computer = CamperHistoryComputer(year=args.year, data_context=data_context)
        records = computer.compute_all()

        logger.info(f"Computed {len(records)} camper history records")

        # Write records (or just report in dry-run mode)
        writer = CamperHistoryWriter(pb)
        stats = writer.write_records(records, year=args.year, dry_run=args.dry_run)

        # Write stats output if requested
        if args.stats_output:
            write_stats_output(args.stats_output, stats, success=True)

        # Print summary
        print(f"\nCamper history computation complete for year {args.year}!")
        if args.dry_run:
            print("  (Dry run - no records written)")
        print(f"  - Records computed: {len(records)}")
        print(f"  - Records created: {stats.get('created', 0)}")
        print(f"  - Records deleted: {stats.get('deleted', 0)}")
        print(f"  - Errors: {stats.get('errors', 0)}")

        # Calculate retention statistics
        returning_count = sum(1 for r in records if r.is_returning)
        if records:
            returning_pct = (returning_count / len(records)) * 100
            print("\nRetention metrics:")
            print(f"  - Returning campers: {returning_count} ({returning_pct:.1f}%)")
            print(f"  - New campers: {len(records) - returning_count} ({100 - returning_pct:.1f}%)")

            avg_years = sum(r.years_at_camp for r in records) / len(records)
            print(f"  - Average years at camp: {avg_years:.1f}")

    except Exception as e:
        logger.error(f"Fatal error: {e}")
        if args.stats_output:
            write_stats_output(args.stats_output, {"errors": 1}, success=False)
        sys.exit(1)


if __name__ == "__main__":
    main()

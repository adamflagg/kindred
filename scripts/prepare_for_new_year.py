#!/usr/bin/env python3
"""
Prepare the system for a new camp year.
This script updates configuration and validates the transition.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime
from typing import Any

from dotenv import load_dotenv, set_key


def load_env_config() -> dict[str, Any] | None:
    """Load current configuration from .env file."""
    load_dotenv()

    config = {
        "season_id": int(os.getenv("CAMPMINDER_SEASON_ID", datetime.now().year)),
        "active_year": int(os.getenv("CAMPMINDER_SEASON_ID", datetime.now().year)),
        "api_key": os.getenv("CAMPMINDER_API_KEY"),
        "primary_key": os.getenv("CAMPMINDER_PRIMARY_KEY"),
        "client_id": os.getenv("CAMPMINDER_CLIENT_ID"),
        "historical_years": json.loads(os.getenv("HISTORICAL_YEARS", "[]")),
    }

    if not config["api_key"] or not config["primary_key"] or not config["client_id"]:
        print("ERROR: Required CAMPMINDER environment variables not found in .env!")
        return None

    return config


def save_env_config(config: dict[str, Any]) -> None:
    """Save updated configuration to .env file."""
    # Make a backup first
    if os.path.exists(".env"):
        backup_name = f".env.backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        os.system(f"cp .env {backup_name}")
        print(f"Created backup: {backup_name}")

    # Update .env file
    set_key(".env", "CAMPMINDER_SEASON_ID", str(config["season_id"]))
    set_key(".env", "HISTORICAL_YEARS", json.dumps(config["historical_years"]))

    print("Updated .env file")


def prepare_for_year(new_year: int) -> bool:
    """Prepare configuration for a new year."""
    config = load_env_config()
    if not config:
        return False

    current_season = config.get("season_id", "Not set")
    print("\nCurrent configuration:")
    print(f"  Season ID: {current_season}")
    print(f"  Active year: {config.get('active_year', 'Not set')}")

    # Update configuration
    old_year = config.get("season_id", datetime.now().year - 1)
    config["season_id"] = new_year
    config["active_year"] = new_year

    # Track historical years
    if "historical_years" not in config:
        config["historical_years"] = []

    # Add the old year to historical if it's not there
    if old_year not in config["historical_years"] and old_year < new_year:
        config["historical_years"].append(old_year)
        config["historical_years"].sort()

    print("\nNew configuration:")
    print(f"  Season ID: {new_year}")
    print(f"  Active year: {new_year}")
    print(f"  Historical years: {config['historical_years']}")

    # Confirm before saving
    confirm = input(f"\nUpdate configuration for {new_year}? (yes/no): ")
    if confirm.lower() == "yes":
        save_env_config(config)
        print(f"\n✓ System prepared for {new_year}!")
        print("\nNext steps:")
        print(f"1. Run historical sync for {old_year}:")
        print(f"   uv run python scripts/sync/populate_historical_bunking.py {old_year}")
        print(f"2. Run regular sync for {new_year}:")
        print("   uv run python scripts/sync/sync_all_layers.py")
        print("3. Validate data integrity:")
        print("   uv run python scripts/check/validate_year_integrity.py")
        return True
    else:
        print("Cancelled - no changes made")
        return False


def main() -> None:
    """Main entry point."""
    parser = argparse.ArgumentParser(description="Prepare the bunking system for a new camp year")
    parser.add_argument("year", type=int, help="The new year to prepare for (e.g., 2026)")
    parser.add_argument("--check-only", action="store_true", help="Only show what would change without modifying files")

    args = parser.parse_args()

    # Validate year
    current_year = datetime.now().year
    if args.year < current_year:
        print(f"ERROR: New year {args.year} cannot be in the past (current: {current_year})")
        sys.exit(1)

    if args.year > current_year + 1:
        print(f"WARNING: Preparing for {args.year} which is more than 1 year in the future")

    if args.check_only:
        config = load_env_config()
        if config:
            print(f"Would update CAMPMINDER_SEASON_ID from {config.get('season_id')} to {args.year}")
            print(f"Would set active_year to {args.year}")
            old_year = config.get("season_id", current_year)
            if old_year not in config.get("historical_years", []):
                print(f"Would add {old_year} to HISTORICAL_YEARS")
    else:
        prepare_for_year(args.year)


if __name__ == "__main__":
    main()

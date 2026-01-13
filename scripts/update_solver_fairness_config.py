#!/usr/bin/env python3
"""
Update solver configuration to prioritize fair distribution of satisfied requests.

This script updates the solver configuration to:
1. Set must_satisfy_one penalty (soft constraint with high penalty)
2. Add diminishing returns configuration for multiple requests per camper
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

# Note: ClientResponseError import may show as attr-defined error due to
# pocketbase library not exporting it explicitly, but it works at runtime
from pocketbase.client import ClientResponseError  # type: ignore[attr-defined]

from pocketbase import PocketBase

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))


def main() -> None:
    """Update solver configuration for fairness."""
    # Connect to PocketBase
    pb = PocketBase("http://localhost:8090")
    pb.collection("_superusers").auth_with_password(
        os.getenv("POCKETBASE_ADMIN_EMAIL", "admin@camp.local"),
        os.getenv("POCKETBASE_ADMIN_PASSWORD", "campbunking123"),
    )

    # Configuration updates
    config_updates = [
        # Enable must_satisfy_one with high penalty (soft constraint)
        {
            "config_key": "constraint.must_satisfy_one.enabled",
            "config_value": "1",
            "description": "Enable must satisfy one request constraint",
            "category": "constraint",
            "data_type": "boolean",
        },
        {
            "config_key": "constraint.must_satisfy_one.penalty",
            "config_value": "100000",
            "description": "Penalty for leaving a camper with no satisfied requests (higher = optimizer tries harder)",
            "category": "constraint",
            "data_type": "integer",
        },
        # Diminishing returns configuration
        {
            "config_key": "objective.enable_diminishing_returns",
            "config_value": "1",
            "description": "Enable diminishing returns for multiple satisfied requests per camper",
            "category": "solver",
            "data_type": "boolean",
        },
        {
            "config_key": "objective.first_request_multiplier",
            "config_value": "10",
            "description": "Weight multiplier for first satisfied request",
            "category": "solver",
            "data_type": "integer",
        },
        {
            "config_key": "objective.second_request_multiplier",
            "config_value": "5",
            "description": "Weight multiplier for second satisfied request",
            "category": "solver",
            "data_type": "integer",
        },
        {
            "config_key": "objective.third_plus_request_multiplier",
            "config_value": "1",
            "description": "Weight multiplier for third and subsequent satisfied requests",
            "category": "solver",
            "data_type": "integer",
        },
    ]

    # Update or create each configuration
    for config in config_updates:
        try:
            # Try to find existing config
            existing = pb.collection("solver_config").get_first_list_item(f'config_key="{config["config_key"]}"')
            # Update existing
            pb.collection("solver_config").update(existing.id, config)
            print(f"Updated: {config['config_key']} = {config['config_value']}")
        except Exception:
            # Create new
            try:
                pb.collection("solver_config").create(config)
                print(f"Created: {config['config_key']} = {config['config_value']}")
            except ClientResponseError as e:
                print(f"Error creating {config['config_key']}: {e}")

    print("\nConfiguration updated successfully!")
    print("\nKey changes:")
    print("- must_satisfy_one uses SOFT constraint with very high penalty (100,000)")
    print("  This ensures the optimizer always finds a solution while strongly")
    print("  prioritizing satisfying at least one request per camper.")
    print("- Diminishing returns enabled:")
    print("  - 1st satisfied request: priority × 10 × 10 = priority × 100")
    print("  - 2nd satisfied request: priority × 10 × 5 = priority × 50")
    print("  - 3rd+ satisfied requests: priority × 10 × 1 = priority × 10")
    print("\nThis ensures the optimizer prioritizes getting at least one request satisfied")
    print("for as many campers as possible before satisfying multiple requests per camper.")


if __name__ == "__main__":
    main()

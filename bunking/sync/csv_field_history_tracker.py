#!/usr/bin/env python3
"""
Enhanced CSV History Tracker with field-level granularity.
Tracks changes at the field level to avoid recreating requests when unrelated fields change.
"""

from __future__ import annotations

import hashlib
import json
import shutil
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from bunking.sync.sync_logging import setup_logging

logger = setup_logging("csv_field_history_tracker")


class CSVFieldHistoryTracker:
    """Track CSV field changes at a granular level to preserve manually resolved requests"""

    # Map CSV fields to the request types they generate
    FIELD_TO_REQUEST_TYPE = {
        "Share Bunk With": "bunk_with",
        "Do Not Share Bunk With": "not_bunk_with",
        "RetParent-Socializewithbest": "age_preference",
        "BunkingNotes Notes": ["bunk_with", "not_bunk_with"],  # Can generate multiple types
        "Internal Bunk Notes": ["bunk_with", "not_bunk_with"],  # Can generate multiple types
    }

    def __init__(self, history_dir: str = "csv_history"):
        """Initialize the enhanced history tracker

        Args:
            history_dir: Directory to store history files
        """
        self.history_dir = Path(history_dir)
        self.history_dir.mkdir(exist_ok=True)

        # Metadata file for tracking sync runs
        self.metadata_file = self.history_dir / "sync_metadata.json"

        logger.info(f"Initialized enhanced CSV field history tracker in {self.history_dir}")

    def compute_field_hash(self, field_value: str | None) -> str:
        """Compute hash for a single field value

        Args:
            field_value: The field value to hash

        Returns:
            SHA256 hash of the field value
        """
        field_value = "" if field_value is None else str(field_value).strip()

        return hashlib.sha256(field_value.encode()).hexdigest()

    def compute_field_hashes(self, row: dict[str, Any]) -> dict[str, str]:
        """Compute hashes for each relevant field in a row

        Args:
            row: CSV row dictionary

        Returns:
            Dictionary mapping field names to their hashes
        """
        field_hashes = {}

        # Always include PersonID and Grade as they affect all requests
        core_fields = ["PersonID", "Grade"]
        for field in core_fields:
            value = row.get(field, "")
            field_hashes[field] = self.compute_field_hash(value)

        # Hash each request-generating field separately
        for field in self.FIELD_TO_REQUEST_TYPE:
            value = row.get(field, "")
            if value:  # Only hash non-empty fields
                field_hashes[field] = self.compute_field_hash(value)

        return field_hashes

    def get_context_filename(self, context: str, file_type: str = "previous") -> Path | None:
        """Get history filename for a given context

        Args:
            context: Sync context (e.g., 'year_2025_session_4', 'session_4', 'test_100')
            file_type: 'current' or 'previous'

        Returns:
            Path to history file, or None for test contexts
        """
        if context.startswith("test_"):
            return None  # Never save test runs

        # Handle both old format (session_X) and new format (year_YYYY_session_X)
        if context.startswith("session_") or context.startswith("year_"):
            return self.history_dir / f"{file_type}_field_hashes_{context}.json"
        else:
            logger.warning(f"Unknown context: {context}")
            return None

    def load_previous_field_hashes(self, context: str) -> dict[int, dict[str, str]]:
        """Load field-level hashes from previous sync run

        Args:
            context: Sync context

        Returns:
            Dictionary mapping person ID to field hashes
        """
        previous_file = self.get_context_filename(context, "previous")
        if not previous_file or not previous_file.exists():
            return {}

        try:
            with open(previous_file) as f:
                data = json.load(f)

            # Convert string keys back to int
            result = {}
            for person_id_str, field_hashes in data.items():
                try:
                    person_id = int(person_id_str)
                    result[person_id] = field_hashes
                except (ValueError, TypeError):
                    continue

            logger.debug(f"Loaded field hashes for {len(result)} persons from previous history")
            return result

        except Exception as e:
            logger.error(f"Failed to load previous field hashes: {e}")
            return {}

    def save_current_field_hashes(self, field_hashes: dict[int, dict[str, str]], context: str) -> None:
        """Save current field hashes and rotate files

        Args:
            field_hashes: Dictionary mapping person ID to field hashes
            context: Sync context
        """
        if context.startswith("test_"):
            logger.debug(f"Skipping history save for test context: {context}")
            return

        current_file = self.get_context_filename(context, "current")
        previous_file = self.get_context_filename(context, "previous")

        if not current_file or not previous_file:
            return

        try:
            # Rotate current to previous if it exists
            if current_file.exists():
                shutil.copy2(current_file, previous_file)
                logger.debug(f"Rotated current to previous for context: {context}")

            # Write new data
            with open(current_file, "w") as f:
                # Convert int keys to strings for JSON
                json_data = {str(k): v for k, v in field_hashes.items()}
                json.dump(json_data, f, indent=2)

            logger.info(f"Saved field hashes for {len(field_hashes)} persons to history")

            # First-run handling
            if not previous_file.exists() and current_file.exists():
                shutil.copy2(current_file, previous_file)
                logger.info("Created initial previous file for next run")

        except Exception as e:
            logger.error(f"Failed to save field hashes: {e}")
            raise

    def get_changed_fields(
        self, rows: list[dict[str, Any]], context: str
    ) -> tuple[dict[int, set[str]], dict[int, dict[str, str]]]:
        """Identify which fields have changed for each person

        Args:
            rows: All CSV rows
            context: Sync context

        Returns:
            - changed_fields: Dict mapping person ID to set of changed field names
            - current_field_hashes: Current field hash map for saving
        """
        if context.startswith("test_"):
            # For test runs, all fields are "changed"
            changed_fields = {}
            current_field_hashes = {}
            for row in rows:
                try:
                    person_id = int(row["PersonID"])
                    field_hashes = self.compute_field_hashes(row)
                    current_field_hashes[person_id] = field_hashes
                    changed_fields[person_id] = set(field_hashes.keys())
                except (KeyError, ValueError):
                    pass
            return changed_fields, current_field_hashes

        # Load previous field hashes
        previous_field_hashes = self.load_previous_field_hashes(context)

        changed_fields = {}
        current_field_hashes = {}

        for row in rows:
            try:
                person_id = int(row["PersonID"])
                current_hashes = self.compute_field_hashes(row)
                current_field_hashes[person_id] = current_hashes

                # Get previous hashes for this person
                prev_hashes = previous_field_hashes.get(person_id, {})

                # Find which fields changed
                person_changed_fields = set()

                # Check each field
                for field_name, current_hash in current_hashes.items():
                    prev_hash = prev_hashes.get(field_name)
                    if prev_hash != current_hash:
                        person_changed_fields.add(field_name)

                # Also check for removed fields
                for field_name in prev_hashes:
                    if field_name not in current_hashes:
                        person_changed_fields.add(field_name)

                if person_changed_fields:
                    changed_fields[person_id] = person_changed_fields

            except (KeyError, ValueError) as e:
                logger.warning(f"Invalid row: {e}")

        # Log summary
        total_persons = len(current_field_hashes)
        changed_persons = len(changed_fields)
        unchanged_persons = total_persons - changed_persons

        logger.info(f"Field-level analysis: {changed_persons} persons with changes, {unchanged_persons} unchanged")

        # Log field change distribution
        field_change_counts: dict[str, int] = {}
        for person_fields in changed_fields.values():
            for field in person_fields:
                field_change_counts[field] = field_change_counts.get(field, 0) + 1

        if field_change_counts:
            logger.info("Changed fields distribution:")
            for field, count in sorted(field_change_counts.items()):
                logger.info(f"  {field}: {count} persons")

        return changed_fields, current_field_hashes

    def get_affected_request_types(self, changed_fields: set[str]) -> set[str]:
        """Determine which request types are affected by the changed fields

        Args:
            changed_fields: Set of field names that changed

        Returns:
            Set of request types that should be regenerated
        """
        affected_types = set()

        for field in changed_fields:
            if field in ["PersonID", "Grade"]:
                # Core fields affect all request types
                return {"bunk_with", "not_bunk_with", "age_preference"}

            request_types = self.FIELD_TO_REQUEST_TYPE.get(field, [])
            if isinstance(request_types, str):
                affected_types.add(request_types)
            else:
                affected_types.update(request_types)

        return affected_types

    def cleanup_old_history(self, retention_days: int = 30) -> None:
        """Remove history files older than retention period

        Args:
            retention_days: Number of days to keep history
        """
        try:
            cutoff = datetime.now() - timedelta(days=retention_days)
            cleaned = 0

            # Find and remove old files
            for pattern in ["*.json.backup.*", "previous_field_hashes_*.json", "current_field_hashes_*.json"]:
                for file in self.history_dir.glob(pattern):
                    if file.stat().st_mtime < cutoff.timestamp():
                        file.unlink()
                        cleaned += 1

            if cleaned > 0:
                logger.info(f"Cleaned up {cleaned} old history files")

        except Exception as e:
            logger.error(f"Failed to cleanup old history: {e}")

#!/usr/bin/env python3
"""
Validate PocketBase migration schema from /api/collections endpoint.

This script validates that migrations produce the expected schema:
1. Required collections exist
2. Field limits are sane (not default 5000 for text fields)
3. Relations point to valid collections
4. Required indexes are present
5. Select fields have values
6. Critical fields exist on core collections

Usage:
    python validate_migrations.py <collections.json>
    # Or pipe from curl:
    curl -s http://127.0.0.1:8090/api/collections | python validate_migrations.py -
"""

from __future__ import annotations

import json
import sys
from typing import Any

# Required collections that must exist
REQUIRED_COLLECTIONS = [
    "attendees",
    "bunks",
    "bunk_assignments",
    "bunk_plans",
    "bunk_requests",
    "camp_sessions",
    "config",
    "divisions",
    "households",
    "original_bunk_requests",
    "persons",
    "session_groups",
    "users",
]

# Critical fields that must exist on specific collections
# Format: { collection_name: [field_name, ...] }
REQUIRED_FIELDS = {
    "attendees": ["person_id", "person", "status", "year", "session", "is_active"],
    "persons": ["cm_id", "first_name", "last_name", "year", "household"],
    "camp_sessions": ["cm_id", "name", "year", "session_type"],
    "bunks": ["cm_id", "name", "gender", "year"],
    "bunk_plans": ["year", "session", "bunk"],
    "bunk_assignments": ["year", "session", "bunk", "person"],
}

# Relations that must point to valid collections
# Format: { collection_name: { field_name: target_collection_name } }
REQUIRED_RELATIONS = {
    "attendees": {
        "person": "persons",
        "session": "camp_sessions",
    },
    "persons": {
        "household": "households",
        "division": "divisions",
    },
    "bunk_plans": {
        "session": "camp_sessions",
        "bunk": "bunks",
    },
    "bunk_assignments": {
        "session": "camp_sessions",
        "bunk": "bunks",
        "person": "persons",
    },
}

# Select fields that must have values defined
# Format: { collection_name: { field_name: [expected_values] } }
# Use empty list [] to just check that values array is non-empty
REQUIRED_SELECT_VALUES = {
    "attendees": {
        "status": [
            "none",
            "enrolled",
            "applied",
            "waitlisted",
            "cancelled",
            "unknown",
        ],  # Subset check
    },
    "camp_sessions": {
        "session_type": ["main", "ag", "embedded"],
    },
}

# Text fields that should NOT have the default 5000 char limit
# (they should have higher limits for content fields)
TEXT_FIELDS_REQUIRE_CUSTOM_LIMIT = {
    "original_bunk_requests": ["bunk_with", "not_bunk_with", "bunking_notes"],
    "bunk_requests": ["notes"],
}


class ValidationError(Exception):
    """Raised when validation fails."""


def load_collections(source: str) -> list[dict[str, Any]]:
    """Load collections from JSON file or stdin."""
    if source == "-":
        data = json.load(sys.stdin)
    else:
        with open(source) as f:
            data = json.load(f)

    # Handle both direct list and paginated response
    if isinstance(data, list):
        return list(data)
    if isinstance(data, dict) and "items" in data:
        return list(data["items"])
    raise ValidationError(f"Unexpected response format: {type(data)}")


def build_collection_map(
    collections: list[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    """Build a map of collection name -> collection data."""
    return {c["name"]: c for c in collections}


def build_collection_id_map(collections: list[dict[str, Any]]) -> dict[str, str]:
    """Build a map of collection ID -> collection name."""
    return {c["id"]: c["name"] for c in collections}


def get_field(collection: dict[str, Any], field_name: str) -> dict[str, Any] | None:
    """Get a field from a collection by name."""
    # schema.fields is the standard PB format
    fields: list[dict[str, Any]] = collection.get("fields", [])
    for field in fields:
        if field.get("name") == field_name:
            return field
    return None


def validate_required_collections(collection_map: dict[str, Any]) -> list[str]:
    """Validate that all required collections exist."""
    errors = []
    for name in REQUIRED_COLLECTIONS:
        if name not in collection_map:
            errors.append(f"Missing required collection: {name}")
    return errors


def validate_required_fields(collection_map: dict[str, Any]) -> list[str]:
    """Validate that required fields exist on collections."""
    errors = []
    for col_name, field_names in REQUIRED_FIELDS.items():
        if col_name not in collection_map:
            continue  # Already caught by required collections check

        collection = collection_map[col_name]
        for field_name in field_names:
            if get_field(collection, field_name) is None:
                errors.append(f"Missing field '{field_name}' on collection '{col_name}'")

    return errors


def validate_relations(collection_map: dict[str, Any], id_map: dict[str, str]) -> list[str]:
    """Validate that relation fields point to valid collections."""
    errors = []
    for col_name, relations in REQUIRED_RELATIONS.items():
        if col_name not in collection_map:
            continue

        collection = collection_map[col_name]
        for field_name, target_name in relations.items():
            field = get_field(collection, field_name)
            if field is None:
                continue  # Already caught by required fields check

            if field.get("type") != "relation":
                errors.append(f"Field '{field_name}' on '{col_name}' should be a relation, got '{field.get('type')}'")
                continue

            # Check collectionId points to correct collection
            collection_id = field.get("collectionId")
            if not collection_id:
                errors.append(f"Relation '{field_name}' on '{col_name}' has no collectionId")
                continue

            actual_target = id_map.get(collection_id)
            if actual_target != target_name:
                errors.append(
                    f"Relation '{field_name}' on '{col_name}' points to '{actual_target}' but expected '{target_name}'"
                )

    return errors


def validate_select_values(collection_map: dict[str, Any]) -> list[str]:
    """Validate that select fields have expected values."""
    errors = []
    for col_name, fields in REQUIRED_SELECT_VALUES.items():
        if col_name not in collection_map:
            continue

        collection = collection_map[col_name]
        for field_name, expected_values in fields.items():
            field = get_field(collection, field_name)
            if field is None:
                continue

            if field.get("type") != "select":
                errors.append(f"Field '{field_name}' on '{col_name}' should be select, got '{field.get('type')}'")
                continue

            actual_values = field.get("values", [])
            if not actual_values:
                errors.append(f"Select field '{field_name}' on '{col_name}' has no values defined")
                continue

            # Check that expected values are present (subset check)
            if expected_values:
                missing = set(expected_values) - set(actual_values)
                if missing:
                    errors.append(f"Select field '{field_name}' on '{col_name}' missing values: {sorted(missing)}")

    return errors


def validate_text_field_limits(collection_map: dict[str, Any]) -> list[str]:
    """Validate text fields don't have the problematic default 5000 limit."""
    errors = []
    for col_name, field_names in TEXT_FIELDS_REQUIRE_CUSTOM_LIMIT.items():
        if col_name not in collection_map:
            continue

        collection = collection_map[col_name]
        for field_name in field_names:
            field = get_field(collection, field_name)
            if field is None:
                continue

            if field.get("type") != "text":
                continue

            # In v0.23+ the max is a direct property, not in options
            max_val = field.get("max")
            # Also check options.max for older migrations
            if max_val is None:
                options = field.get("options", {})
                max_val = options.get("max")

            # Default is 5000 if not specified - this is often too low
            if max_val is not None and max_val == 5000:
                errors.append(
                    f"Text field '{field_name}' on '{col_name}' has default 5000 limit - "
                    f"likely needs higher limit for content"
                )

    return errors


def validate_indexes(collection_map: dict[str, Any]) -> list[str]:
    """Validate that critical unique indexes exist."""
    errors = []

    # Check for unique indexes on key collections
    index_checks = {
        "attendees": "idx_attendees_unique",
        "persons": "idx_persons_campminder",
    }

    for col_name, expected_index_pattern in index_checks.items():
        if col_name not in collection_map:
            continue

        collection = collection_map[col_name]
        indexes = collection.get("indexes", [])

        found = False
        for idx in indexes:
            if expected_index_pattern in idx:
                found = True
                break

        if not found:
            errors.append(f"Missing expected index containing '{expected_index_pattern}' on collection '{col_name}'")

    return errors


def main() -> int:
    """Main validation entry point."""
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <collections.json | ->", file=sys.stderr)
        return 1

    source = sys.argv[1]

    try:
        collections = load_collections(source)
    except (json.JSONDecodeError, FileNotFoundError, ValidationError) as e:
        print(f"Failed to load collections: {e}", file=sys.stderr)
        return 1

    collection_map = build_collection_map(collections)
    id_map = build_collection_id_map(collections)

    all_errors = []

    print("Validating PocketBase schema...")
    print(f"  Found {len(collections)} collections")

    # Run all validations
    all_errors.extend(validate_required_collections(collection_map))
    all_errors.extend(validate_required_fields(collection_map))
    all_errors.extend(validate_relations(collection_map, id_map))
    all_errors.extend(validate_select_values(collection_map))
    all_errors.extend(validate_text_field_limits(collection_map))
    all_errors.extend(validate_indexes(collection_map))

    if all_errors:
        print(f"\n❌ Schema validation failed with {len(all_errors)} error(s):")
        for error in all_errors:
            print(f"   - {error}")
        return 1

    print("\n✅ Schema validation passed!")
    print("   - All required collections exist")
    print("   - All required fields present")
    print("   - All relations resolve correctly")
    print("   - All select fields have expected values")
    print("   - Critical indexes present")

    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""
Validate PocketBase migration files for SQL standards compliance.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import Any

# PocketBase field types and their valid options
VALID_FIELD_TYPES = {
    "text": {"required_options": ["min", "max", "pattern"], "optional_options": []},
    "number": {"required_options": ["min", "max", "noDecimal"], "optional_options": []},
    "bool": {"required_options": [], "optional_options": []},
    "email": {"required_options": ["exceptDomains", "onlyDomains"], "optional_options": []},
    "url": {"required_options": ["exceptDomains", "onlyDomains"], "optional_options": []},
    "date": {"required_options": ["min", "max"], "optional_options": []},
    "select": {"required_options": ["values", "maxSelect"], "optional_options": []},
    "json": {"required_options": ["maxSize"], "optional_options": []},
    "file": {"required_options": ["maxSelect", "maxSize", "mimeTypes", "thumbs"], "optional_options": ["protected"]},
    "relation": {
        "required_options": ["collectionId", "cascadeDelete", "minSelect", "maxSelect", "displayFields"],
        "optional_options": [],
    },
    "editor": {"required_options": ["convertUrls"], "optional_options": []},
}

# Required system fields for base collections
SYSTEM_FIELDS = ["id", "created", "updated"]

# Collection types
VALID_COLLECTION_TYPES = ["base", "auth", "view"]


class MigrationValidator:
    def __init__(self, file_path: str):
        self.file_path = Path(file_path)
        self.content = self.file_path.read_text()
        self.errors: list[str] = []
        self.warnings: list[str] = []

    def validate(self) -> tuple[bool, list[str], list[str]]:
        """Validate the migration file."""
        # Check basic structure
        self._check_migration_structure()

        # Extract and validate collections
        collections = self._extract_collections()
        for collection in collections:
            self._validate_collection(collection)

        # Check for common issues
        self._check_common_issues()

        return len(self.errors) == 0, self.errors, self.warnings

    def _check_migration_structure(self) -> None:
        """Check basic migration file structure."""
        # Check for proper migrate function
        if not re.search(r"migrate\s*\(\s*\(\s*db\s*\)\s*=>\s*{", self.content):
            self.errors.append("Missing proper migrate function declaration")

        # Check for Dao initialization
        if not re.search(r"const\s+dao\s*=\s*new\s+Dao\s*\(\s*db\s*\)", self.content):
            self.errors.append("Missing Dao initialization")

        # Check for proper TypeScript reference
        if not self.content.startswith('/// <reference path="../pb_data/types.d.ts" />'):
            self.warnings.append("Missing TypeScript reference comment")

    def _extract_collections(self) -> list[dict[str, Any]]:
        """Extract collection definitions from the migration."""
        collections = []

        # Find all new Collection() declarations
        collection_pattern = r"new\s+Collection\s*\(\s*{([^}]+)}\s*\)"
        matches = re.finditer(collection_pattern, self.content, re.DOTALL)

        for match in matches:
            collection_def = match.group(1)
            collection = self._parse_collection_definition(collection_def)
            if collection:
                collections.append(collection)

        return collections

    def _parse_collection_definition(self, definition: str) -> dict[str, Any] | None:
        """Parse a collection definition string."""
        try:
            # Extract basic properties
            collection = {}

            # Extract id
            id_match = re.search(r'id:\s*"([^"]+)"', definition)
            if id_match:
                collection["id"] = id_match.group(1)

            # Extract name
            name_match = re.search(r'name:\s*"([^"]+)"', definition)
            if name_match:
                collection["name"] = name_match.group(1)

            # Extract type
            type_match = re.search(r'type:\s*"([^"]+)"', definition)
            if type_match:
                collection["type"] = type_match.group(1)

            # Extract schema
            schema_match = re.search(r"schema:\s*\[([^\]]+)\]", definition, re.DOTALL)
            if schema_match:
                collection["schema"] = self._parse_schema(schema_match.group(1))

            return collection
        except Exception as e:
            self.warnings.append(f"Failed to parse collection definition: {e}")
            return None

    def _parse_schema(self, schema_str: str) -> list[dict[str, Any]]:
        """Parse schema field definitions."""
        fields = []

        # Find all field objects
        field_pattern = r"{([^}]+)}"
        matches = re.finditer(field_pattern, schema_str, re.DOTALL)

        for match in matches:
            field_def = match.group(1)
            field = self._parse_field_definition(field_def)
            if field:
                fields.append(field)

        return fields

    def _parse_field_definition(self, definition: str) -> dict[str, Any] | None:
        """Parse a field definition."""
        try:
            field = {}

            # Extract properties with regex
            for prop in ["id", "name", "type"]:
                match = re.search(f'{prop}:\\s*"([^"]+)"', definition)
                if match:
                    field[prop] = match.group(1)

            # Extract boolean properties
            for prop in ["required", "presentable", "unique", "system"]:
                match = re.search(f"{prop}:\\s*(true|false)", definition)
                if match:
                    field[prop] = match.group(1) == "true"

            # Extract options
            options_match = re.search(r"options:\s*{([^}]*)}", definition)
            if options_match:
                field["options"] = options_match.group(1)

            return field
        except Exception:
            return None

    def _validate_collection(self, collection: dict[str, Any]) -> None:
        """Validate a collection definition."""
        # Check required properties
        if "id" not in collection:
            self.errors.append("Collection missing 'id' property")

        if "name" not in collection:
            self.errors.append("Collection missing 'name' property")

        if "type" not in collection:
            self.errors.append("Collection missing 'type' property")
        elif collection["type"] not in VALID_COLLECTION_TYPES:
            self.errors.append(
                f"Invalid collection type '{collection['type']}' for {collection.get('name', 'unknown')}"
            )

        # Validate collection naming
        if "name" in collection:
            name = collection["name"]
            if not re.match(r"^[a-z_][a-z0-9_]*$", name):
                self.errors.append(f"Collection name '{name}' should be lowercase with underscores only")

        # Validate schema fields
        if "schema" in collection:
            self._validate_schema(collection["name"], collection["schema"])

    def _validate_schema(self, collection_name: str, schema: list[dict[str, Any]]) -> None:
        """Validate schema fields."""
        field_names = set()

        for field in schema:
            # Check for duplicate field names
            if "name" in field:
                if field["name"] in field_names:
                    self.errors.append(f"Duplicate field name '{field['name']}' in {collection_name}")
                field_names.add(field["name"])

            # Validate field definition
            self._validate_field(collection_name, field)

    def _validate_field(self, collection_name: str, field: dict[str, Any]) -> None:
        """Validate a single field."""
        # Check required field properties
        if "id" not in field:
            self.errors.append(f"Field missing 'id' in {collection_name}")

        if "name" not in field:
            self.errors.append(f"Field missing 'name' in {collection_name}")
            return

        if "type" not in field:
            self.errors.append(f"Field '{field['name']}' missing 'type' in {collection_name}")
            return

        # Validate field type
        field_type = field.get("type")
        if field_type not in VALID_FIELD_TYPES:
            self.errors.append(f"Invalid field type '{field_type}' for '{field['name']}' in {collection_name}")
            return

        # Check system field property
        if "system" not in field:
            self.warnings.append(f"Field '{field['name']}' missing 'system' property in {collection_name}")

        # Validate field naming
        if not re.match(r"^[a-z_][a-z0-9_]*$", field["name"]):
            self.errors.append(
                f"Field name '{field['name']}' should be lowercase with underscores in {collection_name}"
            )

    def _check_common_issues(self) -> None:
        """Check for common PocketBase migration issues."""
        # Check for manual index creation (should use collection.indexes instead)
        if re.search(r'db\.newQuery\s*\(\s*["\']CREATE\s+(?:UNIQUE\s+)?INDEX', self.content, re.IGNORECASE):
            self.errors.append("Manual index creation detected - use collection.indexes property instead")

        # Check for proper collection saving
        if re.search(r"dao\.saveCollection\s*\(\s*collection\s*\)", self.content):
            # Check if collection is being reassigned
            if not re.search(r"collection\s*=\s*new\s+Collection", self.content):
                self.warnings.append("Reusing collection variable - create new Collection instance for each")

        # Check for relation field validation
        relation_fields = re.findall(r'type:\s*"relation"[^}]+collectionId:\s*"([^"]+)"', self.content)
        for collection_id in relation_fields:
            # Check if the referenced collection exists in this migration
            if not re.search(f'id:\\s*"{collection_id}"', self.content):
                self.warnings.append(f"Relation references collection '{collection_id}' which may not exist yet")

        # Check for proper date format in date field options
        date_options = re.findall(r'type:\s*"date"[^}]+(?:min|max):\s*"([^"]+)"', self.content)
        for date_value in date_options:
            if date_value and not re.match(r"^\d{4}-\d{2}-\d{2}", date_value):
                self.errors.append(f"Invalid date format '{date_value}' - use YYYY-MM-DD format")


def main() -> int:
    """Validate PocketBase migration files."""
    if len(sys.argv) < 2:
        print("Usage: python validate_pocketbase_migration.py <migration_file>")
        sys.exit(1)

    file_path = sys.argv[1]
    if not Path(file_path).exists():
        print(f"Error: File '{file_path}' not found")
        sys.exit(1)

    validator = MigrationValidator(file_path)
    valid, errors, warnings = validator.validate()

    if errors:
        print("❌ ERRORS:")
        for error in errors:
            print(f"  - {error}")

    if warnings:
        print("\n⚠️  WARNINGS:")
        for warning in warnings:
            print(f"  - {warning}")

    if valid:
        print("\n✅ Migration file is valid!")
        return 0
    else:
        print(f"\n❌ Migration file has {len(errors)} errors")
        return 1


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""
Generate a complete PocketBase migration file from the current database state.
This creates a single snapshot migration that captures all collections, fields,
indexes, and rules in a 100% PocketBase-compliant format.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any


class PocketBaseMigrationGenerator:
    def __init__(self, db_path: str) -> None:
        self.db_path = db_path
        self.collections: list[dict[str, Any]] = []
        self.collection_order: list[str] = []

    def connect(self) -> sqlite3.Connection:
        """Connect to the PocketBase database."""
        return sqlite3.connect(self.db_path)

    def extract_collections(self) -> None:
        """Extract all collections from the database."""
        conn = self.connect()
        cursor = conn.cursor()

        # Get all non-system collections
        cursor.execute("""
            SELECT id, created, updated, name, type, system, schema, indexes,
                   listRule, viewRule, createRule, updateRule, deleteRule, options
            FROM _collections
            WHERE system = 0
            ORDER BY created, name
        """)

        for row in cursor.fetchall():
            collection = {
                "id": row[0],
                "created": row[1],
                "updated": row[2],
                "name": row[3],
                "type": row[4],
                "system": row[5],
                "schema": json.loads(row[6]) if row[6] else [],
                "indexes": json.loads(row[7]) if row[7] else [],
                "listRule": row[8],
                "viewRule": row[9],
                "createRule": row[10],
                "updateRule": row[11],
                "deleteRule": row[12],
                "options": json.loads(row[13]) if row[13] else {},
            }
            self.collections.append(collection)

        conn.close()

    def order_collections_by_dependencies(self) -> None:
        """Order collections so that referenced collections come before those that reference them."""
        # Build dependency graph
        dependencies: dict[str, set[str]] = {}
        collection_map = {c["name"]: c for c in self.collections}

        for collection in self.collections:
            deps: set[str] = set()
            # Check for relation fields
            for field in collection.get("schema", []):
                if field.get("type") == "relation":
                    options = field.get("options", {})
                    collection_id = options.get("collectionId")
                    if collection_id and collection_id in collection_map:
                        deps.add(collection_id)
            dependencies[collection["name"]] = deps

        # Topological sort
        visited: set[str] = set()
        temp_mark: set[str] = set()
        self.collection_order = []

        def visit(name: str) -> None:
            if name in temp_mark:
                # Circular dependency - just add it
                return
            if name in visited:
                return

            temp_mark.add(name)
            for dep in dependencies.get(name, []):
                if dep in collection_map:
                    visit(dep)
            temp_mark.remove(name)
            visited.add(name)
            self.collection_order.append(name)

        for name in collection_map:
            if name not in visited:
                visit(name)

    def escape_js_string(self, value: Any) -> str:
        """Escape a string for JavaScript."""
        if value is None:
            return "null"
        # Escape backslashes first, then quotes
        escaped = str(value).replace("\\", "\\\\").replace('"', '\\"')
        # Escape newlines
        escaped = escaped.replace("\n", "\\n").replace("\r", "\\r")
        return f'"{escaped}"'

    def format_field(self, field: dict[str, Any], indent: int = 6) -> str:
        """Format a field definition for the migration."""
        spaces = " " * indent
        lines = [f"{spaces}{{"]

        # Add field properties
        props = []
        props.append(f'"system": {str(field.get("system", False)).lower()}')
        props.append(f'"id": {self.escape_js_string(field.get("id", field.get("name")))}')
        props.append(f'"name": {self.escape_js_string(field.get("name"))}')
        props.append(f'"type": {self.escape_js_string(field.get("type"))}')
        props.append(f'"required": {str(field.get("required", False)).lower()}')
        props.append(f'"presentable": {str(field.get("presentable", False)).lower()}')
        props.append(f'"unique": {str(field.get("unique", False)).lower()}')

        # Format options
        options = field.get("options", {})
        if options:
            props.append(f'"options": {json.dumps(options, indent=2, sort_keys=True)}')
        else:
            props.append('"options": {}')

        # Join properties
        for i, prop in enumerate(props):
            if i < len(props) - 1:
                lines.append(f"{spaces}  {prop},")
            else:
                lines.append(f"{spaces}  {prop}")

        lines.append(f"{spaces}}}")
        return "\n".join(lines)

    def format_collection(self, collection: dict[str, Any]) -> str:
        """Format a collection definition for the migration."""
        lines = []
        lines.append(f"  const {collection['name']}Collection = new Collection({{")

        # Basic properties
        lines.append(f'    "id": {self.escape_js_string(collection["id"])},')
        lines.append(f'    "created": {self.escape_js_string(collection["created"])},')
        lines.append(f'    "updated": {self.escape_js_string(collection["updated"])},')
        lines.append(f'    "name": {self.escape_js_string(collection["name"])},')
        lines.append(f'    "type": {self.escape_js_string(collection["type"])},')
        lines.append(f'    "system": {str(collection["system"]).lower()},')

        # Schema
        if collection.get("schema"):
            lines.append('    "schema": [')
            for i, field in enumerate(collection["schema"]):
                field_str = self.format_field(field)
                if i < len(collection["schema"]) - 1:
                    lines.append(field_str + ",")
                else:
                    lines.append(field_str)
            lines.append("    ],")
        else:
            lines.append('    "schema": [],')

        # Indexes
        if collection.get("indexes"):
            lines.append(f'    "indexes": {json.dumps(collection["indexes"])},')

        # Rules
        rules = ["listRule", "viewRule", "createRule", "updateRule", "deleteRule"]
        for rule in rules:
            value = collection.get(rule)
            if value is not None:
                lines.append(f'    "{rule}": {self.escape_js_string(value)},')

        # Options
        if collection.get("options"):
            options_str = json.dumps(collection["options"], indent=4, sort_keys=True)
            # Indent the options properly
            options_lines = options_str.split("\n")
            lines.append('    "options": ' + options_lines[0])
            for line in options_lines[1:]:
                lines.append("    " + line)
        else:
            lines.append('    "options": {}')

        lines.append("  })")
        lines.append("")

        # Save collection
        lines.append(f"  dao.saveCollection({collection['name']}Collection)")
        lines.append("")

        return "\n".join(lines)

    def generate_migration(self) -> str:
        """Generate the complete migration file."""
        lines: list[str] = []

        # Header
        lines.append('/// <reference path="../pb_data/types.d.ts" />')
        lines.append("/**")
        lines.append(" * Complete database schema snapshot")
        lines.append(f" * Generated on {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        lines.append(" * ")
        lines.append(" * This migration captures the entire current database state")
        lines.append(" * for clean deployments without migration history issues.")
        lines.append(" */")
        lines.append("")

        # Migration function
        lines.append("migrate((db) => {")
        lines.append("  const dao = new Dao(db)")
        lines.append("")
        lines.append("  // Create all collections in dependency order")
        lines.append("")

        # Add each collection
        for name in self.collection_order:
            collection = next(c for c in self.collections if c["name"] == name)
            lines.append("  // ========================================")
            lines.append(f"  // {name.upper()} COLLECTION")
            lines.append("  // ========================================")
            lines.append(self.format_collection(collection))

        lines.append("}, (db) => {")
        lines.append("  // Rollback: delete all collections in reverse order")
        lines.append("  const dao = new Dao(db)")
        lines.append("  const collections = [")

        # List collections in reverse order for rollback
        for name in reversed(self.collection_order):
            lines.append(f"    {self.escape_js_string(name)},")

        lines.append("  ]")
        lines.append("")
        lines.append("  collections.forEach(name => {")
        lines.append("    try {")
        lines.append("      const collection = dao.findCollectionByNameOrId(name)")
        lines.append("      dao.deleteCollection(collection)")
        lines.append("    } catch (e) {")
        lines.append("      // Collection might not exist")
        lines.append("    }")
        lines.append("  })")
        lines.append("})")

        return "\n".join(lines)

    def save_migration(self, output_path: str) -> None:
        """Save the migration to a file."""
        content = self.generate_migration()

        with open(output_path, "w") as f:
            f.write(content)

        print(f"Migration saved to: {output_path}")
        print(f"Total collections: {len(self.collections)}")
        print(f"Collections in dependency order: {', '.join(self.collection_order)}")


def main() -> None:
    # Get project root relative to script location
    project_root = Path(__file__).resolve().parent.parent.parent

    # Paths
    db_path = project_root / "pocketbase" / "pb_data" / "data.db"
    output_path = project_root / "pocketbase" / "pb_migrations" / "1900000000_complete_snapshot.js"

    # Check database exists
    if not db_path.exists():
        print(f"ERROR: Database not found at {db_path}")
        return

    # Generate migration
    generator = PocketBaseMigrationGenerator(str(db_path))

    print("Extracting collections from database...")
    generator.extract_collections()

    print("Ordering collections by dependencies...")
    generator.order_collections_by_dependencies()

    print("Generating migration file...")
    generator.save_migration(str(output_path))

    print("\nMigration generation complete!")
    print("\nNext steps:")
    print("1. Review the generated migration file")
    print("2. Test on a fresh Docker container")
    print("3. Compare schema with current database")


if __name__ == "__main__":
    main()

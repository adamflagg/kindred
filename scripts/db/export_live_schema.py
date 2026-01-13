#!/usr/bin/env python3
"""
Export the current live database schema from PocketBase.
"""

from __future__ import annotations

import json
import re
import sqlite3
from pathlib import Path
from typing import Any


def parse_pb_schema_json(schema_json: str) -> list[dict[str, Any]]:
    """Parse PocketBase schema JSON."""
    try:
        result: list[dict[str, Any]] = json.loads(schema_json)
        return result
    except Exception:
        return []


def extract_index_info(sql: str) -> list[str]:
    """Extract index definitions from CREATE TABLE SQL."""
    indexes: list[str] = []

    # Look for CREATE INDEX statements after the table
    index_pattern = r"CREATE\s+(?:UNIQUE\s+)?INDEX\s+[^;]+;"
    matches = re.findall(index_pattern, sql, re.IGNORECASE | re.MULTILINE)
    indexes.extend(matches)

    return indexes


def export_live_schema() -> None:
    """Export the current schema from the PocketBase database."""
    # Get project root relative to script location
    project_root = Path(__file__).resolve().parent.parent.parent
    db_path = project_root / "pocketbase" / "pb_data" / "data.db"

    if not db_path.exists():
        print(f"ERROR: Database not found at {db_path}")
        return

    conn = sqlite3.connect(str(db_path))
    cursor = conn.cursor()

    # Get all collections from _collections table
    cursor.execute("""
        SELECT name, type, schema, indexes, createRule, updateRule, 
               deleteRule, listRule, viewRule, options
        FROM _collections
        WHERE system = 0
        ORDER BY name
    """)

    collections = {}

    for row in cursor.fetchall():
        coll_name = row[0]
        collections[coll_name] = {
            "type": row[1],
            "fields": {},
            "indexes": [],
            "rules": {"create": row[4], "update": row[5], "delete": row[6], "list": row[7], "view": row[8]},
            "options": json.loads(row[9]) if row[9] else {},
        }

        # Parse schema
        schema_fields = parse_pb_schema_json(row[2])
        for field in schema_fields:
            field_name = field.get("name")
            if field_name:
                collections[coll_name]["fields"][field_name] = {
                    "type": field.get("type"),
                    "required": field.get("required", False),
                    "unique": field.get("unique", False),
                    "options": field.get("options", {}),
                    "presentable": field.get("presentable", False),
                    "system": field.get("system", False),
                }

        # Parse indexes
        if row[3]:
            indexes = row[3].strip().split("\n") if "\n" in row[3] else [row[3]]
            collections[coll_name]["indexes"] = [idx.strip() for idx in indexes if idx.strip()]

    # Get actual SQLite table info for verification
    cursor.execute("""
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name NOT LIKE '\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
    """)

    sqlite_tables = [row[0] for row in cursor.fetchall()]

    # For each collection, get the actual SQLite schema
    for table in sqlite_tables:
        if table in collections:
            # Get column info
            cursor.execute(f"PRAGMA table_info({table})")
            sqlite_columns = {}
            for col in cursor.fetchall():
                sqlite_columns[col[1]] = {
                    "type": col[2],
                    "notnull": bool(col[3]),
                    "default": col[4],
                    "pk": bool(col[5]),
                }
            collections[table]["sqlite_columns"] = sqlite_columns

            # Get indexes
            cursor.execute(f"PRAGMA index_list({table})")
            sqlite_indexes = []
            for idx in cursor.fetchall():
                idx_name = idx[1]
                cursor.execute(f"PRAGMA index_info({idx_name})")
                columns = [row[2] for row in cursor.fetchall()]
                sqlite_indexes.append({"name": idx_name, "unique": bool(idx[2]), "columns": columns})
            collections[table]["sqlite_indexes"] = sqlite_indexes

    conn.close()

    # Save the schema
    output: dict[str, Any] = {
        "collections": collections,
        "table_count": len(collections),
        "sqlite_tables": sqlite_tables,
    }

    with open(project_root / "live_schema.json", "w") as f:
        json.dump(output, f, indent=2, sort_keys=True)

    print(f"Exported schema for {len(collections)} collections")
    print(f"SQLite tables found: {len(sqlite_tables)}")

    # Also create simplified version for comparison
    simplified: dict[str, Any] = {"collections": {}}

    for coll_name, coll_data in collections.items():
        simplified["collections"][coll_name] = {
            "fields": {
                name: {
                    "type": field["type"],
                    "required": field["required"],
                    "unique": field["unique"],
                    "options": field.get("options", {}),
                }
                for name, field in coll_data["fields"].items()
            },
            "indexes": coll_data["indexes"],
        }

    with open(project_root / "live_schema_simple.json", "w") as f:
        json.dump(simplified, f, indent=2, sort_keys=True)


if __name__ == "__main__":
    export_live_schema()

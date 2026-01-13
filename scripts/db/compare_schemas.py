#!/usr/bin/env python3
"""
Compare theoretical schema (from migrations) with actual live schema.
Identify all discrepancies in detail.
"""

from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path
from typing import Any


class SchemaComparator:
    def __init__(self) -> None:
        self.discrepancies: list[dict[str, Any]] = []
        self.enum_mismatches: list[Any] = []
        self.missing_collections: list[str] = []
        self.extra_collections: list[str] = []
        self.field_differences: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)
        self.index_differences: defaultdict[str, dict[str, list[str]]] = defaultdict(dict)

    def add_discrepancy(
        self,
        category: str,
        collection: str,
        field: str,
        issue: str,
        details: dict[str, Any] | None = None,
    ) -> None:
        """Record a discrepancy."""
        self.discrepancies.append(
            {"category": category, "collection": collection, "field": field, "issue": issue, "details": details or {}}
        )

    def compare_field_type(self, field_name: str, theoretical: dict[str, Any], actual: dict[str, Any]) -> list[str]:
        """Compare field types and options."""
        issues = []

        # Check type
        if theoretical.get("type") != actual.get("type"):
            issues.append(f"Type mismatch: {theoretical.get('type')} vs {actual.get('type')}")

        # Check required
        if theoretical.get("required") != actual.get("required"):
            issues.append(f"Required mismatch: {theoretical.get('required')} vs {actual.get('required')}")

        # Check unique
        if theoretical.get("unique") != actual.get("unique"):
            issues.append(f"Unique mismatch: {theoretical.get('unique')} vs {actual.get('unique')}")

        # Check select options
        if theoretical.get("type") == "select" and actual.get("type") == "select":
            theo_values = set(theoretical.get("options", {}).get("values", []))
            actual_values = set(actual.get("options", {}).get("values", []))

            if theo_values != actual_values:
                missing = theo_values - actual_values
                extra = actual_values - theo_values
                if missing:
                    issues.append(f"Missing enum values: {missing}")
                if extra:
                    issues.append(f"Extra enum values: {extra}")

        return issues

    def compare_collections(self, theoretical: dict[str, Any], actual: dict[str, Any]) -> None:
        """Compare collections between theoretical and actual schemas."""
        theo_colls = set(theoretical.get("collections", {}).keys())
        actual_colls = set(actual.get("collections", {}).keys())

        # Missing collections (in theoretical but not actual)
        self.missing_collections = list(theo_colls - actual_colls)

        # Extra collections (in actual but not theoretical)
        self.extra_collections = list(actual_colls - theo_colls)

        # Common collections to compare
        common_colls = theo_colls & actual_colls

        for coll_name in common_colls:
            theo_coll = theoretical["collections"][coll_name]
            actual_coll = actual["collections"][coll_name]

            # Compare fields
            theo_fields = set(theo_coll.get("fields", {}).keys())
            actual_fields = set(actual_coll.get("fields", {}).keys())

            # Missing fields
            missing_fields = theo_fields - actual_fields
            for field in missing_fields:
                self.field_differences[coll_name].append(
                    {"field": field, "issue": "missing_in_actual", "theoretical": theo_coll["fields"][field]}
                )

            # Extra fields
            extra_fields = actual_fields - theo_fields
            for field in extra_fields:
                self.field_differences[coll_name].append(
                    {"field": field, "issue": "extra_in_actual", "actual": actual_coll["fields"][field]}
                )

            # Common fields - compare properties
            common_fields = theo_fields & actual_fields
            for field in common_fields:
                theo_field = theo_coll["fields"][field]
                actual_field = actual_coll["fields"][field]

                issues = self.compare_field_type(field, theo_field, actual_field)
                if issues:
                    self.field_differences[coll_name].append(
                        {
                            "field": field,
                            "issue": "property_mismatch",
                            "issues": issues,
                            "theoretical": theo_field,
                            "actual": actual_field,
                        }
                    )

            # Compare indexes
            theo_indexes = set(theo_coll.get("indexes", []))
            actual_indexes = set(actual_coll.get("indexes", []))

            missing_indexes = theo_indexes - actual_indexes
            extra_indexes = actual_indexes - theo_indexes

            if missing_indexes or extra_indexes:
                self.index_differences[coll_name] = {"missing": list(missing_indexes), "extra": list(extra_indexes)}


def main() -> None:
    # Get project root relative to script location
    project_root = Path(__file__).resolve().parent.parent.parent

    # Load schemas
    theoretical_path = project_root / "theoretical_schema_simple.json"
    actual_path = project_root / "live_schema_simple.json"

    if not theoretical_path.exists():
        print("ERROR: Theoretical schema not found. Run analyze_migrations_detailed.py first.")
        return

    if not actual_path.exists():
        print("ERROR: Actual schema not found. Run export_live_schema.py first.")
        return

    with open(theoretical_path) as f:
        theoretical = json.load(f)

    with open(actual_path) as f:
        actual = json.load(f)

    # Compare schemas
    comparator = SchemaComparator()
    comparator.compare_collections(theoretical, actual)

    # Generate report
    report = {
        "summary": {
            "missing_collections": comparator.missing_collections,
            "extra_collections": comparator.extra_collections,
            "collections_with_field_issues": list(comparator.field_differences.keys()),
            "collections_with_index_issues": list(comparator.index_differences.keys()),
            "total_discrepancies": len(comparator.discrepancies),
        },
        "details": {
            "field_differences": dict(comparator.field_differences),
            "index_differences": dict(comparator.index_differences),
            "all_discrepancies": comparator.discrepancies,
        },
    }

    # Save report
    report_path = project_root / "schema_comparison_report.json"
    with open(report_path, "w") as f:
        json.dump(report, f, indent=2)

    # Print summary
    print("=== SCHEMA COMPARISON SUMMARY ===")
    print(f"\nMissing Collections (in migrations but not in DB): {len(comparator.missing_collections)}")
    for coll in comparator.missing_collections:
        print(f"  - {coll}")

    print(f"\nExtra Collections (in DB but not in migrations): {len(comparator.extra_collections)}")
    for coll in comparator.extra_collections:
        print(f"  - {coll}")

    print(f"\nCollections with Field Issues: {len(comparator.field_differences)}")
    for coll, issues in comparator.field_differences.items():
        print(f"\n  {coll}:")
        for issue in issues[:5]:  # Show first 5 issues
            print(f"    - {issue['field']}: {issue['issue']}")
            if "issues" in issue:
                for i in issue["issues"]:
                    print(f"      • {i}")
        if len(issues) > 5:
            print(f"    ... and {len(issues) - 5} more issues")

    print(f"\nCollections with Index Issues: {len(comparator.index_differences)}")
    for coll, diffs in comparator.index_differences.items():
        print(f"  {coll}:")
        if diffs["missing"]:
            print(f"    Missing: {diffs['missing']}")
        if diffs["extra"]:
            print(f"    Extra: {diffs['extra']}")

    print("\nDetailed report saved to: schema_comparison_report.json")

    # Analyze specific enum issues
    print("\n=== ENUM VALUE ANALYSIS ===")
    enum_fields = []

    for coll, issues in comparator.field_differences.items():
        for issue in issues:
            if "issues" in issue:
                for i in issue["issues"]:
                    if "enum values" in i:
                        enum_fields.append(
                            {
                                "collection": coll,
                                "field": issue["field"],
                                "issue": i,
                                "theoretical": issue.get("theoretical", {}).get("options", {}).get("values", []),
                                "actual": issue.get("actual", {}).get("options", {}).get("values", []),
                            }
                        )

    if enum_fields:
        print(f"\nFound {len(enum_fields)} enum field discrepancies:")
        for ef in enum_fields:
            print(f"\n{ef['collection']}.{ef['field']}:")
            print(f"  Issue: {ef['issue']}")
            print(f"  Theoretical values: {ef['theoretical']}")
            print(f"  Actual values: {ef['actual']}")


if __name__ == "__main__":
    main()

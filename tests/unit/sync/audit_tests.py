#!/usr/bin/env python3
"""
Audit script to analyze the test suite and categorize tests.
This helps identify which tests are suitable for CI.
"""

import ast
import os
from collections import defaultdict


def analyze_test_file(filepath):
    """Analyze a test file and extract key information"""
    info = {
        "path": filepath,
        "name": os.path.basename(filepath),
        "has_class": False,
        "has_main": False,
        "imports_mock": False,
        "imports_pytest": False,
        "sys_path_hack": False,
        "test_functions": [],
        "external_deps": [],
        "issues": [],
    }

    try:
        with open(filepath) as f:
            content = f.read()

        # Check for common patterns
        if 'if __name__ == "__main__"' in content:
            info["has_main"] = True
            info["issues"].append("Has main block - designed as standalone script")

        if "sys.path.insert" in content or "sys.path.append" in content:
            info["sys_path_hack"] = True
            info["issues"].append("Uses sys.path manipulation")

        if "from unittest.mock import" in content or "import mock" in content:
            info["imports_mock"] = True

        if "import pytest" in content or "from pytest" in content:
            info["imports_pytest"] = True

        # Parse AST to find test functions and classes
        try:
            tree = ast.parse(content)
            for node in ast.walk(tree):
                if isinstance(node, ast.ClassDef) and node.name.startswith("Test"):
                    info["has_class"] = True
                elif isinstance(node, ast.FunctionDef) and node.name.startswith("test_"):
                    info["test_functions"].append(node.name)

            # Look for external dependencies
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    for alias in node.names:
                        if alias.name in ["requests", "aiohttp", "httpx"]:
                            info["external_deps"].append(alias.name)
                            info["issues"].append(f"Imports {alias.name} - may need network")
                elif isinstance(node, ast.ImportFrom):
                    if node.module and "pocketbase" in node.module:
                        info["external_deps"].append("pocketbase")
                        info["issues"].append("Imports pocketbase - needs database")

        except SyntaxError as e:
            info["issues"].append(f"Syntax error: {e}")

    except Exception as e:
        info["issues"].append(f"Error reading file: {e}")

    return info


def categorize_tests(test_dir):
    """Categorize all tests in the directory"""
    categories = defaultdict(list)

    for filename in os.listdir(test_dir):
        if filename.startswith("test_") and filename.endswith(".py"):
            filepath = os.path.join(test_dir, filename)
            info = analyze_test_file(filepath)

            # Categorize based on characteristics
            if info["has_main"] and not info["has_class"]:
                categories["standalone"].append(info)
            elif info["imports_pytest"] and info["has_class"] and not info["issues"]:
                categories["clean_pytest"].append(info)
            elif info["external_deps"]:
                categories["integration"].append(info)
            elif info["sys_path_hack"]:
                categories["needs_cleanup"].append(info)
            else:
                categories["unknown"].append(info)

    return categories


def main():
    """Run the audit"""
    test_dir = os.path.dirname(os.path.abspath(__file__))
    categories = categorize_tests(test_dir)

    print("# Test Suite Audit Report\n")
    print(f"Total test files: {sum(len(tests) for tests in categories.values())}\n")

    print("## Clean pytest tests (suitable for CI)")
    print("These tests follow pytest conventions and have no issues:\n")
    for test in categories["clean_pytest"]:
        print(f"- `{test['name']}`: {len(test['test_functions'])} tests")

    print("\n## Integration tests (need external services)")
    print("These tests require database, network, or other services:\n")
    for test in categories["integration"]:
        print(f"- `{test['name']}`: {', '.join(test['external_deps'])}")

    print("\n## Standalone scripts (not for pytest)")
    print("These are designed to run as scripts, not with pytest:\n")
    for test in categories["standalone"]:
        print(f"- `{test['name']}`")

    print("\n## Tests needing cleanup")
    print("These tests have issues that need fixing:\n")
    for test in categories["needs_cleanup"]:
        print(f"- `{test['name']}`: {test['issues'][0]}")

    print("\n## Unknown/Other")
    for test in categories["unknown"]:
        print(f"- `{test['name']}`: {len(test['test_functions'])} tests")

    # Summary
    print("\n## Summary")
    print(f"- Clean pytest tests: {len(categories['clean_pytest'])}")
    print(f"- Integration tests: {len(categories['integration'])}")
    print(f"- Standalone scripts: {len(categories['standalone'])}")
    print(f"- Need cleanup: {len(categories['needs_cleanup'])}")
    print(f"- Unknown: {len(categories['unknown'])}")


if __name__ == "__main__":
    main()

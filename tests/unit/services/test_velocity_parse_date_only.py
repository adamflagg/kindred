"""Test that velocity_service uses parse_date_only instead of inline date-stripping.

TDD: This test is written FIRST, before the refactor.
It verifies that velocity_service.py imports and uses parse_date_only
from reconstruction.py, rather than inline split("T")[0].split(" ")[0] patterns.
"""

import ast
import inspect
from pathlib import Path

import pytest


def _get_velocity_source() -> str:
    """Return the source code of velocity_service.py."""
    path = Path(__file__).resolve().parents[3] / "api" / "services" / "velocity_service.py"
    return path.read_text()


class TestParseDataOnlyImport:
    """Verify that parse_date_only is imported from reconstruction."""

    def test_imports_parse_date_only(self):
        """velocity_service must import parse_date_only from reconstruction."""
        source = _get_velocity_source()
        tree = ast.parse(source)
        imported = False
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                if node.module and "reconstruction" in node.module:
                    for alias in node.names:
                        if alias.name == "parse_date_only":
                            imported = True
        assert imported, "velocity_service.py must import parse_date_only from api.services.reconstruction"


class TestNoInlineDateStripping:
    """Verify that no inline .split('T')[0].split(' ')[0] patterns remain."""

    def test_no_split_t_split_space_pattern(self):
        """No occurrences of .split("T")[0].split(" ")[0] should remain."""
        source = _get_velocity_source()
        count = source.count('.split("T")[0].split(" ")[0]')
        count += source.count(".split('T')[0].split(' ')[0]")
        assert count == 0, (
            f"Found {count} inline .split('T')[0].split(' ')[0] pattern(s) — use parse_date_only() instead"
        )

    def test_no_split_space_split_t_pattern(self):
        """No occurrences of .split(" ")[0].split("T")[0] should remain."""
        source = _get_velocity_source()
        count = source.count('.split(" ")[0].split("T")[0]')
        count += source.count(".split(' ')[0].split('T')[0]")
        assert count == 0, (
            f"Found {count} inline .split(' ')[0].split('T')[0] pattern(s) — use parse_date_only() instead"
        )


class TestParseDataOnlyUsage:
    """Verify that parse_date_only is actually called in the module."""

    def test_parse_date_only_is_called(self):
        """parse_date_only must actually be called in velocity_service.py."""
        source = _get_velocity_source()
        assert "parse_date_only(" in source, "parse_date_only is imported but never called in velocity_service.py"

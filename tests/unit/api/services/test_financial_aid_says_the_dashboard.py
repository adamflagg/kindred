"""Owner ruling 2026-10-05: nobody at camp calls it Kindred, so no Camperships string staff can read names it. It
says "the dashboard" ("The dashboard" opening a sentence). Identifiers, enum values, log keys, comments and
docstrings keep the name; only string values that reach a screen change."""

from __future__ import annotations

import ast
from pathlib import Path

from api.services.financial_aid_decisions_service import CANCELLED_IN_KINDRED
from api.services.financial_aid_grant_placements import PLACEMENT_REASON
from api.services.financial_aid_reports_service import WITHDRAWN_LABEL
from api.services.financial_aid_to_place import _TEXT as CHANGED_SINCE_TEXT
from bunking.financial_aid.decisions.as_of import PAST_DATE_GAPS

ROOT = Path(__file__).resolve().parents[4]
CAMPERSHIPS = (
    "api/services/financial_aid*.py",
    "api/schemas/financial_aid*.py",
    "api/routers/financial_aid*.py",
    "bunking/financial_aid/**/*.py",
)


def _docstrings(tree: ast.AST) -> set[int]:
    """Every bare string statement: module, class and function docstrings, and attribute docstrings."""
    return {
        id(node.value)
        for node in ast.walk(tree)
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str)
    }


def _strings_naming_kindred() -> list[str]:
    found: list[str] = []
    for pattern in CAMPERSHIPS:
        for path in sorted(ROOT.glob(pattern)):
            tree = ast.parse(path.read_text(encoding="utf-8"))
            skip = _docstrings(tree)
            found.extend(
                f"{path.relative_to(ROOT)}:{node.lineno}: {node.value!r}"
                for node in ast.walk(tree)
                if isinstance(node, ast.Constant)
                and isinstance(node.value, str)
                and "Kindred" in node.value
                and id(node) not in skip
            )
    return found


def test_the_scan_reads_the_camperships_server() -> None:
    """The guard below passes vacuously if the globs stop matching: prove they still reach the files."""
    assert len(list(ROOT.glob(CAMPERSHIPS[0]))) > 20
    assert len(list(ROOT.glob(CAMPERSHIPS[3]))) > 20


def test_no_camperships_server_string_names_kindred() -> None:
    assert _strings_naming_kindred() == []


def test_the_refusals_and_labels_say_the_dashboard() -> None:
    assert CANCELLED_IN_KINDRED == "Cancelled in the dashboard: reopen it first"
    assert WITHDRAWN_LABEL == "Withdrawn in the dashboard"
    assert PLACEMENT_REASON == "Where the grants register placed each grant when the dashboard priced the season"
    assert CHANGED_SINCE_TEXT["cancellation"] == "the request was cancelled or reopened in the dashboard"
    assert PAST_DATE_GAPS["posted_before_request"] == (
        "Posted in CampMinder by this date, but the request was recorded in the dashboard after it"
    )

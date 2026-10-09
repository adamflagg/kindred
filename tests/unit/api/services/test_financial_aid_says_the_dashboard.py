"""Owner ruling 2026-10-05, plain staff words: nobody at camp calls it Kindred, so no Camperships string staff can
read names it: it says "the dashboard" ("The dashboard" opening a sentence). Nor does one say "tick": Posted and
Accepted are checkboxes, so a round is "checked Posted" and "unchecked". Owner ruling 2026-10-05 (late): nor does one
say "headcount"; staff read "number of people". Identifiers, enum values, log keys, URL paths, comments and docstrings
keep their words; only string values that reach a screen change."""

from __future__ import annotations

import ast
import re
from collections.abc import Callable
from pathlib import Path

from api.services.financial_aid_decisions_service import CANCELLED_IN_KINDRED
from api.services.financial_aid_grant_placements import PLACEMENT_REASON
from api.services.financial_aid_reports_service import WITHDRAWN_LABEL
from api.services.financial_aid_to_place import _TEXT as CHANGED_SINCE_TEXT
from bunking.financial_aid.decisions.as_of import PAST_DATE_GAPS
from bunking.financial_aid.definitions import DEFINITIONS

ROOT = Path(__file__).resolve().parents[4]
CAMPERSHIPS = (
    "api/services/financial_aid*.py",
    "api/schemas/financial_aid*.py",
    "api/routers/financial_aid*.py",
    "bunking/financial_aid/**/*.py",
)


def _docstrings(tree: ast.AST) -> set[int]:
    """Every bare string statement (module, class and function docstrings, and attribute docstrings), and every name in
    an `__all__` list, which is an identifier however it is cased."""
    skipped = {
        id(node.value)
        for node in ast.walk(tree)
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str)
    }
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "__all__" for t in node.targets):
            skipped.update(id(name) for name in ast.walk(node.value) if isinstance(name, ast.Constant))
    return skipped


_IDENTIFIER = re.compile(r"[a-z_]+")  # an enum value or a key ("tick", "unticked", "ticks"), never prose
_TICK = re.compile(r"\b(un-?)?tick", re.IGNORECASE)


def _naming_kindred(text: str) -> bool:
    return "Kindred" in text


def _saying_tick(text: str) -> bool:
    return _TICK.search(text) is not None and _IDENTIFIER.fullmatch(text) is None


def _saying_headcount(text: str) -> bool:
    """Prose naming a headcount; a key ("headcount_source") or a URL path ("/requests/{id}/headcount") is not prose."""
    return "headcount" in text.casefold() and _IDENTIFIER.fullmatch(text) is None and not text.startswith("/")


def _strings(says: Callable[[str], bool]) -> list[str]:
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
                and says(node.value)
                and id(node) not in skip
            )
    return found


def test_the_scan_reads_the_camperships_server() -> None:
    """The guard below passes vacuously if the globs stop matching: prove they still reach the files."""
    assert len(list(ROOT.glob(CAMPERSHIPS[0]))) > 20
    assert len(list(ROOT.glob(CAMPERSHIPS[3]))) > 20


def test_no_camperships_server_string_names_kindred() -> None:
    assert _strings(_naming_kindred) == []


def test_no_camperships_server_string_says_tick() -> None:
    assert _strings(_saying_tick) == []


def test_no_camperships_server_string_says_headcount() -> None:
    assert _strings(_saying_headcount) == []


def test_the_cost_definition_says_number_of_people() -> None:
    (cost,) = (d for d in DEFINITIONS if d.key == "cost")
    # The owner's shorter wording (★5, final-ux 10-09) reads "Family Camp by the number of people"; the ruling
    # this pins is the staff word, "number of people", never "headcount".
    assert "Family Camp by the number of people" in cost.text
    assert "headcount" not in cost.text.lower()


def test_the_headcount_scan_skips_keys_and_paths_and_catches_prose() -> None:
    assert not _saying_headcount("headcount_non_infant")
    assert not _saying_headcount("/requests/{request_id}/headcount")
    assert _saying_headcount("Headcount")
    assert _saying_headcount("Enter the family-camp headcount")
    assert _saying_headcount("Family Camp by HeadCount")


def test_the_tick_scan_skips_keys_and_catches_prose() -> None:
    assert not _saying_tick("unticked")
    assert not _saying_tick("ticks")
    assert _saying_tick("Untick Accepted on Round ")
    assert _saying_tick("You un-ticked this round")
    assert _saying_tick("Ticked today")


def test_the_refusals_and_labels_say_the_dashboard() -> None:
    assert CANCELLED_IN_KINDRED == "Cancelled in the dashboard: reopen it first"
    assert WITHDRAWN_LABEL == "Withdrawn in the dashboard"
    assert PLACEMENT_REASON == "Where the grants register placed each grant when the dashboard priced the season"
    assert CHANGED_SINCE_TEXT["cancellation"] == "the request was cancelled or reopened in the dashboard"
    assert PAST_DATE_GAPS["posted_before_request"] == (
        "Posted in CampMinder by this date, but the request was recorded in the dashboard after it"
    )

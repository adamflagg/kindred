"""No value reaches a quoted PocketBase filter literal unescaped.

The API, the graph builder and the sync processor query PocketBase as
superuser, so a quote or a trailing backslash in an interpolated value would
otherwise close the string literal early, rewrite the filter and widen what the
query reads. Every quoted interpolation that follows a filter operator goes
through ``pb_escape`` at the sink, as the lodging repository already does.

The guard is an AST scan, not a per-line regex, so it also sees filters passed
positionally, written without spaces around the operator, or split across an
implicit string concatenation. Unquoted interpolations (``year = {year}``) are
out of its scope: those must be ints, and are left alone.
"""

import ast
import re
from pathlib import Path

import pytest

from api.utils.pb_filters import pb_escape
from bunking.graph.social_graph_builder import SocialGraphBuilder

REPO_ROOT = Path(__file__).resolve().parents[2]
SCANNED_DIRS = ("api", "bunking", "scripts")

# A PocketBase comparison operator (=, !=, >, >=, <, <=, ~, !~, and the ?-prefixed
# any-of forms), then an opening quote whose literal is still open where the
# interpolation sits. \x00 stands in for an earlier interpolation in the same
# f-string, so `"{a}-{b}"` flags both.
OPEN_FILTER_LITERAL = re.compile(r"""\??(?:!=|!~|>=|<=|=|~|>|<)\s*(["'])[^"']*$""")

PLACEHOLDER = "\x00"

# A log line is not a filter, even when it reads like one (`field='{x}'`).
LOG_METHODS = frozenset({"debug", "info", "warning", "warn", "error", "exception", "critical", "log"})


def _is_pb_escape_call(node: ast.expr) -> bool:
    if not isinstance(node, ast.Call):
        return False
    func = node.func
    name = func.id if isinstance(func, ast.Name) else func.attr if isinstance(func, ast.Attribute) else None
    return name == "pb_escape"


def _receiver_name(node: ast.expr) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return node.attr
    return ""


def _log_message_strings(tree: ast.AST) -> set[int]:
    """ids of the f-strings passed to a logger call, which are never filters."""
    skipped: set[int] = set()
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr in LOG_METHODS
            and "log" in _receiver_name(node.func.value).lower()
        ):
            for arg in node.args:
                skipped.update(id(sub) for sub in ast.walk(arg) if isinstance(sub, ast.JoinedStr))
    return skipped


def unescaped_filter_interpolations(source: str) -> list[int]:
    """Line numbers of quoted filter interpolations not wrapped in pb_escape()."""
    offenders: list[int] = []
    tree = ast.parse(source)
    log_messages = _log_message_strings(tree)
    for node in ast.walk(tree):
        if not isinstance(node, ast.JoinedStr) or id(node) in log_messages:
            continue
        prefix = ""
        for part in node.values:
            if isinstance(part, ast.Constant) and isinstance(part.value, str):
                prefix += part.value
            elif isinstance(part, ast.FormattedValue):
                if OPEN_FILTER_LITERAL.search(prefix) and not _is_pb_escape_call(part.value):
                    offenders.append(part.value.lineno)
                prefix += PLACEHOLDER
    return offenders


def _scanned_files() -> list[Path]:
    files = []
    for top in SCANNED_DIRS:
        for path in sorted((REPO_ROOT / top).rglob("*.py")):
            if "tests" in path.parts or "node_modules" in path.parts:
                continue
            files.append(path)
    return files


def test_no_filter_interpolates_an_unescaped_quoted_value() -> None:
    offenders = []
    for path in _scanned_files():
        source = path.read_text()
        lines = source.splitlines()
        for lineno in unescaped_filter_interpolations(source):
            offenders.append(f"{path.relative_to(REPO_ROOT)}:{lineno}: {lines[lineno - 1].strip()}")
    assert offenders == [], f"{len(offenders)} quoted filter value(s) not wrapped in pb_escape():\n" + "\n".join(
        offenders
    )


@pytest.mark.parametrize(
    "snippet",
    [
        "f'scenario = \"{scenario_id}\"'",
        "f\"source_field = '{field}'\"",
        'f\'(person="{a}" && relative="{b}")\'',
        "client.get_first_list_item(f'run_id = \"{orphan}\"')",
        "f'year = {year} && status != \"{status}\"'",
        "f'name ~ \"{q}\"'",
        "f'name !~ \"{q}\"'",
        "f\"created > '{at}'\"",
        "f\"created <= '{at}'\"",
        "f'tags ?= \"{tag}\"'",
        "f'tags ?!= \"{tag}\"'",
        "f'name = \"{first}-{last}\"'",
        "f'id = \"{_record_id(record_id)}\"'",
        "f'category = \"{category}\" ' f'&& config_key = \"{key}\"'",
        "logger.debug(msg, extra={'filter': f'id = \"{rid}\"'})",
    ],
)
def test_guard_flags_an_unescaped_quoted_value(snippet: str) -> None:
    assert unescaped_filter_interpolations(snippet) != []


@pytest.mark.parametrize(
    "snippet",
    [
        "f'scenario = \"{pb_escape(scenario_id)}\"'",
        "f\"source_field = '{pb_escape(field)}'\"",
        "f'year = {year} && cm_id = {cm_id}'",
        "f'name = \"{pb_escape(first)}-{pb_escape(last)}\"'",
        "f'{base} && year = {year}'",
        "f'Found {count} records for \"{name}\"'",
        "f'id = \"{filters.pb_escape(x)}\"'",
        "logger.debug(f\"[AI-PARSE] Input: field='{field}' text='{text}'\")",
        "self.logger.info(f\"'{a}' == '{b}' -> '{c}'\")",
    ],
)
def test_guard_passes_escaped_or_unquoted_values(snippet: str) -> None:
    assert unescaped_filter_interpolations(snippet) == []


@pytest.mark.parametrize(
    "value", ["abcdefghij12345", "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6", "2026", "2026-07-01 00:00:00.000Z"]
)
def test_pb_escape_leaves_a_real_id_unchanged(value: str) -> None:
    assert pb_escape(value) == value


def test_pb_escape_neutralises_quotes_and_backslashes() -> None:
    assert pb_escape("O'Brien") == "O\\'Brien"
    assert pb_escape('a" || id != "') == 'a\\" || id != \\"'
    assert pb_escape("trailing\\") == "trailing\\\\"


def test_graph_builder_scenario_clause_cannot_break_out_of_its_quotes() -> None:
    _, clause = SocialGraphBuilder._assignment_source('abc" || id != "')
    assert clause == ' && scenario = "abc\\" || id != \\""'


def test_graph_builder_scenario_clause_keeps_a_real_id_unchanged() -> None:
    _, clause = SocialGraphBuilder._assignment_source("abcdefghij12345")
    assert clause == ' && scenario = "abcdefghij12345"'

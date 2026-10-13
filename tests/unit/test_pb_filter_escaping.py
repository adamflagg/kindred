"""No value can rewrite a PocketBase filter it is interpolated into.

The API, the graph builder and the sync processor query PocketBase as
superuser, so a quote or a trailing backslash in an interpolated value would
otherwise close the string literal early, rewrite the filter and widen what the
query reads. Every quoted interpolation that follows a filter operator goes
through ``pb_escape`` at the sink, as the lodging repository already does.

The guard is an AST scan, not a per-line regex. It turns every string-building
expression (f-string, ``+`` chain, ``%``, ``str.format``, ``str.replace``) into
literal text and holes, then walks it with a quote-state lexer that honours
backslash escapes. It flags:

- a hole inside a quoted literal that has an operator before its opening quote
  or after its closing quote, unless the hole is a bare ``pb_escape(...)`` with
  no format spec or conversion;
- a hole sitting unquoted right after ``field <op>``, unless it is provably a
  number (``int(...)``, arithmetic whose every operand is one, a literal, or a
  name in INT_NAMES). There is no quote to break out of there, so a str would
  be the worse sink.

A logger call's own message is skipped; a filter built inside one of its
arguments is not.
"""

import ast
import re
import string
from dataclasses import dataclass
from pathlib import Path

import pytest

from api.utils.pb_filters import pb_escape
from bunking.graph.social_graph_builder import SocialGraphBuilder

REPO_ROOT = Path(__file__).resolve().parents[2]
SCANNED_DIRS = ("api", "bunking", "scripts")

# A PocketBase comparison operator: =, !=, >, >=, <, <=, ~, !~, and the
# ?-prefixed any-of forms. A quoted literal is a filter value when one sits
# just before its opening quote, or just after its closing quote (fexpr accepts
# the literal on either side).
_OPERATOR = r"\??(?:!=|!~|>=|<=|=|~|>|<)"

# Stands in for an interpolation or a closed literal in the text outside quotes,
# so an operator is only "before" a value when nothing else sits between them.
PLACEHOLDER = "\x00"
# Stands in for a hole that supplies the operator itself (`{field} {op} "..."`).
# It is a code-chosen token, not judged, but the hole after it is a value.
OPERATOR_HOLE = "\x01"
OPERATOR_NAMES = re.compile(r"^(?:op|operator|\w+_op|\w+_operator|cmp|comparator)$")

_ANY_OPERATOR = r"(?:" + _OPERATOR + "|" + OPERATOR_HOLE + r")"
OPERATOR_BEFORE = re.compile(_ANY_OPERATOR + r"\s*$")
OPERATOR_AFTER = re.compile(r"^\s*" + _ANY_OPERATOR)
# The unquoted case is judged on the full `field <op> ` shape, because prose
# (`key={value}`, `a -> {b}`, `H = {n}`) reads like a bare operator. The field
# may be a hole too (`{field} = {value}`), as a helper that takes it does; that
# counts only where a clause starts (string start, `(`, `&&`, `||`), because
# `- {dep} = {value}` and `{a} + {b} = {total}` are prose.
FIELD_OPERATOR_BEFORE = re.compile(
    r"(?:(?:^|[\s(&|])[a-z_@][a-z0-9_.@]*|(?:^|\(|&&|\|\|)\s*" + PLACEHOLDER + r")\s+" + _ANY_OPERATOR + r"\s*$"
)

# A log line is not a filter, even when it reads like one (`field='{x}'`).
LOG_METHODS = frozenset({"debug", "info", "warning", "warn", "error", "exception", "critical", "log"})

# %-format conversions that only accept numbers, so cannot carry a quote
# (%c is left out: it takes a one-character str).
_NUMERIC_PERCENT = frozenset("diouxXeEfFgG")
_PERCENT_FIELD = re.compile(r"%(?:\(([^)]*)\))?[-#0 +]*(?:\*|\d+)?(?:\.(?:\*|\d+))?[hlL]?(.)")

# An unquoted value after an operator must be a number. These are the names the
# tree interpolates that way by convention; anything else goes through int(...).
# Do not add a name that can hold a PocketBase record id (`*_id`, `sid`): those
# are str, and `scenario = {scenario_id}` needs no quote to rewrite the filter.
INT_NAMES = re.compile(
    r"""(?x)^(?:
        year | \w*_year | y           # years, int-typed throughout
      | \w*cm_id                      # CampMinder ids are ints
      | [A-Z][A-Z0-9_]*                # module constants
      | min_confidence | max_confidence  # float Query params, validated 0..1
    )$"""
)


@dataclass
class Hole:
    """One runtime value spliced into a string being built."""

    node: ast.expr
    # pb_escape's output is only safe whole: a format spec can cut it between a
    # backslash and the quote it escapes, and !r adds quotes of its own.
    spec: bool = False
    # A %d-style field, which only accepts a number.
    numeric: bool = False


Template = list[str | Hole]


def _is_pb_escape_call(node: ast.expr) -> bool:
    if not isinstance(node, ast.Call):
        return False
    func = node.func
    name = func.id if isinstance(func, ast.Name) else func.attr if isinstance(func, ast.Attribute) else None
    return name == "pb_escape"


def _terminal_name(node: ast.expr) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return node.attr
    return ""


def _is_unquotable(node: ast.expr) -> bool:
    if isinstance(node, ast.Constant):
        return isinstance(node.value, int | float | str)  # a literal cannot be rewritten
    if isinstance(node, ast.IfExp):
        return _is_unquotable(node.body) and _is_unquotable(node.orelse)
    if isinstance(node, ast.Call):
        return _terminal_name(node.func) in {"int", "len"}
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Sub | ast.Mult | ast.FloorDiv | ast.Add):
        # Both sides: `PREFIX + scenario_id` and `scenario_id * 1` are str.
        return _is_unquotable(node.left) and _is_unquotable(node.right)
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
        return _is_unquotable(node.operand)
    return bool(INT_NAMES.match(_terminal_name(node)))


def _is_operator_hole(node: ast.expr) -> bool:
    """A hole that supplies a comparison operator, by name or by value."""
    if isinstance(node, ast.Constant):
        return isinstance(node.value, str) and re.fullmatch(_OPERATOR, node.value.strip()) is not None
    if isinstance(node, ast.IfExp):
        return _is_operator_hole(node.body) and _is_operator_hole(node.orelse)
    return bool(OPERATOR_NAMES.match(_terminal_name(node)))


def _str_constant(node: ast.expr) -> str | None:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    return None


def _percent_template(fmt: str, right: ast.expr) -> Template:
    """The parts of `fmt % right`, each field mapped to the value it takes."""
    values = list(right.elts) if isinstance(right, ast.Tuple) else [right]
    keyed = dict(zip(right.keys, right.values, strict=True)) if isinstance(right, ast.Dict) else {}
    out: Template = []
    pos = 0
    index = 0
    for match in _PERCENT_FIELD.finditer(fmt):
        out.append(fmt[pos : match.start()])
        pos = match.end()
        key, conv = match.group(1), match.group(2)
        if conv == "%":
            out.append("%")
            continue
        node = right
        if key is not None:
            node = next((v for k, v in keyed.items() if k is not None and _str_constant(k) == key), right)
        elif index < len(values):
            node = values[index]
            index += 1
        out.append(Hole(node, spec=conv != "s", numeric=conv in _NUMERIC_PERCENT))
    out.append(fmt[pos:])
    return out


def _format_template(fmt: str, call: ast.Call) -> Template:
    """The parts of `fmt.format(...)`, each field mapped to the value it takes."""
    out: Template = []
    auto = 0
    keywords = {kw.arg: kw.value for kw in call.keywords if kw.arg}
    for literal, field, spec, conversion in string.Formatter().parse(fmt):
        out.append(literal)
        if field is None:
            continue
        node: ast.expr = call
        if field == "":
            if auto < len(call.args):
                node = call.args[auto]
            auto += 1
        elif field.isdigit():
            if int(field) < len(call.args):
                node = call.args[int(field)]
        elif field in keywords:
            node = keywords[field]
        out.append(Hole(node, spec=bool(spec or conversion)))
    return out


def _template(node: ast.expr) -> Template | None:
    """`node` as literal text and holes, when it builds a string; else None."""
    text = _str_constant(node)
    if text is not None:
        return [text]
    if isinstance(node, ast.JoinedStr):
        out: Template = []
        for part in node.values:
            if isinstance(part, ast.FormattedValue):
                out.append(Hole(part.value, spec=part.conversion != -1 or part.format_spec is not None))
            elif (value := _str_constant(part)) is not None:
                out.append(value)
        return out
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
        left, right = _template(node.left), _template(node.right)
        if left is None and right is None:
            return None
        head: Template = left if left is not None else [Hole(node.left)]
        tail: Template = right if right is not None else [Hole(node.right)]
        return head + tail
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Mod) and (fmt := _str_constant(node.left)) is not None:
        return _percent_template(fmt, node.right)
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
        receiver = _str_constant(node.func.value)
        if receiver is not None and node.func.attr == "format":
            return _format_template(receiver, node)
        if receiver is not None and node.func.attr == "replace" and len(node.args) >= 2:
            old = _str_constant(node.args[0])
            if old:
                pieces = receiver.split(old)
                out = [pieces[0]]
                for piece in pieces[1:]:
                    out += [Hole(node.args[1]), piece]
                return out
    return None


def _template_offenders(template: Template) -> list[ast.expr]:
    """Holes that can rewrite the filter: unescaped inside a quoted filter
    literal, or a non-int sitting unquoted right after an operator."""
    offenders: list[ast.expr] = []
    outside = ""  # text outside quotes so far
    quote: str | None = None
    escaped = False
    literal_before = ""  # outside text before the open literal
    literal_holes: list[Hole] = []
    closed: tuple[str, list[Hole]] | None = None  # last literal, awaiting its trailing text
    trailing = ""

    def settle_closed() -> None:
        nonlocal closed, trailing
        if closed is not None:
            before, holes = closed
            if OPERATOR_BEFORE.search(before) or OPERATOR_AFTER.match(trailing):
                offenders.extend(h.node for h in holes if not h.numeric and (h.spec or not _is_pb_escape_call(h.node)))
        closed, trailing = None, ""

    for item in template:
        if isinstance(item, Hole):
            if quote is not None:
                literal_holes.append(item)
                escaped = False
                continue
            marker = OPERATOR_HOLE if _is_operator_hole(item.node) else PLACEHOLDER
            if closed is not None:
                trailing += marker
            settle_closed()
            if marker == OPERATOR_HOLE:
                outside += marker
                continue
            if (
                FIELD_OPERATOR_BEFORE.search(outside)
                and not item.numeric
                and not (_is_unquotable(item.node) and not item.spec)
            ):
                offenders.append(item.node)
            outside += marker
            continue
        for ch in item:
            if quote is not None:
                if escaped:
                    escaped = False
                elif ch == "\\":
                    escaped = True
                elif ch == quote:
                    quote = None
                    closed, trailing = (literal_before, literal_holes), ""
                    outside += PLACEHOLDER
                continue
            if ch in "\"'":
                settle_closed()
                quote, literal_before, literal_holes = ch, outside, []
                continue
            outside += ch
            if closed is not None:
                trailing += ch
    if quote is not None:  # still open at the end: judge it on the operator before it
        closed, trailing = (literal_before, literal_holes), ""
    settle_closed()
    return offenders


def _is_log_call(node: ast.Call) -> bool:
    return (
        isinstance(node.func, ast.Attribute)
        and (node.func.attr in LOG_METHODS or node.func.attr.startswith("log_"))
        and "log" in _terminal_name(node.func.value).lower()
    )


def _hole_children(template: Template) -> list[ast.expr]:
    return [item.node for item in template if isinstance(item, Hole)]


def unescaped_filter_interpolations(source: str) -> list[int]:
    """Line numbers of filter values that could rewrite the filter."""
    offenders: list[ast.expr] = []

    def visit(node: ast.AST, *, log_message: bool = False) -> None:
        if isinstance(node, ast.expr):
            template = _template(node)
            if template is not None:
                # A log call's own message is not a filter, but a filter built
                # inside one of its values still is.
                if not log_message:
                    offenders.extend(_template_offenders(template))
                for child in _hole_children(template):
                    visit(child)
                return
        if isinstance(node, ast.Call) and _is_log_call(node):
            visit(node.func)
            for arg in node.args:
                visit(arg, log_message=True)
            for kw in node.keywords:
                visit(kw.value)
            return
        for sub in ast.iter_child_nodes(node):
            visit(sub)

    visit(ast.parse(source))
    return sorted({node.lineno for node in offenders})


def _scanned_files() -> list[Path]:
    files = []
    for top in SCANNED_DIRS:
        for path in sorted((REPO_ROOT / top).rglob("*.py")):
            parts = path.relative_to(REPO_ROOT).parts
            if "tests" in parts or "node_modules" in parts:
                continue
            files.append(path)
    return files


def test_no_filter_interpolates_an_unescaped_value() -> None:
    files = _scanned_files()
    assert files, "the guard scanned nothing"
    offenders = []
    for path in files:
        source = path.read_text()
        lines = source.splitlines()
        for lineno in unescaped_filter_interpolations(source):
            offenders.append(f"{path.relative_to(REPO_ROOT)}:{lineno}: {lines[lineno - 1].strip()}")
    assert offenders == [], (
        f"{len(offenders)} filter value(s) can rewrite their filter. Wrap a quoted value in "
        "pb_escape(...), and coerce an unquoted one with int(...):\n"
    ) + "\n".join(offenders)


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
        # Built without an f-string.
        "{'filter': 'person = \"' + person_pb_id + '\"'}",
        "'id = \"' + f'{x}\"'",
        "'scenario = \"{}\"'.format(scenario_id)",
        "'scenario = \"{s}\"'.format(s=scenario_id)",
        "\"first_name = '%s'\" % name",
        "\"first_name = '%s' && last_name = '%s'\" % (pb_escape(a), b)",
        "'scenario = \"X\"'.replace('X', v)",
        # A quote character earlier in the literal, or the literal on the left.
        'f"title ~ \\"don\'t {needle}\\""',
        "f'\"{scenario_id}\" = scenario'",
        # A format spec or conversion can cut pb_escape's output mid-escape.
        "f'name = \"{pb_escape(name):.20}\"'",
        "f'name = \"{pb_escape(name)!r}\"'",
        # A filter nested inside a log call is still a filter.
        "logger.info(pb.get(f'id = \"{x}\"'))",
        "logger.info('n=%s', pb.collection('c').get_list(1, 1, {'filter': f'id = \"{rid}\"'}))",
        # The field or the operator is itself a hole: the value is still a value.
        "f'{field} {op} \"{scenario_id}\"'",
        "f'{field} != \"{x}\"'",
        "f'year = {year} && {field} {op} \"{x}\"'",
        "f'(name {op} \"{x}\")'",
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
        "logger.info('x = \\'%s\\'', name)",
        'logger.info("x = \'" + name + "\'")',
        "'id = \"' + pb_escape(x) + '\"'",
        "'scenario = \"{}\"'.format(pb_escape(s))",
        "\"name = '%s'\" % pb_escape(n)",
        '"year = %d" % year',
        '"(" + " || ".join(terms) + ")"',
        "f'Found \"{name}\" in {count} rows'",
        "f'Found {count} {kind} for \"{name}\"'",
    ],
)
def test_guard_passes_escaped_or_unquoted_values(snippet: str) -> None:
    assert unescaped_filter_interpolations(snippet) == []


@pytest.mark.parametrize(
    "snippet",
    [
        # An unquoted value needs no quote to break out of, so it must be an int.
        "f'scenario = {scenario_id}'",
        "f'scenario = {q}{x}{q}'",
        "'scenario = ' + scenario_id",
        "'scenario = %s' % scenario_id",
        "'scenario = {}'.format(scenario_id)",
        "f'flag = {str(flag).lower()}'",
        "f'cm_id = {sid}'",
        # Arithmetic is a number only when every operand is: `+` and `*` also
        # build a str from a str.
        "f'scenario = {PREFIX + scenario_id}'",
        "f'scenario = {scenario_id * 1}'",
        "f'cm_id = {\"x\" + name}'",
        'f\'cm_id = {"x" + ("y" + name)}\'',
        # The field or the operator is itself a hole.
        "{'filter': f'{field} = {scenario_id}'}",
        "f'{a} {op} {b}'",
        "f' && {field} = {sid}'",
        "f'({field} >= {at})'",
    ],
)
def test_guard_flags_an_unquoted_value_that_is_not_an_int(snippet: str) -> None:
    assert unescaped_filter_interpolations(snippet) != []


@pytest.mark.parametrize(
    "snippet",
    [
        "f'year = {year}'",
        "f'year = {int(year)} && cm_id = {session_cm_id}'",
        "f'year >= {year - 1} && year <= {int(year) + 1}'",
        "f'year = {ctx.year} && bunk.cm_id = {bunk_cm_id}'",
        "f'final_confidence >= {min_confidence}'",
        "f'cm_id = {int(sid)}'",
        "f\"phase3_triggered = {'true' if flag else 'false'}\"",
        "constraint_logger.log_feasibility_warning(f'capacity >= {group_size}')",
        # A hole field or operator holds the value to the same rule.
        "f'{field} = {int(i)}'",
        "f' && {field} = {int(session_cm_id)}'",
        "f'{a} {op} {int(b)}'",
        "f'{field} ~ \"{pb_escape(needle)}\"'",
        "f'{field} {op} \"{pb_escape(x)}\"'",
    ],
)
def test_guard_passes_an_unquoted_int(snippet: str) -> None:
    assert unescaped_filter_interpolations(snippet) == []


def test_guard_scans_the_source_tree() -> None:
    files = _scanned_files()
    assert len(files) > 100
    assert all("tests" not in path.relative_to(REPO_ROOT).parts for path in files)


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

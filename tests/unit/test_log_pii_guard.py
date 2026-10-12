"""Logs at INFO and above carry CampMinder IDs, never camper names or request text.

Production runs ``LOG_LEVEL=INFO``. What the API writes at that level lands in
the container's stdout, and the solver's run logs are also persisted as JSON
under ``logs/solver/`` (a mounted volume). Both are readable by anyone with
host access, outside the app's RBAC -- so the convention, already followed by
the Go sync, is that a log line names a person by CampMinder ID and the name
stays in the database. DEBUG and TRACE are exempt: they are opt-in diagnostic
levels, off in production.

The solver's ``ConstraintLogger`` methods are checked at every level, because
everything they record is written to the persisted run log whatever the
logging level.

This is a static guard: it walks the AST of every module under ``api/`` and
``bunking/`` and fails on a logging call whose arguments reference a
person-name or free-text identifier.
"""

from __future__ import annotations

import ast
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SCANNED_ROOTS = ("api", "bunking")

# Logger methods that emit at INFO or above. `.debug`, `.trace` and
# `.log(TRACE, ...)` are deliberately absent.
LOGGER_LEVEL_METHODS = frozenset({"info", "warning", "warn", "error", "exception", "critical"})

# ConstraintLogger methods: everything they record is persisted to the run log.
CONSTRAINT_LOGGER_METHODS = frozenset({"log_constraint", "log_violation", "log_feasibility_warning", "log_progress"})

# Identifiers (variables, attributes or dict keys) that hold a person's name or
# the free text a family wrote.
NAME_IDENTIFIERS = frozenset(
    {
        "first_name",
        "last_name",
        "preferred_name",
        "full_name",
        "person_name",
        "requester_name",
        "requestee_name",
        "target_name",
        "target_names",
        "request_text",
        "req_text",
        "raw_text",
        "name_text",
        "normalized_name",
    }
)

# `<var>.name` is a person's name when <var> is one of these.
PERSON_VARIABLES = frozenset({"person", "p", "camper", "attendee", "candidate", "best_candidate"})

# Bare variables that hold a person's name in most logging contexts.
NAME_LIKE_VARIABLES = frozenset({"name", "target"})

# (path, enclosing function, identifier) -> why that use is not a person.
EXEMPT: dict[tuple[str, str, str], str] = {
    (
        "bunking/sync/bunk_request_processor/integration/provider_factory.py",
        "register_provider",
        "name",
    ): "an AI provider's registry key",
    (
        "bunking/sync/bunk_request_processor/orchestrator/orchestrator.py",
        "_validate_target_names_in_source",
        "target",
    ): "only logged once matched against UNIT_NAMES, so it is a cabin unit",
}


def _receiver_name(func: ast.Attribute) -> str:
    value = func.value
    if isinstance(value, ast.Name):
        return value.id
    if isinstance(value, ast.Attribute):
        return value.attr
    return ""


def _is_checked_call(node: ast.Call) -> bool:
    func = node.func
    if not isinstance(func, ast.Attribute):
        return False
    if func.attr in CONSTRAINT_LOGGER_METHODS:
        return True
    return func.attr in LOGGER_LEVEL_METHODS and "log" in _receiver_name(func).lower()


def _flagged_identifiers(node: ast.Call) -> list[str]:
    found: list[str] = []
    for arg in [*node.args, *(kw.value for kw in node.keywords)]:
        for sub in ast.walk(arg):
            if isinstance(sub, ast.Name) and (sub.id in NAME_IDENTIFIERS or sub.id in NAME_LIKE_VARIABLES):
                found.append(sub.id)
            elif isinstance(sub, ast.Attribute):
                if sub.attr in NAME_IDENTIFIERS:
                    found.append(sub.attr)
                elif sub.attr == "name" and isinstance(sub.value, ast.Name) and sub.value.id in PERSON_VARIABLES:
                    found.append(f"{sub.value.id}.name")
            elif (
                isinstance(sub, ast.Subscript)
                and isinstance(sub.slice, ast.Constant)
                and sub.slice.value in NAME_IDENTIFIERS
            ):
                found.append(str(sub.slice.value))
    return found


class _LoggingCallVisitor(ast.NodeVisitor):
    """Collects flagged logging calls, each attributed to its innermost function."""

    def __init__(self, rel: str) -> None:
        self.rel = rel
        self.function_stack: list[str] = ["<module>"]
        self.violations: list[str] = []

    def _visit_function(self, node: ast.FunctionDef | ast.AsyncFunctionDef) -> None:
        self.function_stack.append(node.name)
        self.generic_visit(node)
        self.function_stack.pop()

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self._visit_function(node)

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        self._visit_function(node)

    def visit_Call(self, node: ast.Call) -> None:
        if _is_checked_call(node):
            func_name = self.function_stack[-1]
            for ident in _flagged_identifiers(node):
                if (self.rel, func_name, ident) not in EXEMPT:
                    self.violations.append(f"{self.rel}:{node.lineno} ({func_name}) logs {ident}")
        self.generic_visit(node)


def _violations() -> list[str]:
    violations: list[str] = []
    for root in SCANNED_ROOTS:
        for path in sorted((REPO_ROOT / root).rglob("*.py")):
            rel = path.relative_to(REPO_ROOT).as_posix()
            visitor = _LoggingCallVisitor(rel)
            visitor.visit(ast.parse(path.read_text(encoding="utf-8"), filename=rel))
            violations.extend(visitor.violations)
    return sorted(set(violations))


def test_no_names_or_request_text_in_info_plus_logs() -> None:
    violations = _violations()
    assert not violations, (
        "Log lines at INFO+ (and every ConstraintLogger record) must identify a person by "
        "CampMinder ID, not by name or the text a family wrote:\n  " + "\n  ".join(violations)
    )


def test_guard_flags_the_shapes_it_claims_to() -> None:
    """The guard itself must fire on each shape, or a green run proves nothing."""
    source = (
        "def f(person, req, row):\n"
        "    logger.info(f'{person.name}')\n"
        "    logger.warning('%s', req.requester_name)\n"
        "    log.error(row['target_name'])\n"
        "    self.constraint_logger.log_violation('x', f'{first_name}')\n"
        "    logger.debug(f'{person.name}')\n"
    )
    call_nodes = [n for n in ast.walk(ast.parse(source)) if isinstance(n, ast.Call) and _is_checked_call(n)]
    flagged = [ident for n in call_nodes for ident in _flagged_identifiers(n)]
    assert flagged == ["person.name", "requester_name", "target_name", "first_name"]

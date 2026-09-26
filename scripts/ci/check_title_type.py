#!/usr/bin/env python3
"""Hold a PR title's type to what its changed files can possibly change.

Three types are decidable from the file list alone: `ci` (CI and release
machinery), `chore` (agent and dev tooling) and `test` (tests only). When EVERY
changed file falls in those categories, the title's type must match; a PR that
touches anything else is left to judgment. The 2026-09 commit-type audit found
all three routinely mistyped -- CI repairs titled `fix`, tooling repairs titled
`fix`, test-only PRs titled `fix(tests)` -- which put work that ships nothing
into the release notes, and could bump a version.

Runs inside the required `Validate PR title` job. Reads the PR title from
PR_TITLE, its labels (a JSON list) from PR_LABELS, and the changed paths one per
line on stdin. The `type-override` label waives the check.

Pure stdlib, and no `PurePosixPath.full_match`: the runner's system Python may
predate 3.13.
"""

import json
import os
import re
import sys

OVERRIDE_LABEL = "type-override"

# First match wins, so agent guidance under tests/ (tests/CLAUDE.md) reads as
# tooling, not as a test.
CATEGORIES: list[tuple[str, list[re.Pattern[str]]]] = [
    (
        "harness",
        [
            re.compile(p)
            for p in (
                r"^\.claude/",
                r"(^|/)CLAUDE\.md$",
                r"^AGENTS\.md$",
                r"^\.lefthook\.yml$",
                r"^\.coderabbit\.yaml$",
                r"^scripts/worktree/",
            )
        ],
    ),
    (
        "ci",
        [
            re.compile(p)
            for p in (
                r"^\.github/",
                r"^scripts/ci/",
                r"^(cliff\.toml|renovate\.json|zizmor\.yml|commitlint\.config\.js)$",
            )
        ],
    ),
    (
        "tests",
        [re.compile(p) for p in (r"^tests/", r"\.test\.tsx?$", r"_test\.go$", r"(^|/)conftest\.py$")],
    ),
]

DESCRIPTIONS = {
    frozenset({"ci"}): "CI or release machinery",
    frozenset({"chore"}): "agent or dev tooling",
    frozenset({"test"}): "a test",
    frozenset({"ci", "chore"}): "CI machinery or agent tooling",
}

TYPE = re.compile(r"^([a-z]+)(?:\([^)]*\))?!?: ")


def _category(path: str) -> str | None:
    for name, patterns in CATEGORIES:
        if any(p.search(path) for p in patterns):
            return name
    return None


def required_types(files: list[str]) -> set[str] | None:
    """The types the file list allows, or None when the files decide nothing."""
    cats = {_category(f) for f in files}
    if not files or None in cats:
        return None
    if cats == {"tests"}:
        return {"test"}
    if cats <= {"ci", "tests"}:
        return {"ci"}
    if cats <= {"harness", "tests"}:
        return {"chore"}
    return {"ci", "chore"}


def check(title: str, files: list[str], labels: list[str]) -> tuple[bool, str]:
    """(passes, message). The message is empty when the files decide nothing."""
    if title.startswith("Revert") or title.startswith("revert"):
        return True, "A revert keeps the type of what it reverts; not checked."
    required = required_types(files)
    if required is None:
        return True, ""
    if OVERRIDE_LABEL in labels:
        return True, f"Type-vs-files check waived by the `{OVERRIDE_LABEL}` label."
    m = TYPE.match(title)
    actual = m.group(1) if m else None
    if actual in required:
        return True, ""
    allowed = " or ".join(f"`{t}`" for t in sorted(required))
    return False, (
        f"Every changed file is {DESCRIPTIONS[frozenset(required)]}, so the type must be {allowed}, "
        f"not `{actual}`. Types by effect: docs/reference/commit-conventions.md. "
        f"If the files mislead, add the `{OVERRIDE_LABEL}` label."
    )


def main() -> int:
    title = os.environ.get("PR_TITLE", "")
    labels = json.loads(os.environ.get("PR_LABELS") or "[]")
    files = [line.strip() for line in sys.stdin if line.strip()]
    ok, message = check(title, files, labels)
    if ok:
        if message:
            print(message)
        return 0
    print(f"::error title=PR title type::{message}")
    return 1


if __name__ == "__main__":
    sys.exit(main())

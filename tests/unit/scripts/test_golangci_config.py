"""A linter must not be switched off tree-wide to silence one package.

kindred#2664 bumped golangci-lint 2.9.0 -> 2.13.2 (required: 2.9.0 panics
outright on a `go 1.27` module, which PocketBase 0.40 forced). That carried
`goconst` 1.8.2 -> 1.11.0, whose 1.11 release began checking composite
literals, and 468 findings appeared on a tree the old pin called clean. The
bump suppressed them with a global `exclude-types: [Call, CompositeLit]`.

Two things about that suppression are worth pinning here rather than
rediscovering:

1. `exclude-types` filters **counted occurrences**, not just reported ones.
   Measured with a probe package: a string appearing twice in assignments and
   three times in composite literals reports "5 occurrences" with CompositeLit
   counted, and is **completely silent** without it -- the total drops below
   `min-occurrences: 3`, so the two assignment sites go unflagged too. A
   global exclusion is therefore wider than it reads.

2. The 468 are not spread across the tree. 460 are in `sync/`, whose CampMinder
   query params, JSON keys and CSV headers are schema vocabulary that reads
   better as literals (kindred#2665 argues that case at length). `sync/` already
   carries path-scoped exclusions for `gocyclo`, `dupl` and `revive` on exactly
   this "inherently repetitive package" reasoning.

So the policy these tests hold: narrow by path, where the exclusion names the
package it is for and the rule keeps working everywhere else. Never by killing
the check for the whole module.

kindred#2665 tracks the `sync/` backlog itself.
"""

import subprocess
from pathlib import Path
from typing import Any

import yaml

REPO_ROOT = Path(__file__).parents[3]
CONFIG = REPO_ROOT / ".golangci.yml"

# goconst's own default. Restating it in `exclude-types` is required -- setting
# the key at all replaces the default rather than adding to it -- so it is the
# one value that does not represent a deliberate narrowing.
GOCONST_DEFAULT_EXCLUDE_TYPES = {"Call"}

# The one package goconst is allowed to skip, and the issue that owns undoing it.
GOCONST_EXCLUDED_PACKAGES = {"sync"}


def _config() -> dict[str, Any]:
    loaded: dict[str, Any] = yaml.safe_load(CONFIG.read_text())
    return loaded


def _exclusion_rules() -> list[dict[str, Any]]:
    rules: list[dict[str, Any]] = _config()["linters"]["exclusions"].get("rules", [])
    return rules


def _rules_disabling(linter: str) -> list[dict[str, Any]]:
    return [r for r in _exclusion_rules() if linter in r.get("linters", [])]


def _go_packages() -> set[str]:
    """Top-level package directories under pocketbase/ that hold tracked .go files."""
    out = subprocess.run(
        ["git", "ls-files", "pocketbase/*.go", "pocketbase/**/*.go"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=True,
    ).stdout.split()
    packages = set()
    for path in out:
        parts = path.split("/")
        if len(parts) > 2:
            packages.add(parts[1])
    return packages


def test_goconst_is_not_disabled_tree_wide() -> None:
    """No global `exclude-types` beyond goconst's own default.

    Excluding a type suppresses counting, so a global entry silences the rule
    at call sites it does not even name. Narrow by path instead.
    """
    exclude_types = set(_config()["linters"]["settings"]["goconst"].get("exclude-types", []))
    extra = exclude_types - GOCONST_DEFAULT_EXCLUDE_TYPES
    assert not extra, (
        f".golangci.yml excludes goconst type(s) {sorted(extra)} for the whole module. "
        "exclude-types filters counted occurrences, so this also silences findings at "
        "assignments, case clauses and comparisons that share the string. If one package "
        "is the problem, add it to the path-scoped exclusions instead."
    )


def test_goconst_skips_exactly_the_packages_we_said_it_could() -> None:
    """The blast radius of the goconst exclusion, asserted against the tree.

    Widening it to another package has to happen here too, with a reason --
    which is the point. Fails equally if `sync/` is ever un-excluded without
    this file following.
    """
    packages = _go_packages()
    # Both are named so the walk below is known to be exercising something: `sync`
    # is the excluded one, `lodging` a package that must stay covered.
    assert "sync" in packages, f"package layout changed unexpectedly; found {sorted(packages)}"
    assert "lodging" in packages, f"package layout changed unexpectedly; found {sorted(packages)}"

    excluded = set()
    for rule in _rules_disabling("goconst"):
        path = rule.get("path", "")
        for package in packages:
            if path.startswith(f"{package}/"):
                excluded.add(package)

    assert excluded == GOCONST_EXCLUDED_PACKAGES, (
        f"goconst is path-excluded from {sorted(excluded)}, expected "
        f"{sorted(GOCONST_EXCLUDED_PACKAGES)}. Every other Go package -- "
        f"{sorted(packages - GOCONST_EXCLUDED_PACKAGES)} -- must keep the rule live."
    )


def test_noctx_is_excluded_from_tests_by_message_not_wholesale() -> None:
    """The known test-file noise is one message; the linter has others.

    golangci-lint 2.11 carried noctx 0.5.0, which began flagging
    `httptest.NewRequest`. All 22 findings in this repo's tests are that one
    message, and passing a context to a request a test builds and serves
    in-process buys nothing. Excluding the whole linter for `_test.go` would
    also hide a real one -- an un-contexted `http.Get` in a test helper that
    talks to something. Scope it by text, as the `revive`/`unused-parameter`
    exclusion beside it already does.
    """
    rules = _rules_disabling("noctx")
    assert rules, ".golangci.yml no longer excludes noctx anywhere; drop this test if that is deliberate"
    for rule in rules:
        assert rule.get("text"), (
            f"the noctx exclusion for path {rule.get('path')!r} disables the whole linter. "
            "Give it a `text:` naming the message it is for, so an unrelated noctx "
            "finding in a test still reports."
        )

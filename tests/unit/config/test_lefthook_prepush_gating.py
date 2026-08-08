"""Guard test for kindred#1937: pre-push `glob:` keys never gate.

lefthook 2.1.6's pre-push commands never observe what is actually being
*pushed* — the only file query lefthook issues in a pre-push run is
`git diff --name-only --cached`, which is empty on a normal push (nothing is
staged at push time). That makes `{files}` empty and `{push_files}` fall
back to "every tracked file in the repo", so every `glob:` pattern matches
and every command runs regardless of what the branch actually touched.
Measured directly against lefthook 2.1.6 in kindred#1937: a single-commit,
markdown-only branch still ran `go-build`.

The fix is `skip: - run: "..."` conditions computed over the actual push
range (`origin/main...HEAD`, three-dot/merge-base form — two-dot misreports
once `main` moves), matching the in-repo precedent (`shellcheck` already
guards itself with a `skip: - run:` condition for a missing binary). This
test pins that every pre-push command scoped to a language/file-type by a
`glob:` key also carries a skip condition computed over the three-dot push
range, so a branch that never touched Python doesn't pay for `pytest`/`mypy`,
a branch that never touched Go doesn't pay for `go-build`, etc.

`behind-origin` is legitimately exempt: it isn't gated by file type at all
(gated by `only: - ref: main`) and its entire job *is* to inspect the
relationship to `origin/main`, so requiring it to skip based on that same
relationship would be circular.
"""

from pathlib import Path
from typing import Any

import yaml

REPO_ROOT = Path(__file__).resolve().parents[3]
LEFTHOOK_CONFIG = REPO_ROOT / ".lefthook.yml"

# Commands whose job is inherently "compare against origin/main" — requiring
# a skip condition over that same range would be circular, not a gating bug.
EXEMPT_FROM_GATING = {"behind-origin"}


def _load_prepush_commands() -> dict[str, Any]:
    config = yaml.safe_load(LEFTHOOK_CONFIG.read_text())
    return dict(config["pre-push"]["commands"])


def _skip_run_strings(command: dict[str, Any]) -> list[str]:
    skip = command.get("skip") or []
    return [entry["run"] for entry in skip if "run" in entry]


def test_every_language_scoped_prepush_command_has_a_skip_condition():
    """Every `glob:`-scoped pre-push command must also carry a `skip:` list.

    Without this, the glob is decorative: lefthook's push_files fallback
    (every tracked file) satisfies any glob, so the command always runs.
    """
    commands = _load_prepush_commands()
    scoped = {name: cmd for name, cmd in commands.items() if "glob" in cmd and name not in EXEMPT_FROM_GATING}
    # Sanity: this is meant to cover the commands #1937 measured (9 of 10).
    assert len(scoped) >= 9, f"expected >=9 glob-scoped commands, found {sorted(scoped)}"

    missing_skip = [name for name, cmd in scoped.items() if not cmd.get("skip")]
    assert not missing_skip, (
        f"pre-push commands with a `glob:` but no `skip:` gate never actually gate (kindred#1937): {missing_skip}"
    )


def test_every_gating_skip_condition_uses_the_three_dot_push_range():
    """Each skip condition that computes a diff range must use `origin/main...HEAD`.

    Three-dot (merge-base) form is required — two-dot (`origin/main..HEAD`)
    misreports the push range once `main` has moved ahead independently.
    A skip condition unrelated to the push range (e.g. shellcheck's
    "is the binary installed?" check) is fine alongside it; what matters is
    that *at least one* skip entry gates on the correct diff range.
    """
    commands = _load_prepush_commands()
    scoped = {name: cmd for name, cmd in commands.items() if "glob" in cmd and name not in EXEMPT_FROM_GATING}

    bad = {}
    for name, cmd in scoped.items():
        runs = _skip_run_strings(cmd)
        three_dot = [r for r in runs if "origin/main...HEAD" in r]
        # Flag any run condition that uses the two-dot form as a diff range
        # (a common typo'd downgrade of the three-dot form) without also
        # having a correct three-dot entry present.
        two_dot_only = [r for r in runs if "origin/main..HEAD" in r and "origin/main...HEAD" not in r]
        if not three_dot or two_dot_only:
            bad[name] = runs
    assert not bad, (
        "pre-push commands must gate on the three-dot merge-base range "
        f"'origin/main...HEAD', not omit it or use the two-dot form: {bad}"
    )


def test_gating_skip_conditions_are_inverted_greps_over_the_diff():
    """Skip conditions must be `... && ! git diff ... | grep -qE '<pattern>'`.

    This is the shape lefthook needs: `skip:` runs the command when the
    condition is FALSE, so "skip unless the diff matches" is spelled with a
    leading `!` on the diff/grep pipeline.
    """
    commands = _load_prepush_commands()
    scoped = {name: cmd for name, cmd in commands.items() if "glob" in cmd and name not in EXEMPT_FROM_GATING}

    malformed = {}
    for name, cmd in scoped.items():
        runs = _skip_run_strings(cmd)
        gating_runs = [r for r in runs if "origin/main...HEAD" in r]
        for r in gating_runs:
            if "! git diff --name-only origin/main...HEAD" not in r:
                malformed[name] = r
            if "grep -qE" not in r:
                malformed[name] = r
    assert not malformed, f"malformed gating skip conditions: {malformed}"


def test_gating_skip_conditions_fail_open_when_origin_main_is_unresolvable():
    """Each gating skip condition must fetch + verify `origin/main` exists
    before trusting a diff against it, and must NOT skip (i.e. must run the
    check) if that verification fails.

    Without this, a missing/unfetched `origin/main` makes
    `git diff --name-only origin/main...HEAD` fail with no stdout, which
    `grep -qE` then reports as "no match" — silently SKIPPING every
    language-scoped check instead of running them. That is the same
    false-green failure family already flagged in this repo (rtk's "ok" on
    a rejected push, `lefthook run pre-push` exiting 0 with nothing to
    push): failing to determine an answer must never look like "no work to
    do".
    """
    commands = _load_prepush_commands()
    scoped = {name: cmd for name, cmd in commands.items() if "glob" in cmd and name not in EXEMPT_FROM_GATING}

    unsafe = {}
    for name, cmd in scoped.items():
        runs = _skip_run_strings(cmd)
        gating_runs = [r for r in runs if "origin/main...HEAD" in r]
        for r in gating_runs:
            has_fetch = "git fetch origin main" in r
            has_existence_guard = "git rev-parse -q --verify origin/main" in r
            # The existence guard must gate (via &&) the diff/grep pipeline,
            # so a failed guard short-circuits to a non-zero (run) result
            # rather than falling through to a diff that would fail closed.
            guards_the_pipeline = bool(has_existence_guard and "&& ! git diff --name-only origin/main...HEAD" in r)
            if not (has_fetch and has_existence_guard and guards_the_pipeline):
                unsafe[name] = r
    assert not unsafe, (
        f"gating skip conditions must fetch+verify origin/main and fail "
        f"open (run, not skip) when it can't be resolved: {unsafe}"
    )


def test_behind_origin_is_not_incorrectly_exempted():
    """Guard the exemption list itself: `behind-origin` must still exist and
    still be the *only* glob-less pre-push command, so the exemption isn't
    silently covering up a future gating bug on a different command.
    """
    commands = _load_prepush_commands()
    glob_less = [name for name, cmd in commands.items() if "glob" not in cmd]
    assert glob_less == ["behind-origin"], f"expected only 'behind-origin' to lack a glob; found: {glob_less}"

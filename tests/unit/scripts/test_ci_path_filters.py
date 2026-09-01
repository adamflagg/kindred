"""Every CI job's paths-filter must be able to fire on the job's own inputs.

A job whose gate cannot match the files it checks does not go red when those
files break -- it goes *skipped*, and `ci-summary` counts a skipped job as OK.
That is the same false-green shape as the `go` filter fixed in kindred#2652,
where `go.mod`/`go.sum` were listed at the repo root and the module actually
lives at `pocketbase/go.mod`, so every Dependabot Go bump ran zero Go tests.

`tests/unit/scripts/test_go_test_shard.py` owns the Go half of this. This file
owns the Python half, filed as kindred#2653.

Matching uses `PurePosixPath.full_match`, whose semantics line up with the
picomatch globbing `dorny/paths-filter` uses for the pattern forms in this
workflow -- notably `config/*.json` matches `config/a.json` but not
`config/sub/a.json`.
"""

import re
import subprocess
from pathlib import Path, PurePosixPath
from typing import Any

import yaml

REPO_ROOT = Path(__file__).parents[3]
CI_WORKFLOW = REPO_ROOT / ".github/workflows/ci.yml"


def _ci() -> dict[str, Any]:
    wf = yaml.safe_load(CI_WORKFLOW.read_text())
    assert isinstance(wf, dict)
    return wf


def _filters() -> dict[str, list[str]]:
    step = _ci()["jobs"]["detect-changes"]["steps"][1]
    parsed = yaml.safe_load(step["with"]["filters"])
    assert isinstance(parsed, dict)
    return parsed


def _gating_filters(job: str) -> list[str]:
    """The detect-changes outputs a job's `if:` actually reads.

    Derived from the expression rather than hardcoded, so renaming the filter a
    job gates on cannot silently orphan these assertions.
    """
    expr = _ci()["jobs"][job]["if"]
    names = re.findall(r"needs\.detect-changes\.outputs\.(\w+)", expr)
    assert names, f"{job} has no detect-changes gate: {expr!r}"
    return names


def _patterns_gating(job: str) -> list[str]:
    filters = _filters()
    pats: list[str] = []
    for name in _gating_filters(job):
        pats.extend(filters[name])
    return pats


def _matches(path: str, patterns: list[str]) -> bool:
    p = PurePosixPath(path)
    return any(p.full_match(pat) for pat in patterns)


def _tracked(*globs: str) -> list[str]:
    out = subprocess.run(
        ["git", "ls-files", *globs],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=True,
    ).stdout.split()
    assert out, f"no tracked files for {globs}"
    return out


def _json_validation_globs() -> list[str]:
    """The globs the `JSON config validation` step iterates, read from the step.

    Deriving them beats hardcoding: if someone adds a third directory to that
    loop, this picks it up and demands the filter cover it too.
    """
    steps = _ci()["jobs"]["python-lint"]["steps"]
    run = next(st["run"] for st in steps if st.get("name") == "JSON config validation")
    m = re.search(r"for f in (.+?); do", run)
    assert m, f"could not read the glob list out of the step: {run!r}"
    return m.group(1).split()


def test_python_lint_gate_covers_every_tracked_python_file():
    """`ruff format --check .`, `ruff check .` and `mypy .` lint the whole tree.

    python-lint gated on `backend`, which has no `tests/**`, so a tests-only PR
    was never formatted, linted or type-checked in CI. Observed live on #2652,
    which added four Python tests and reported `Python Lint: skipping`.
    """
    patterns = _patterns_gating("python-lint")
    uncovered = [f for f in _tracked("*.py") if not _matches(f, patterns)]
    assert not uncovered, f"{len(uncovered)} tracked .py files cannot trigger python-lint: {uncovered[:5]}"


def test_python_lint_gate_covers_its_non_python_inputs():
    """The job does more than ruff and mypy, and those steps have inputs too.

    `JSON config validation` reads config/*.json and bunking/*.json; the
    pip-audit step reads .pip-audit-ignore, so adding an ignored CVE there must
    be able to re-run the audit that consumes it.
    """
    patterns = _patterns_gating("python-lint")
    # A representative path per glob, not the files that happen to exist today:
    # `bunking/*.json` currently matches nothing, and the job should still be
    # able to fire on the first file added there.
    required = [g.replace("*", "sample") for g in _json_validation_globs()]
    required.append(".pip-audit-ignore")
    uncovered = [f for f in required if not _matches(f, patterns)]
    assert not uncovered, f"python-lint step inputs cannot trigger it: {uncovered}"


def test_python_lint_gate_covers_the_workflow_that_defines_it():
    """The steps, their order and their flags all live in ci.yml.

    Same reasoning the `go` filter already documents for itself: a PR that edits
    only this job would otherwise ship having never run it.
    """
    assert _matches(".github/workflows/ci.yml", _patterns_gating("python-lint"))


def test_python_lint_does_not_run_on_go_only_changes():
    """`backend` bundles `pocketbase/**`, so a Go-only PR ran the full Python lint.

    The gate should describe this job's inputs, not a filter meant for another.
    """
    patterns = _patterns_gating("python-lint")
    assert not _matches("pocketbase/sync/sync.go", patterns)
    assert not _matches("pocketbase/go.mod", patterns)


def test_tests_python_gate_covers_the_workflow_its_own_tests_assert_on():
    """These filter assertions live in the Python suite, gated on `python`.

    `python` watches no workflow file, so editing only ci.yml -- exactly the
    change these tests exist to police -- ran none of them.
    """
    assert _matches(".github/workflows/ci.yml", _patterns_gating("tests-python"))

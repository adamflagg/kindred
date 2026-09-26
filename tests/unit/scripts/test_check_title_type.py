"""The title check holds a PR's type to what its files can change.

Three types are decidable from the file list alone, and the 2026-09 audit found
all three routinely mistyped: 54 CI repairs titled `fix`, 20 dev-tooling
repairs titled `fix`, and test-only PRs titled `fix(tests)`, `refactor` or
`chore`. Each of those put work that ships nothing into the release notes, and
could bump a version.

So when EVERY changed file is CI machinery, agent tooling, or tests, the type
must say so. A PR that touches anything else is judged by a person, never by
this check. The `type-override` label is the escape hatch for the rare PR
whose files mislead.

`scripts/ci/check_title_type.py` runs inside the required `Validate PR title`
job; `test_commit_type_config.py` owns the workflow wiring.
"""

import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path
from types import ModuleType

import pytest

REPO_ROOT = Path(__file__).parents[3]
SCRIPT = REPO_ROOT / "scripts" / "ci" / "check_title_type.py"


def _load() -> ModuleType:
    spec = importlib.util.spec_from_file_location("check_title_type", SCRIPT)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


mod = _load()

CI = ".github/workflows/ci.yml"
CI_SCRIPT = "scripts/ci/check_renovate_managers.py"
HARNESS = ".claude/skills/grab-feedback/SKILL.md"
TEST = "tests/unit/scripts/test_ci_path_filters.py"
FRONTEND_TEST = "frontend/src/components/Card.test.tsx"
GO_TEST = "pocketbase/sync/persons_test.go"
APP = "frontend/src/components/Card.tsx"
DOC = "docs/reference/commit-conventions.md"


@pytest.mark.parametrize(
    ("files", "required"),
    [
        ([CI], {"ci"}),
        ([CI_SCRIPT, "cliff.toml", "renovate.json"], {"ci"}),
        ([CI, TEST], {"ci"}),
        ([HARNESS, "CLAUDE.md", "pocketbase/CLAUDE.md", ".lefthook.yml"], {"chore"}),
        ([HARNESS, TEST], {"chore"}),
        ([CI, HARNESS], {"ci", "chore"}),
        ([TEST, FRONTEND_TEST, GO_TEST], {"test"}),
        ([APP], None),
        ([CI, APP], None),
        ([CI, DOC], None),
        ([], None),
    ],
)
def test_required_types_follow_the_file_list(files: list[str], required: set[str] | None) -> None:
    assert mod.required_types(files) == required


@pytest.mark.parametrize(
    ("title", "files"),
    [
        ("fix(release): repair the tag step", [CI]),
        ("fix(scripts): repair a worktree script", [HARNESS]),
        ("fix(tests): unflake the path-filter test", [TEST]),
        ("perf(tests): shard the Go suite", [CI]),
        ("feat(harness): a new skill", [HARNESS]),
    ],
)
def test_a_type_the_files_contradict_fails(title: str, files: list[str]) -> None:
    ok, message = mod.check(title, files, labels=[])
    assert not ok
    assert "type-override" in message, "the failure must name the escape hatch"


@pytest.mark.parametrize(
    ("title", "files"),
    [
        ("ci: shard the Go suite", [CI]),
        ("ci(deps): bump actions/checkout from 6 to 7", [CI]),
        ("chore(harness): teach grab-feedback verbatim quotes", [HARNESS]),
        ("test(api): cover the empty roster", [TEST]),
        ("ci(release): pin git-cliff", [CI, TEST]),
        ("feat(frontend): a new panel", [APP]),
        ("fix(frontend): wrong count", [APP, TEST]),
    ],
)
def test_a_type_the_files_allow_passes(title: str, files: list[str]) -> None:
    ok, message = mod.check(title, files, labels=[])
    assert ok, message


@pytest.mark.parametrize("title", ['Revert "fix(release): repair the tag step"', "revert(release): undo it"])
def test_a_revert_keeps_the_type_of_what_it_reverts(title: str) -> None:
    ok, _ = mod.check(title, [CI], labels=[])
    assert ok


def test_the_override_label_waives_the_check() -> None:
    ok, message = mod.check("fix(release): repair the tag step", [CI], labels=["dependencies", "type-override"])
    assert ok
    assert "type-override" in message


def _run(title: str, files: list[str], labels: list[str]) -> subprocess.CompletedProcess[str]:
    env = {**os.environ, "PR_TITLE": title, "PR_LABELS": json.dumps(labels)}
    return subprocess.run(
        [sys.executable, str(SCRIPT)],
        input="\n".join(files) + "\n",
        env=env,
        capture_output=True,
        text=True,
    )


def test_cli_fails_with_an_actions_error_annotation() -> None:
    result = _run("fix(release): repair the tag step", [CI], [])
    assert result.returncode == 1
    assert result.stdout.startswith("::error"), result.stdout
    assert "`ci`" in result.stdout


def test_cli_passes_quietly_when_the_files_decide_nothing() -> None:
    result = _run("feat(frontend): a new panel", [APP, CI], [])
    assert result.returncode == 0, result.stdout + result.stderr

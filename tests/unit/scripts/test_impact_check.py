import sys
from pathlib import Path

import pytest
import yaml

from scripts.guide.impact_check import decide, has_docs_none, main, needs_docs

REPO = Path(__file__).resolve().parents[3]


@pytest.mark.parametrize(
    ("path", "expected"),
    [
        ("frontend/src/pages/camperships/AidTodayPage.tsx", True),
        ("frontend/src/pages/camperships/AidTodayPage.test.tsx", False),
        ("frontend/src/types/api-generated/types.gen.ts", False),
        ("frontend/src/lib/pocketbase-types.ts", False),
        ("frontend/src/test/setup.ts", False),
        ("frontend/src/test/test-utils.tsx", False),
        ("bunking/rbac/permissions.py", True),
        ("scripts/guide/facts.json", True),
        ("frontend/src/help/helpKeys.json", True),
        ("api/routers/financial_aid.py", True),
        ("tests/unit/test_x.py", False),
        (".github/workflows/ci.yml", False),
        ("bunking/solver/direct_solver.py", False),
    ],
)
def test_needs_docs(path, expected):
    assert needs_docs([path]) is expected


@pytest.mark.parametrize(
    ("body", "expected"),
    [
        ("Docs: none — internal refactor", True),
        ("Docs: none - internal refactor", True),
        ("Docs: none – internal refactor", True),
        ("Docs: none —", False),
        ("Docs: none —    ", False),
        ("```\nDocs: none — inside a fence\n```", False),
        ("~~~\nDocs: none — inside a tilde fence\n~~~", False),
        ("~~~\n```\n~~~\nDocs: none — after a tilde fence holding backticks", True),
        ("docs: none — lower case", False),
        ("Some text\nDocs: none — tooling only\nmore", True),
    ],
)
def test_has_docs_none(body, expected):
    assert has_docs_none(body) is expected


def test_decide():
    ui = ["frontend/src/pages/X.tsx"]
    assert decide(["tests/unit/a.py"], "", False) == (True, "no staff-visible files changed")
    assert decide(ui, "", True)[0] is True
    assert decide(ui, "Docs: none — tooling only", False)[0] is True
    ok, why = decide(ui, "", False)
    assert ok is False
    assert "Docs: none" in why


def test_cli_reads_one_changed_path_per_line(tmp_path, monkeypatch, capsys):
    changed = tmp_path / "changed.txt"
    changed.write_text("frontend/src/pages/My Page.tsx\n")
    body = tmp_path / "body.md"
    body.write_text("")
    argv = ["impact_check", "--changed-file", str(changed), "--body-file", str(body), "--paired-has-commits", "false"]
    monkeypatch.setattr(sys, "argv", argv)
    assert main() == 1
    assert capsys.readouterr().out.startswith("docs impact: FAIL")


# --- the CI job: report-only, body read at run time, silent about the guide --

_CI = yaml.safe_load((REPO / ".github/workflows/ci.yml").read_text())
_JOB = _CI["jobs"]["guide-impact"]


def test_guide_impact_job_is_report_only():
    assert _JOB["continue-on-error"] is True
    assert "guide-impact" not in _CI["jobs"]["summary"]["needs"]
    assert "pull_request" in _JOB["if"]


def test_guide_impact_never_interpolates_expressions_in_run():
    for step in _JOB["steps"]:
        assert "${{" not in step.get("run", ""), step.get("name")


def test_pr_body_and_branch_never_pass_through_step_env():
    # The runner prints every step `env:` entry in the public log header, so the
    # body (and the branch name) would be echoed there verbatim. Read both at run
    # time instead; that also lets a re-run see a body edited after the push.
    for job in ("guide-impact", "guide-build"):
        for step in _CI["jobs"][job]["steps"]:
            for value in (step.get("env") or {}).values():
                assert "pull_request.body" not in str(value), job
                assert "head_ref" not in str(value), job
    run = next(s["run"] for s in _JOB["steps"] if "run" in s)
    assert 'gh pr view "$PR_NUMBER"' in run
    assert "--json body" in run
    assert 'BRANCH="$GITHUB_HEAD_REF"' in run


def test_impact_script_runs_without_the_guide_secrets():
    run = next(s["run"] for s in _JOB["steps"] if "run" in s)
    assert "env -u GUIDE_READ_TOKEN -u GUIDE_REPO python3 -m scripts.guide.impact_check" in run


def test_guide_impact_does_not_name_the_guide_or_branch_in_output():
    run = next(s["run"] for s in _JOB["steps"] if "run" in s)
    for line in run.splitlines():
        if line.lstrip().startswith("echo"):
            assert "$GUIDE_REPO" not in line, line
            assert "$BRANCH" not in line, line
    assert "docs impact: skipped (could not list changed files)" in run
    assert "(no guide access: paired branch not checked)" in run

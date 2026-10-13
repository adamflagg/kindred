from pathlib import Path

import pytest
import yaml

from scripts.guide.impact_check import decide, has_docs_none, needs_docs

REPO = Path(__file__).resolve().parents[3]


@pytest.mark.parametrize(
    ("path", "expected"),
    [
        ("frontend/src/pages/camperships/AidTodayPage.tsx", True),
        ("frontend/src/pages/camperships/AidTodayPage.test.tsx", False),
        ("frontend/src/types/api-generated/types.gen.ts", False),
        ("frontend/src/lib/pocketbase-types.ts", False),
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


# --- the CI job: report-only, body only via env, silent about the guide ------

_CI = yaml.safe_load((REPO / ".github/workflows/ci.yml").read_text())
_JOB = _CI["jobs"]["guide-impact"]


def test_guide_impact_job_is_report_only():
    assert _JOB["continue-on-error"] is True
    assert "guide-impact" not in _CI["jobs"]["summary"]["needs"]
    assert "pull_request" in _JOB["if"]


def test_guide_impact_never_interpolates_expressions_in_run():
    for step in _JOB["steps"]:
        assert "${{" not in step.get("run", ""), step.get("name")


def test_pr_body_reaches_the_step_only_through_env():
    step = next(s for s in _JOB["steps"] if "run" in s)
    assert step["env"]["PR_BODY"] == "${{ github.event.pull_request.body }}"
    assert "pull_request.body" not in step["run"]
    assert "printf '%s' \"$PR_BODY\"" in step["run"]
    assert 'echo "$PR_BODY"' not in step["run"]


def test_guide_impact_does_not_name_the_guide_or_branch_in_output():
    run = next(s["run"] for s in _JOB["steps"] if "run" in s)
    for line in run.splitlines():
        if line.lstrip().startswith("echo"):
            assert "$GUIDE_REPO" not in line, line
            assert "$BRANCH" not in line, line
    assert "docs impact: skipped (could not list changed files)" in run
    assert "(no guide access: paired branch not checked)" in run

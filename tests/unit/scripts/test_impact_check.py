import subprocess
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
        ("frontend/src/pages/camperships/AidTodayPage.spec.tsx", False),
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
        # A fence closes only on the same character, at least as long, and bare.
        ("````\n```\nDocs: none — inside a four-backtick fence\n````", False),
        ("~~~~\n~~~\nDocs: none — inside a four-tilde fence\n~~~~", False),
        ("```\n````\nDocs: none — after a longer closing fence", True),
        ("```\n```js\nDocs: none — a fence line with an info string does not close\n```", False),
        ("```python\ncode\n```\nDocs: none — after a fence with an info string", True),
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


# --- the CI job: gates CI, body read at run time, silent about the guide -----

_CI = yaml.safe_load((REPO / ".github/workflows/ci.yml").read_text())
_JOB = _CI["jobs"]["guide-impact"]


def test_guide_impact_job_gates_ci():
    """Owner ruling 2026-10-14: a staff-visible PR must pair a guide branch or
    say `Docs: none — <reason>`, or CI Gate fails. It was report-only, and an
    agent's wrong `Docs: none` plus a hand-merged guide PR went unnoticed."""
    assert "continue-on-error" not in _JOB
    assert "guide-impact" in _CI["jobs"]["summary"]["needs"]
    assert "pull_request" in _JOB["if"]


@pytest.mark.parametrize("var", ["GUIDE_IMPACT", "GUIDE_BUILD"])
@pytest.mark.parametrize(
    ("result", "passes"),
    [("success", True), ("skipped", True), ("failure", False), ("cancelled", False)],
)
def test_ci_gate_verdict_on_the_guide_jobs(var: str, result: str, passes: bool) -> None:
    """Run the gate's real shell with every other job green. Skipped is fine:
    both jobs run only on same-repo PRs (a push or a fork PR skips them)."""
    step = _CI["jobs"]["summary"]["steps"][0]
    needs = {"GUIDE_IMPACT": "guide-impact", "GUIDE_BUILD": "guide-build"}[var]
    assert step["env"][var] == "${{ needs." + needs + ".result }}"
    env = dict.fromkeys(step["env"], "success")
    env |= {var: result, "EVENT_NAME": "pull_request", "PATH": "/usr/bin:/bin"}
    proc = subprocess.run(["bash", "-c", step["run"]], env=env, capture_output=True, text=True, check=False)
    assert (proc.returncode == 0) is passes, proc.stdout + proc.stderr


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
    assert "docs impact: could not list changed files" in run
    assert "docs impact: skipped (no guide access configured)" in run


# --- the job's real shell, with gh stubbed ----------------------------------

_FILES_CALL = 'gh api --paginate "repos/$GITHUB_REPOSITORY/pulls/$PR_NUMBER/files"'


def _run_impact(
    tmp_path: Path, *, secrets: bool, body: str = "", files: str = "", fail: str = ""
) -> tuple[subprocess.CompletedProcess[str], list[str]]:
    """Run guide-impact's run script with a fake gh. `fail` names the gh call
    ("view", "files") that exits non-zero; every call is logged."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    log = tmp_path / "gh.log"
    (tmp_path / "body.txt").write_text(body)
    (tmp_path / "files.txt").write_text(files)
    gh = bin_dir / "gh"
    gh.write_text(
        "#!/bin/bash\n"
        f'echo "$*" >> "{log}"\n'
        'case "$1 $2" in\n'
        f'  "pr view") [ "{fail}" = view ] && exit 1; cat "{tmp_path}/body.txt" ;;\n'
        f'  "api --paginate") [ "{fail}" = files ] && exit 1; cat "{tmp_path}/files.txt" ;;\n'
        "  api*) echo 0 ;;\n"
        "esac\n"
    )
    gh.chmod(0o755)
    env = {
        "PATH": f"{bin_dir}:/usr/bin:/bin",
        "RUNNER_TEMP": str(tmp_path),
        "GITHUB_HEAD_REF": "feature/x",
        "GITHUB_REPOSITORY": "owner/kindred",
        "PR_NUMBER": "7",
        "GH_TOKEN": "t",
    }
    if secrets:
        env |= {"GUIDE_REPO": "owner/guide", "GUIDE_READ_TOKEN": "g"}
    run = next(s["run"] for s in _JOB["steps"] if "run" in s)
    proc = subprocess.run(["bash", "-c", run], cwd=REPO, env=env, capture_output=True, text=True, check=False)
    calls = log.read_text().splitlines() if log.exists() else []
    return proc, calls


def test_no_guide_access_skips_before_reading_anything(tmp_path):
    """Dependabot gets no Actions secrets and cannot add a Docs: none line."""
    proc, calls = _run_impact(tmp_path, secrets=False, files="frontend/src/App.tsx\n")
    assert proc.returncode == 0, proc.stdout
    assert "docs impact: skipped (no guide access configured)" in proc.stdout
    assert calls == []


def test_an_unreadable_body_fails_closed(tmp_path):
    proc, _ = _run_impact(tmp_path, secrets=True, fail="view")
    assert proc.returncode == 1
    assert "docs impact: could not read the PR body" in proc.stdout


def test_an_unlistable_diff_fails_closed(tmp_path):
    proc, _ = _run_impact(tmp_path, secrets=True, body="x", fail="files")
    assert proc.returncode == 1
    assert "docs impact: could not list changed files" in proc.stdout


def test_changed_files_come_from_the_paginated_files_api(tmp_path):
    """`gh pr diff` gives up on very large PRs; the files API pages to 3,000."""
    run = next(s["run"] for s in _JOB["steps"] if "run" in s)
    assert _FILES_CALL in run
    assert "gh pr diff" not in run


def test_a_staff_visible_change_with_a_docs_none_line_passes(tmp_path):
    proc, _ = _run_impact(tmp_path, secrets=True, body="Docs: none — refactor only\n", files="frontend/src/App.tsx\n")
    assert proc.returncode == 0, proc.stdout
    assert "docs impact: pass" in proc.stdout


def test_a_staff_visible_change_with_no_answer_fails(tmp_path):
    proc, _ = _run_impact(tmp_path, secrets=True, body="no line\n", files="frontend/src/App.tsx\n")
    assert proc.returncode == 1
    assert "docs impact: FAIL" in proc.stdout

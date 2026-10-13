import os
import subprocess
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parents[3]
SCRIPT = REPO / "scripts/guide/build_guide.sh"


def _run(tmp_path, cmd):
    guide = tmp_path / "guide"
    (guide / "src/data").mkdir(parents=True)
    facts = tmp_path / "facts.json"
    facts.write_text('{"version": 1}\n')
    env = {**os.environ, "GUIDE_BUILD_CMD": cmd, "RUNNER_TEMP": str(tmp_path)}
    r = subprocess.run(["bash", str(SCRIPT), str(guide), str(facts)], capture_output=True, text=True, env=env)
    return r, guide


def test_pass_prints_only_pass_and_copies_facts(tmp_path):
    r, guide = _run(tmp_path, "true")
    assert r.returncode == 0
    assert r.stdout.strip() == "guide: pass"
    assert r.stderr == ""
    assert (guide / "src/data/facts.json").read_text() == '{"version": 1}\n'


def test_failure_prints_a_count_and_never_the_build_output(tmp_path):
    leaky = "echo 'error: Unknown permission key on page about Riley Sam' >&2; echo 'error: second'; exit 1"
    r, _ = _run(tmp_path, leaky)
    assert r.returncode == 1
    assert r.stdout.strip() == "guide: 2 errors"
    assert "Riley" not in r.stdout + r.stderr


def test_failure_with_no_error_lines_still_counts_at_least_one(tmp_path):
    r, _ = _run(tmp_path, "echo 'Riley Sam page broke'; exit 3")
    assert r.returncode == 1
    assert r.stdout.strip() == "guide: 1 errors"
    assert "Riley" not in r.stdout + r.stderr


# --- the CI job: report-only, and silent about the private repo -------------

import yaml

_CI = yaml.safe_load((REPO / ".github/workflows/ci.yml").read_text())


def test_guide_build_job_is_report_only():
    job = _CI["jobs"]["guide-build"]
    assert job["continue-on-error"] is True
    assert "guide-build" not in _CI["jobs"]["summary"]["needs"]


def test_guide_build_never_interpolates_expressions_in_run_and_silences_git():
    job = _CI["jobs"]["guide-build"]
    for step in job["steps"]:
        assert "${{" not in step.get("run", ""), step.get("name")
    run = next(s["run"] for s in job["steps"] if "run" in s)
    assert run.count(">/dev/null 2>&1") >= 2  # ls-remote and clone
    assert "guide: skipped (no guide access configured)" in run

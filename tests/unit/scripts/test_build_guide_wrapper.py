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


def test_facts_copy_failure_fails_loudly_with_one_quiet_line(tmp_path):
    guide = tmp_path / "guide"
    guide.mkdir()  # no src/data: the copy cannot succeed
    facts = tmp_path / "facts.json"
    facts.write_text("{}\n")
    env = {**os.environ, "GUIDE_BUILD_CMD": "true", "RUNNER_TEMP": str(tmp_path)}
    r = subprocess.run(["bash", str(SCRIPT), str(guide), str(facts)], capture_output=True, text=True, env=env)
    assert r.returncode == 1
    assert r.stdout.strip() == "guide: 1 errors"
    assert len(r.stdout.strip().splitlines()) == 1
    assert r.stderr == ""


# --- the CI job: gates CI, and silent about the private repo ----------------

_CI = yaml.safe_load((REPO / ".github/workflows/ci.yml").read_text())


def test_guide_build_job_gates_ci():
    """Owner ruling 2026-10-14: a PR that breaks the guide build (a page naming
    a key the PR removed) fails CI Gate. It still skips cleanly without the
    guide secrets, so Dependabot and fork PRs are not blocked."""
    job = _CI["jobs"]["guide-build"]
    assert "continue-on-error" not in job
    assert "guide-build" in _CI["jobs"]["summary"]["needs"]
    run = next(s["run"] for s in job["steps"] if "run" in s)
    skip = run.index("guide: skipped (no guide access configured)")
    assert run[skip:].split("\n", 2)[1].strip() == "exit 0"


def test_guide_build_never_interpolates_expressions_in_run_and_silences_git():
    job = _CI["jobs"]["guide-build"]
    for step in job["steps"]:
        assert "${{" not in step.get("run", ""), step.get("name")
    run = next(s["run"] for s in job["steps"] if "run" in s)
    assert run.count(">/dev/null 2>&1") >= 2  # ls-remote and clone
    assert "guide: skipped (no guide access configured)" in run


def _run_text():
    return next(s["run"] for s in _CI["jobs"]["guide-build"]["steps"] if "run" in s)


def test_every_git_remote_command_is_silenced():
    lines = [ln for ln in _run_text().splitlines() if "git ls-remote" in ln or "git clone" in ln]
    assert len(lines) == 2
    # a continued line (trailing backslash) carries the redirect on its next line
    run = _run_text().replace("\\\n", " ")
    for ln in [ln for ln in run.splitlines() if "git ls-remote" in ln or "git clone" in ln]:
        assert ">/dev/null 2>&1" in ln, ln


def test_no_echo_expands_a_secret_or_name():
    for ln in _run_text().splitlines():
        if ln.lstrip().startswith(("echo", "printf")):
            for var in ("GUIDE_REPO", "url", "BRANCH", "GITHUB_HEAD_REF", "ref", "GH_TOKEN"):
                assert f"${var}" not in ln, ln
                assert f"${{{var}}}" not in ln, ln


def test_token_is_withheld_from_the_guides_code():
    run = _run_text()
    assert "remote remove origin" in run
    assert "env -u GH_TOKEN -u GUIDE_REPO bash scripts/guide/build_guide.sh" in run
    assert "refs/heads/$BRANCH" in run


def test_branch_is_read_at_run_time_not_through_step_env():
    # Step `env:` entries are printed in the public log header.
    step = next(s for s in _CI["jobs"]["guide-build"]["steps"] if "run" in s)
    assert "BRANCH" not in (step.get("env") or {})
    assert 'BRANCH="$GITHUB_HEAD_REF"' in step["run"]


# --- the branch lookup: absent ref builds main, a failed lookup fails loudly ---

_STUB_GIT = """#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$GIT_LOG"
case "$1" in
  ls-remote) exit "$LS_REMOTE_RC" ;;
  clone) mkdir -p "${@: -1}/src/data" ;;
esac
exit 0
"""


def _run_build_step(tmp_path, ls_remote_rc):
    stub = tmp_path / "bin"
    stub.mkdir()
    (stub / "git").write_text(_STUB_GIT)
    (stub / "git").chmod(0o755)
    env = {
        **os.environ,
        "PATH": f"{stub}:{os.environ['PATH']}",
        "GIT_LOG": str(tmp_path / "git.log"),
        "LS_REMOTE_RC": str(ls_remote_rc),
        "GUIDE_REPO": "example-org/example-guide",
        "GH_TOKEN": "tok-abc",
        "GITHUB_HEAD_REF": "feature/example",
        "RUNNER_TEMP": str(tmp_path),
        "GUIDE_BUILD_CMD": "true",
    }
    # GitHub runs `run:` blocks as `bash --noprofile --norc -eo pipefail`.
    r = subprocess.run(
        ["bash", "--noprofile", "--norc", "-eo", "pipefail", "-c", _run_text()],
        cwd=REPO,
        capture_output=True,
        text=True,
        env=env,
    )
    log = (tmp_path / "git.log").read_text() if (tmp_path / "git.log").exists() else ""
    return r, log


def test_existing_paired_branch_is_built(tmp_path):
    r, log = _run_build_step(tmp_path, 0)
    assert r.returncode == 0, r.stdout
    assert "--branch feature/example " in log
    assert "building against: paired branch" in r.stdout


def test_absent_paired_branch_builds_main(tmp_path):
    # `git ls-remote --exit-code` exits 2 when the ref does not exist.
    r, log = _run_build_step(tmp_path, 2)
    assert r.returncode == 0, r.stdout
    assert "--branch main " in log
    assert "building against: main" in r.stdout


def test_failed_branch_lookup_fails_instead_of_building_main(tmp_path):
    # 128 is an auth or network failure: building main would report on the wrong tree.
    r, log = _run_build_step(tmp_path, 128)
    assert r.returncode != 0
    assert r.stdout.strip() == "guide: branch lookup failed"
    assert "clone" not in log
    for secret in ("example-guide", "feature/example", "tok-abc"):
        assert secret not in r.stdout + r.stderr

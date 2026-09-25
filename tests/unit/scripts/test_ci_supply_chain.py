"""CI's own supply chain: every tool CI downloads is pinned and verified.

Three gaps this file pins shut:

- **Dependency review.** Nothing looked at what a PR adds to the dependency
  graph. `actions/dependency-review-action` fails a PR that introduces a
  dependency with a known high/critical advisory, before it merges -- the
  security-audit jobs only notice once the advisory is already on main.
- **gitleaks** was installed as `curl ... | sudo tar` with no checksum and no
  Renovate marker, so it could neither be verified nor bumped (it sat at
  v8.22.1 while upstream moved on).
- **zizmor** ran as bare `pipx run zizmor`, i.e. whatever PyPI served that
  minute. A new zizmor release adding an audit could turn every PR red with no
  diff to point at -- the reason actionlint is pinned and needs review.

`test_check_renovate_managers.py` owns whether the Renovate markers are
captured; this file owns the workflow shape.
"""

import re
import subprocess
from pathlib import Path
from typing import Any

import pytest
import yaml

REPO_ROOT = Path(__file__).parents[3]
CI_WORKFLOW = REPO_ROOT / ".github/workflows/ci.yml"

SHA_PIN = re.compile(r"^[\w.-]+/[\w.-]+@[0-9a-f]{40}$")
VERSION_COMMENT = re.compile(r"@[0-9a-f]{40} # v\d+\.\d+\.\d+$", re.MULTILINE)


def _ci() -> dict[str, Any]:
    wf = yaml.safe_load(CI_WORKFLOW.read_text())
    assert isinstance(wf, dict)
    return wf


def _job(name: str) -> dict[str, Any]:
    job = _ci()["jobs"][name]
    assert isinstance(job, dict)
    return job


def _step(job: str, name: str) -> dict[str, Any]:
    for step in _job(job)["steps"]:
        if step.get("name") == name:
            assert isinstance(step, dict)
            return step
    raise AssertionError(f"{job} has no step named {name!r}")


# --------------------------- dependency review ---------------------------


def test_dependency_review_runs_only_on_pull_requests():
    """It diffs base against head; a push to main has no PR to diff."""
    assert _job("dependency-review")["if"] == "github.event_name == 'pull_request'"


def test_dependency_review_hardens_the_runner_first_and_blocks_egress():
    steps = _job("dependency-review")["steps"]
    first = steps[0]
    assert first["uses"].startswith("step-security/harden-runner@")
    assert first["with"]["egress-policy"] == "block"
    # The exact set, so a widened allowlist fails here too.
    allowed = set(first["with"]["allowed-endpoints"].split())
    assert allowed == {
        "agent.api.stepsecurity.io:443",
        "api.github.com:443",
        "prod.app-api.stepsecurity.io:443",
        "productionresultssa*.blob.core.windows.net:443",
    }


def test_dependency_review_action_is_sha_pinned_with_a_version_comment():
    step = _step("dependency-review", "Dependency review")
    assert step["uses"].startswith("actions/dependency-review-action@")
    assert SHA_PIN.match(step["uses"]), step["uses"]
    raw = CI_WORKFLOW.read_text()
    line = next(ln for ln in raw.splitlines() if "actions/dependency-review-action@" in ln)
    assert VERSION_COMMENT.search(line), line


def test_dependency_review_config():
    cfg = _step("dependency-review", "Dependency review")["with"]
    assert cfg["fail-on-severity"] == "high"
    assert cfg["comment-summary-in-pr"] == "never"
    # The scorecard lookup calls two third-party APIs (api.securityscorecards.dev,
    # api.deps.dev) that the blocked egress policy does not allow.
    assert cfg["show-openssf-scorecard"] is False
    # The default is runtime only, which would let a PR add a dev dependency
    # (vite, vitest, the markdownlint chain) carrying a high advisory.
    scopes = {s.strip() for s in cfg["fail-on-scopes"].split(",")}
    assert scopes == {"runtime", "development"}


def test_dependency_review_token_is_read_only():
    """`comment-summary-in-pr: never` is what lets this stay read-only."""
    assert _job("dependency-review")["permissions"] == {"contents": "read"}


def test_dependency_review_checks_out_nothing():
    """The action reads the dependency-graph compare API; it needs no tree."""
    uses = [s.get("uses", "") for s in _job("dependency-review")["steps"]]
    assert not any(u.startswith("actions/checkout@") for u in uses)


def test_ci_gate_needs_dependency_review():
    assert "dependency-review" in _job("summary")["needs"]


def test_ci_gate_tolerates_skip_only_off_pull_requests():
    """Skipped is fine on a push to main; on a PR it would be a silent pass."""
    step = _job("summary")["steps"][0]
    assert step["env"]["DEPENDENCY_REVIEW"] == "${{ needs.dependency-review.result }}"
    assert step["env"]["EVENT_NAME"] == "${{ github.event_name }}"
    script = step["run"]
    assert '"$DEPENDENCY_REVIEW" != "success"' in script
    assert '"$EVENT_NAME" = "pull_request"' in script


@pytest.mark.parametrize(
    ("event", "result", "passes"),
    [
        ("push", "skipped", True),
        ("workflow_dispatch", "skipped", True),
        ("pull_request", "success", True),
        ("pull_request", "skipped", False),
        ("pull_request", "failure", False),
        ("pull_request", "cancelled", False),
        ("push", "failure", False),
    ],
)
def test_ci_gate_script_verdict(event: str, result: str, passes: bool) -> None:
    """Run the gate's real shell with every other job green."""
    step = _job("summary")["steps"][0]
    env = dict.fromkeys(step["env"], "success")
    env |= {"DEPENDENCY_REVIEW": result, "EVENT_NAME": event, "PATH": "/usr/bin:/bin"}
    proc = subprocess.run(["bash", "-c", step["run"]], env=env, capture_output=True, text=True)
    assert (proc.returncode == 0) is passes, proc.stdout + proc.stderr


# --------------------------- gitleaks ---------------------------


def test_gitleaks_version_carries_a_renovate_marker():
    script = _step("secret-scan", "Install gitleaks")["run"]
    assert re.search(
        r"# renovate: datasource=github-releases depName=gitleaks/gitleaks\n\s*GITLEAKS_VERSION=",
        script,
    ), script


def test_gitleaks_archive_is_checksum_verified_before_extraction():
    script = _step("secret-scan", "Install gitleaks")["run"]
    assert "set -euo pipefail" in script
    assert re.search(r"GITLEAKS_SHA256=\"?[0-9a-f]{64}", script), script
    assert "sha256sum -c" in script
    assert script.index("sha256sum -c") < script.index("tar ")
    # Never extract straight off the wire: nothing to verify in a pipe.
    assert not re.search(r"curl[^\n]*\|\s*(sudo\s+)?tar", script.replace("\\\n", " "))


# --------------------------- zizmor ---------------------------


def test_zizmor_is_pinned_with_a_renovate_marker():
    script = _step("security-lint", "Install and run zizmor")["run"]
    assert re.search(r"# renovate: datasource=pypi depName=zizmor\n\s*ZIZMOR_VERSION=", script), script
    assert 'pipx run --spec "zizmor==${ZIZMOR_VERSION}" zizmor' in script

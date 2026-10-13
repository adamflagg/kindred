"""The api and pocketbase images carry the version CD built them at.

CD rebuilds only the images whose files changed and retags the rest from
`:latest`, so the frontend's baked version says nothing about the others. Each
image therefore bakes its own `KINDRED_VERSION`, which its version endpoint
reports, and integration-test checks that every REBUILT image carries the run's
version string.
"""

import re
from pathlib import Path
from typing import Any

import pytest
import yaml

REPO_ROOT = Path(__file__).parents[3]
CD_WORKFLOW = REPO_ROOT / ".github/workflows/cd.yml"
VERSION_OUTPUT = "${{ needs.detect-changes.outputs.version }}"


def _final_stage(dockerfile: str) -> list[str]:
    """Instructions of the last stage, continuation lines folded in."""
    text = (REPO_ROOT / "docker" / dockerfile).read_text().replace("\\\n", " ")
    lines = [ln.strip() for ln in text.splitlines() if ln.strip() and not ln.strip().startswith("#")]
    last_from = max(i for i, ln in enumerate(lines) if ln.startswith("FROM "))
    return lines[last_from:]


@pytest.mark.parametrize("dockerfile", ["Dockerfile.api", "Dockerfile.pocketbase"])
def test_final_stage_bakes_the_build_version(dockerfile):
    stage = _final_stage(dockerfile)
    assert "ARG VERSION=dev" in stage
    assert "ENV KINDRED_VERSION=${VERSION}" in stage
    # As late as possible: a per-commit value must not bust the cache of any
    # filesystem layer, so nothing that builds one may follow it.
    arg_at = stage.index("ARG VERSION=dev")
    assert stage.index("ENV KINDRED_VERSION=${VERSION}") > arg_at
    assert not [ln for ln in stage[arg_at:] if re.match(r"(COPY|ADD|RUN) ", ln)]


def _cd() -> dict[str, Any]:
    wf = yaml.safe_load(CD_WORKFLOW.read_text())
    assert isinstance(wf, dict)
    return wf


def _step(job: str, name: str) -> dict[str, Any]:
    steps = _cd()["jobs"][job]["steps"]
    matches = [s for s in steps if s.get("name", "").startswith(name)]
    assert len(matches) == 1, f"{job}: expected one step named {name!r}"
    step: dict[str, Any] = matches[0]
    return step


def test_one_version_string_feeds_the_build_and_the_check():
    """The build arg and the verify step read the same output, so they cannot disagree."""
    assert "version" in _cd()["jobs"]["detect-changes"]["outputs"]
    assert _step("build-and-scan", "Build and push")["env"]["BUILD_VERSION"] == VERSION_OUTPUT
    assert _step("integration-test", "Verify image revision labels")["env"]["EXPECTED_VERSION"] == VERSION_OUTPUT


def test_verify_step_checks_kindred_version_on_rebuilt_images():
    script = _step("integration-test", "Verify image revision labels")["run"]
    assert "KINDRED_VERSION" in script
    assert "EXPECTED_VERSION" in script
    assert ".Config.Env" in script


def test_build_version_describes_the_pr_head_not_the_synthetic_merge_commit():
    """pull_request runs check out a merge commit; the version must name the head the image labels use."""
    step = _step("detect-changes", "Compute build version")
    ref = step["env"]["REF"]
    assert "github.event.pull_request.head.sha" in ref
    assert "github.sha" in ref
    assert 'git describe --tags --always "$REF"' in step["run"]

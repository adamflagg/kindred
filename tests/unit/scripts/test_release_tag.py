"""Release docs tag: the Release workflow gives the staff-guide image the release's version.

Every test replaces subprocess.run with a fake, so nothing touches the network.
As with lockstep, the output-discipline tests matter as much as the behaviour:
release.yml's log is PUBLIC, so the guide repo's name, the guide commit and any
gh output must never be printed.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

import pytest
import yaml

from scripts.guide import release_tag
from scripts.guide.release_tag import main

REPO = Path(__file__).resolve().parents[3]
RELEASE_WORKFLOW = REPO / ".github/workflows/release.yml"

KINDRED_REPO = "owner/kindred"
GUIDE_REPO = "owner/private-guide-repo"
RELEASE_SHA = "a" * 40
GUIDE_SHA = "b" * 40
RUN_ID = 987654
LEAKY_STDERR = "HTTP 404: Not Found (https://api.github.com/repos/owner/private-guide-repo/...)"


def _done(stdout: str = "", rc: int = 0, stderr: str = "") -> subprocess.CompletedProcess[str]:
    return subprocess.CompletedProcess(args=[], returncode=rc, stdout=stdout, stderr=stderr)


class FakeGh:
    """Stands in for subprocess.run; answers by matching the gh api path."""

    def __init__(
        self,
        *,
        lockstep: str = "success",
        kindred_main: str = RELEASE_SHA,
        image: str = "success",
        dispatch_ok: bool = True,
        tag_run: str = "success",
    ) -> None:
        self.lockstep = lockstep
        self.kindred_main = kindred_main
        self.image = image
        self.dispatch_ok = dispatch_ok
        self.tag_run = tag_run
        self.calls: list[tuple[list[str], dict[str, str]]] = []

    def __call__(self, cmd: list[str], *a: Any, **k: Any) -> subprocess.CompletedProcess[str]:
        cmd = list(cmd)
        env = dict(k.get("env") or {})
        self.calls.append((cmd, env))
        assert cmd[:2] == ["gh", "api"], cmd
        path = next(c for c in cmd[2:] if c.startswith("repos/"))
        if path == f"repos/{KINDRED_REPO}/actions/workflows/guide-lockstep.yml/runs?head_sha={RELEASE_SHA}":
            return _done(json.dumps([{"id": 1, "status": "completed", "conclusion": self.lockstep}]))
        if path == f"repos/{KINDRED_REPO}/commits/main":
            return _done(self.kindred_main + "\n")
        if path == f"repos/{GUIDE_REPO}/commits/main":
            return _done(GUIDE_SHA + "\n")
        if path == f"repos/{GUIDE_REPO}/actions/workflows/image.yml/runs?head_sha={GUIDE_SHA}":
            return _done(json.dumps([{"id": 2, "status": "completed", "conclusion": self.image}]))
        if path == f"repos/{GUIDE_REPO}/actions/workflows/release-tag.yml/dispatches":
            if not self.dispatch_ok:
                return _done("", 1, LEAKY_STDERR)
            return _done(f"{RUN_ID}\n")
        if path == f"repos/{GUIDE_REPO}/actions/runs/{RUN_ID}":
            return _done(json.dumps({"status": "completed", "conclusion": self.tag_run}))
        raise AssertionError(f"unexpected call: {cmd}")

    def paths(self) -> list[str]:
        return [next(c for c in cmd[2:] if c.startswith("repos/")) for cmd, _ in self.calls]

    def dispatched(self) -> bool:
        return any(p.endswith("/release-tag.yml/dispatches") for p in self.paths())


@pytest.fixture
def env(monkeypatch):
    monkeypatch.setenv("KINDRED_REPO", KINDRED_REPO)
    monkeypatch.setenv("KINDRED_TOKEN", "kindred-token")
    monkeypatch.setenv("GUIDE_REPO", GUIDE_REPO)
    monkeypatch.setenv("GUIDE_TOKEN", "guide-token")
    monkeypatch.setattr("scripts.guide.lockstep.time.sleep", lambda s: None)
    monkeypatch.setattr("scripts.guide.release_tag.time.sleep", lambda s: None)


def _install(monkeypatch: pytest.MonkeyPatch, fake: FakeGh) -> FakeGh:
    monkeypatch.setattr("scripts.guide.lockstep.subprocess.run", fake)
    return fake


def _main(version: str = "7.1.0", sha: str = RELEASE_SHA) -> int:
    return main(["--release-sha", sha, "--version", version])


# ------------------------------- happy path -------------------------------


def test_tags_the_guide_main_image_with_the_release_version(monkeypatch, env, capsys):
    fake = _install(monkeypatch, FakeGh())
    assert _main() == 0
    dispatch = next(cmd for cmd, _ in fake.calls if any(c.endswith("/dispatches") for c in cmd))
    assert "ref=main" in dispatch
    assert "inputs[version]=7.1.0" in dispatch
    assert f"inputs[sha]={GUIDE_SHA}" in dispatch
    assert "docs: tagged 7.1.0" in capsys.readouterr().out


def test_steps_run_in_order(monkeypatch, env):
    """Lockstep first, then the main check, then the guide image, then the tag."""
    fake = _install(monkeypatch, FakeGh())
    assert _main() == 0
    assert fake.paths() == [
        f"repos/{KINDRED_REPO}/actions/workflows/guide-lockstep.yml/runs?head_sha={RELEASE_SHA}",
        f"repos/{KINDRED_REPO}/commits/main",
        f"repos/{GUIDE_REPO}/commits/main",
        f"repos/{GUIDE_REPO}/actions/workflows/image.yml/runs?head_sha={GUIDE_SHA}",
        f"repos/{GUIDE_REPO}/actions/workflows/release-tag.yml/dispatches",
        f"repos/{GUIDE_REPO}/actions/runs/{RUN_ID}",
    ]


def test_the_dispatch_asks_for_the_run_id(monkeypatch, env):
    fake = _install(monkeypatch, FakeGh())
    assert _main() == 0
    dispatch = next(cmd for cmd, _ in fake.calls if any(c.endswith("/dispatches") for c in cmd))
    assert dispatch[dispatch.index("-X") + 1] == "POST"
    assert "return_run_details=true" in dispatch
    assert dispatch[dispatch.index("--jq") + 1] == ".workflow_run_id"


def test_kindred_calls_use_the_kindred_token_and_guide_calls_the_guide_token(monkeypatch, env):
    fake = _install(monkeypatch, FakeGh())
    assert _main() == 0
    for cmd, call_env in fake.calls:
        path = next(c for c in cmd[2:] if c.startswith("repos/"))
        expected = "kindred-token" if path.startswith(f"repos/{KINDRED_REPO}/") else "guide-token"
        assert call_env.get("GH_TOKEN") == expected, path
        assert "kindred-token" not in cmd
        assert "guide-token" not in cmd


def test_a_v_prefixed_version_is_tagged_without_it(monkeypatch, env, capsys):
    fake = _install(monkeypatch, FakeGh())
    assert _main(version="v7.1.0") == 0
    dispatch = next(cmd for cmd, _ in fake.calls if any(c.endswith("/dispatches") for c in cmd))
    assert "inputs[version]=7.1.0" in dispatch
    assert "docs: tagged 7.1.0" in capsys.readouterr().out


# ------------------------------- stops ------------------------------------


@pytest.mark.parametrize("conclusion", ["failure", "cancelled", "timed_out"])
def test_an_unfinished_or_failed_lockstep_stops_before_tagging(monkeypatch, env, capsys, conclusion):
    fake = _install(monkeypatch, FakeGh(lockstep=conclusion))
    assert _main() == 1
    assert not fake.dispatched()
    assert "lockstep" in capsys.readouterr().out


def test_a_lockstep_run_that_never_finishes_stops_the_release(monkeypatch, env, capsys):
    def never(*a, **k):
        raise TimeoutError("guide-lockstep.yml")

    _install(monkeypatch, FakeGh())
    monkeypatch.setattr(release_tag, "wait_for_check", never)
    assert _main() == 1
    assert "lockstep" in capsys.readouterr().out


def test_kindred_main_moving_past_the_release_stops_before_tagging(monkeypatch, env, capsys):
    """The guide could then describe a newer Kindred than the release."""
    fake = _install(monkeypatch, FakeGh(kindred_main="c" * 40))
    assert _main() == 1
    assert not fake.dispatched()
    assert "main has moved past the release commit" in capsys.readouterr().out


def test_a_failed_guide_image_build_stops_before_tagging(monkeypatch, env, capsys):
    fake = _install(monkeypatch, FakeGh(image="failure"))
    assert _main() == 1
    assert not fake.dispatched()
    assert "guide image" in capsys.readouterr().out


def test_a_failed_dispatch_stops_the_release(monkeypatch, env, capsys):
    _install(monkeypatch, FakeGh(dispatch_ok=False))
    assert _main() == 1
    assert "dispatch" in capsys.readouterr().out


def test_a_failed_tag_run_stops_the_release(monkeypatch, env, capsys):
    _install(monkeypatch, FakeGh(tag_run="failure"))
    assert _main() == 1
    out = capsys.readouterr().out
    assert "docs: tagged" not in out
    assert "tag run" in out


def test_a_tag_run_that_never_finishes_stops_the_release(monkeypatch, env, capsys):
    class Stuck(FakeGh):
        def __call__(self, cmd, *a, **k):
            if any(c.endswith(f"/actions/runs/{RUN_ID}") for c in cmd):
                self.calls.append((list(cmd), dict(k.get("env") or {})))
                return _done(json.dumps({"status": "in_progress", "conclusion": None}))
            return super().__call__(cmd, *a, **k)

    _install(monkeypatch, Stuck())
    monkeypatch.setattr(release_tag, "TAG_RUN_TIMEOUT_S", 0)
    assert _main() == 1
    assert "tag run" in capsys.readouterr().out


@pytest.mark.parametrize("version", ["", "7", "7.1", "7.1.0-rc1", "7.1.0; rm -rf /", "x.y.z"])
def test_a_bad_version_is_refused_before_anything_runs(monkeypatch, env, capsys, version):
    fake = _install(monkeypatch, FakeGh())
    assert _main(version=version) == 1
    assert fake.calls == []


@pytest.mark.parametrize("sha", ["", "abc", "A" * 40, "a" * 39, "g" * 40])
def test_a_bad_release_sha_is_refused_before_anything_runs(monkeypatch, env, capsys, sha):
    fake = _install(monkeypatch, FakeGh())
    assert _main(sha=sha) == 1
    assert fake.calls == []


@pytest.mark.parametrize("missing", ["GUIDE_REPO", "GUIDE_TOKEN"])
def test_missing_guide_access_stops_the_release(monkeypatch, env, capsys, missing):
    """Ruling: a docs-tag failure stops the release, so a pinned version always has docs."""
    monkeypatch.delenv(missing)
    fake = _install(monkeypatch, FakeGh())
    assert _main() == 1
    assert fake.calls == []
    assert "no guide access" in capsys.readouterr().out


@pytest.mark.parametrize("missing", ["KINDRED_REPO", "KINDRED_TOKEN"])
def test_missing_kindred_access_stops_before_any_wait(monkeypatch, env, capsys, missing):
    """Unset, the lockstep wait would poll `repos//...` for its full 80 minutes."""
    monkeypatch.delenv(missing)
    fake = _install(monkeypatch, FakeGh())
    assert _main() == 1
    assert fake.calls == []
    assert "no kindred access" in capsys.readouterr().out


# --------------------------- output discipline ----------------------------


@pytest.mark.parametrize(
    "fake",
    [
        FakeGh(),
        FakeGh(lockstep="failure"),
        FakeGh(kindred_main="c" * 40),
        FakeGh(image="failure"),
        FakeGh(dispatch_ok=False),
        FakeGh(tag_run="failure"),
    ],
)
def test_output_never_names_the_guide_repo_commit_or_gh_output(monkeypatch, env, capsys, fake):
    _install(monkeypatch, fake)
    _main()
    out = capsys.readouterr()
    text = out.out + out.err
    assert "private-guide-repo" not in text
    assert GUIDE_SHA not in text
    assert GUIDE_SHA[:7] not in text
    assert str(RUN_ID) not in text
    assert "HTTP 404" not in text


def test_an_unexpected_error_prints_only_its_type(monkeypatch, env, capsys):
    def boom(*a, **k):
        raise RuntimeError("secret detail owner/private-guide-repo")

    monkeypatch.setattr("scripts.guide.lockstep.subprocess.run", boom)
    assert _main() == 1
    out = capsys.readouterr().out
    assert "RuntimeError" in out
    assert "private-guide-repo" not in out


# ------------------------------- workflow ---------------------------------


def _release_steps() -> list[dict[str, Any]]:
    wf = yaml.safe_load(RELEASE_WORKFLOW.read_text())
    steps: list[dict[str, Any]] = wf["jobs"]["release"]["steps"]
    return steps


def _step_index(name: str) -> int:
    names = [s.get("name", "") for s in _release_steps()]
    return names.index(name)


def test_release_tags_the_docs_before_any_kindred_image_gets_a_version_tag():
    """A docs failure must leave nothing half-released: caddy's rebuild and the
    crane promotion are the first steps that write a version tag."""
    docs = _step_index("Tag the staff-guide image with the release version")
    assert docs < _step_index("Rebuild caddy with release version")
    assert docs < _step_index("Promote non-frontend images via crane")
    assert docs < _step_index("Create tag and release")
    assert docs > _step_index("Find SHA-tagged images in registry")


def test_release_job_can_read_the_guide_write_token():
    """GUIDE_WRITE_TOKEN is an environment secret, scoped to main."""
    wf = yaml.safe_load(RELEASE_WORKFLOW.read_text())
    assert wf["jobs"]["release"]["environment"] == "guide-lockstep"


def test_docs_step_passes_secrets_through_env_and_strips_the_v():
    step = _release_steps()[_step_index("Tag the staff-guide image with the release version")]
    assert step["env"]["GUIDE_TOKEN"] == "${{ secrets.GUIDE_WRITE_TOKEN }}"
    assert step["env"]["GUIDE_REPO"] == "${{ secrets.GUIDE_REPO }}"
    assert step["env"]["KINDRED_TOKEN"] == "${{ github.token }}"
    assert "secrets." not in step["run"]
    assert "python3 -m scripts.guide.release_tag" in step["run"]
    assert '--version "${VERSION#v}"' in step["run"]
    assert '--release-sha "$(git rev-parse HEAD)"' in step["run"]

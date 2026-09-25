"""The Dependabot auto-merge step must survive GitHub's mergeability race.

PR #2854 was the 7th of 7 Dependabot PRs opened in ~3 minutes. Its auto-merge
step ran 27 s after open, while `mergeable` was still UNKNOWN, and GitHub
refused `enablePullRequestAutoMerge` with a spurious "without `workflows`
permission" error. The step never retried, so the PR sat open with green CI.
Its six siblings, identical in shape, auto-merged fine.

These tests run the step's real shell against stub `gh` and `sleep` binaries.
"""

import os
import stat
import subprocess
from pathlib import Path
from typing import Any

import yaml

REPO = Path(__file__).resolve().parents[3]
WORKFLOW = REPO / ".github" / "workflows" / "dependabot-auto-merge.yml"


def _merge_step() -> dict[str, Any]:
    steps = yaml.safe_load(WORKFLOW.read_text())["jobs"]["auto-merge"]["steps"]
    return next(s for s in steps if "gh pr merge" in s.get("run", ""))


def _run(tmp_path: Path, mergeable: list[str], merge_results: list[int]) -> tuple[int, list[str]]:
    """Run the step with `gh` answering `mergeable` states then `merge_results` exit codes in order."""
    log = tmp_path / "calls.log"
    (tmp_path / "mergeable").write_text("\n".join(mergeable) + "\n")
    (tmp_path / "merge").write_text("\n".join(str(c) for c in merge_results) + "\n")
    gh = tmp_path / "gh"
    gh.write_text(
        f"""#!/usr/bin/env bash
echo "gh $*" >> {log}
pop() {{ local f="{tmp_path}/$1"; local v; v=$(head -n1 "$f"); [ "$(wc -l < "$f")" -gt 1 ] && sed -i 1d "$f"; echo "$v"; }}
case "$1 $2" in
  "pr view") pop mergeable ;;
  "pr merge") code=$(pop merge); [ "$code" = 0 ] || echo "GraphQL: refusing to allow a GitHub App ... without workflows permission" >&2; exit "$code" ;;
esac
"""
    )
    sleep = tmp_path / "sleep"
    sleep.write_text(f'#!/usr/bin/env bash\necho "sleep $*" >> {log}\n')
    for f in (gh, sleep):
        f.chmod(f.stat().st_mode | stat.S_IXUSR)
    env = {
        **os.environ,
        "PATH": f"{tmp_path}:{os.environ['PATH']}",
        "PR_URL": "https://github.com/o/r/pull/1",
        "GH_TOKEN": "x",
    }
    proc = subprocess.run(["bash", "-c", _merge_step()["run"]], env=env, capture_output=True, text=True)
    calls = log.read_text().splitlines() if log.exists() else []
    return proc.returncode, calls


def test_waits_for_mergeability_before_enabling_auto_merge(tmp_path):
    code, calls = _run(tmp_path, ["UNKNOWN", "UNKNOWN", "MERGEABLE"], [0])
    assert code == 0
    merges = [i for i, c in enumerate(calls) if c.startswith("gh pr merge")]
    views = [i for i, c in enumerate(calls) if c.startswith("gh pr view")]
    assert len(views) == 3
    assert merges, calls
    assert merges[0] > views[-1], calls


def test_retries_a_refused_enable(tmp_path):
    code, calls = _run(tmp_path, ["MERGEABLE"], [1, 0])
    assert code == 0
    assert sum(c.startswith("gh pr merge") for c in calls) == 2
    assert all("--auto --squash" in c for c in calls if c.startswith("gh pr merge"))


def test_gives_up_loudly_after_bounded_retries(tmp_path):
    code, calls = _run(tmp_path, ["MERGEABLE"], [1])
    assert code != 0
    assert 2 <= sum(c.startswith("gh pr merge") for c in calls) <= 5


def test_mergeability_wait_is_bounded(tmp_path):
    code, calls = _run(tmp_path, ["UNKNOWN"], [0])
    views = sum(c.startswith("gh pr view") for c in calls)
    assert views <= 20
    # Still attempts the enable after the wait expires, rather than failing silently.
    assert any(c.startswith("gh pr merge") for c in calls)
    assert code == 0


def test_no_workflows_permission_is_granted():
    """The fix is timing, not scope: the job must not be able to edit Actions files."""
    perms = yaml.safe_load(WORKFLOW.read_text())["permissions"]
    assert perms == {"contents": "write", "pull-requests": "write"}

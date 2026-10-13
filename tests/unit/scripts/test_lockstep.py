"""Guide lockstep: after a kindred PR merges, merge its paired guide PR once green.

The planner is pure. The executor shells out to gh and git; every test here
replaces subprocess.run with a fake, so nothing touches the network.

The output-discipline tests matter as much as the behaviour: this runs on a
PUBLIC repo's Actions log, so the guide repo's name, branch names, PR numbers,
PR titles and any gh/git output must never be printed.
"""

from __future__ import annotations

import inspect
import json
import subprocess
from pathlib import Path
from typing import Any

import pytest
import yaml

from scripts.guide import lockstep
from scripts.guide.lockstep import Plan, main, plan, wait_for_check

REPO = Path(__file__).resolve().parents[3]
WORKFLOW = REPO / ".github/workflows/guide-lockstep.yml"

# --------------------------------- plan ---------------------------------


def test_merges_the_one_open_pr_on_the_same_branch():
    p = plan("feature/x", [{"number": 7, "headRefName": "feature/x"}, {"number": 8, "headRefName": "feature/y"}], False)
    assert (p.action, p.guide_pr) == ("merge-paired", 7)


def test_branch_name_match_is_exact():
    p = plan("feature/x", [{"number": 7, "headRefName": "feature/x-2"}], False)
    assert p.action == "nothing"


def test_branch_name_match_is_exact_not_a_suffix():
    p = plan("x", [{"number": 7, "headRefName": "feature/x"}], False)
    assert p.action == "nothing"


def test_two_open_prs_on_one_branch_is_an_error():
    p = plan("feature/x", [{"number": 7, "headRefName": "feature/x"}, {"number": 9, "headRefName": "feature/x"}], True)
    assert p.action == "error"
    assert "2 open guide PRs" in p.reason


def test_no_pair_but_facts_changed_opens_a_sync_pr():
    assert plan("feature/x", [], True).action == "open-facts-sync"


def test_no_pair_and_no_facts_change_does_nothing():
    assert plan("feature/x", [], False).action == "nothing"


def test_a_pair_wins_over_a_facts_sync():
    """The paired PR carries the facts too; a second sync PR would race it."""
    p = plan("feature/x", [{"number": 7, "headRefName": "feature/x"}], True)
    assert (p.action, p.guide_pr) == ("merge-paired", 7)


@pytest.mark.parametrize(
    ("branch", "prs", "facts"),
    [
        ("feature/secret-branch", [{"number": 4242, "headRefName": "feature/secret-branch"}], False),
        ("feature/secret-branch", [{"number": 4242, "headRefName": "feature/secret-branch"}] * 2, True),
        ("feature/secret-branch", [], True),
        ("feature/secret-branch", [], False),
    ],
)
def test_reasons_never_name_the_branch_or_the_pr(branch, prs, facts):
    p = plan(branch, prs, facts)
    assert "secret-branch" not in p.reason
    assert "4242" not in p.reason
    assert p.reason


def test_a_pair_based_on_another_branch_is_not_merged():
    prs = [{"number": 7, "headRefName": "feature/x", "baseRefName": "feature/parent"}]
    for facts in (False, True):
        p = plan("feature/x", prs, facts)
        assert (p.action, p.guide_pr) == ("nothing", None)
        assert p.reason == "paired guide PR is not based on main"


def test_a_pair_based_on_main_is_merged():
    p = plan("feature/x", [{"number": 7, "headRefName": "feature/x", "baseRefName": "main"}], False)
    assert (p.action, p.guide_pr) == ("merge-paired", 7)


def test_plan_is_a_frozen_dataclass():
    p = Plan("nothing", None, "why")
    with pytest.raises(AttributeError):
        p.action = "error"  # type: ignore[misc]


# ----------------------------- wait_for_check -----------------------------


def _completed(stdout: str, rc: int = 0) -> subprocess.CompletedProcess[str]:
    return subprocess.CompletedProcess(args=[], returncode=rc, stdout=stdout, stderr="")


def test_wait_for_check_polls_until_the_check_completes(monkeypatch):
    responses = iter([[], [{"name": "image", "status": "completed", "conclusion": "success"}]])
    monkeypatch.setattr(
        "scripts.guide.lockstep.subprocess.run", lambda *a, **k: _completed(json.dumps(next(responses)))
    )
    monkeypatch.setattr("scripts.guide.lockstep.time.sleep", lambda s: None)
    assert wait_for_check("owner/guide", "a" * 40, poll_s=0) == "success"


def test_wait_for_check_ignores_other_check_names(monkeypatch):
    responses = iter(
        [
            [{"name": "lint", "status": "completed", "conclusion": "failure"}],
            [{"name": "image", "status": "completed", "conclusion": "success"}],
        ]
    )
    monkeypatch.setattr(
        "scripts.guide.lockstep.subprocess.run", lambda *a, **k: _completed(json.dumps(next(responses)))
    )
    monkeypatch.setattr("scripts.guide.lockstep.time.sleep", lambda s: None)
    assert wait_for_check("owner/guide", "a" * 40, poll_s=0) == "success"


def test_wait_for_check_returns_a_failing_conclusion(monkeypatch):
    run = [{"name": "image", "status": "completed", "conclusion": "failure"}]
    monkeypatch.setattr("scripts.guide.lockstep.subprocess.run", lambda *a, **k: _completed(json.dumps(run)))
    assert wait_for_check("owner/guide", "a" * 40, poll_s=0) == "failure"


def test_wait_for_check_times_out_on_a_never_completing_run(monkeypatch):
    run = [{"name": "image", "status": "in_progress", "conclusion": None}]
    monkeypatch.setattr("scripts.guide.lockstep.subprocess.run", lambda *a, **k: _completed(json.dumps(run)))
    monkeypatch.setattr("scripts.guide.lockstep.time.sleep", lambda s: None)
    with pytest.raises(TimeoutError):
        wait_for_check("owner/guide", "a" * 40, timeout_s=0, poll_s=0)


def test_wait_for_check_asks_only_for_the_named_check(monkeypatch):
    seen: list[list[str]] = []

    def run(cmd, *a, **k):
        seen.append(list(cmd))
        return _completed(json.dumps([{"name": "image", "status": "completed", "conclusion": "success"}]))

    monkeypatch.setattr("scripts.guide.lockstep.subprocess.run", run)
    assert wait_for_check("owner/guide", "a" * 40, poll_s=0) == "success"
    assert seen[0][2] == f"repos/owner/guide/commits/{'a' * 40}/check-runs?check_name=image"


@pytest.mark.parametrize(
    ("runs", "expected"),
    [
        (
            [
                {"id": 11, "name": "image", "status": "completed", "conclusion": "failure"},
                {"id": 12, "name": "image", "status": "completed", "conclusion": "success"},
            ],
            "success",
        ),
        (
            [
                {"id": 12, "name": "image", "status": "completed", "conclusion": "failure"},
                {"id": 11, "name": "image", "status": "completed", "conclusion": "success"},
            ],
            "failure",
        ),
    ],
)
def test_wait_for_check_uses_the_most_recent_run(monkeypatch, runs, expected):
    monkeypatch.setattr("scripts.guide.lockstep.subprocess.run", lambda *a, **k: _completed(json.dumps(runs)))
    assert wait_for_check("owner/guide", "a" * 40, poll_s=0) == expected


def test_wait_for_check_waits_on_a_newer_run_still_in_progress(monkeypatch):
    runs = [
        {"id": 11, "name": "image", "status": "completed", "conclusion": "success"},
        {"id": 12, "name": "image", "status": "in_progress", "conclusion": None},
    ]
    monkeypatch.setattr("scripts.guide.lockstep.subprocess.run", lambda *a, **k: _completed(json.dumps(runs)))
    monkeypatch.setattr("scripts.guide.lockstep.time.sleep", lambda s: None)
    with pytest.raises(TimeoutError):
        wait_for_check("owner/guide", "a" * 40, timeout_s=0, poll_s=0)


def test_wait_for_check_times_out_when_the_check_never_appears(monkeypatch):
    calls: list[int] = []

    def run(*a, **k):
        calls.append(1)
        return _completed("[]")

    clock = iter([0.0, 5.0, 10.0, 15.0])
    monkeypatch.setattr("scripts.guide.lockstep.subprocess.run", run)
    monkeypatch.setattr("scripts.guide.lockstep.time.sleep", lambda s: None)
    monkeypatch.setattr("scripts.guide.lockstep.time.monotonic", lambda: next(clock))
    with pytest.raises(TimeoutError):
        wait_for_check("owner/guide", "a" * 40, timeout_s=12, poll_s=5)
    assert len(calls) == 3


def test_wait_for_check_waits_twenty_minutes_by_default():
    assert inspect.signature(wait_for_check).parameters["timeout_s"].default == 1200


def test_wait_for_check_treats_a_gh_failure_as_not_ready(monkeypatch):
    monkeypatch.setattr("scripts.guide.lockstep.subprocess.run", lambda *a, **k: _completed("", rc=1))
    monkeypatch.setattr("scripts.guide.lockstep.time.sleep", lambda s: None)
    with pytest.raises(TimeoutError):
        wait_for_check("owner/guide", "a" * 40, timeout_s=0, poll_s=0)


# ------------------------------- executor -------------------------------

MERGE_SHA = "c" * 40
TIP_SHA = "e" * 40
START_HEAD = "a" * 40
NEW_HEAD = "d" * 40
TIP_FACTS = '{"facts": "kindred main tip"}\n'
OLD_FACTS = '{"facts": "guide main, stale"}\n'
OWNED = ["src/data/facts.json", "src/data/source.json"]
GUIDE_REPO = "owner/private-guide-repo"
GUIDE_TOKEN = "guide-token-SECRET"
KINDRED_TOKEN = "kindred-token-READ"
BRANCH = "feature/private-branch"
SYNC_BRANCH = f"facts-sync/{MERGE_SHA[:7]}"
TITLE = "feat(frontend): a title that must stay out of the log"
KINDRED_PR = {
    "number": 3001,
    "title": TITLE,
    "headRefName": BRANCH,
    "headRepo": "owner/kindred",
    "mergeCommit": MERGE_SHA,
}
LEAKY_STDERR = "fatal: could not read from https://github.com/owner/private-guide-repo.git page text"


class FakeRun:
    """Stands in for subprocess.run; answers by matching the argv.

    It keeps just enough git state to tell a clone's starting HEAD from the
    one after a commit, and whether a merge of guide main is in progress.
    `merge_results` gives one outcome per guide-main merge, in order:
    "up-to-date", "clean", or a list of conflicted paths.
    """

    def __init__(
        self,
        *,
        kindred_prs: list[dict[str, Any]] | None = None,
        facts_changed: bool = False,
        guide_prs: list[dict[str, Any]] | None = None,
        conclusion: str = "success",
        fail: str | None = None,
        staged_changes: bool = True,
        merge_results: list[Any] | None = None,
        pr_merge_failures: int = 0,
        guide_main_facts: str = OLD_FACTS,
        pr_state_after_failed_merge: str = "OPEN",
    ) -> None:
        self.kindred_prs = [KINDRED_PR] if kindred_prs is None else kindred_prs
        self.facts_changed = facts_changed
        self.guide_prs = (
            [{"number": 4242, "headRefName": BRANCH, "baseRefName": "main"}] if guide_prs is None else guide_prs
        )
        self.conclusion = conclusion
        self.fail = fail
        self.staged_changes = staged_changes
        self.merge_results = list(merge_results or [])
        self.pr_merge_failures = pr_merge_failures
        self.guide_main_facts = guide_main_facts
        self.pr_state_after_failed_merge = pr_state_after_failed_merge
        self.committed = False
        self.merging = False
        self.conflicts: list[str] = []
        self.calls: list[tuple[list[str], dict[str, str], str | None]] = []

    def _key(self, cmd: list[str]) -> str:
        if cmd[0] == "gh":
            if cmd[1] == "api" and "/commits/" in cmd[2] and cmd[2].endswith("/pulls"):
                return "kindred-pulls"
            if cmd[1] == "api" and "/check-runs" in cmd[2]:
                return "check-runs"
            return "gh " + " ".join(cmd[1:3])
        git = [c for c in cmd[1:] if not c.startswith("-c") and "credential" not in c and "=" not in c]
        sub = next(c for c in git if not c.startswith("-") and c != "-C")
        return "git " + sub

    def __call__(self, cmd, *args, env=None, cwd=None, **kwargs):
        cmd = list(cmd)
        self.calls.append((cmd, dict(env or {}), cwd))
        key = self._key(cmd)
        if self.fail == key:
            return subprocess.CompletedProcess(cmd, 1, stdout=LEAKY_STDERR, stderr=LEAKY_STDERR)
        out = ""
        rc = 0
        if key == "kindred-pulls":
            out = json.dumps(self.kindred_prs)
        elif key == "gh pr list":
            out = json.dumps(self.guide_prs)
        elif key == "git diff":
            if "--cached" in cmd:
                rc = 1 if self.staged_changes else 0
            elif "--diff-filter=U" in cmd:
                out = "".join(f"{p}\n" for p in self.conflicts)
            else:
                out = "scripts/guide/facts.json\n" if self.facts_changed else ""
        elif key == "git show":
            out = TIP_FACTS
        elif key == "git clone":
            data = Path(cmd[-1]) / "src" / "data"
            data.mkdir(parents=True, exist_ok=True)
            (data / "facts.json").write_text(self.guide_main_facts, encoding="utf-8")
            self.committed = self.merging = False
            self.conflicts = []
        elif key == "git merge":
            if "--abort" in cmd:
                self.merging = False
            else:
                result = self.merge_results.pop(0) if self.merge_results else "up-to-date"
                if result == "clean":
                    self.merging = True
                elif isinstance(result, list):
                    self.merging = True
                    self.conflicts = result
                    rc = 1
        elif key == "git commit":
            self.committed = True
            self.merging = False
        elif key == "git rev-parse":
            if "FETCH_HEAD" in cmd:
                out = TIP_SHA + "\n"
            elif "MERGE_HEAD" in cmd:
                rc = 0 if self.merging else 1
                out = (NEW_HEAD + "\n") if self.merging else ""
            else:
                out = (NEW_HEAD if self.committed else START_HEAD) + "\n"
        elif key == "check-runs":
            out = json.dumps([{"name": "image", "status": "completed", "conclusion": self.conclusion}])
        elif key == "gh pr create":
            out = "https://github.com/owner/private-guide-repo/pull/77\n"
        elif key == "gh pr view":
            out = self.pr_state_after_failed_merge + "\n"
        elif key == "gh pr merge" and self.pr_merge_failures > 0:
            self.pr_merge_failures -= 1
            return subprocess.CompletedProcess(cmd, 1, stdout=LEAKY_STDERR, stderr=LEAKY_STDERR)
        return subprocess.CompletedProcess(cmd, rc, stdout=out, stderr="")

    def called(self) -> list[str]:
        return [self._key(c) for c, _, _ in self.calls]

    def all(self, key: str) -> list[list[str]]:
        return [c for c, _, _ in self.calls if self._key(c) == key]

    def call(self, key: str) -> tuple[list[str], dict[str, str], str | None]:
        matches = [c for c in self.calls if self._key(c[0]) == key]
        assert matches, f"no {key!r} call in {self.called()}"
        return matches[-1]


@pytest.fixture
def env(monkeypatch, tmp_path):
    monkeypatch.setenv("KINDRED_REPO", "owner/kindred")
    monkeypatch.setenv("KINDRED_TOKEN", KINDRED_TOKEN)
    monkeypatch.setenv("GUIDE_REPO", GUIDE_REPO)
    monkeypatch.setenv("GUIDE_TOKEN", GUIDE_TOKEN)
    monkeypatch.setenv("GH_TOKEN", "ambient-token-must-not-leak")
    monkeypatch.setenv("RUNNER_TEMP", str(tmp_path))
    monkeypatch.setattr("scripts.guide.lockstep.time.sleep", lambda s: None)


def _install(monkeypatch: pytest.MonkeyPatch, fake: FakeRun) -> FakeRun:
    monkeypatch.setattr("scripts.guide.lockstep.subprocess.run", fake)
    return fake


def _spy_writes(monkeypatch: pytest.MonkeyPatch, fake: FakeRun) -> list[dict[str, str]]:
    """Install `fake`, recording the lockstep-owned files each time they are staged."""
    written: list[dict[str, str]] = []

    def spy(cmd, *a, **k):
        if fake._key(list(cmd)) == "git add":
            root = Path(k["cwd"])
            written.append({rel: (root / rel).read_text(encoding="utf-8") for rel in OWNED})
        return fake(cmd, *a, **k)

    monkeypatch.setattr("scripts.guide.lockstep.subprocess.run", spy)
    return written


def _assert_quiet(out: str) -> None:
    """Nothing private reaches the public log, and only the two line shapes do."""
    for secret in (GUIDE_REPO, "private-guide-repo", BRANCH, "private-branch", TITLE, "4242", "3001", "#77"):
        assert secret not in out
    assert GUIDE_TOKEN not in out
    assert KINDRED_TOKEN not in out
    assert "page text" not in out
    assert "fatal" not in out
    for line in out.splitlines():
        assert line.startswith(("plan: ", "lockstep: ")), line


@pytest.mark.parametrize("sha", ["", "abc", "C" * 40, "c" * 39, "c" * 41, "c" * 39 + "g", "c" * 40 + "\n"])
def test_a_bad_merge_sha_is_refused_before_anything_runs(monkeypatch, env, capsys, sha):
    fake = _install(monkeypatch, FakeRun())
    assert main(["--merge-sha", sha]) == 1
    assert capsys.readouterr().out == "lockstep: bad merge sha\n"
    assert fake.calls == []


def test_missing_guide_access_skips_cleanly(monkeypatch, env, capsys):
    monkeypatch.delenv("GUIDE_TOKEN")
    fake = _install(monkeypatch, FakeRun())
    assert main(["--merge-sha", MERGE_SHA]) == 0
    assert capsys.readouterr().out == "lockstep: skipped (no guide access configured)\n"
    assert fake.calls == []


def test_a_direct_push_with_no_pr_does_nothing(monkeypatch, env, capsys):
    fake = _install(monkeypatch, FakeRun(kindred_prs=[]))
    assert main(["--merge-sha", MERGE_SHA]) == 0
    out = capsys.readouterr().out
    assert out.startswith("plan: nothing (")
    assert "gh pr list" not in fake.called()


def test_dry_run_prints_the_plan_and_touches_nothing(monkeypatch, env, capsys):
    fake = _install(monkeypatch, FakeRun())
    assert main(["--merge-sha", MERGE_SHA, "--dry-run"]) == 0
    out = capsys.readouterr().out
    assert out.startswith("plan: merge-paired (")
    assert out.count("\n") == 1
    _assert_quiet(out)
    assert not {"git clone", "git fetch", "git push", "gh pr merge", "gh pr create"} & set(fake.called())


def test_the_kindred_lookup_asks_for_head_repo_and_merge_commit(monkeypatch, env, capsys):
    fake = _install(monkeypatch, FakeRun())
    assert main(["--merge-sha", MERGE_SHA, "--dry-run"]) == 0
    jq = fake.call("kindred-pulls")[0][-1]
    assert "headRepo: .head.repo.full_name" in jq
    assert "mergeCommit: .merge_commit_sha" in jq
    listing = fake.call("gh pr list")[0]
    assert listing[listing.index("--json") + 1] == "number,headRefName,baseRefName"


def test_a_fork_pr_is_never_paired(monkeypatch, env, capsys):
    fork = {**KINDRED_PR, "headRepo": "someone/kindred"}
    fake = _install(monkeypatch, FakeRun(kindred_prs=[fork]))
    assert main(["--merge-sha", MERGE_SHA]) == 0
    out = capsys.readouterr().out
    assert out.startswith("plan: nothing (")
    _assert_quiet(out)
    assert "someone" not in out
    assert "gh pr list" not in fake.called()


def test_a_deleted_fork_head_is_never_paired(monkeypatch, env, capsys):
    _install(monkeypatch, FakeRun(kindred_prs=[{**KINDRED_PR, "headRepo": None}]))
    assert main(["--merge-sha", MERGE_SHA]) == 0
    assert capsys.readouterr().out.startswith("plan: nothing (")


def test_of_several_kindred_prs_the_one_this_sha_merged_wins(monkeypatch, env, capsys):
    other = {**KINDRED_PR, "number": 3002, "title": "other", "headRefName": "feature/other", "mergeCommit": "b" * 40}
    fake = _install(monkeypatch, FakeRun(kindred_prs=[other, KINDRED_PR]))
    assert main(["--merge-sha", MERGE_SHA]) == 0
    merge = fake.call("gh pr merge")[0]
    assert merge[merge.index("--subject") + 1] == TITLE


def test_several_kindred_prs_none_merged_by_this_sha_does_nothing(monkeypatch, env, capsys):
    a = {**KINDRED_PR, "mergeCommit": "b" * 40}
    b = {**KINDRED_PR, "number": 3002, "mergeCommit": None}
    fake = _install(monkeypatch, FakeRun(kindred_prs=[a, b]))
    assert main(["--merge-sha", MERGE_SHA]) == 0
    assert capsys.readouterr().out.startswith("plan: nothing (")
    assert "gh pr list" not in fake.called()


def test_a_paired_pr_on_another_base_is_left_alone(monkeypatch, env, capsys):
    stacked = [{"number": 4242, "headRefName": BRANCH, "baseRefName": "feature/parent"}]
    fake = _install(monkeypatch, FakeRun(guide_prs=stacked))
    assert main(["--merge-sha", MERGE_SHA]) == 0
    out = capsys.readouterr().out
    assert out == "plan: nothing (paired guide PR is not based on main)\n"
    assert "git clone" not in fake.called()


def test_kindred_reads_use_the_workflow_token_and_guide_calls_the_guide_token(monkeypatch, env, capsys):
    fake = _install(monkeypatch, FakeRun())
    assert main(["--merge-sha", MERGE_SHA]) == 0
    for cmd, run_env, cwd in fake.calls:
        key = fake._key(cmd)
        if key == "kindred-pulls" or (key == "git fetch" and cwd is None):
            assert run_env.get("GH_TOKEN") == KINDRED_TOKEN, key
        elif cmd[0] == "gh" or key in ("git clone", "git push"):
            assert run_env.get("GH_TOKEN") == GUIDE_TOKEN, key
        else:
            assert "GH_TOKEN" not in run_env, key
        assert "GUIDE_TOKEN" not in run_env
        assert "KINDRED_TOKEN" not in run_env
        assert run_env.get("GH_TOKEN") != "ambient-token-must-not-leak"


def test_no_token_ever_appears_on_an_argv(monkeypatch, env, capsys):
    fake = _install(monkeypatch, FakeRun())
    assert main(["--merge-sha", MERGE_SHA]) == 0
    for cmd, _, _ in fake.calls:
        joined = " ".join(cmd)
        assert GUIDE_TOKEN not in joined
        assert KINDRED_TOKEN not in joined
        assert "x-access-token" not in joined


def test_git_authenticates_through_gh_credential_helper(monkeypatch, env, capsys):
    fake = _install(monkeypatch, FakeRun())
    assert main(["--merge-sha", MERGE_SHA]) == 0
    for key in ("git fetch", "git clone", "git push"):
        cmd = " ".join(fake.call(key)[0])
        assert "credential.helper=!gh auth git-credential" in cmd, key
        assert " -q" in cmd or "--quiet" in cmd, key


def test_merge_paired_happy_path(monkeypatch, env, capsys):
    fake = _install(monkeypatch, FakeRun())
    assert main(["--merge-sha", MERGE_SHA]) == 0
    out = capsys.readouterr().out
    assert out.splitlines() == [out.splitlines()[0], "lockstep: merged"]
    assert out.startswith("plan: merge-paired (")
    _assert_quiet(out)

    clone = fake.call("git clone")[0]
    assert clone[clone.index("--branch") + 1] == BRANCH
    assert "--depth" not in clone, "merging guide main needs history"
    assert "gh pr create" not in fake.called()

    merge = fake.call("gh pr merge")[0]
    assert "4242" in merge
    assert "--squash" in merge
    assert "--delete-branch" in merge
    assert merge[merge.index("--match-head-commit") + 1] == NEW_HEAD
    assert merge[merge.index("--subject") + 1] == TITLE
    assert merge[merge.index("--body") + 1] == f"Paired-with: kindred@{MERGE_SHA}"
    assert merge[merge.index("-R") + 1] == GUIDE_REPO

    check = fake.call("check-runs")[0]
    assert f"repos/{GUIDE_REPO}/commits/{NEW_HEAD}/check-runs" in check[2]


# D1-e (b): content is state-based -- kindred main's TIP, not the merge commit.


def test_the_guide_gets_kindred_main_tips_facts_and_stamp(monkeypatch, env, capsys):
    fake = FakeRun()
    written = _spy_writes(monkeypatch, fake)
    assert main(["--merge-sha", MERGE_SHA]) == 0
    assert written[-1]["src/data/facts.json"] == TIP_FACTS
    assert written[-1]["src/data/source.json"] == json.dumps({"kindred_sha": TIP_SHA}) + "\n"

    fetch, fetch_env, fetch_cwd = fake.call("git fetch")
    assert fetch_cwd is None
    assert fetch_env["GH_TOKEN"] == KINDRED_TOKEN
    assert fetch[-2:] == ["origin", "refs/heads/main"]
    assert "--depth=1" in fetch
    assert fake.call("git show")[0][-1] == f"{TIP_SHA}:scripts/guide/facts.json"

    commit = " ".join(fake.call("git commit")[0])
    assert f"chore(facts): sync from kindred@{TIP_SHA[:7]}" in commit
    assert "user.name=guide-lockstep" in commit
    assert "user.email=noreply@example.test" in commit
    assert fake.call("git push")[0][-1] == f"HEAD:refs/heads/{BRANCH}"


def test_a_dry_run_of_an_error_plan_still_exits_1(monkeypatch, env, capsys):
    """The workflow_dispatch default is dry_run=true; it must show the same red a real run would."""
    two = [{"number": n, "headRefName": BRANCH, "baseRefName": "main"} for n in (4242, 4243)]
    fake = _install(monkeypatch, FakeRun(guide_prs=two))
    assert main(["--merge-sha", MERGE_SHA, "--dry-run"]) == 1
    out = capsys.readouterr().out
    assert out.startswith("plan: error (")
    _assert_quiet(out)
    assert not {"git clone", "git push", "gh pr merge", "gh pr create"} & set(fake.called())


def test_the_merge_sha_still_decides_the_plan(monkeypatch, env, capsys):
    fake = _install(monkeypatch, FakeRun(guide_prs=[], facts_changed=False))
    assert main(["--merge-sha", MERGE_SHA, "--dry-run"]) == 0
    assert capsys.readouterr().out.startswith("plan: nothing (")
    diff = fake.call("git diff")[0]
    assert f"{MERGE_SHA}^" in diff
    assert MERGE_SHA in diff
    assert diff[-1] == "scripts/guide/facts.json"
    assert fake.call("kindred-pulls")[0][2].endswith(f"/commits/{MERGE_SHA}/pulls")


def test_a_paired_pr_already_carrying_the_facts_merges_without_a_new_commit(monkeypatch, env, capsys):
    fake = _install(monkeypatch, FakeRun(staged_changes=False))
    assert main(["--merge-sha", MERGE_SHA]) == 0
    assert "git commit" not in fake.called()
    assert "git push" not in fake.called()
    merge = fake.call("gh pr merge")[0]
    assert merge[merge.index("--match-head-commit") + 1] == START_HEAD


# D1-e (c): merge guide main into the branch before writing.


def test_guide_main_is_merged_in_before_the_facts_are_written(monkeypatch, env, capsys):
    fake = _install(monkeypatch, FakeRun(merge_results=["clean"]))
    assert main(["--merge-sha", MERGE_SHA]) == 0
    keys = fake.called()
    assert keys.index("git merge") < keys.index("git add")
    merge = fake.call("git merge")[0]
    assert merge[-1] == "origin/main"
    assert "user.name=guide-lockstep" in " ".join(merge)
    assert fake.call("git merge")[2] is not None, "runs inside the guide clone"


def test_a_clean_main_merge_is_committed_and_pushed_even_with_no_data_change(monkeypatch, env, capsys):
    fake = _install(monkeypatch, FakeRun(merge_results=["clean"], staged_changes=False))
    assert main(["--merge-sha", MERGE_SHA]) == 0
    assert "git commit" in fake.called()
    assert "git push" in fake.called()
    merge = fake.call("gh pr merge")[0]
    assert merge[merge.index("--match-head-commit") + 1] == NEW_HEAD


@pytest.mark.parametrize("conflicts", [["src/data/facts.json"], ["src/data/source.json"], OWNED])
def test_conflicts_only_in_lockstep_owned_files_are_resolved_by_the_overwrite(monkeypatch, env, capsys, conflicts):
    fake = FakeRun(merge_results=[conflicts])
    written = _spy_writes(monkeypatch, fake)
    assert main(["--merge-sha", MERGE_SHA]) == 0
    assert capsys.readouterr().out.endswith("lockstep: merged\n")
    assert written[-1]["src/data/facts.json"] == TIP_FACTS
    assert not [c for c in fake.all("git merge") if "--abort" in c]
    assert "git commit" in fake.called()
    assert "git push" in fake.called()


@pytest.mark.parametrize("conflicts", [["src/pages/howto.md"], ["src/pages/howto.md", "src/data/facts.json"]])
def test_any_other_conflict_pushes_and_merges_nothing(monkeypatch, env, capsys, conflicts):
    fake = _install(monkeypatch, FakeRun(merge_results=[conflicts]))
    assert main(["--merge-sha", MERGE_SHA]) == 1
    out = capsys.readouterr().out
    assert out.splitlines()[-1] == "lockstep: guide PR conflicts with main"
    _assert_quiet(out)
    assert "howto" not in out
    for key in ("git commit", "git push", "gh pr merge"):
        assert key not in fake.called(), key


# D1-e (d): a failed merge redoes (c) -> push -> check -> merge, 3 attempts in all.


def test_a_failed_merge_is_retried_from_a_fresh_main_merge(monkeypatch, env, capsys):
    fake = _install(monkeypatch, FakeRun(pr_merge_failures=1, merge_results=["up-to-date", "clean"]))
    assert main(["--merge-sha", MERGE_SHA]) == 0
    assert capsys.readouterr().out.endswith("lockstep: merged\n")
    assert len(fake.all("gh pr merge")) == 2
    assert len(fake.all("git clone")) == 2
    assert len([c for c in fake.all("git merge") if "--abort" not in c]) == 2
    assert len(fake.all("git fetch")) == 2, "the kindred tip is re-read each attempt"
    assert len(fake.all("check-runs")) >= 2
    assert all(c[c.index("--branch") + 1] == BRANCH for c in fake.all("git clone"))


@pytest.mark.parametrize("guide_prs", [None, []], ids=["paired", "sync"])
def test_the_kindred_tip_is_read_after_each_guide_clone(monkeypatch, env, capsys, guide_prs):
    """A tip read BEFORE the clone can be older than a stamp another run has
    already merged into guide main; merging main in and then writing that older
    tip reverts guide main without any squash conflict. Read after the clone,
    the tip is never older than anything the clone's main holds."""
    fake = _install(monkeypatch, FakeRun(guide_prs=guide_prs, facts_changed=True, pr_merge_failures=1))
    assert main(["--merge-sha", MERGE_SHA]) == 0
    order = [k for k in fake.called() if k in ("git clone", "git fetch")]
    assert order == ["git clone", "git fetch", "git clone", "git fetch"]


def test_a_merge_that_landed_but_reported_failure_is_not_retried(monkeypatch, env, capsys):
    """e.g. the squash landed and only --delete-branch failed: a retry would re-clone a gone branch."""
    fake = _install(monkeypatch, FakeRun(pr_merge_failures=1, pr_state_after_failed_merge="MERGED"))
    assert main(["--merge-sha", MERGE_SHA]) == 0
    assert capsys.readouterr().out.endswith("lockstep: merged\n")
    assert len(fake.all("gh pr merge")) == 1
    assert len(fake.all("git clone")) == 1
    view = fake.call("gh pr view")
    assert view[1]["GH_TOKEN"] == GUIDE_TOKEN
    assert "4242" in view[0]


def test_three_failed_merges_give_up(monkeypatch, env, capsys):
    fake = _install(monkeypatch, FakeRun(pr_merge_failures=10))
    assert main(["--merge-sha", MERGE_SHA]) == 1
    out = capsys.readouterr().out
    assert out.splitlines()[-1] == "lockstep: merge failed"
    _assert_quiet(out)
    assert len(fake.all("gh pr merge")) == 3


def test_a_retry_that_now_conflicts_stops(monkeypatch, env, capsys):
    fake = _install(monkeypatch, FakeRun(pr_merge_failures=1, merge_results=["clean", ["src/pages/howto.md"]]))
    assert main(["--merge-sha", MERGE_SHA]) == 1
    assert capsys.readouterr().out.splitlines()[-1] == "lockstep: guide PR conflicts with main"
    assert len(fake.all("gh pr merge")) == 1
    assert len(fake.all("git push")) == 1


def test_a_facts_sync_retry_reuses_its_pr_and_branch(monkeypatch, env, capsys):
    fake = _install(monkeypatch, FakeRun(guide_prs=[], facts_changed=True, pr_merge_failures=1))
    assert main(["--merge-sha", MERGE_SHA]) == 0
    assert len(fake.all("gh pr create")) == 1
    clones = fake.all("git clone")
    assert [c[c.index("--branch") + 1] for c in clones] == ["main", SYNC_BRANCH]
    assert all("77" in m for m in fake.all("gh pr merge"))


# D1-e (e): never open a sync PR for facts guide main already has.


def test_facts_sync_opens_a_pr_and_merges_it_once_green(monkeypatch, env, capsys):
    fake = _install(monkeypatch, FakeRun(guide_prs=[], facts_changed=True))
    assert main(["--merge-sha", MERGE_SHA]) == 0
    out = capsys.readouterr().out
    assert out.startswith("plan: open-facts-sync (")
    assert out.endswith("lockstep: merged\n")
    _assert_quiet(out)

    clone = fake.call("git clone")[0]
    assert clone[clone.index("--branch") + 1] == "main"
    assert fake.call("git push")[0][-1] == f"HEAD:refs/heads/{SYNC_BRANCH}"
    create = fake.call("gh pr create")[0]
    assert create[create.index("--head") + 1] == SYNC_BRANCH
    assert create[create.index("--title") + 1] == f"chore(facts): sync from kindred@{MERGE_SHA[:7]}"
    assert create[create.index("--body") + 1] == f"Paired-with: kindred@{MERGE_SHA}"
    merge = fake.call("gh pr merge")[0]
    assert "77" in merge
    assert "--delete-branch" in merge
    assert merge[merge.index("--match-head-commit") + 1] == NEW_HEAD


def test_a_new_sync_branch_overwrites_an_orphaned_one_of_the_same_name(monkeypatch, env, capsys):
    """A run that pushed facts-sync/<sha7> but failed to open its PR (or whose PR
    was closed) leaves the branch with no open PR. The re-run starts a fresh
    branch from main, so a plain push would be a non-fast-forward forever."""
    fake = _install(monkeypatch, FakeRun(guide_prs=[], facts_changed=True))
    assert main(["--merge-sha", MERGE_SHA]) == 0
    push = fake.call("git push")[0]
    assert "--force" in push
    assert push[-1] == f"HEAD:refs/heads/{SYNC_BRANCH}"


@pytest.mark.parametrize(
    "guide_prs",
    [
        [{"number": 4242, "headRefName": BRANCH, "baseRefName": "main"}],
        [{"number": 88, "headRefName": SYNC_BRANCH, "baseRefName": "main"}],
    ],
    ids=["paired", "reused-sync"],
)
def test_an_existing_branch_is_never_force_pushed(monkeypatch, env, capsys, guide_prs):
    fake = _install(monkeypatch, FakeRun(guide_prs=guide_prs, facts_changed=True, guide_main_facts=TIP_FACTS))
    assert main(["--merge-sha", MERGE_SHA]) == 0
    assert all("--force" not in c and not c[-1].startswith("+") for c in fake.all("git push"))


def test_a_rerun_reuses_the_open_sync_pr_for_this_sha(monkeypatch, env, capsys):
    """Round 1, item 1: a sync that failed after opening its PR is recoverable by re-run."""
    existing = [{"number": 88, "headRefName": SYNC_BRANCH, "baseRefName": "main"}]
    fake = _install(monkeypatch, FakeRun(guide_prs=existing, facts_changed=True, guide_main_facts=TIP_FACTS))
    assert main(["--merge-sha", MERGE_SHA]) == 0
    out = capsys.readouterr().out
    assert out.startswith("plan: open-facts-sync (")
    assert out.endswith("lockstep: merged\n")
    _assert_quiet(out)
    assert "88" not in out
    assert "gh pr create" not in fake.called()
    clones = fake.all("git clone")
    assert [c[c.index("--branch") + 1] for c in clones] == [SYNC_BRANCH]
    assert "git checkout" not in fake.called()
    keys = fake.called()
    assert keys.index("git merge") < keys.index("git add"), "catches up with guide main first"
    assert fake.call("git push")[0][-1] == f"HEAD:refs/heads/{SYNC_BRANCH}"
    merge = fake.call("gh pr merge")[0]
    assert "88" in merge
    assert merge[merge.index("--match-head-commit") + 1] == NEW_HEAD


@pytest.mark.parametrize(
    "decoy",
    [
        {"number": 89, "headRefName": f"facts-sync/{'b' * 7}", "baseRefName": "main"},
        {"number": 89, "headRefName": f"x{SYNC_BRANCH}", "baseRefName": "main"},
        {"number": 89, "headRefName": SYNC_BRANCH, "baseRefName": "feature/parent"},
    ],
)
def test_only_an_exact_sync_pr_on_main_is_reused(monkeypatch, env, capsys, decoy):
    fake = _install(monkeypatch, FakeRun(guide_prs=[decoy], facts_changed=True))
    assert main(["--merge-sha", MERGE_SHA]) == 0
    assert len(fake.all("gh pr create")) == 1
    assert fake.call("git clone")[0][fake.call("git clone")[0].index("--branch") + 1] == "main"
    assert "77" in fake.call("gh pr merge")[0]


def test_facts_sync_skips_when_guide_main_already_has_the_tips_facts(monkeypatch, env, capsys):
    fake = _install(monkeypatch, FakeRun(guide_prs=[], facts_changed=True, guide_main_facts=TIP_FACTS))
    assert main(["--merge-sha", MERGE_SHA]) == 0
    out = capsys.readouterr().out
    assert out.splitlines()[-1] == "lockstep: facts already in sync"
    _assert_quiet(out)
    for key in ("git commit", "git push", "gh pr create", "gh pr merge"):
        assert key not in fake.called(), key


def test_a_paired_pr_merges_even_when_guide_main_already_has_the_facts(monkeypatch, env, capsys):
    """The pair carries doc changes too; facts equality only short-cuts a sync."""
    fake = _install(monkeypatch, FakeRun(guide_main_facts=TIP_FACTS))
    assert main(["--merge-sha", MERGE_SHA]) == 0
    assert "gh pr merge" in fake.called()


def test_two_open_guide_prs_on_the_branch_is_a_hard_failure(monkeypatch, env, capsys):
    prs = [{"number": 4242, "headRefName": BRANCH}, {"number": 4243, "headRefName": BRANCH}]
    fake = _install(monkeypatch, FakeRun(guide_prs=prs))
    assert main(["--merge-sha", MERGE_SHA]) == 1
    out = capsys.readouterr().out
    assert "plan: error (2 open guide PRs" in out
    _assert_quiet(out)
    assert "4243" not in out
    assert "gh pr merge" not in fake.called()
    assert "git clone" not in fake.called()


@pytest.mark.parametrize("conclusion", ["failure", "cancelled", "timed_out"])
def test_a_red_guide_check_merges_nothing(monkeypatch, env, capsys, conclusion):
    fake = _install(monkeypatch, FakeRun(conclusion=conclusion))
    assert main(["--merge-sha", MERGE_SHA]) == 1
    out = capsys.readouterr().out
    assert out.splitlines()[-1] == f"lockstep: guide check {conclusion}; nothing merged"
    assert "gh pr merge" not in fake.called()


def test_a_check_that_never_finishes_merges_nothing(monkeypatch, env, capsys):
    fake = _install(monkeypatch, FakeRun())

    def never(*a, **k):
        raise TimeoutError

    monkeypatch.setattr(lockstep, "wait_for_check", never)
    assert main(["--merge-sha", MERGE_SHA]) == 1
    assert capsys.readouterr().out.splitlines()[-1] == "lockstep: guide check timed out; nothing merged"
    assert "gh pr merge" not in fake.called()


@pytest.mark.parametrize(
    ("fail", "message"),
    [
        ("kindred-pulls", "lockstep: kindred PR lookup failed"),
        ("gh pr list", "lockstep: guide PR list failed"),
        ("git fetch", "lockstep: kindred fetch failed"),
        ("git clone", "lockstep: guide clone failed"),
        ("git push", "lockstep: guide push failed"),
        ("gh pr merge", "lockstep: merge failed"),
    ],
)
def test_failures_print_only_their_class(monkeypatch, env, capsys, fail, message):
    _install(monkeypatch, FakeRun(fail=fail))
    assert main(["--merge-sha", MERGE_SHA]) == 1
    out = capsys.readouterr().out
    assert out.splitlines()[-1] == message
    _assert_quiet(out)


def test_a_failed_pr_create_merges_nothing(monkeypatch, env, capsys):
    fake = _install(monkeypatch, FakeRun(guide_prs=[], facts_changed=True, fail="gh pr create"))
    assert main(["--merge-sha", MERGE_SHA]) == 1
    out = capsys.readouterr().out
    assert out.splitlines()[-1] == "lockstep: guide PR create failed"
    _assert_quiet(out)
    assert "gh pr merge" not in fake.called()


def test_an_unexpected_exception_prints_only_its_type(monkeypatch, env, capsys):
    def boom(*a, **k):
        raise RuntimeError(f"leaks {GUIDE_REPO}")

    monkeypatch.setattr("scripts.guide.lockstep.subprocess.run", boom)
    assert main(["--merge-sha", MERGE_SHA]) == 1
    out = capsys.readouterr().out
    assert out == "lockstep: internal error (RuntimeError)\n"


# ------------------------------- workflow -------------------------------


def _workflow() -> dict[Any, Any]:
    wf = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    assert isinstance(wf, dict)
    return wf


def test_workflow_runs_after_main_moves_and_on_demand():
    on = _workflow()[True]  # PyYAML reads the bare key `on` as True
    assert on["push"]["branches"] == ["main"]
    assert set(on["workflow_dispatch"]["inputs"]) == {"merge_sha", "dry_run"}
    assert on["workflow_dispatch"]["inputs"]["dry_run"]["default"] is True


def test_workflow_permissions_are_read_only():
    assert _workflow()["permissions"] == {"contents": "read", "pull-requests": "read"}


def test_workflow_queues_per_merge_sha_and_never_cancels():
    """D1-e (a): one group per SHA, so a pending run is never dropped by a newer one."""
    concurrency = _workflow()["concurrency"]
    assert concurrency["group"] == "guide-lockstep-${{ inputs.merge_sha || github.sha }}"
    assert concurrency["cancel-in-progress"] is False


def test_workflow_timeout_fits_three_full_check_waits():
    assert _workflow()["jobs"]["lockstep"]["timeout-minutes"] == 75
    assert lockstep.MERGE_ATTEMPTS * lockstep.CHECK_TIMEOUT_S / 60 < 75


def test_workflow_step_env_carries_only_secrets_repo_token_sha_and_flag():
    """Step env is printed in the PUBLIC log header (D1-b)."""
    job = _workflow()["jobs"]["lockstep"]
    step = next(s for s in job["steps"] if "run" in s)
    assert step["env"] == {
        "GUIDE_TOKEN": "${{ secrets.GUIDE_WRITE_TOKEN }}",
        "GUIDE_REPO": "${{ secrets.GUIDE_REPO }}",
        "KINDRED_TOKEN": "${{ github.token }}",
        "KINDRED_REPO": "${{ github.repository }}",
        "MERGE_SHA": "${{ inputs.merge_sha || github.sha }}",
        "DRY_RUN": "${{ inputs.dry_run && 'true' || 'false' }}",
    }
    assert "${{" not in step["run"]
    assert "scripts.guide.lockstep" in step["run"]


def test_workflow_actions_are_sha_pinned_and_checkout_drops_credentials():
    job = _workflow()["jobs"]["lockstep"]
    uses = [s["uses"] for s in job["steps"] if "uses" in s]
    assert all("@" in u and len(u.split("@")[1]) == 40 for u in uses)
    checkout = next(s for s in job["steps"] if s.get("uses", "").startswith("actions/checkout@"))
    assert checkout["with"]["persist-credentials"] is False
    assert checkout["with"]["fetch-depth"] == 2
    assert "astral-sh/setup-uv@1c37ad07a6a961277cf70c0d37d6f313000f5884" in uses

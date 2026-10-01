"""`scripts/git-tidy.sh` deletes a stale ref only when nothing on it can be lost.

A 2026-09-30 sweep removed 25 local refs and 11 remote branches by hand. Every
one turned out to be landed or superseded -- but the one that nearly wasn't is
why this script exists in the shape it does: a test commit pushed one minute
AFTER its PR squash-merged (kindred#2486) was on the branch and nowhere else.
An age-based or "PR is closed" rule deletes it. So the rule here is containment:

    a ref is deletable only if its tip is already on origin/main, or is
    contained in the head of a MERGED or CLOSED PR -- whose commits GitHub
    keeps under refs/pull/N/head after the branch is gone.

Everything else is reported for a human or agent to look at and left alone.
Stashes are never dropped, only listed. These tests build a throwaway repo
with a bare `origin`, stub `gh` on PATH, and pin each half of that rule.
"""

import json
import os
import stat
import subprocess
from pathlib import Path

import pytest
import yaml

REPO_ROOT = Path(__file__).parents[3]
TIDY = REPO_ROOT / "scripts/git-tidy.sh"
LEFTHOOK_CONFIG = REPO_ROOT / ".lefthook.yml"

OLD = "2026-01-01T12:00:00Z"  # well past the 14-day grace from any real "now"


def _clean_env(**extra: str) -> dict[str, str]:
    """os.environ with every GIT_* variable stripped.

    Load-bearing: under lefthook's pre-push, GIT_DIR / GIT_INDEX_FILE point at
    the REAL repository and git prefers them over `cwd=`. Without this the
    fixture below commits into the developer's worktree. See
    test_worktree_cleanup.py, which measured exactly that.
    """
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    env.update(extra)
    return env


def _git(*args: str, cwd: Path, date: str | None = None) -> str:
    extra = {"GIT_AUTHOR_DATE": date, "GIT_COMMITTER_DATE": date} if date else {}
    return subprocess.run(
        ["git", *args],
        cwd=cwd,
        capture_output=True,
        text=True,
        check=True,
        env=_clean_env(**extra),
    ).stdout.strip()


def _commit(repo: Path, name: str, date: str = OLD) -> str:
    (repo / f"{name}.txt").write_text(f"{name}\n")
    _git("add", "-A", cwd=repo)
    _git("commit", "-qm", name, cwd=repo, date=date)
    return _git("rev-parse", "HEAD", cwd=repo)


def _refs(repo: Path, prefix: str = "refs/") -> set[str]:
    out = _git("for-each-ref", "--format=%(refname)", prefix, cwd=repo)
    return set(out.split()) if out else set()


def _branches(repo: Path) -> set[str]:
    out = _git("for-each-ref", "--format=%(refname:short)", "refs/heads", cwd=repo)
    return set(out.split()) if out else set()


class Gh:
    """A `gh` stub answering `gh pr list --head X` and `gh pr list --search SHA`.

    Answers are JSON arrays of {number, state, headRefOid}, the fields the
    script asks for. Anything unregistered answers `[]`, which is what GitHub
    returns for a commit no PR contains.
    """

    def __init__(self, root: Path) -> None:
        self.root = root
        self.bin = root / "stubbin"
        (root / "gh-head").mkdir(parents=True)
        (root / "gh-search").mkdir(parents=True)
        (root / "gh-side").mkdir(parents=True)
        self.bin.mkdir(parents=True)
        gh = self.bin / "gh"
        gh.write_text(
            "#!/bin/bash\n"
            f'root="{root}"\n'
            '[ -e "$root/gh-fail" ] && { echo "gh: network down" >&2; exit 1; }\n'
            "kind=''; key=''\n"
            "while [ $# -gt 0 ]; do\n"
            '  case "$1" in\n'
            '    --head) kind=head; key="$2"; shift ;;\n'
            '    --search) kind=search; key="$2"; shift ;;\n'
            "  esac\n"
            "  shift\n"
            "done\n"
            'side="$root/gh-side/$kind-$(printf %s "$key" | tr / _)"\n'
            '[ -f "$side" ] && bash "$side" </dev/null >/dev/null\n'
            'f="$root/gh-$kind/$(printf %s "$key" | tr / _)"\n'
            'if [ -f "$f" ]; then cat "$f"; else echo "[]"; fi\n'
        )
        gh.chmod(gh.stat().st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)

    def pr(
        self, number: int, state: str, head: str, *, branch: str | None = None, commits: tuple[str, ...] = ()
    ) -> None:
        """Register PR `number` with head `head`, findable by branch and by commit SHA."""
        payload = json.dumps([{"number": number, "state": state, "headRefOid": head}])
        if branch:
            (self.root / "gh-head" / branch.replace("/", "_")).write_text(payload)
        for sha in {head, *commits}:
            (self.root / "gh-search" / sha).write_text(payload)

    def on_search(self, sha: str, script: str) -> None:
        """Run `script` (bash) whenever the stub is asked `--search sha`, before it answers."""
        (self.root / "gh-side" / f"search-{sha}").write_text(script)

    def fail(self) -> None:
        (self.root / "gh-fail").write_text("")


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    """A clone of a bare `origin` whose main has one old commit."""
    origin = tmp_path / "origin.git"
    _git("init", "-q", "--bare", "-b", "main", str(origin), cwd=tmp_path)
    work = tmp_path / "repo"
    work.mkdir()
    _git("init", "-q", "-b", "main", cwd=work)
    _git("config", "user.email", "test@example.com", cwd=work)
    _git("config", "user.name", "Test", cwd=work)
    _git("remote", "add", "origin", str(origin), cwd=work)
    _commit(work, "base")
    _git("push", "-q", "origin", "main", cwd=work)
    _git("fetch", "-q", "origin", cwd=work)
    return work


@pytest.fixture
def gh(tmp_path: Path) -> Gh:
    return Gh(tmp_path / "gh")


def _run(repo: Path, gh: Gh, *args: str) -> subprocess.CompletedProcess[str]:
    env = _clean_env(PATH=f"{gh.bin}:{os.environ['PATH']}")
    return subprocess.run(["bash", str(TIDY), *args], cwd=repo, capture_output=True, text=True, env=env)


def _branch_with_commit(repo: Path, branch: str, name: str, date: str = OLD) -> str:
    _git("checkout", "-q", "-b", branch, "main", cwd=repo)
    sha = _commit(repo, name, date)
    _git("checkout", "-q", "main", cwd=repo)
    return sha


def _land_on_main(repo: Path, branch: str) -> None:
    _git("merge", "-q", "--ff-only", branch, cwd=repo)
    _git("push", "-q", "origin", "main", cwd=repo)
    _git("fetch", "-q", "origin", cwd=repo)


# ─── the containment rule ──────────────────────────────────────────────────


def test_a_branch_already_on_main_is_deleted(repo: Path, gh: Gh) -> None:
    _branch_with_commit(repo, "feature/landed", "landed")
    _land_on_main(repo, "feature/landed")

    dry = _run(repo, gh)
    assert dry.returncode == 0, dry.stderr
    assert "feature/landed" in dry.stdout
    assert "feature/landed" in _branches(repo), "the default run must not delete anything"

    applied = _run(repo, gh, "--apply")
    assert applied.returncode == 0, applied.stderr
    assert "feature/landed" not in _branches(repo)


def test_a_review_checkout_of_a_merged_pr_is_deleted(repo: Path, gh: Gh) -> None:
    """A squash merge puts a different SHA on main, so only the PR proves it landed.

    The local name (`pr-12-review`) matches no head branch on GitHub; the PR is
    found by searching for the commit, the way `gh pr list --search <sha>` does.
    """
    sha = _branch_with_commit(repo, "pr-12-review", "reviewed")
    gh.pr(12, "MERGED", sha)

    _run(repo, gh, "--apply")

    assert "pr-12-review" not in _branches(repo)


def test_an_early_commit_of_a_merged_pr_is_deleted(repo: Path, gh: Gh) -> None:
    """The local tip is behind the PR's final head -- still fully contained."""
    first = _branch_with_commit(repo, "pr-13-review", "first")
    _git("checkout", "-q", "-b", "scratch", "pr-13-review", cwd=repo)
    head = _commit(repo, "follow-up")
    _git("checkout", "-q", "main", cwd=repo)
    _git("branch", "-q", "-D", "scratch", cwd=repo)
    gh.pr(13, "MERGED", head, commits=(first,))

    _run(repo, gh, "--apply")

    assert "pr-13-review" not in _branches(repo)


def test_a_pr_head_missing_locally_is_fetched_before_judging(repo: Path, gh: Gh, tmp_path: Path) -> None:
    """The final head often exists only on GitHub, under refs/pull/N/head."""
    first = _branch_with_commit(repo, "feature/fetched", "first")
    _git("push", "-q", "origin", f"{first}:refs/heads/tmp", cwd=repo)
    other = tmp_path / "other"
    _git("clone", "-q", "-b", "tmp", str(tmp_path / "origin.git"), str(other), cwd=tmp_path)
    _git("config", "user.email", "test@example.com", cwd=other)
    _git("config", "user.name", "Test", cwd=other)
    head = _commit(other, "pushed-elsewhere")
    _git("push", "-q", "origin", f"{head}:refs/pull/14/head", cwd=other)
    _git("push", "-q", "origin", "--delete", "tmp", cwd=other)
    gh.pr(14, "CLOSED", head, branch="feature/fetched", commits=(first,))

    result = _run(repo, gh, "--apply")

    assert "feature/fetched" not in _branches(repo), result.stdout + result.stderr


def test_a_commit_pushed_after_the_merge_is_kept(repo: Path, gh: Gh) -> None:
    """The kindred#2486 case: the PR merged, then one more commit landed on the branch.

    That commit is in no PR head and not on main -- the branch is its only copy.
    """
    merged_head = _branch_with_commit(repo, "feature/late", "merged-part")
    _git("checkout", "-q", "feature/late", cwd=repo)
    _commit(repo, "after-merge")
    _git("checkout", "-q", "main", cwd=repo)
    gh.pr(15, "MERGED", merged_head, branch="feature/late")

    result = _run(repo, gh, "--apply")

    assert "feature/late" in _branches(repo), "deleted the only copy of a post-merge commit"
    assert "feature/late" in result.stdout, "a kept ref must still be reported for a look"


def test_unpushed_work_with_no_pr_is_kept(repo: Path, gh: Gh) -> None:
    _branch_with_commit(repo, "feature/unpushed", "wip")

    result = _run(repo, gh, "--apply")

    assert "feature/unpushed" in _branches(repo)
    assert "feature/unpushed" in result.stdout


def test_an_open_pr_is_left_alone(repo: Path, gh: Gh) -> None:
    sha = _branch_with_commit(repo, "feature/in-flight", "wip")
    gh.pr(16, "OPEN", sha, branch="feature/in-flight")

    _run(repo, gh, "--apply")

    assert "feature/in-flight" in _branches(repo)


def test_a_branch_that_moves_after_it_was_judged_is_not_deleted(repo: Path, gh: Gh) -> None:
    """Deletion is tied to the SHA that was judged, not to whatever the name holds by then.

    Judging every ref makes network calls before anything is deleted, so a branch
    can gain a commit in between. That commit is in no PR and not on main; deleting
    the name would lose the only copy, and the recovery log would hold the old SHA.
    """
    sha = _branch_with_commit(repo, "pr-19-review", "reviewed")
    _git("checkout", "-q", "-b", "scratch", "pr-19-review", cwd=repo)
    newer = _commit(repo, "landed-mid-run")
    _git("checkout", "-q", "main", cwd=repo)
    _git("branch", "-q", "-D", "scratch", cwd=repo)
    gh.pr(19, "MERGED", sha)
    gh.on_search(sha, f"git -C '{repo}' update-ref refs/heads/pr-19-review {newer}\n")

    _run(repo, gh, "--apply")

    assert "pr-19-review" in _branches(repo), "deleted a branch that moved after it was judged"
    assert _git("rev-parse", "pr-19-review", cwd=repo) == newer


def test_a_ref_is_not_deleted_when_its_recovery_line_cannot_be_written(repo: Path, gh: Gh) -> None:
    """The recovery log is the undo; a deletion it cannot record does not happen."""
    _branch_with_commit(repo, "feature/landed", "landed")
    _land_on_main(repo, "feature/landed")
    (Path(_git("rev-parse", "--absolute-git-dir", cwd=repo)) / "git-tidy-recovery.log").mkdir()

    _run(repo, gh, "--apply")

    assert "feature/landed" in _branches(repo)


def test_a_failed_github_lookup_keeps_the_ref(repo: Path, gh: Gh) -> None:
    """No answer is not a "no PR" answer: the ref is kept, and the run still succeeds."""
    sha = _branch_with_commit(repo, "pr-17-review", "reviewed")
    gh.pr(17, "MERGED", sha)
    gh.fail()

    result = _run(repo, gh, "--apply")

    assert result.returncode == 0, result.stderr
    assert "pr-17-review" in _branches(repo)


# ─── what is never a candidate ─────────────────────────────────────────────


def test_a_branch_checked_out_in_a_worktree_is_not_a_candidate(repo: Path, gh: Gh) -> None:
    """A worktree's branch is someone's live work -- not listed, not offered for deletion.

    `git branch -D` already refuses a checked-out branch, so "still exists"
    alone cannot tell whether the script skipped it or merely failed to delete
    it. The report is what an agent acts on, so the report is what is pinned.
    """
    _branch_with_commit(repo, "feature/busy", "busy")
    _land_on_main(repo, "feature/busy")
    _git("worktree", "add", "-q", ".worktrees/busy", "feature/busy", cwd=repo)

    result = _run(repo, gh, "--apply")

    assert "feature/busy" in _branches(repo)
    assert "feature/busy" not in result.stdout, "offered a worktree's live branch for deletion"


def test_main_is_never_a_candidate(repo: Path, gh: Gh) -> None:
    _git("checkout", "-q", "--detach", cwd=repo)

    result = _run(repo, gh, "--apply")

    assert "main" in _branches(repo), result.stdout


def test_a_ref_inside_the_grace_period_is_not_reported(repo: Path, gh: Gh) -> None:
    """Fresh work is someone's current work; it is neither deleted nor nagged about."""
    _branch_with_commit(repo, "feature/today", "today", date="")

    result = _run(repo, gh, "--apply")

    assert "feature/today" in _branches(repo)
    assert "feature/today" not in result.stdout


# ─── refs outside refs/heads ───────────────────────────────────────────────


def test_a_landed_backup_ref_is_deleted(repo: Path, gh: Gh) -> None:
    sha = _branch_with_commit(repo, "feature/x", "x")
    _land_on_main(repo, "feature/x")
    _git("branch", "-q", "-D", "feature/x", cwd=repo)
    _git("update-ref", "refs/backup/x-pre-rebase", sha, cwd=repo)

    _run(repo, gh, "--apply")

    assert "refs/backup/x-pre-rebase" not in _refs(repo)


def test_a_stray_remote_tracking_ref_is_judged_like_a_branch(repo: Path, gh: Gh) -> None:
    """`refs/remotes/pr/N` from an ad-hoc fetch has no remote to prune it."""
    sha = _branch_with_commit(repo, "scratch", "pr-content")
    _git("update-ref", "refs/remotes/pr/18", sha, cwd=repo)
    _git("branch", "-q", "-D", "scratch", cwd=repo)
    gh.pr(18, "MERGED", sha)

    _run(repo, gh, "--apply")

    assert "refs/remotes/pr/18" not in _refs(repo)
    assert "refs/remotes/origin/main" in _refs(repo), "a configured remote's refs are fetch's job"


# ─── stashes and recovery ──────────────────────────────────────────────────


def test_an_old_stash_is_listed_and_never_dropped(repo: Path, gh: Gh) -> None:
    (repo / "base.txt").write_text("edited\n")
    _git("stash", "push", "-q", "-m", "old-experiment", cwd=repo, date=OLD)

    result = _run(repo, gh, "--apply")

    assert "old-experiment" in result.stdout
    assert _git("stash", "list", cwd=repo), "--apply dropped a stash"


def test_apply_records_every_deleted_sha_for_recovery(repo: Path, gh: Gh) -> None:
    sha = _branch_with_commit(repo, "feature/landed", "landed")
    _land_on_main(repo, "feature/landed")

    _run(repo, gh, "--apply")

    log = Path(_git("rev-parse", "--absolute-git-dir", cwd=repo)) / "git-tidy-recovery.log"
    assert sha in log.read_text()
    assert "refs/heads/feature/landed" in log.read_text()


# ─── notice mode (the post-merge hook) ─────────────────────────────────────


def test_notice_is_silent_when_there_is_nothing_to_report(repo: Path, gh: Gh) -> None:
    result = _run(repo, gh, "--notice")

    assert result.returncode == 0
    assert result.stdout.strip() == ""


def test_notice_reports_and_points_at_apply_without_deleting(repo: Path, gh: Gh) -> None:
    _branch_with_commit(repo, "feature/landed", "landed")
    _land_on_main(repo, "feature/landed")
    _branch_with_commit(repo, "feature/unpushed", "wip")

    result = _run(repo, gh, "--notice")

    assert result.returncode == 0
    assert "feature/landed" in result.stdout
    assert "feature/unpushed" in result.stdout
    assert "--apply" in result.stdout
    assert {"feature/landed", "feature/unpushed"} <= _branches(repo)


def test_notice_exits_zero_when_github_is_unreachable(repo: Path, gh: Gh) -> None:
    _branch_with_commit(repo, "feature/unpushed", "wip")
    gh.fail()

    result = _run(repo, gh, "--notice")

    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize(
    "args",
    [
        ("--notice", "--grace-days"),
        ("--notice", "--grace-days", "abc"),
        ("--grace-days", "abc", "--notice"),
        ("--notice", "--bogus"),
    ],
)
def test_notice_exits_zero_on_a_bad_argument(repo: Path, gh: Gh, args: tuple[str, ...]) -> None:
    """In notice mode EVERY exit is 0 -- argument errors included, whatever the order."""
    result = _run(repo, gh, *args)

    assert result.returncode == 0, result.stderr


def test_a_non_numeric_grace_days_is_refused(repo: Path, gh: Gh) -> None:
    _branch_with_commit(repo, "feature/landed", "landed")
    _land_on_main(repo, "feature/landed")

    result = _run(repo, gh, "--apply", "--grace-days", "abc")

    assert result.returncode != 0
    assert "--grace-days" in result.stderr
    assert "feature/landed" in _branches(repo)


def test_notice_never_deletes_even_when_given_apply(repo: Path, gh: Gh) -> None:
    """The hook path reports; deletion is only ever a deliberate manual run."""
    _branch_with_commit(repo, "feature/landed", "landed")
    _land_on_main(repo, "feature/landed")

    result = _run(repo, gh, "--notice", "--apply")

    assert result.returncode == 0, result.stderr
    assert "feature/landed" in _branches(repo)


def test_the_post_merge_hook_runs_the_notice() -> None:
    """Agents see this on every pull; nobody runs the script unprompted."""
    config = yaml.safe_load(LEFTHOOK_CONFIG.read_text())
    commands = config["post-merge"]["commands"]
    runs = " ".join(c.get("run", "") for c in commands.values())
    assert "git-tidy.sh --notice" in runs

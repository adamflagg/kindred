"""`cleanup.sh` must act on the branch a worktree is actually on.

The script used to derive the branch from the directory name -- `feature/$1` --
and then gate deletion on whether a PR for *that guessed name* was merged. The
two agree only when nobody names a branch after its subject rather than its
directory, and it takes exactly one such worktree in a sweep to break.

Measured 2026-09-01, cleaning up after kindred#2666: `.worktrees/goconst-campminder`
was on `feature/goconst-2665`. `--all-merged` looked for a merged PR on
`feature/goconst-campminder`, found none, and skipped it -- while the real branch's
PR was merged. Worse, `cleanup.sh goconst-campminder --force` would have deleted
the *guessed* branch (which happened to exist as an empty leftover from `new.sh`)
and left the real one behind. Three worktrees and four branches had to be removed
by hand.

These tests build a throwaway repo with a worktree whose branch deliberately
does not match its directory, stub `gh` on PATH, and assert the script resolves
the branch from git rather than from the path.
"""

import os
import shutil
import stat
import subprocess
from pathlib import Path

import pytest
import yaml

REPO_ROOT = Path(__file__).parents[3]
CLEANUP = REPO_ROOT / "scripts/worktree/cleanup.sh"
LEFTHOOK_CONFIG = REPO_ROOT / ".lefthook.yml"


def _clean_env(**extra: str) -> dict[str, str]:
    """os.environ with every GIT_* variable stripped.

    This is load-bearing, not hygiene. `git` prefers GIT_DIR / GIT_INDEX_FILE /
    GIT_WORK_TREE over the current directory, and a git HOOK exports them --
    so under lefthook's pre-push, every `git` call below would ignore its own
    `cwd=` and operate on the REAL repository instead.

    Measured while writing this file: the fixture's `git init` + `git add -A` +
    `git commit` ran against the developer's worktree, truncating its index from
    2,646 entries to 1 and moving the branch ref onto the fixture's "seed"
    commit. `pre-push-verify.sh` passed (no hook, no GIT_* set) while the push
    itself failed -- the divergence is the tell.
    """
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    env.update(extra)
    return env


def _git(*args: str, cwd: Path) -> str:
    return subprocess.run(
        ["git", *args], cwd=cwd, capture_output=True, text=True, check=True, env=_clean_env()
    ).stdout.strip()


def _branches(repo: Path) -> set[str]:
    out = _git("for-each-ref", "--format=%(refname:short)", "refs/heads", cwd=repo)
    return set(out.split()) if out else set()


def _stub_gh(bin_dir: Path, merged_branches: set[str]) -> None:
    """A `gh` that reports MERGED only for the named branches.

    cleanup.sh calls `gh pr list --head <branch> --state merged --json state
    --jq '.[0].state'`, so the stub only has to find --head and answer.
    """
    bin_dir.mkdir(parents=True, exist_ok=True)
    gh = bin_dir / "gh"
    gh.write_text(
        "#!/bin/bash\n"
        "head=''\n"
        "while [ $# -gt 0 ]; do\n"
        '  if [ "$1" = "--head" ]; then head="$2"; shift; fi\n'
        "  shift\n"
        "done\n"
        f'case " {" ".join(sorted(merged_branches))} " in\n'
        '  *" $head "*) echo MERGED ;;\n'
        "  *) echo ;;\n"
        "esac\n"
    )
    gh.chmod(gh.stat().st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    """A repo with `.worktrees/<dir>` checked out on a differently-named branch."""
    main = tmp_path / "repo"
    main.mkdir()
    _git("init", "-q", "-b", "main", cwd=main)
    _git("config", "user.email", "test@example.com", cwd=main)
    _git("config", "user.name", "Test", cwd=main)
    (main / "README.md").write_text("seed\n")
    _git("add", "-A", cwd=main)
    _git("commit", "-qm", "seed", cwd=main)

    # The script sources scripts/colors.sh from the repo it is run against.
    (main / "scripts").mkdir(exist_ok=True)
    shutil.copy(REPO_ROOT / "scripts/colors.sh", main / "scripts/colors.sh")
    (main / "scripts/worktree").mkdir(parents=True, exist_ok=True)
    shutil.copy(CLEANUP, main / "scripts/worktree/cleanup.sh")

    # DIRECTORY name and BRANCH name deliberately disagree -- the whole point.
    _git("worktree", "add", "-q", "-b", "feature/real-name", ".worktrees/dir-name", cwd=main)
    return main


def _detach(worktree: Path) -> None:
    """Put a worktree on a detached HEAD.

    Not exotic: an interrupted rebase leaves one, and so does checking out a
    SHA inside a worktree to reproduce something.
    """
    _git("checkout", "-q", "--detach", "HEAD", cwd=worktree)


def _run_cleanup(repo: Path, *args: str, merged: set[str]) -> subprocess.CompletedProcess[str]:
    bin_dir = repo.parent / "stubbin"
    _stub_gh(bin_dir, merged)
    env = _clean_env(PATH=f"{bin_dir}:{os.environ['PATH']}")
    return subprocess.run(
        ["bash", "scripts/worktree/cleanup.sh", *args],
        cwd=repo,
        capture_output=True,
        text=True,
        env=env,
    )


def test_cleanup_resolves_the_branch_the_worktree_is_actually_on(repo: Path) -> None:
    """`cleanup.sh <dir>` deletes the real branch, not `feature/<dir>`.

    The merged PR is on `feature/real-name`. Nothing is merged for the guessed
    `feature/dir-name`, so a script that guesses refuses to do anything.
    """
    assert "feature/real-name" in _branches(repo)

    result = _run_cleanup(repo, "dir-name", merged={"feature/real-name"})

    assert result.returncode == 0, f"refused to clean up:\n{result.stdout}\n{result.stderr}"
    assert not (repo / ".worktrees/dir-name").exists(), "worktree directory survived"
    assert "feature/real-name" not in _branches(repo), (
        "the worktree's actual branch was left behind -- the script deleted or "
        "looked up the directory-derived name instead"
    )


def test_cleanup_refuses_when_the_real_branch_has_no_merged_pr(repo: Path) -> None:
    """The WIP guard must key on the real branch too.

    Inverted from the test above: here `feature/dir-name` is the merged one, and
    the branch actually checked out is not. Guessing from the directory would
    make this look safe and delete unmerged work.
    """
    result = _run_cleanup(repo, "dir-name", merged={"feature/dir-name"})

    assert result.returncode != 0, "cleaned up a worktree whose real branch is unmerged"
    assert (repo / ".worktrees/dir-name").exists()
    assert "feature/real-name" in _branches(repo)


def test_all_merged_finds_a_worktree_whose_branch_differs_from_its_directory(repo: Path) -> None:
    """`--all-merged` walks directories, so it inherits the same defect."""
    result = _run_cleanup(repo, "--all-merged", merged={"feature/real-name"})

    assert not (repo / ".worktrees/dir-name").exists(), f"--all-merged skipped it:\n{result.stdout}"
    assert "feature/real-name" not in _branches(repo)


def test_a_detached_worktree_is_not_removed_without_force(repo: Path) -> None:
    """No branch means no PR to check, so the work-in-progress guard must refuse.

    A detached HEAD is the worst case for `git worktree remove --force`: a
    commit made there is reachable from nothing, and removing the worktree
    deletes its reflog along with it. The old directory-guessing script refused
    here by accident -- `feature/dir-name` had no merged PR -- and resolving the
    branch properly must not convert that accident into a silent deletion.

    Both branches are reported merged so the refusal cannot come from a failed
    lookup: there is no branch to look up at all.
    """
    _detach(repo / ".worktrees/dir-name")

    result = _run_cleanup(repo, "dir-name", merged={"feature/real-name", "feature/dir-name"})

    assert result.returncode != 0, f"removed a detached worktree with no --force:\n{result.stdout}"
    assert (repo / ".worktrees/dir-name").exists(), "the detached worktree was removed anyway"


def test_force_removes_a_detached_worktree_and_leaves_every_branch_alone(repo: Path) -> None:
    """`--force` is the operator accepting the loss, and it must still work.

    The branch the worktree sat on before detaching has to survive: with no
    symbolic ref there is nothing to delete, and deleting `feature/dir-name`
    on a guess is the whole defect this file exists to pin.
    """
    _detach(repo / ".worktrees/dir-name")
    before = _branches(repo)

    result = _run_cleanup(repo, "dir-name", "--force", merged=set())

    assert result.returncode == 0, f"--force did not clean up:\n{result.stdout}\n{result.stderr}"
    assert not (repo / ".worktrees/dir-name").exists(), "worktree directory survived --force"
    assert _branches(repo) == before, "a branch was deleted for a worktree that was on none"


def test_all_merged_skips_a_detached_worktree(repo: Path) -> None:
    """The sweep has no branch to check either, so it must leave the worktree be."""
    _detach(repo / ".worktrees/dir-name")

    result = _run_cleanup(repo, "--all-merged", merged={"feature/real-name", "feature/dir-name"})

    assert result.returncode == 0, f"{result.stdout}\n{result.stderr}"
    assert (repo / ".worktrees/dir-name").exists(), f"swept a detached worktree:\n{result.stdout}"
    assert _branches(repo) == {"main", "feature/real-name"}


def test_the_helpers_never_touch_the_repo_named_by_the_git_environment(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A git hook exports GIT_DIR; the fixture must still work on its own repo.

    `git` prefers GIT_DIR / GIT_INDEX_FILE over `cwd=`, so without scrubbing
    them this file's own fixture rewrites whichever repository the ambient
    environment points at. That is not hypothetical -- it truncated this
    worktree's index to a single entry and moved its branch ref onto the
    fixture's "seed" commit, and it only reproduced under `git push` because
    that is when a hook sets the variables.

    A decoy repo stands in for the victim so the assertion is safe to run.
    """
    decoy = tmp_path / "decoy"
    decoy.mkdir()
    _git("init", "-q", "-b", "main", cwd=decoy)
    _git("config", "user.email", "test@example.com", cwd=decoy)
    _git("config", "user.name", "Test", cwd=decoy)
    for n in range(3):
        (decoy / f"f{n}.txt").write_text(f"{n}\n")
    _git("add", "-A", cwd=decoy)
    _git("commit", "-qm", "decoy baseline", cwd=decoy)

    before_head = _git("rev-parse", "HEAD", cwd=decoy)
    before_files = _git("ls-files", cwd=decoy).split()
    assert len(before_files) == 3

    # Exactly what lefthook's pre-push leaves in the environment.
    #
    # monkeypatch, not a raw os.environ write with a `del` in a finally: under
    # that hook GIT_DIR really IS already set, so `del` would strip the hook's
    # own value from every test that runs after this one -- the same ambient-
    # environment leak this file is about, aimed at the rest of the suite.
    # pytest restores whatever was there, set or unset, at teardown.
    monkeypatch.setenv("GIT_DIR", str(decoy / ".git"))
    monkeypatch.setenv("GIT_INDEX_FILE", str(decoy / ".git/index"))

    victim = tmp_path / "other"
    victim.mkdir()
    _git("init", "-q", "-b", "main", cwd=victim)
    _git("config", "user.email", "test@example.com", cwd=victim)
    _git("config", "user.name", "Test", cwd=victim)
    (victim / "unrelated.txt").write_text("x\n")
    _git("add", "-A", cwd=victim)
    _git("commit", "-qm", "seed", cwd=victim)

    assert _git("rev-parse", "HEAD", cwd=decoy) == before_head, (
        "the helper committed into the repo named by GIT_DIR instead of its own"
    )
    assert _git("ls-files", cwd=decoy).split() == before_files, "the helper rewrote the index named by GIT_INDEX_FILE"


def _worktree_notifier_body() -> str:
    """The `post-merge` hook body that suggests worktrees for cleanup."""
    config = yaml.safe_load(LEFTHOOK_CONFIG.read_text())
    return str(config["post-merge"]["commands"]["worktree-cleanup"]["run"])


def test_the_post_merge_notifier_resolves_the_branch_the_same_way_cleanup_does() -> None:
    """`.lefthook.yml`'s notifier must not re-introduce the directory-name guess.

    The notifier and `cleanup.sh` were deliberately built to share one
    detection method (commit 9b9702db, kindred#11): the hook tells you which
    worktrees are ready, the script removes them. When only the script learned
    to resolve the branch from git, the pair drifted -- and the hook kept the
    exact #2666 defect, so a worktree whose branch is named for its subject
    rather than its directory is never suggested at all.

    That half is notification-only and destroys nothing, which is precisely why
    it would have gone unnoticed: the reminder simply stops arriving. This test
    is the thing that notices.
    """
    body = _worktree_notifier_body()

    assert "symbolic-ref" in body, (
        "the post-merge notifier must resolve each worktree's branch from git, "
        "the same way cleanup.sh's resolve_branch() does"
    )
    assert "feature/$name" not in body, (
        "the notifier is guessing the branch from the directory name again -- "
        "the kindred#2666 defect this PR removed from cleanup.sh"
    )


def test_both_worktree_branch_readers_agree() -> None:
    """Pin the *pair*, so fixing one and forgetting the other fails here.

    Asserting each side in isolation lets them drift apart while both tests
    still pass. The invariant is that they agree.
    """
    resolver = "symbolic-ref --quiet --short HEAD"
    assert resolver in CLEANUP.read_text(), "cleanup.sh stopped resolving the branch from git"
    assert resolver in _worktree_notifier_body(), "the post-merge notifier stopped agreeing with cleanup.sh"

"""`cleanup.sh` must act on the branch a worktree is actually on.

The script used to derive the branch from the directory name -- `feature/$1` --
and then gate deletion on whether a PR for *that guessed name* was merged. The
two agree only when nobody renames anything, and a sweep that puts three
worktrees on branches named for their subject rather than their directory
breaks all three at once.

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

REPO_ROOT = Path(__file__).parents[3]
CLEANUP = REPO_ROOT / "scripts/worktree/cleanup.sh"


def _git(*args: str, cwd: Path) -> str:
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()


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


def _run_cleanup(repo: Path, *args: str, merged: set[str]) -> subprocess.CompletedProcess[str]:
    bin_dir = repo.parent / "stubbin"
    _stub_gh(bin_dir, merged)
    env = {**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}"}
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

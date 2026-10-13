"""Guide lockstep: after a kindred PR merges, land its paired guide PR (spec R14).

Runs from .github/workflows/guide-lockstep.yml on every push to main. It finds
the kindred PR that produced the merge commit, then:

- merge-paired     exactly one OPEN guide PR, based on main, whose head branch
                   is the kindred PR's branch: catch it up with guide main,
                   write kindred main's tip facts onto it, wait for the guide's
                   own `image.yml` workflow run on that exact head, then merge.
- open-facts-sync  no pair, but this commit changed scripts/guide/facts.json:
                   the same, on a `facts-sync/<sha7>` PR. A re-run reuses that
                   PR if it is still open; otherwise one is opened from main,
                   overwriting any orphaned branch of that name.
- nothing          no pair and no facts change, a pair not based on main, or
                   no same-repo kindred PR for this commit.
- error            more than one open guide PR on the branch (exit 1, dry run too).

Nothing reaches guide main without a green `image.yml` workflow run on the
exact head: the merge passes --match-head-commit, so a push after the run
cannot ride in. The run is read through the Actions API (ruling D1-f): a
fine-grained token can be granted "Actions: Read", while no fine-grained
permission covers the check-runs endpoint.

Runs for different merge SHAs may overlap (ruling D1-e), so what is written is
state-based: the merge SHA decides the plan, but the facts copied and the
source.json stamp come from kindred main's TIP, read right AFTER the guide
clone. Guide main only ever holds stamps from tips read earlier, so the tip
written is never older than anything the clone's main carries; a run whose
branch then falls behind a newer stamp landing on guide main conflicts on
squash, and its retry re-clones and re-reads the tip, so guide mergeability
is what enforces the ordering. Guide main is merged into the branch first;
a conflict outside the two lockstep-owned files stops the run. A failed merge
redoes that, re-pushes, re-waits and re-merges, up to MERGE_ATTEMPTS in all.
A sync PR is not opened when guide main already holds the tip's facts.

The Actions log is PUBLIC. Output is one `plan: <action> (<reason>)` line plus
`lockstep: ...` lines; reasons never carry branch names, PR numbers or titles,
and gh/git output is captured and never echoed. Tokens: the kindred read uses
the workflow's own token, guide calls use the guide token, each injected as
GH_TOKEN into that one subprocess. No token ever appears on an argv or in a
URL; git authenticates through gh's credential helper.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

Action = Literal["merge-paired", "open-facts-sync", "nothing", "error"]

FACTS_PATH = "scripts/guide/facts.json"
_SHA = re.compile(r"^[0-9a-f]{40}$")
_CONCLUSION = re.compile(r"^[a-z_]{1,32}$")
_PR_URL_NUMBER = re.compile(r"/pull/(\d+)\s*$")
_GIT_AUTH = ["-c", "credential.helper=", "-c", "credential.helper=!gh auth git-credential"]
_GIT_IDENTITY = [
    "-c",
    "user.name=guide-lockstep",
    "-c",
    "user.email=noreply@example.test",
    "-c",
    "commit.gpgsign=false",
]
_OWNED = frozenset({"src/data/facts.json", "src/data/source.json"})  # lockstep writes these
MERGE_ATTEMPTS = 3
# 3 attempts x CHECK_TIMEOUT_S must fit the job's timeout-minutes (75).
CHECK_TIMEOUT_S = 1200
# Copied from the runner's env into every subprocess; nothing else is inherited,
# so an ambient GH_TOKEN (or the other side's token) never reaches a call.
_PASSTHROUGH = ("PATH", "HOME", "TMPDIR", "RUNNER_TEMP", "LANG", "LC_ALL")


@dataclass(frozen=True)
class Plan:
    action: Action
    guide_pr: int | None
    reason: str


class LockstepError(Exception):
    """A failure whose message is a fixed, public-safe failure class."""


def plan(kindred_branch: str, guide_open_prs: list[dict[str, Any]], facts_changed: bool) -> Plan:
    """Pure decision. Only an exact head-branch match among OPEN PRs pairs, and
    only one based on main is merged. A dict without `baseRefName` counts as
    based on main (the executor always asks gh for it)."""
    matches = [p for p in guide_open_prs if kindred_branch and p.get("headRefName") == kindred_branch]
    if len(matches) > 1:
        return Plan("error", None, f"{len(matches)} open guide PRs on the paired branch")
    if len(matches) == 1:
        if matches[0].get("baseRefName", "main") != "main":
            return Plan("nothing", None, "paired guide PR is not based on main")
        return Plan("merge-paired", int(matches[0]["number"]), "one open guide PR on the paired branch")
    if facts_changed:
        return Plan("open-facts-sync", None, "facts changed with no paired guide PR")
    return Plan("nothing", None, "no paired guide PR and no facts change")


def _env(token: str | None = None) -> dict[str, str]:
    env = {k: os.environ[k] for k in _PASSTHROUGH if k in os.environ}
    env.update(GIT_TERMINAL_PROMPT="0", GH_PROMPT_DISABLED="1", GH_NO_UPDATE_NOTIFIER="1")
    if token is not None:
        env["GH_TOKEN"] = token
    return env


def _run(cmd: list[str], env: Mapping[str, str], cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
    """Run with every byte of output captured; callers never print it."""
    return subprocess.run(cmd, env=dict(env), cwd=cwd, capture_output=True, text=True, check=False)


def _ok(cmd: list[str], env: Mapping[str, str], failure: str, cwd: Path | None = None) -> str:
    result = _run(cmd, env, cwd)
    if result.returncode != 0:
        raise LockstepError(failure)
    return result.stdout


def _run_id(run: dict[str, Any]) -> int:
    run_id = run.get("id")
    return run_id if isinstance(run_id, int) else 0


def wait_for_check(
    repo: str,
    sha: str,
    workflow_file: str = "image.yml",
    timeout_s: int = CHECK_TIMEOUT_S,
    poll_s: int = 20,
    *,
    env: Mapping[str, str] | None = None,
) -> str:
    """Poll `repo`'s `workflow_file` runs for head `sha` until the newest completes; return its conclusion.

    Uses the Actions API (`actions/workflows/<file>/runs?head_sha=`), which a
    fine-grained token reaches with "Actions: Read" (ruling D1-f). With several
    runs on the head (a re-run, a second trigger), the most recent -- highest
    id -- decides; until it is `completed`, keep polling. A failed gh call
    counts as "not ready yet" (a transient API blip should not abort the wait).
    Raises TimeoutError once `timeout_s` has passed, including when no run
    ever appears.
    """
    run_env = env if env is not None else _env(os.environ.get("GUIDE_TOKEN", ""))
    cmd = [
        "gh",
        "api",
        f"repos/{repo}/actions/workflows/{workflow_file}/runs?head_sha={sha}",
        "--jq",
        "[.workflow_runs[] | {id, status, conclusion}]",
    ]
    deadline = time.monotonic() + timeout_s
    while True:
        result = _run(cmd, run_env)
        if result.returncode == 0:
            try:
                runs = json.loads(result.stdout or "[]")
            except json.JSONDecodeError:
                runs = []
            runs = [r for r in runs if isinstance(r, dict)] if isinstance(runs, list) else []
            if runs:
                latest = max(runs, key=_run_id)
                if latest.get("status") == "completed":
                    return str(latest.get("conclusion") or "unknown")
        if time.monotonic() >= deadline:
            raise TimeoutError(workflow_file)
        time.sleep(poll_s)


def _kindred_pr(kindred_repo: str, sha: str, token: str) -> dict[str, Any] | None:
    """The same-repo PR that produced `sha`, or None.

    A fork PR's branch name can collide with an internal one, so only heads in
    kindred itself count. If several remain, only the one whose merge commit is
    `sha` does; if none is, there is no PR to pair.
    """
    out = _ok(
        [
            "gh",
            "api",
            f"repos/{kindred_repo}/commits/{sha}/pulls",
            "--jq",
            "[.[] | {number, title, headRefName: .head.ref, headRepo: .head.repo.full_name,"
            " mergeCommit: .merge_commit_sha}]",
        ],
        _env(token),
        "kindred PR lookup failed",
    )
    try:
        prs = json.loads(out or "[]")
    except json.JSONDecodeError as exc:
        raise LockstepError("kindred PR lookup failed") from exc
    own = [pr for pr in prs if isinstance(pr, dict) and kindred_repo and pr.get("headRepo") == kindred_repo]
    if len(own) == 1:
        return own[0]
    merged_here = [pr for pr in own if pr.get("mergeCommit") == sha]
    return merged_here[0] if len(merged_here) == 1 else None


def _facts_changed(sha: str) -> bool:
    out = _ok(["git", "diff", "--name-only", f"{sha}^", sha, "--", FACTS_PATH], _env(), "kindred diff failed")
    return bool(out.strip())


def _kindred_tip(token: str) -> tuple[str, str]:
    """kindred main's tip SHA and its facts.json (D1-e b: the newest state wins)."""
    _ok(
        ["git", *_GIT_AUTH, "fetch", "-q", "--no-tags", "--depth=1", "origin", "refs/heads/main"],
        _env(token),
        "kindred fetch failed",
    )
    tip = _ok(["git", "rev-parse", "FETCH_HEAD"], _env(), "kindred fetch failed").strip()
    if not _SHA.fullmatch(tip):
        raise LockstepError("kindred fetch failed")
    return tip, _ok(["git", "show", f"{tip}:{FACTS_PATH}"], _env(), "kindred facts read failed")


def _merge_guide_main(repo_dir: Path) -> None:
    """Merge guide origin/main in (D1-e c). Only lockstep-owned conflicts are allowed;
    the caller's overwrite of those two files then resolves them."""
    local = _env()
    merged = _run(["git", *_GIT_IDENTITY, "merge", "-q", "--no-ff", "--no-commit", "origin/main"], local, repo_dir)
    if merged.returncode == 0:
        return
    conflicted = set(
        _ok(["git", "diff", "--name-only", "--diff-filter=U"], local, "guide merge failed", repo_dir).splitlines()
    )
    if conflicted and conflicted <= _OWNED:
        return
    _run(["git", "merge", "--abort"], local, repo_dir)
    raise LockstepError("guide PR conflicts with main" if conflicted else "guide merge failed")


def _prepare_head(
    *,
    guide_repo: str,
    guide_env: Mapping[str, str],
    clone_ref: str,
    push_branch: str,
    new_branch: bool,
    kindred_token: str,
) -> str | None:
    """Bring the guide branch up to date with main and the tip's facts; return its head.

    Returns None when this is a new sync branch and guide main already holds
    exactly these facts (D1-e e): there is nothing to sync.
    """
    local = _env()
    with tempfile.TemporaryDirectory(dir=os.environ.get("RUNNER_TEMP")) as tmp:
        repo_dir = Path(tmp) / "guide"
        # Full history (no --depth): merging guide main needs the merge base.
        _ok(
            [
                "git",
                *_GIT_AUTH,
                "clone",
                "-q",
                "--branch",
                clone_ref,
                f"https://github.com/{guide_repo}.git",
                str(repo_dir),
            ],
            guide_env,
            "guide clone failed",
        )
        # After the clone, never before: a tip read first can be older than a
        # stamp another run has since merged into guide main, and merging main
        # in then writing that older tip would revert it with no conflict.
        tip, facts = _kindred_tip(kindred_token)
        data = repo_dir / "src" / "data"
        if new_branch:
            current = data / "facts.json"
            if current.is_file() and current.read_text(encoding="utf-8") == facts:
                return None
            _ok(["git", "checkout", "-q", "-b", push_branch], local, "guide branch failed", repo_dir)
        start = _ok(["git", "rev-parse", "HEAD"], local, "guide rev-parse failed", repo_dir).strip()

        _merge_guide_main(repo_dir)

        data.mkdir(parents=True, exist_ok=True)
        (data / "facts.json").write_text(facts, encoding="utf-8", newline="")
        (data / "source.json").write_text(json.dumps({"kindred_sha": tip}) + "\n", encoding="utf-8")
        _ok(["git", "add", *sorted(_OWNED)], local, "guide stage failed", repo_dir)

        merging = _run(["git", "rev-parse", "-q", "--verify", "MERGE_HEAD"], local, repo_dir).returncode == 0
        staged = _run(["git", "diff", "--cached", "--quiet"], local, repo_dir).returncode
        if staged not in (0, 1):
            raise LockstepError("guide stage failed")
        if merging or staged == 1:
            message = f"chore(facts): sync from kindred@{tip[:7]}"
            _ok(["git", *_GIT_IDENTITY, "commit", "-q", "-m", message], local, "guide commit failed", repo_dir)

        head = _ok(["git", "rev-parse", "HEAD"], local, "guide rev-parse failed", repo_dir).strip()
        if not _SHA.fullmatch(head):
            raise LockstepError("guide rev-parse failed")
        if head != start or new_branch:
            # A new sync branch is only built when no open PR on main uses that
            # name, so any remote branch of the same name is an orphan of an
            # earlier attempt (pushed, then the PR create failed or the PR was
            # closed): overwrite it, or every re-run is a non-fast-forward.
            # An existing branch (paired, or a reused sync PR) is never forced.
            force = ["--force"] if new_branch else []
            _ok(
                ["git", *_GIT_AUTH, "push", "-q", *force, "origin", f"HEAD:refs/heads/{push_branch}"],
                guide_env,
                "guide push failed",
                repo_dir,
            )
        return head


def sync_branch(sha: str) -> str:
    return f"facts-sync/{sha[:7]}"


def _open_sync_pr(guide_prs: list[dict[str, Any]], sha: str) -> int | None:
    """The still-open sync PR for this SHA (exact head, based on main), if any."""
    head = sync_branch(sha)
    for pr in guide_prs:
        if pr.get("headRefName") == head and pr.get("baseRefName", "main") == "main":
            return int(pr["number"])
    return None


def _execute(
    p: Plan,
    *,
    sha: str,
    branch: str,
    title: str,
    guide_repo: str,
    guide_token: str,
    kindred_token: str,
    guide_prs: list[dict[str, Any]],
) -> str:
    """Land the plan; return the public-safe outcome. Raises LockstepError on failure."""
    guide_env = _env(guide_token)
    sync = p.action == "open-facts-sync"
    push_branch = sync_branch(sha) if sync else branch
    number = p.guide_pr
    if sync:
        # A re-run of a sync that failed after opening its PR must reuse it: a
        # fresh branch from main would be a non-fast-forward push onto the old
        # one, and gh refuses a second PR for the same head.
        number = _open_sync_pr(guide_prs, sha)

    for _attempt in range(MERGE_ATTEMPTS):
        new_branch = sync and number is None
        head = _prepare_head(
            guide_repo=guide_repo,
            guide_env=guide_env,
            clone_ref="main" if new_branch else push_branch,
            push_branch=push_branch,
            new_branch=new_branch,
            kindred_token=kindred_token,
        )
        if head is None:
            return "facts already in sync"

        if number is None:
            out = _ok(
                [
                    "gh",
                    "pr",
                    "create",
                    "-R",
                    guide_repo,
                    "--base",
                    "main",
                    "--head",
                    push_branch,
                    "--title",
                    f"chore(facts): sync from kindred@{sha[:7]}",
                    "--body",
                    f"Paired-with: kindred@{sha}",
                ],
                guide_env,
                "guide PR create failed",
            )
            found = _PR_URL_NUMBER.search(out)
            if not found:
                raise LockstepError("guide PR create failed")
            number = int(found.group(1))

        try:
            conclusion = wait_for_check(guide_repo, head, env=guide_env)
        except TimeoutError as exc:
            raise LockstepError("guide check timed out; nothing merged") from exc
        if conclusion != "success":
            shown = conclusion if _CONCLUSION.match(conclusion) else "unknown"
            raise LockstepError(f"guide check {shown}; nothing merged")

        merged = _run(
            [
                "gh",
                "pr",
                "merge",
                "-R",
                guide_repo,
                str(number),
                "--squash",
                "--delete-branch",
                "--match-head-commit",
                head,
                "--subject",
                title,
                "--body",
                f"Paired-with: kindred@{sha}",
            ],
            guide_env,
        )
        if merged.returncode == 0:
            return "merged"
        # A non-zero exit can still mean the squash landed (e.g. only the branch
        # delete failed); retrying would then re-clone a deleted branch.
        state = _run(
            ["gh", "pr", "view", "-R", guide_repo, str(number), "--json", "state", "--jq", ".state"], guide_env
        )
        if state.returncode == 0 and state.stdout.strip() == "MERGED":
            return "merged"
    raise LockstepError("merge failed")


def _lockstep(sha: str, dry_run: bool) -> int:
    guide_repo = os.environ.get("GUIDE_REPO", "")
    guide_token = os.environ.get("GUIDE_TOKEN", "")
    if not guide_repo or not guide_token:
        print("lockstep: skipped (no guide access configured)")
        return 0

    pr = _kindred_pr(os.environ.get("KINDRED_REPO", ""), sha, os.environ.get("KINDRED_TOKEN", ""))
    if pr is None:
        print("plan: nothing (no same-repo kindred PR for this commit)")
        return 0

    facts_changed = _facts_changed(sha)
    out = _ok(
        [
            "gh",
            "pr",
            "list",
            "-R",
            guide_repo,
            "--state",
            "open",
            "--limit",
            "500",
            "--json",
            "number,headRefName,baseRefName",
        ],
        _env(guide_token),
        "guide PR list failed",
    )
    try:
        guide_prs = json.loads(out or "[]")
    except json.JSONDecodeError as exc:
        raise LockstepError("guide PR list failed") from exc

    p = plan(str(pr.get("headRefName") or ""), guide_prs, facts_changed)
    print(f"plan: {p.action} ({p.reason})")
    # Checked before the dry-run return: a dry run must show the same red.
    if p.action == "error":
        print("lockstep: error; nothing merged")
        return 1
    if dry_run or p.action == "nothing":
        return 0

    outcome = _execute(
        p,
        sha=sha,
        branch=str(pr.get("headRefName") or ""),
        title=str(pr.get("title") or f"chore(facts): sync from kindred@{sha[:7]}"),
        guide_repo=guide_repo,
        guide_token=guide_token,
        kindred_token=os.environ.get("KINDRED_TOKEN", ""),
        guide_prs=guide_prs,
    )
    print(f"lockstep: {outcome}")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Merge the paired guide PR once its build is green.")
    ap.add_argument("--merge-sha", required=True)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)

    # A workflow_dispatch input is free text: validate before any use.
    if not _SHA.fullmatch(args.merge_sha):
        print("lockstep: bad merge sha")
        return 1
    try:
        return _lockstep(args.merge_sha, args.dry_run)
    except LockstepError as exc:
        print(f"lockstep: {exc}")
        return 1
    except Exception as exc:  # the log is public: print the type only
        print(f"lockstep: internal error ({type(exc).__name__})")
        return 1


if __name__ == "__main__":
    sys.exit(main())

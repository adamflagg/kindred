"""Guide lockstep: after a kindred PR merges, land its paired guide PR (spec R14).

Runs from .github/workflows/guide-lockstep.yml on every push to main. It finds
the kindred PR that produced the merge commit, then:

- merge-paired     exactly one OPEN guide PR whose head branch is the kindred
                   PR's branch: push this commit's facts onto it, wait for the
                   guide's own `image` check on that exact head, then merge.
- open-facts-sync  no pair, but scripts/guide/facts.json changed: open a sync
                   PR on the guide carrying the new facts, then the same.
- nothing          no pair and no facts change, or no kindred PR at all.
- error            more than one open guide PR on the branch (exit 1).

Nothing reaches guide main without a green `image` check on the exact head:
the merge passes --match-head-commit, so a push after the check cannot ride in.

Runs for different merge SHAs may overlap (ruling D1-e), so what is written is
state-based: the merge SHA decides the plan, but the facts copied and the
source.json stamp come from kindred main's TIP, fetched at write time, so the
last writer is always the newest. Guide main is merged into the branch first;
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
# Copied from the runner's env into every subprocess; nothing else is inherited,
# so an ambient GH_TOKEN (or the other side's token) never reaches a call.
_OWNED = frozenset({"src/data/facts.json", "src/data/source.json"})  # lockstep writes these
MERGE_ATTEMPTS = 3
_PASSTHROUGH = ("PATH", "HOME", "TMPDIR", "RUNNER_TEMP", "LANG", "LC_ALL")


@dataclass(frozen=True)
class Plan:
    action: Action
    guide_pr: int | None
    reason: str


class LockstepError(Exception):
    """A failure whose message is a fixed, public-safe failure class."""


def plan(kindred_branch: str, guide_open_prs: list[dict[str, Any]], facts_changed: bool) -> Plan:
    """Pure decision. Only an exact head-branch match among OPEN PRs pairs."""
    matches = [p for p in guide_open_prs if kindred_branch and p.get("headRefName") == kindred_branch]
    if len(matches) > 1:
        return Plan("error", None, f"{len(matches)} open guide PRs on the paired branch")
    if len(matches) == 1:
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


def wait_for_check(
    repo: str,
    sha: str,
    check_name: str = "image",
    timeout_s: int = 1800,
    poll_s: int = 20,
    *,
    env: Mapping[str, str] | None = None,
) -> str:
    """Poll `repo`'s check runs on `sha` until `check_name` completes; return its conclusion.

    A failed gh call counts as "not ready yet" (a transient API blip should not
    abort a 30-minute wait). Raises TimeoutError once `timeout_s` has passed.
    """
    run_env = env if env is not None else _env(os.environ.get("GUIDE_TOKEN", ""))
    cmd = [
        "gh",
        "api",
        f"repos/{repo}/commits/{sha}/check-runs?check_name={check_name}",
        "--jq",
        "[.check_runs[] | {name, status, conclusion}]",
    ]
    deadline = time.monotonic() + timeout_s
    while True:
        result = _run(cmd, run_env)
        if result.returncode == 0:
            try:
                runs = json.loads(result.stdout or "[]")
            except json.JSONDecodeError:
                runs = []
            named = [r for r in runs if isinstance(r, dict) and r.get("name") == check_name]
            done = [r for r in named if r.get("status") == "completed"]
            if named and len(done) == len(named):
                return str(done[0].get("conclusion") or "unknown")
        if time.monotonic() >= deadline:
            raise TimeoutError(check_name)
        time.sleep(poll_s)


def _kindred_pr(kindred_repo: str, sha: str, token: str) -> dict[str, Any] | None:
    out = _ok(
        [
            "gh",
            "api",
            f"repos/{kindred_repo}/commits/{sha}/pulls",
            "--jq",
            "[.[] | {number, title, headRefName: .head.ref}]",
        ],
        _env(token),
        "kindred PR lookup failed",
    )
    try:
        prs = json.loads(out or "[]")
    except json.JSONDecodeError as exc:
        raise LockstepError("kindred PR lookup failed") from exc
    return prs[0] if prs else None


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
    tip: str,
    facts: str,
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
            _ok(
                ["git", *_GIT_AUTH, "push", "-q", "origin", f"HEAD:refs/heads/{push_branch}"],
                guide_env,
                "guide push failed",
                repo_dir,
            )
        return head


def _execute(
    p: Plan, *, sha: str, branch: str, title: str, guide_repo: str, guide_token: str, kindred_token: str
) -> str:
    """Land the plan; return the public-safe outcome. Raises LockstepError on failure."""
    guide_env = _env(guide_token)
    sync = p.action == "open-facts-sync"
    push_branch = f"facts-sync/{sha[:7]}" if sync else branch
    number = p.guide_pr

    for _attempt in range(MERGE_ATTEMPTS):
        tip, facts = _kindred_tip(kindred_token)
        new_branch = sync and number is None
        head = _prepare_head(
            guide_repo=guide_repo,
            guide_env=guide_env,
            clone_ref="main" if new_branch else push_branch,
            push_branch=push_branch,
            new_branch=new_branch,
            tip=tip,
            facts=facts,
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
        print("plan: nothing (no kindred PR for this commit)")
        return 0

    facts_changed = _facts_changed(sha)
    out = _ok(
        ["gh", "pr", "list", "-R", guide_repo, "--state", "open", "--limit", "500", "--json", "number,headRefName"],
        _env(guide_token),
        "guide PR list failed",
    )
    try:
        guide_prs = json.loads(out or "[]")
    except json.JSONDecodeError as exc:
        raise LockstepError("guide PR list failed") from exc

    p = plan(str(pr.get("headRefName") or ""), guide_prs, facts_changed)
    print(f"plan: {p.action} ({p.reason})")
    if dry_run or p.action == "nothing":
        return 0
    if p.action == "error":
        print("lockstep: error; nothing merged")
        return 1

    outcome = _execute(
        p,
        sha=sha,
        branch=str(pr.get("headRefName") or ""),
        title=str(pr.get("title") or f"chore(facts): sync from kindred@{sha[:7]}"),
        guide_repo=guide_repo,
        guide_token=guide_token,
        kindred_token=os.environ.get("KINDRED_TOKEN", ""),
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

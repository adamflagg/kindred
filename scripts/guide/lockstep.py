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


def _execute(p: Plan, *, sha: str, branch: str, title: str, guide_repo: str, guide_token: str) -> None:
    guide_env = _env(guide_token)
    local = _env()
    sha7 = sha[:7]
    message = f"chore(facts): sync from kindred@{sha7}"
    if p.action == "merge-paired":
        clone_ref = push_branch = branch
    else:
        clone_ref, push_branch = "main", f"facts-sync/{sha7}"

    facts = _ok(["git", "show", f"{sha}:{FACTS_PATH}"], local, "kindred facts read failed")

    with tempfile.TemporaryDirectory(dir=os.environ.get("RUNNER_TEMP")) as tmp:
        repo_dir = Path(tmp) / "guide"
        _ok(
            [
                "git",
                *_GIT_AUTH,
                "clone",
                "-q",
                "--depth",
                "1",
                "--branch",
                clone_ref,
                f"https://github.com/{guide_repo}.git",
                str(repo_dir),
            ],
            guide_env,
            "guide clone failed",
        )
        if p.action == "open-facts-sync":
            _ok(["git", "checkout", "-q", "-b", push_branch], local, "guide branch failed", repo_dir)

        data = repo_dir / "src" / "data"
        data.mkdir(parents=True, exist_ok=True)
        (data / "facts.json").write_text(facts, encoding="utf-8", newline="")
        (data / "source.json").write_text(json.dumps({"kindred_sha": sha}) + "\n", encoding="utf-8")
        _ok(["git", "add", "src/data/facts.json", "src/data/source.json"], local, "guide stage failed", repo_dir)

        staged = _run(["git", "diff", "--cached", "--quiet"], local, repo_dir)
        if staged.returncode not in (0, 1):
            raise LockstepError("guide stage failed")
        if staged.returncode == 1:
            _ok(["git", *_GIT_IDENTITY, "commit", "-q", "-m", message], local, "guide commit failed", repo_dir)
            _ok(
                ["git", *_GIT_AUTH, "push", "-q", "origin", f"HEAD:refs/heads/{push_branch}"],
                guide_env,
                "guide push failed",
                repo_dir,
            )
        head = _ok(["git", "rev-parse", "HEAD"], local, "guide rev-parse failed", repo_dir).strip()
        if not _SHA.match(head):
            raise LockstepError("guide rev-parse failed")

    number = p.guide_pr
    if p.action == "open-facts-sync":
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
                message,
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

    _ok(
        [
            "gh",
            "pr",
            "merge",
            "-R",
            guide_repo,
            str(number),
            "--squash",
            "--match-head-commit",
            head,
            "--subject",
            title,
            "--body",
            f"Paired-with: kindred@{sha}",
        ],
        guide_env,
        "merge failed",
    )


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

    _execute(
        p,
        sha=sha,
        branch=str(pr.get("headRefName") or ""),
        title=str(pr.get("title") or f"chore(facts): sync from kindred@{sha[:7]}"),
        guide_repo=guide_repo,
        guide_token=guide_token,
    )
    print("lockstep: merged")
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

"""Release docs tag: give the staff-guide image the release's version.

Runs from .github/workflows/release.yml before any Kindred image gets a version
tag, so one version pins both the app and its guide on prod. In order:

1. wait for guide-lockstep.yml's run on the release commit; anything but
   success stops the release (its paired guide PR may not have landed);
2. stop if Kindred main has moved past the release commit, because guide main
   could then describe a newer Kindred than the one being released;
3. read guide main's head and wait for its image.yml run, which publishes the
   `:sha-<sha7>` image the tag is copied from;
4. dispatch the guide's own release-tag.yml with {version, sha} and wait for
   that run. The guide repo tags its image with its own workflow token, so this
   side needs only "Actions: Read and write" on the guide repo, never a token
   that can write packages.

Guide main at release time is exactly what a latest/latest deploy would pull,
which is what this pins. Any failure stops the release (owner ruling), so a
pinned version always has a guide image.

The Actions log is PUBLIC: output is fixed `docs: ...` lines only. The guide
repo's name, the guide commit and the dispatched run id are never printed, and
gh output is captured and never echoed.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time

from scripts.guide.lockstep import _SHA, _env, _run, wait_for_check

_VERSION = re.compile(r"^v?(\d+\.\d+\.\d+)$")
LOCKSTEP_TIMEOUT_S = 80 * 60  # guide-lockstep's job timeout is 75 minutes
IMAGE_TIMEOUT_S = 20 * 60
TAG_RUN_TIMEOUT_S = 10 * 60
POLL_S = 15


class ReleaseTagError(Exception):
    """A failure whose message is a fixed, public-safe failure class."""


def _sha_of(repo: str, ref: str, token: str, failure: str) -> str:
    result = _run(["gh", "api", f"repos/{repo}/commits/{ref}", "--jq", ".sha"], _env(token))
    sha = result.stdout.strip()
    if result.returncode != 0 or not _SHA.fullmatch(sha):
        raise ReleaseTagError(failure)
    return sha


def _wait(repo: str, sha: str, workflow_file: str, timeout_s: int, token: str, what: str) -> None:
    try:
        conclusion = wait_for_check(repo, sha, workflow_file, timeout_s, POLL_S, env=_env(token))
    except TimeoutError:
        raise ReleaseTagError(f"{what} did not finish in time") from None
    if conclusion != "success":
        raise ReleaseTagError(f"{what} did not succeed")


def _dispatch(guide_repo: str, guide_sha: str, version: str, token: str) -> int:
    result = _run(
        [
            "gh",
            "api",
            "-X",
            "POST",
            f"repos/{guide_repo}/actions/workflows/release-tag.yml/dispatches",
            "-f",
            "ref=main",
            "-f",
            f"inputs[version]={version}",
            "-f",
            f"inputs[sha]={guide_sha}",
            "-F",
            "return_run_details=true",
            "--jq",
            ".workflow_run_id",
        ],
        _env(token),
    )
    run_id = result.stdout.strip()
    if result.returncode != 0 or not run_id.isdigit():
        raise ReleaseTagError("could not dispatch the guide tag workflow")
    return int(run_id)


def _wait_for_run(guide_repo: str, run_id: int, token: str) -> None:
    cmd = ["gh", "api", f"repos/{guide_repo}/actions/runs/{run_id}", "--jq", "{status, conclusion}"]
    deadline = time.monotonic() + TAG_RUN_TIMEOUT_S
    while True:
        result = _run(cmd, _env(token))
        if result.returncode == 0:
            try:
                run = json.loads(result.stdout or "{}")
            except json.JSONDecodeError:
                run = {}
            if isinstance(run, dict) and run.get("status") == "completed":
                if run.get("conclusion") != "success":
                    raise ReleaseTagError("the guide tag run did not succeed")
                return
        if time.monotonic() >= deadline:
            raise ReleaseTagError("the guide tag run did not finish in time")
        time.sleep(POLL_S)


def _release_tag(release_sha: str, version: str) -> int:
    kindred_repo = os.environ.get("KINDRED_REPO", "")
    kindred_token = os.environ.get("KINDRED_TOKEN", "")
    guide_repo = os.environ.get("GUIDE_REPO", "")
    guide_token = os.environ.get("GUIDE_TOKEN", "")
    if not (kindred_repo and kindred_token):
        raise ReleaseTagError("no kindred access (KINDRED_REPO / KINDRED_TOKEN unset)")
    if not (guide_repo and guide_token):
        raise ReleaseTagError("no guide access (GUIDE_REPO / GUIDE_WRITE_TOKEN unset)")

    _wait(kindred_repo, release_sha, "guide-lockstep.yml", LOCKSTEP_TIMEOUT_S, kindred_token, "guide lockstep")
    print("docs: guide lockstep finished on the release commit")

    if _sha_of(kindred_repo, "main", kindred_token, "could not read kindred main") != release_sha:
        raise ReleaseTagError("kindred main has moved past the release commit; re-run the release")

    guide_sha = _sha_of(guide_repo, "main", guide_token, "could not read guide main")
    _wait(guide_repo, guide_sha, "image.yml", IMAGE_TIMEOUT_S, guide_token, "guide image build")
    print("docs: guide image built")

    run_id = _dispatch(guide_repo, guide_sha, version, guide_token)
    _wait_for_run(guide_repo, run_id, guide_token)
    print(f"docs: tagged {version}")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Tag the staff-guide image with the release version.")
    ap.add_argument("--release-sha", required=True)
    ap.add_argument("--version", required=True)
    args = ap.parse_args(argv)

    version = _VERSION.fullmatch(args.version)
    if not version:
        print("docs: bad version")
        return 1
    if not _SHA.fullmatch(args.release_sha):
        print("docs: bad release sha")
        return 1
    try:
        return _release_tag(args.release_sha, version.group(1))
    except ReleaseTagError as exc:
        print(f"docs: {exc}")
        return 1
    except Exception as exc:  # the log is public: print the type only
        print(f"docs: internal error ({type(exc).__name__})")
        return 1


if __name__ == "__main__":
    sys.exit(main())

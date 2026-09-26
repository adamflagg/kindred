"""The commit-type lists agree, and every bot-written title is one the gate accepts.

A PR title becomes the squash commit on main, so its type decides the
changelog group and the version bump. Several files have to agree about types
for that to work, and nothing checked that they did:

- `commitlint.config.js` decides which titles are allowed. The required
  `Validate PR title` check runs it on the PR title, so it is the one list.
- `cliff.toml` maps each type to a changelog group, or skips it, and decides
  the bump.
- `.github/dependabot.yml` and `renovate.json` write titles for the bots.

What this file pins shut, each found in a 2026-09 audit of every merged PR:

- `revert(scope):`, the only revert form the gate accepted, fell through
  cliff.toml's case-sensitive `^Revert` into "Other".
- Dependency bumps were typed `fix`, so they padded Bug Fixes -- 18 of the 50
  in v6.3.0.
- The title check carried its own hand-copied type and scope list, so
  commitlint's length rule never reached a title.
- A `!` marker made git-cliff cut a major, and all five majors to date came
  from one, on an app with no external consumer.
- A release window holding only skipped commits (chore, ci) failed with
  "Tag already exists", which reads as a tagging bug rather than an empty
  window.
"""

import functools
import json
import os
import re
import subprocess
import tomllib
from pathlib import Path, PurePosixPath
from typing import Any

import pytest
import yaml

REPO_ROOT = Path(__file__).parents[3]
COMMITLINT = REPO_ROOT / "commitlint.config.js"
CLIFF = REPO_ROOT / "cliff.toml"
DEPENDABOT = REPO_ROOT / ".github/dependabot.yml"
RENOVATE = REPO_ROOT / "renovate.json"
TITLE_WORKFLOW = REPO_ROOT / ".github/workflows/semantic-pr.yml"
RELEASE_WORKFLOW = REPO_ROOT / ".github/workflows/release.yml"
CI_WORKFLOW = REPO_ROOT / ".github/workflows/ci.yml"

# The ruleset requires a status check with exactly this name. Renaming the job
# does not fail anything -- it leaves every PR waiting on a check that never
# reports.
REQUIRED_TITLE_CHECK = "Validate PR title"

TITLE = re.compile(r"^(?P<type>[a-z]+)(?:\((?P<scope>[^)]*)\))?: ")


def _commitlint_enum(rule: str) -> list[str]:
    """The values of a commitlint `*-enum` rule, read from the JS source.

    Regex over the source rather than `node -e require(...)`: the Python suite
    runs without the root node_modules, and these arrays are plain literals.
    Comments are stripped first so a quoted word inside one is not read as a
    value.
    """
    text = COMMITLINT.read_text()
    m = re.search(rf"'{rule}':\s*\[\s*2,\s*'always',\s*\[(.*?)\]\s*\]", text, re.DOTALL)
    assert m, f"commitlint.config.js has no `{rule}` rule in the form [2, 'always', [...]]"
    values = re.findall(r"'([a-z][a-z-]*)'", re.sub(r"//[^\n]*", "", m.group(1)))
    assert values, f"`{rule}` parsed to an empty list"
    return values


def _types() -> list[str]:
    return _commitlint_enum("type-enum")


def _scopes() -> list[str]:
    return _commitlint_enum("scope-enum")


@functools.cache
def _cliff() -> dict[str, Any]:
    """Parsed once, so parsers compare by identity across calls."""
    return tomllib.loads(CLIFF.read_text())


def _parsers() -> list[dict[str, Any]]:
    parsers = _cliff()["git"]["commit_parsers"]
    assert isinstance(parsers, list)
    return parsers


def _is_catch_all(parser: dict[str, Any]) -> bool:
    return parser.get("message") == ".*"


def _first_parser(message: str) -> dict[str, Any]:
    """The parser git-cliff applies: the first whose `message` regex matches.

    The patterns are plain anchored prefixes, which Rust's regex crate and
    Python's `re` read identically.
    """
    for parser in _parsers():
        if "message" in parser and re.search(parser["message"], message):
            return parser
    raise AssertionError(f"no cliff.toml parser matches {message!r}")


def _preprocess(message: str) -> str:
    """Apply cliff.toml's commit_preprocessors, translating Rust's `${N}` to `\\g<N>`."""
    for pre in _cliff()["git"].get("commit_preprocessors", []):
        replace = re.sub(r"\$\{?(\d+)\}?", r"\\g<\1>", pre["replace"])
        message = re.sub(pre["pattern"], replace, message)
    return message


def _bot_prefixes() -> dict[str, str]:
    """Every commit-message prefix a bot is configured to write, by where it is set."""
    found: dict[str, str] = {}
    for update in yaml.safe_load(DEPENDABOT.read_text())["updates"]:
        where = f"dependabot {update['package-ecosystem']} {update['directory']}"
        for key in ("prefix", "prefix-development"):
            if key in update.get("commit-message", {}):
                found[f"{where} {key}"] = update["commit-message"][key]
    renovate = json.loads(RENOVATE.read_text())
    default_type = renovate["semanticCommitType"]
    default_scope = renovate["semanticCommitScope"]
    found["renovate default"] = f"{default_type}({default_scope})"
    for i, rule in enumerate(renovate.get("packageRules", [])):
        if "semanticCommitType" in rule or "semanticCommitScope" in rule:
            t = rule.get("semanticCommitType", default_type)
            s = rule.get("semanticCommitScope", default_scope)
            found[f"renovate packageRules[{i}]"] = f"{t}({s})"
    assert found
    return found


def _split_prefix(prefix: str) -> tuple[str, str]:
    m = re.fullmatch(r"([a-z]+)\(([a-z-]+)\)", prefix)
    assert m, f"bot prefix {prefix!r} is not `type(scope)`"
    return m.group(1), m.group(2)


# ─── One list of types, and cliff.toml covers exactly that list ─────────────


@pytest.mark.parametrize("commit_type", _types())
def test_every_allowed_type_has_its_own_changelog_parser(commit_type: str) -> None:
    """A type the gate accepts must reach a group (or a skip) of its own.

    Falling through to the `.*` catch-all files the commit under "Other",
    which is how every conventional revert landed there.
    """
    parser = _first_parser(f"{commit_type}(api): subject")
    assert not _is_catch_all(parser), f"`{commit_type}` falls through to the catch-all ({parser})"


def test_github_revert_button_titles_reach_the_reverts_group() -> None:
    """GitHub's Revert button titles the PR `Revert "..."`; commitlint ignores that form by default."""
    assert _first_parser('Revert "feat(api): subject"') is _first_parser("revert(api): subject")


def test_no_changelog_parser_serves_a_type_the_gate_rejects() -> None:
    """A parser no allowed title can reach is dead config that reads as live."""
    reachable = {id(_first_parser(f"{t}(api): subject")) for t in _types()}
    reachable.add(id(_first_parser('Revert "feat(api): subject"')))
    reachable.add(id(_first_parser("Merge pull request #1 from x/y")))
    dead = [p for p in _parsers() if id(p) not in reachable and not _is_catch_all(p)]
    assert not dead, f"cliff.toml parsers no allowed title reaches: {dead}"


def test_no_scope_repeats_a_type_name() -> None:
    """`fix(ci)`, `docs(docs)`: a scope named after a type invites the wrong type.

    The audit found dozens of `fix(ci)`/`chore(ci)`/`perf(ci)` titles on CI
    work, and 20+ `docs(docs)`. With no `ci` scope, CI work has to say `ci`.
    """
    overlap = sorted(set(_types()) & set(_scopes()))
    assert not overlap, f"scopes that are also types: {overlap}"


# ─── Bump and changelog behaviour ───────────────────────────────────────────


@pytest.mark.parametrize(
    "message",
    [
        "feat(api)!: subject",
        "fix!: subject",
        "fix(api): subject\n\nBREAKING CHANGE: something moved",
        "fix(api): subject\n\nBREAKING-CHANGE: something moved",
    ],
)
def test_breaking_markers_do_not_survive_preprocessing(message: str) -> None:
    """Majors are cut by hand (`release <version>`), never by a marker.

    git-cliff reads the preprocessed message, so a marker removed here cannot
    bump the major (verified against git-cliff 2.14.2: `feat!` -> v1.1.0).
    """
    out = _preprocess(message)
    assert not re.match(r"^[a-z]+(\([^)]*\))?!:", out), out
    assert not re.search(r"(?m)^BREAKING[ -]CHANGE:", out), out


def test_preprocessing_keeps_the_type_and_scope() -> None:
    assert _preprocess("feat(api,frontend)!: subject").startswith("feat(api,frontend): subject")
    assert _preprocess("fix!: subject").startswith("fix: subject")


@pytest.mark.parametrize(
    ("message", "expected"),
    [
        ("feat(api): subject (Phase 2 of 3) (#12)", "feat(api): subject (#12)"),
        ("feat(api): subject (part 1) (#12)", "feat(api): subject (#12)"),
        ("fix(api): subject (#12)", "fix(api): subject (#12)"),
        ("fix(api): keep (stage lock) wording (#12)", "fix(api): keep (stage lock) wording (#12)"),
    ],
)
def test_phase_markers_are_stripped_from_changelog_lines(message: str, expected: str) -> None:
    """A phase marker helps the PR's reviewer and scan-it; it means nothing in release notes."""
    assert _preprocess(message) == expected


def test_changelog_groups_carry_a_sort_key_that_sorts_as_intended() -> None:
    """git-cliff orders groups by name. An unprefixed list is alphabetical.

    That put Features after 53 lines of Bug Fixes in v6.3.0. The `<!-- NN -->`
    prefix is stripped by the template's `striptags`, and must be zero-padded:
    `<!-- 10 -->` sorts before `<!-- 9 -->` as a string.
    """
    groups = {p["group"] for p in _parsers() if "group" in p}
    for g in groups:
        assert re.match(r"^<!-- \d\d -->\S", g), f"group {g!r} has no two-digit `<!-- NN -->` sort key"
    assert min(groups).endswith("Features"), f"first group is {min(groups)!r}"
    assert "striptags" in _cliff()["changelog"]["body"]


# ─── Bots write titles the gate accepts, typed by what the bump is ──────────


@pytest.mark.parametrize(("where", "prefix"), sorted(_bot_prefixes().items()))
def test_bot_prefixes_are_a_type_and_scope_the_gate_accepts(where: str, prefix: str) -> None:
    commit_type, scope = _split_prefix(prefix)
    assert commit_type in _types(), f"{where}: type {commit_type!r} is not in commitlint's type-enum"
    assert scope in _scopes(), f"{where}: scope {scope!r} is not in commitlint's scope-enum"


@pytest.mark.parametrize(("where", "prefix"), sorted(_bot_prefixes().items()))
def test_a_dependency_bump_is_never_titled_a_bug_fix(where: str, prefix: str) -> None:
    """A bump is `build(deps)` if it ships, `chore(deps)` if it is dev-only, `ci(deps)` for CI."""
    commit_type, scope = _split_prefix(prefix)
    assert commit_type in {"build", "chore", "ci"}, f"{where}: {prefix!r}"
    assert scope == "deps", f"{where}: {prefix!r} -- one scope for one kind of change"


def test_dev_only_dependency_bumps_stay_out_of_the_changelog() -> None:
    """Dependabot's `prefix-development` covers packages that never reach an image."""
    for where, prefix in _bot_prefixes().items():
        if where.endswith("prefix-development"):
            assert prefix == "chore(deps)", f"{where}: {prefix!r}"


def test_github_actions_bumps_are_ci() -> None:
    actions = [p for w, p in _bot_prefixes().items() if "github-actions" in w]
    assert actions == ["ci(deps)"]


def test_commitlint_ignores_bot_bump_titles_in_their_new_types() -> None:
    """Bot bump subjects run past 120 characters; the ignore must follow the prefixes."""
    text = COMMITLINT.read_text()
    m = re.search(r"\(message\) => /(.+?)/\.test\(message\)", text)
    assert m, "commitlint.config.js has no bot-bump ignore regex"
    ignore = re.compile(m.group(1).replace(r"\/", "/"))
    for title in (
        "build(deps): bump the python-prod group across 1 directory with 5 updates from 1.0.0 to 1.1.0",
        "chore(deps): bump eslint from 10.1.0 to 10.2.0 in /frontend",
        "ci(deps): bump actions/checkout from 6.0.0 to 7.0.1",
    ):
        assert ignore.search(title), title


# ─── The title check runs commitlint, and nothing else ──────────────────────


def _title_workflow() -> dict[Any, Any]:
    """Keys are `Any`: PyYAML reads a bare `on:` key as the boolean True."""
    wf = yaml.safe_load(TITLE_WORKFLOW.read_text())
    assert isinstance(wf, dict)
    return wf


def _title_job() -> dict[str, Any]:
    jobs = [j for j in _title_workflow()["jobs"].values() if j.get("name") == REQUIRED_TITLE_CHECK]
    assert len(jobs) == 1, f"exactly one job must be named {REQUIRED_TITLE_CHECK!r}; the ruleset requires it"
    job = jobs[0]
    assert isinstance(job, dict)
    return job


def test_title_check_runs_commitlint_rather_than_a_copied_list() -> None:
    steps = _title_job()["steps"]
    assert not [s for s in steps if str(s.get("uses", "")).startswith("amannn/")], (
        "the title check must run commitlint.config.js, not keep its own type/scope list"
    )
    assert any("commitlint" in str(s.get("run", "")) for s in steps)


def test_title_reaches_the_shell_through_env_not_interpolation() -> None:
    """A PR title is attacker-controlled text; `${{ }}` inside `run:` is script injection."""
    for step in _title_job()["steps"]:
        assert "github.event.pull_request.title" not in str(step.get("run", "")), step


def test_title_check_still_runs_on_every_event_that_can_change_or_hide_it() -> None:
    """`edited` re-checks a retitled PR; `synchronize` puts the check on each new head."""
    wf = _title_workflow()
    on = wf.get("on") or wf.get(True)
    assert isinstance(on, dict), "semantic-pr.yml has no `on:` mapping"
    assert set(on["pull_request"]["types"]) >= {"opened", "edited", "synchronize", "reopened"}


# ─── Release tooling ────────────────────────────────────────────────────────


def _release_steps() -> list[dict[str, Any]]:
    wf = yaml.safe_load(RELEASE_WORKFLOW.read_text())
    steps = wf["jobs"]["release"]["steps"]
    assert isinstance(steps, list)
    return steps


def test_release_pins_the_git_cliff_version() -> None:
    """Unpinned, CI ran 2.14.2 while local ran 2.12.0, and bump rules differ between releases."""
    step = next(s for s in _release_steps() if "setup-git-cliff" in str(s.get("uses", "")))
    version = str((step.get("with") or {}).get("version", ""))
    assert re.fullmatch(r"\d+\.\d+\.\d+", version), f"setup-git-cliff version is {version!r}"
    assert "depName=orhun/git-cliff" in RELEASE_WORKFLOW.read_text(), "no Renovate marker tracks the pin"


def _run_version_step(tmp_path: Path, bumped: str) -> subprocess.CompletedProcess[str]:
    """Run release.yml's `Calculate version` script in a scratch repo tagged v1.0.0.

    `git cliff` is stubbed to print `bumped`, which is what git-cliff prints for
    the window: the last tag itself when every commit since is skipped.
    """
    script = next(s for s in _release_steps() if s.get("id") == "version")["run"]
    repo = tmp_path / "repo"
    repo.mkdir()
    env = {
        **os.environ,
        "GIT_AUTHOR_NAME": "t",
        "GIT_AUTHOR_EMAIL": "t@example.invalid",
        "GIT_COMMITTER_NAME": "t",
        "GIT_COMMITTER_EMAIL": "t@example.invalid",
        "GIT_CONFIG_GLOBAL": "/dev/null",
        "GIT_CONFIG_NOSYSTEM": "1",
    }
    for cmd in (
        ["git", "init", "-q"],
        ["git", "commit", "-q", "--allow-empty", "-m", "init"],
        ["git", "tag", "-a", "v1.0.0", "-m", "v1.0.0"],
        ["git", "commit", "-q", "--allow-empty", "-m", "chore(harness): x"],
    ):
        subprocess.run(cmd, cwd=repo, env=env, check=True)
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    stub = bin_dir / "git-cliff"
    stub.write_text(f"#!/bin/sh\necho {bumped}\n")
    stub.chmod(0o755)
    env |= {
        "PATH": f"{bin_dir}{os.pathsep}{env['PATH']}",
        "INPUT_VERSION": "",
        "GITHUB_OUTPUT": str(tmp_path / "out"),
        "GITHUB_STEP_SUMMARY": str(tmp_path / "summary"),
    }
    return subprocess.run(
        ["bash", "--noprofile", "--norc", "-eo", "pipefail", "-c", script],
        cwd=repo,
        env=env,
        capture_output=True,
        text=True,
    )


def test_release_explains_a_window_with_nothing_releasable(tmp_path: Path) -> None:
    result = _run_version_step(tmp_path, "v1.0.0")
    output = result.stdout + result.stderr
    assert result.returncode != 0
    assert "Nothing to release" in output, output
    assert "already exists" not in output, output


def test_release_still_computes_a_real_bump(tmp_path: Path) -> None:
    result = _run_version_step(tmp_path, "v1.1.0")
    assert result.returncode == 0, result.stdout + result.stderr
    assert "version=v1.1.0" in (tmp_path / "out").read_text()


# ─── CI can re-run this file when any file it polices changes ───────────────


def test_tests_python_gate_covers_every_file_this_module_polices() -> None:
    """Same shape as kindred#2653/#2663: a gate that cannot fire goes skipped, and skipped scores OK."""
    wf = yaml.safe_load(CI_WORKFLOW.read_text())
    filters = yaml.safe_load(wf["jobs"]["detect-changes"]["steps"][1]["with"]["filters"])
    patterns = filters["python"]
    for path in (COMMITLINT, CLIFF, DEPENDABOT, RENOVATE, TITLE_WORKFLOW, RELEASE_WORKFLOW):
        rel = PurePosixPath(path.relative_to(REPO_ROOT).as_posix())
        assert any(rel.full_match(p) for p in patterns), f"`python` filter cannot fire on {rel}"

"""Every CI job's paths-filter must be able to fire on the job's own inputs.

A job whose gate cannot match the files it checks does not go red when those
files break -- it goes *skipped*, and `ci-summary` counts a skipped job as OK.
That is the same false-green shape as the `go` filter fixed in kindred#2652,
where `go.mod`/`go.sum` were listed at the repo root and the module actually
lives at `pocketbase/go.mod`, so every Dependabot Go bump ran zero Go tests.

`tests/unit/scripts/test_go_test_shard.py` owns the Go half of this. This file
owns the Python half, filed as kindred#2653.

Matching uses `PurePosixPath.full_match`, whose semantics line up with the
picomatch globbing `dorny/paths-filter` uses for the pattern forms in this
workflow -- notably `config/*.json` matches `config/a.json` but not
`config/sub/a.json`.
"""

import json
import re
import subprocess
from pathlib import Path, PurePosixPath
from typing import Any

import yaml

REPO_ROOT = Path(__file__).parents[3]
CI_WORKFLOW = REPO_ROOT / ".github/workflows/ci.yml"


def _ci() -> dict[str, Any]:
    wf = yaml.safe_load(CI_WORKFLOW.read_text())
    assert isinstance(wf, dict)
    return wf


def _filters() -> dict[str, list[str]]:
    step = _ci()["jobs"]["detect-changes"]["steps"][1]
    parsed = yaml.safe_load(step["with"]["filters"])
    assert isinstance(parsed, dict)
    return parsed


def _gating_filters(job: str) -> list[str]:
    """The detect-changes outputs a job's `if:` actually reads.

    Derived from the expression rather than hardcoded, so renaming the filter a
    job gates on cannot silently orphan these assertions.
    """
    expr = _ci()["jobs"][job]["if"]
    names = re.findall(r"needs\.detect-changes\.outputs\.(\w+)", expr)
    assert names, f"{job} has no detect-changes gate: {expr!r}"
    return names


def _gating_filters_for_step(job: str, step_name: str) -> list[str]:
    """The detect-changes outputs one STEP's `if:` reads.

    A step carries its own gate, and it is not always the job's. go-lint's job
    gate admits three filters while seven of its steps admit one, so asserting
    against the job gate alone can report a step as reachable when the step
    itself would skip -- and a job whose steps all skip still concludes
    `success`, which `ci-summary` counts as OK.
    """
    steps = _ci()["jobs"][job]["steps"]
    step = next((st for st in steps if st.get("name") == step_name), None)
    assert step is not None, f"{job} has no step named {step_name!r}"
    expr = step.get("if")
    assert expr, f"{job}/{step_name} has no `if:`"
    names = re.findall(r"needs\.detect-changes\.outputs\.(\w+)", expr)
    assert names, f"{job}/{step_name} has no detect-changes gate: {expr!r}"
    return names


def _patterns_gating_step(job: str, step_name: str) -> list[str]:
    filters = _filters()
    pats: list[str] = []
    for name in _gating_filters_for_step(job, step_name):
        pats.extend(filters[name])
    return pats


def _workspace_modules() -> list[str]:
    """The module directories go.work `use`s, read from go.work itself.

    Derived rather than hardcoded: a module added to the workspace becomes an
    input to `go vet ./...` the moment it is listed, whether or not anyone
    remembers to update this file.
    """
    text = (REPO_ROOT / "go.work").read_text()
    block = re.search(r"use\s*\((.*?)\)", text, re.DOTALL)
    assert block, "go.work has no use(...) block"
    mods = [ln.strip().lstrip("./") for ln in block.group(1).splitlines() if ln.strip()]
    assert mods, "go.work use(...) block is empty"
    return mods


def _patterns_gating(job: str) -> list[str]:
    filters = _filters()
    pats: list[str] = []
    for name in _gating_filters(job):
        pats.extend(filters[name])
    return pats


def _matches(path: str, patterns: list[str]) -> bool:
    p = PurePosixPath(path)
    return any(p.full_match(pat) for pat in patterns)


def _tracked(*globs: str) -> list[str]:
    out = subprocess.run(
        ["git", "ls-files", *globs],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=True,
    ).stdout.split()
    assert out, f"no tracked files for {globs}"
    return out


def _json_validation_globs() -> list[str]:
    """The globs the `JSON config validation` step iterates, read from the step.

    Deriving them beats hardcoding: if someone adds a third directory to that
    loop, this picks it up and demands the filter cover it too.
    """
    steps = _ci()["jobs"]["python-lint"]["steps"]
    run = next(st["run"] for st in steps if st.get("name") == "JSON config validation")
    m = re.search(r"for f in (.+?); do", run)
    assert m, f"could not read the glob list out of the step: {run!r}"
    return m.group(1).split()


def test_python_lint_gate_covers_every_tracked_python_file():
    """`ruff format --check .`, `ruff check .` and `mypy .` lint the whole tree.

    python-lint gated on `backend`, which has no `tests/**`, so a tests-only PR
    was never formatted, linted or type-checked in CI. Observed live on #2652,
    which added four Python tests and reported `Python Lint: skipping`.
    """
    patterns = _patterns_gating("python-lint")
    # .pyi as well as .py: ruff.toml declares `include = ["*.py", "*.pyi"]` and
    # mypy reads stubs natively, so a stub file is as much an input as a module.
    uncovered = [f for f in _tracked("*.py", "*.pyi") if not _matches(f, patterns)]
    assert not uncovered, f"{len(uncovered)} tracked Python files cannot trigger python-lint: {uncovered[:5]}"
    # No stub is tracked yet, so the walk above cannot exercise the .pyi pattern.
    # Assert a representative path instead, for the same reason `bunking/*.json`
    # is asserted representatively below: an unguarded pattern is how a filter
    # entry rots into one that matches nothing and nobody notices.
    assert _matches("bunking/sample.pyi", patterns), "a .pyi stub cannot trigger python-lint"


def test_python_lint_gate_covers_its_non_python_inputs():
    """The job does more than ruff and mypy, and those steps have inputs too.

    `JSON config validation` reads config/*.json and bunking/*.json; the
    pip-audit step reads .pip-audit-ignore, so adding an ignored CVE there must
    be able to re-run the audit that consumes it.
    """
    patterns = _patterns_gating("python-lint")
    # A representative path per glob, not the files that happen to exist today:
    # `bunking/*.json` currently matches nothing, and the job should still be
    # able to fire on the first file added there.
    required = [g.replace("*", "sample") for g in _json_validation_globs()]
    required.append(".pip-audit-ignore")
    uncovered = [f for f in required if not _matches(f, patterns)]
    assert not uncovered, f"python-lint step inputs cannot trigger it: {uncovered}"


def test_python_lint_gate_covers_the_workflow_that_defines_it():
    """The steps, their order and their flags all live in ci.yml.

    Same reasoning the `go` filter already documents for itself: a PR that edits
    only this job would otherwise ship having never run it.
    """
    assert _matches(".github/workflows/ci.yml", _patterns_gating("python-lint"))


def test_python_lint_does_not_run_on_go_only_changes():
    """`backend` bundles `pocketbase/**`, so a Go-only PR ran the full Python lint.

    The gate should describe this job's inputs, not a filter meant for another.
    """
    patterns = _patterns_gating("python-lint")
    assert not _matches("pocketbase/sync/sync.go", patterns)
    assert not _matches("pocketbase/go.mod", patterns)


def test_tests_python_gate_covers_the_workflow_its_own_tests_assert_on():
    """These filter assertions live in the Python suite, gated on `python`.

    `python` watches no workflow file, so editing only ci.yml -- exactly the
    change these tests exist to police -- ran none of them.
    """
    assert _matches(".github/workflows/ci.yml", _patterns_gating("tests-python"))


def test_tests_python_gate_covers_the_golangci_config_it_asserts_on():
    """`test_golangci_config.py` policies `.golangci.yml`, and runs in tests-python.

    Same argument as the test above makes for ci.yml. kindred#2671 added
    assertions that goconst is not disabled tree-wide and that its path
    exclusions name exactly the packages we said they could -- but `python`
    watches no Go config, so a PR that edits ONLY `.golangci.yml` runs none of
    them. #2671 escaped that only because it happened to touch `tests/**` as
    well; a later PR narrowing an exclusion need not.

    A skipped job is scored OK by `ci-summary`, so the failure mode is a silent
    green, not a red -- the same shape as kindred#2653 and kindred#2663.
    """
    assert _matches(".golangci.yml", _patterns_gating("tests-python"))


def _renovate_manager_files() -> list[str]:
    """Every tracked file a Renovate customManager regex actually reads.

    Derived from `renovate.json` rather than hardcoded: a manager added for a
    new file must widen the gate that verifies it, or this list grows and the
    assertion below goes red on the PR that added it.
    """
    config = json.loads((REPO_ROOT / "renovate.json").read_text())
    patterns = []
    for manager in config["customManagers"]:
        for raw in manager["managerFilePatterns"]:
            undelimited = f"{raw!r} is not /-delimited, so Renovate reads it as a glob, not a regex"
            assert raw.startswith("/"), undelimited
            assert raw.endswith("/"), undelimited
            patterns.append(re.compile(raw[1:-1]))
    files = [f for f in _tracked("*") if any(p.search(f) for p in patterns)]
    assert files, "no tracked file matches any customManager pattern"
    return files


def test_security_lint_gate_covers_the_renovate_manager_check_inputs():
    """`Verify Renovate custom managers still match` reads more than the workflows.

    The step is gated on `actions`, which watches `.github/workflows/**`,
    `renovate.json` and the checker itself -- but a customManager also targets
    `docker/healthcheck/go.mod`, and `go`/`docker` do not gate this job. A PR
    that bumps only that Go directive -- precisely what renovate.json's
    `matchDepNames: ["go"]` dashboard rule is built to produce -- would skip the
    one check that proves the regex still matches, and the red would surface
    later on an unrelated workflow PR. Same false-green shape as kindred#2652
    and the python-lint gate above.
    """
    patterns = _patterns_gating("security-lint")
    required = [
        "renovate.json",
        "scripts/ci/check_renovate_managers.py",
        *_renovate_manager_files(),
    ]
    uncovered = [f for f in required if not _matches(f, patterns)]
    assert not uncovered, f"Renovate manager-check inputs cannot trigger security-lint: {uncovered}"


# --- go-lint (kindred#2663) ------------------------------------------------
#
# go-lint gated on `backend`, a filter that carried Python entries no go-lint
# step reads and could not match `.github/workflows/ci.yml`, where the job's
# gate, its eight step-level `if:`s, the pinned golangci-lint version and the
# shellcheck invocation all live. So the job both over-fired (a Python-only PR
# ran gofmt, go vet, golangci-lint, go build, govulncheck and the PocketBase JS
# lint for nothing) and under-fired (a PR editing only go-lint shipped having
# never run it). Same false-green family as kindred#2653: a job that cannot be
# triggered goes *skipped*, and `ci-summary` counts skipped as OK.


def test_go_lint_gate_covers_every_go_file_it_lints():
    """gofmt, go vet, golangci-lint and go build all run over `pocketbase/`.

    Scoped to that module on purpose: `docker/healthcheck/main.go` is the only
    tracked .go outside it, and every go-lint step is scoped to `pocketbase/`,
    so CI does not lint it. That is a deliberate, recorded decision -- see the
    note in `.golangci.yml` -- not an oversight this test should paper over.
    """
    patterns = _patterns_gating_step("go-lint", "Go vet")
    # `pocketbase/*.go`, NOT `pocketbase/**/*.go`. These are git pathspecs, and
    # git's default wildmatch runs without WM_PATHNAME -- `*` crosses `/`, while
    # `**/` still requires a literal slash and so drops every depth-1 file. The
    # `**` form returns 230 files and silently omits 13, pocketbase/main.go among
    # them. The identical string is correct as a paths-filter PATTERN in the same
    # file, which is exactly what makes this easy to get wrong.
    uncovered = [f for f in _tracked("pocketbase/*.go") if not _matches(f, patterns)]
    assert not uncovered, f"{len(uncovered)} tracked Go files cannot trigger go-lint: {uncovered[:5]}"


def test_go_lint_gate_covers_every_workspace_module_manifest():
    """`go vet ./...` loads the whole workspace before it vets anything.

    A `go` directive bumped in ANY workspace module -- or a deleted go.mod --
    hard-fails every Go command inside `pocketbase/` with
    `requires go >= X (running Y; GOTOOLCHAIN=local)`. That is a real input to
    this job even though no go-lint step reads the other module's sources.

    Asserted against the STEP gate, not the job's. Against the job gate this
    passes today by accident -- the gate's `docker` term carries `docker/**`,
    which matches `docker/healthcheck/go.mod` -- while `Go vet` itself, gated
    on one filter, would still skip. A job whose steps all skip concludes
    `success`.
    """
    patterns = _patterns_gating_step("go-lint", "Go vet")
    uncovered = [f"{m}/go.mod" for m in _workspace_modules() if not _matches(f"{m}/go.mod", patterns)]
    assert not uncovered, f"workspace manifests cannot trigger go-lint: {uncovered}"


def test_go_lint_gate_covers_the_pocketbase_js_lint_inputs():
    """The job also runs `npm ci` and `npm run lint` inside `pocketbase/`.

    That script is `eslint pb_migrations pb_hooks`, so the linted trees, the
    flat config and both npm manifests decide its verdict.
    """
    patterns = _patterns_gating_step("go-lint", "PocketBase JS linting")
    required = [
        "pocketbase/eslint.config.js",
        "pocketbase/package.json",
        "pocketbase/package-lock.json",
        "pocketbase/pb_migrations/1500000001_example.js",
        "pocketbase/pb_hooks/main.pb.js",
    ]
    uncovered = [f for f in required if not _matches(f, patterns)]
    assert not uncovered, f"PocketBase JS lint inputs cannot trigger go-lint: {uncovered}"


def test_go_lint_gate_covers_the_workflow_that_defines_it():
    """The gate, the eight step-level `if:`s and the pinned tool version live here.

    Live evidence for the gap this closes: kindred#2680 edited only ci.yml and
    tests/, and reported `Go Lint: skipping` (merge commit 305fc137).
    """
    assert _matches(".github/workflows/ci.yml", _patterns_gating("go-lint"))


def test_go_lint_gate_covers_the_lint_config_it_passes_explicitly():
    """The job runs golangci-lint with `--config ../.golangci.yml`."""
    assert _matches(".golangci.yml", _patterns_gating_step("go-lint", "Go linting"))


def test_go_lint_does_not_run_on_python_only_changes():
    """`backend` bundled Python sources no go-lint step reads.

    A Python-only PR ran the entire Go toolchain -- gofmt, go vet,
    golangci-lint, go build, govulncheck and the PocketBase JS lint -- for
    nothing. The gate should describe this job's inputs, not another job's.
    """
    patterns = _patterns_gating("go-lint")
    for path in ("api/main.py", "bunking/solver/model.py", "conftest.py", "ruff.toml"):
        assert not _matches(path, patterns), f"{path} still triggers go-lint"


def test_go_vet_step_can_be_triggered_by_the_workspace_file():
    """Asserted at the STEP, which is where go.work's only pin now lives.

    `test_go_test_shard.py` used to pin `go.work` into the `backend` filter.
    That filter is gone, and the workspace-manifest test above does NOT subsume
    the pin: it derives `<module>/go.mod` from go.work's use-list and never
    asserts go.work itself, so dropping the entry leaves it green. Verified by
    doing exactly that.
    """
    assert _matches("go.work", _patterns_gating_step("go-lint", "Go vet"))


def test_no_detect_changes_output_is_orphaned():
    """Every declared output must exist as a filter, be read, and name its own key.

    A job gate naming an output that does not exist resolves to `''` -- every
    gated step skips, the job still concludes `success`, and `ci-summary` passes
    it. A misspelled `steps.filter.outputs.golint` on the right-hand side has
    identical symptoms and is invisible on a read-through.
    """
    ci = _ci()
    outputs = ci["jobs"]["detect-changes"]["outputs"]
    filters = _filters()
    workflow_text = CI_WORKFLOW.read_text()

    # Anchored on a right-hand word boundary, not a substring test. `go` is a
    # strict prefix of `goLint`, and `python` of `pythonLint`, so a plain `in`
    # lets `outputs.goLint` satisfy a search for `outputs.go` -- the guard would
    # stay green while `go` was orphaned or miswired. This PR is what creates the
    # go/goLint collision, so the boundary is load-bearing from here on.
    def _reads(name: str, text: str, prefix: str) -> bool:
        return re.search(rf"{prefix}\.{re.escape(name)}(?![A-Za-z0-9_-])", text) is not None

    for name, expr in outputs.items():
        assert name in filters, f"output `{name}` has no matching filter"
        assert _reads(name, expr, r"steps\.filter\.outputs"), f"output `{name}` reads a different filter: {expr!r}"

    # The consumer direction, which is the one that actually bites: every
    # assertion here is otherwise producer-side. A typo in a STEP gate names an
    # output nothing exports, resolves to '', and skips that step silently while
    # the rest of this test stays green. go-lint has nine such references and
    # only three are named by a step-level assertion.
    for used in sorted(set(re.findall(r"needs\.detect-changes\.outputs\.(\w+)", workflow_text))):
        assert used in outputs, (
            f"a gate reads `{used}`, which detect-changes does not export -- it "
            f"resolves to '' and the gated job or step silently skips"
        )

    for name in filters:
        assert name in outputs, f"filter `{name}` is declared but never exported"
        assert _reads(name, workflow_text, r"needs\.detect-changes\.outputs"), (
            f"filter `{name}` is exported but read by no job -- a loaded gun for "
            f"the next job that reaches for a conveniently-broad filter"
        )


def test_node_version_pin_can_trigger_the_jobs_that_read_it():
    """Four jobs set `node-version-file: '.nvmrc'`, and nothing matched it.

    `.python-version` matched three filters; `.nvmrc` matched none -- so a
    Renovate nvm bump (renovate.json enables the `nvm` manager, and .nvmrc has
    been bumped before) triggered no job that validates a toolchain. Asserted at
    the JOB level for go-lint, because its `Setup Node.js` step carries no `if:`
    and runs whenever the job does.
    """
    for job in ("go-lint", "frontend-lint"):
        assert _matches(".nvmrc", _patterns_gating(job)), f"a .nvmrc bump cannot trigger {job}"


# --- shell lint (kindred#2663 Gap C) ---------------------------------------
#
# The shellcheck invocation was written out three times -- ci.yml, .lefthook.yml
# and scripts/pre-push-verify.sh -- as a hand-maintained `find` over four fixed
# roots. Three copies had already drifted into two different commands, and the
# root list did not match what the repo actually holds: four scripts under
# frontend/ and tests/shell/ could not trigger the job that linted them, and
# .claude/hooks/worktree-guard.sh was linted by nothing at all.
#
# Both directions matter and only one of them was ever asserted. `lint_set is a
# subset of the gate` passes green over a widened gate that lints a stale file
# list -- which would report the step as `success` on a file it never opened,
# strictly worse than today's uninformative `skipped`.


def _shellcheck_script() -> Path:
    return REPO_ROOT / "scripts/ci/shellcheck-all.sh"


def _shellcheck_lint_set() -> list[str]:
    """The files scripts/ci/shellcheck-all.sh lints, derived by PARSING it.

    Not by running it. Once the command is `git ls-files '*.sh'`, asserting the
    result of running it against `git ls-files '*.sh'` is circular and passes
    however the script is broken.
    """
    text = _shellcheck_script().read_text()
    m = re.search(r"git ls-files -z (?P<globs>.+?)\)", text)
    assert m, f"could not read the file selection out of the script:\n{text}"
    globs = [g.strip("'\"") for g in m.group("globs").split()]
    files = _tracked(*globs)
    assert len(files) >= 40, f"parsed lint set collapsed to {len(files)} files: {globs}"
    return files


def test_shellcheck_gate_covers_every_file_it_lints():
    """Every file the shellcheck step opens must be able to trigger that step.

    Asserted against the STEP's gate, which is not the job's: the step carries
    `shell || goLint || docker` while seven sibling steps carry `goLint` alone.
    """
    patterns = _patterns_gating_step("go-lint", "Shell script linting (shellcheck)")
    uncovered = [f for f in _shellcheck_lint_set() if not _matches(f, patterns)]
    assert not uncovered, f"{len(uncovered)} linted shell scripts cannot trigger the step: {uncovered}"


def test_every_tracked_shell_script_is_linted():
    """The other direction: a tracked *.sh the command never opens is unlinted.

    `.claude/hooks/worktree-guard.sh` was exactly that -- it lives outside the
    four `find` roots, and test-worktree-guard.sh pins its behaviour while
    nothing checked its syntax.
    """
    linted = set(_shellcheck_lint_set())
    unlinted = [f for f in _tracked("*.sh") if f not in linted]
    assert not unlinted, f"{len(unlinted)} tracked shell scripts are linted by nothing: {unlinted}"


def test_dotfile_directories_are_matched_explicitly_not_by_luck():
    """`**/*.sh` matching a dotted directory depends on the action's glob options.

    dorny/paths-filter runs picomatch, whose `dot` option decides whether `*`
    crosses a leading dot. It is set today at the pinned SHA, but an action bump
    can change it -- and Python's `full_match` IS dot-permissive, so this test
    would keep reporting `.claude/hooks/worktree-guard.sh` as covered while CI
    silently stopped firing on it. Listing the dotted roots explicitly makes the
    coverage independent of that option.
    """
    patterns = _filters()["shell"]
    dotted = {f.split("/")[0] for f in _tracked("*.sh") if f.startswith(".")}
    for root in sorted(dotted):
        assert any(p.startswith(f"{root}/") for p in patterns), (
            f"`shell` covers {root}/ only via a bare `**` -- list {root}/**/*.sh explicitly"
        )


def test_every_shellcheck_call_site_runs_the_same_command():
    """CI, lefthook and pre-push-verify must run ONE command, not three copies.

    They had drifted: ci.yml's `find` matched `-name 'pre-*'` and `-name 'post-*'`
    as well as `*.sh`, and the other two did not. A local pre-push that lints a
    different set than CI is a pre-push that cannot tell you CI will pass.
    """
    script = "scripts/ci/shellcheck-all.sh"
    assert _shellcheck_script().exists(), f"{script} does not exist"

    ci_run = next(
        st["run"] for st in _ci()["jobs"]["go-lint"]["steps"] if st.get("name", "").startswith("Shell script linting")
    )
    lefthook = (REPO_ROOT / ".lefthook.yml").read_text()
    prepush = (REPO_ROOT / "scripts/pre-push-verify.sh").read_text()

    for name, text in (("ci.yml", ci_run), (".lefthook.yml", lefthook), ("pre-push-verify.sh", prepush)):
        assert script in text, f"{name} does not delegate to {script}"
        assert "-maxdepth" not in text or name != "ci.yml", f"{name} still hand-rolls a find"

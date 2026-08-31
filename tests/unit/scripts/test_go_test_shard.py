"""Tests for the Go test sharder.

`go test -race ./...` is the longest job in CI (~390s of a ~400s critical path),
and most of that is the race detector's ~4.5x multiplier over 2729 serial tests.
Sharding the run across a matrix splits the wall clock, but it introduces the one
failure mode this repo has been bitten by before (the paths-filter incident of
March 2026): a partition that silently stops covering some tests still reports
green. Everything here exists to make that impossible --

- `partition` must be exhaustive and disjoint over the live inventory, so no
  (package, test) pair can fall through the buckets or be double-counted;
- `verify_reported` must fail loudly when a test the shard *selected* produced no
  result line, which is what a bad `-run` regex actually looks like from outside.

The `-list`-driven inventory is exercised offline through the `--from-json` CLI
contract; the partition and parsing logic is unit-tested directly.
"""

import importlib.util
import json
import re
import subprocess
import sys
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest
import yaml

REPO_ROOT = Path(__file__).parents[3]
SCRIPT_PATH = REPO_ROOT / "scripts" / "ci" / "go_test_shard.py"


def _load_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("go_test_shard", SCRIPT_PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    # Registered before exec: @dataclass resolves its own module through
    # sys.modules, and blows up on a module that was never put there.
    sys.modules["go_test_shard"] = module
    spec.loader.exec_module(module)
    return module


mod = _load_module()

PKG = "github.com/camp/kindred/pocketbase/sync"
OTHER = "github.com/camp/kindred/pocketbase/lodging"


def inventory(names: list[str], pkg: str = PKG) -> list[tuple[str, str]]:
    return [(pkg, n) for n in names]


def run_cli(rows: list[dict[str, str]], extra: list[str]) -> tuple[int, str, str]:
    result = subprocess.run(
        [sys.executable, str(SCRIPT_PATH), "--from-json", "-", "--plan", *extra],
        input=json.dumps(rows),
        capture_output=True,
        text=True,
    )
    return result.returncode, result.stdout, result.stderr


# --- partition: the exhaustiveness contract -------------------------------


def test_partition_is_exhaustive():
    inv = inventory([f"Test{i:03d}" for i in range(50)])
    buckets = mod.partition(inv, 4)
    covered = [item for bucket in buckets for item in bucket]
    assert sorted(covered) == sorted(inv)


def test_partition_is_disjoint():
    inv = inventory([f"Test{i:03d}" for i in range(50)])
    buckets = mod.partition(inv, 4)
    covered = [item for bucket in buckets for item in bucket]
    assert len(covered) == len(set(covered)) == len(inv)


def test_partition_returns_exactly_total_buckets():
    inv = inventory([f"Test{i:03d}" for i in range(50)])
    assert len(mod.partition(inv, 4)) == 4


def test_partition_is_deterministic_across_calls():
    inv = inventory([f"Test{i:03d}" for i in range(50)])
    assert mod.partition(inv, 4) == mod.partition(inv, 4)


def test_partition_is_insensitive_to_input_order():
    """A shard must not change contents because `go list` reordered packages."""
    names = [f"Test{i:03d}" for i in range(50)]
    forward = mod.partition(inventory(names), 4)
    backward = mod.partition(inventory(list(reversed(names))), 4)
    assert forward == backward


def test_partition_with_total_one_keeps_everything():
    inv = inventory([f"Test{i:03d}" for i in range(50)])
    assert mod.partition(inv, 1) == [sorted(inv)]


def test_partition_balances_bucket_sizes_within_one():
    inv = inventory([f"Test{i:03d}" for i in range(50)])
    sizes = [len(b) for b in mod.partition(inv, 4)]
    assert max(sizes) - min(sizes) <= 1


def test_partition_handles_more_shards_than_tests():
    inv = inventory(["TestOnly"])
    buckets = mod.partition(inv, 4)
    assert sum(len(b) for b in buckets) == 1
    assert sum(1 for b in buckets if b) == 1


def test_partition_deals_a_slow_cluster_across_shards():
    """The ~3.1s tests cluster by name prefix; round-robin must deal them out.

    Every `TestLodgingAssignmentsSync*` test pays the same ~3s schema-build cost
    under -race. Bucketing them by hash-of-prefix or contiguous chunk would pile
    the whole cluster into one shard and leave the critical path where it was.
    """
    cluster = [f"TestLodgingAssignmentsSync{i:02d}" for i in range(20)]
    buckets = mod.partition(inventory(cluster), 4)
    per_shard = [sum(1 for _, n in b if n.startswith("TestLodgingAssignmentsSync")) for b in buckets]
    assert max(per_shard) - min(per_shard) <= 1


def test_partition_keeps_same_named_tests_in_different_packages_distinct():
    inv = [(PKG, "TestSync"), (OTHER, "TestSync")]
    buckets = mod.partition(inv, 2)
    covered = [item for bucket in buckets for item in bucket]
    assert sorted(covered) == sorted(inv)


def test_partition_rejects_a_nonpositive_total():
    with pytest.raises(ValueError, match="total"):
        mod.partition(inventory(["TestA"]), 0)


# --- the -run regex -------------------------------------------------------


def test_run_regex_is_anchored_and_alternated():
    assert mod.build_run_regex(["TestA", "TestB"]) == "^(TestA|TestB)$"


def test_run_regex_escapes_metacharacters():
    """A name is a Go identifier today, but the regex must not assume it."""
    assert mod.build_run_regex(["Test.A"]) == r"^(Test\.A)$"


def test_run_regex_anchoring_still_admits_subtests():
    """`-run` splits on `/`, so an anchored top-level pattern keeps subtests."""
    pattern = mod.build_run_regex(["TestParent"])
    assert re.match(pattern, "TestParent")
    assert not re.match(pattern, "TestParentExtra")


# --- reading back what actually ran ---------------------------------------


# --- inventory parsing ----------------------------------------------------


def test_parse_list_output_keeps_test_functions():
    raw = "TestAlpha\nTestBeta\nok  \tgithub.com/camp/kindred/pocketbase/sync\t0.004s\n"
    assert mod.parse_list_output(raw) == ["TestAlpha", "TestBeta"]


def test_parse_list_output_drops_benchmarks_but_keeps_fuzz_and_examples():
    """Benchmarks do not run under plain `go test`; fuzz seeds and examples do."""
    raw = "TestAlpha\nBenchmarkThing\nFuzzParser\nExampleUsage\nok  \tpkg\t0.004s\n"
    assert mod.parse_list_output(raw) == ["TestAlpha", "FuzzParser", "ExampleUsage"]


def test_parse_list_output_ignores_no_test_files_notice():
    raw = "?   \tgithub.com/camp/kindred/pocketbase/cmd\t[no test files]\n"
    assert mod.parse_list_output(raw) == []


# --- CLI contract ---------------------------------------------------------


def test_cli_plan_lists_only_this_shards_tests():
    rows = [{"package": PKG, "test": f"Test{i:03d}"} for i in range(8)]
    code, out, err = run_cli(rows, ["--shard", "0", "--total", "4"])
    assert code == 0, err
    assert sorted(out.split()) == ["Test000", "Test004"]


def test_cli_plan_shards_cover_the_whole_inventory():
    rows = [{"package": PKG, "test": f"Test{i:03d}"} for i in range(30)]
    seen: list[str] = []
    for shard in range(4):
        code, out, err = run_cli(rows, ["--shard", str(shard), "--total", "4"])
        assert code == 0, err
        seen.extend(out.split())
    assert sorted(seen) == sorted(r["test"] for r in rows)


def test_cli_rejects_a_shard_index_out_of_range():
    rows = [{"package": PKG, "test": "TestA"}]
    code, _, err = run_cli(rows, ["--shard", "4", "--total", "4"])
    assert code != 0
    assert "shard" in err.lower()


def test_cli_rejects_an_empty_inventory():
    """An inventory that came back empty means `-list` broke, not that there is
    nothing to test -- running zero tests four times must not report green."""
    code, _, err = run_cli([], ["--shard", "0", "--total", "4"])
    assert code != 0
    assert "empty" in err.lower() or "no tests" in err.lower()


# --- command construction -------------------------------------------------


def test_build_commands_emits_one_invocation_per_package():
    selected = [(PKG, "TestA"), (OTHER, "TestB"), (PKG, "TestC")]
    commands = mod.build_commands(selected, ["-race", "-v"])
    # Set, not sequence -- ordering is a separate contract, pinned below.
    assert sorted(c.package for c in commands) == sorted({PKG, OTHER})
    assert len(commands) == 2


def test_build_commands_scopes_each_regex_to_its_own_package():
    """A shared regex across packages would re-run a name that exists in both.

    No two packages collide on a test name today, but a future collision must
    not silently double-run a test in one shard and skip it in another.
    """
    selected = [(PKG, "TestShared"), (OTHER, "TestOther")]
    by_package = {c.package: c for c in mod.build_commands(selected, [])}
    assert by_package[PKG].argv[-2] == "^(TestShared)$"
    assert by_package[OTHER].argv[-2] == "^(TestOther)$"


def test_build_commands_puts_the_package_last_and_forwards_go_args():
    commands = mod.build_commands([(PKG, "TestA")], ["-race", "-v"])
    assert commands[0].argv[:4] == ["go", "test", "-race", "-v"]
    assert commands[0].argv[-1] == PKG


def test_build_commands_sorts_names_for_a_stable_regex():
    commands = mod.build_commands([(PKG, "TestB"), (PKG, "TestA")], [])
    assert commands[0].argv[-2] == "^(TestA|TestB)$"


def test_build_commands_orders_by_descending_test_count():
    """Longest package first, so a thread pool is not left holding `sync` last."""
    selected = [(OTHER, "TestX")] + [(PKG, f"Test{i}") for i in range(5)]
    assert mod.build_commands(selected, [])[0].package == PKG


def test_cli_rejects_a_nonpositive_jobs_value():
    rows = [{"package": PKG, "test": "TestA"}]
    code, _, err = run_cli(rows, ["--shard", "0", "--total", "1", "--jobs", "0"])
    assert code != 0
    assert "jobs" in err.lower()


# --- the workflow wiring --------------------------------------------------
#
# The sharder only runs when the `go` paths-filter fires. Left out of that
# filter, a change to the sharder itself ships without ever running a Go test --
# which is the exact false-green class the rest of this file exists to prevent,
# and it happened on this PR's own first CI run.


def _ci_workflow() -> dict[str, Any]:
    workflow = yaml.safe_load((REPO_ROOT / ".github/workflows/ci.yml").read_text())
    assert isinstance(workflow, dict)
    return workflow


def _go_filter() -> list[str]:
    filters = _ci_workflow()["jobs"]["detect-changes"]["steps"][1]["with"]["filters"]
    patterns = yaml.safe_load(filters)["go"]
    assert isinstance(patterns, list)
    return patterns


def test_go_filter_covers_the_sharder():
    assert "scripts/ci/go_test_shard.py" in _go_filter()


def test_tests_go_job_shards_and_derives_total_from_the_matrix():
    """A hardcoded --total that drifts from the matrix is a silent coverage hole."""
    job = _ci_workflow()["jobs"]["tests-go"]
    shards = job["strategy"]["matrix"]["shard"]
    assert shards == list(range(len(shards))), "shard indices must be 0-based and contiguous"

    run = job["steps"][-1]["run"]
    assert "strategy.job-total" in run, "--total must come from the matrix, not a literal"
    assert "-race" in run


# --- the inventory must not build a second variant -------------------------


def test_inventory_command_forwards_the_go_args():
    """`-list` builds test binaries, so it must build the ones the run will use.

    Without the flags forwarded, `-list` compiles a whole non-race copy of every
    test binary and the runs then compile the race copies from scratch -- two
    full builds per shard, and the first one is thrown away. Measured on the
    runner: ~22s of the shard's 262s.
    """
    argv = mod.inventory_argv(["-race", "-v"])
    assert argv[:2] == ["go", "test"]
    assert "-race" in argv
    assert argv[-1] == "./..."


def test_inventory_command_keeps_list_and_json():
    argv = mod.inventory_argv(["-race"])
    assert "-list" in argv
    assert "-json" in argv


# --- reading back what actually ran, from -json events ---------------------
#
# This used to parse `--- PASS:` lines out of the human transcript, which Go only
# emits under `-v`. That made the coverage guard silently dependent on a flag
# nobody was enforcing: drop `-v` and every *passing* package reported as a
# coverage hole -- a 100% false failure wearing the costume of the exact bug this
# script exists to catch. `go test -json` emits a structured pass/fail/skip event
# per test regardless of `-v`, and on a cache hit too, so the dependency is gone
# and the cached-result special case with it.


def ev(action: str, test: str | None = None, output: str | None = None) -> dict[str, str]:
    e: dict[str, str] = {"Action": action, "Package": PKG}
    if test is not None:
        e["Test"] = test
    if output is not None:
        e["Output"] = output
    return e


def stream(*evs: dict[str, str]) -> str:
    return "\n".join(json.dumps(e) for e in evs)


def test_parse_reported_tests_reads_pass_fail_skip_events():
    out = stream(ev("pass", "TestAlpha"), ev("fail", "TestBeta"), ev("skip", "TestGamma"))
    assert mod.parse_reported_tests(out) == {"TestAlpha", "TestBeta", "TestGamma"}


def test_parse_reported_tests_works_without_v():
    """The whole point: no `-v`, still a result per test."""
    out = stream(ev("run", "TestAlpha"), ev("pass", "TestAlpha"))
    assert mod.parse_reported_tests(out) == {"TestAlpha"}


def test_parse_reported_tests_ignores_subtest_events():
    out = stream(ev("pass", "TestAlpha"), ev("pass", "TestAlpha/sub_case"))
    assert mod.parse_reported_tests(out) == {"TestAlpha"}


def test_parse_reported_tests_ignores_package_level_events():
    """A package-level pass carries no Test field and is not a test result."""
    out = stream(ev("pass"), ev("pass", "TestAlpha"))
    assert mod.parse_reported_tests(out) == {"TestAlpha"}


def test_parse_reported_tests_ignores_non_result_actions():
    out = stream(ev("run", "TestAlpha"), ev("output", "TestAlpha", "=== RUN\n"))
    assert mod.parse_reported_tests(out) == set()


def test_parse_reported_tests_counts_a_cache_hit_normally():
    """A cache hit replays the same events, so it needs no special case."""
    out = stream(ev("output", output="ok  \tpkg\t(cached)\n"), ev("pass", "TestAlpha"))
    assert mod.parse_reported_tests(out) == {"TestAlpha"}


def test_parse_reported_tests_tolerates_non_json_lines():
    """Build errors and toolchain notices are interleaved as bare text."""
    out = "go: downloading something\n" + stream(ev("pass", "TestAlpha")) + "\nnot json\n"
    assert mod.parse_reported_tests(out) == {"TestAlpha"}


def test_parse_reported_tests_on_empty_output():
    assert mod.parse_reported_tests("") == set()


def test_render_output_reconstructs_the_transcript_in_order():
    """The JSON stream is unreadable in a CI log; the Output fields are the log."""
    out = stream(
        ev("output", "TestAlpha", "=== RUN   TestAlpha\n"),
        ev("output", "TestAlpha", "--- PASS: TestAlpha (0.10s)\n"),
        ev("output", output="ok  \tpkg\t0.4s\n"),
    )
    assert mod.render_output(out) == "=== RUN   TestAlpha\n--- PASS: TestAlpha (0.10s)\nok  \tpkg\t0.4s\n"


def test_render_output_passes_through_non_json_lines():
    out = "# github.com/camp/kindred/pocketbase/sync\nsync/x.go:1:1: syntax error\n"
    assert "syntax error" in mod.render_output(out)


# --- verify_reported, now flag-independent ---------------------------------


def test_verify_reported_accepts_an_exact_match():
    mod.verify_reported(PKG, {"TestA", "TestB"}, {"TestA", "TestB"})


def test_verify_reported_rejects_a_missing_test():
    with pytest.raises(mod.ShardError, match="TestB"):
        mod.verify_reported(PKG, {"TestA", "TestB"}, {"TestA"})


def test_verify_reported_tolerates_extra_reported_tests():
    mod.verify_reported(PKG, {"TestA"}, {"TestA", "TestSomethingElse"})


# --- the run command -------------------------------------------------------


def test_build_commands_requests_json_output():
    """`-json` is what makes the coverage check independent of `-v`."""
    assert "-json" in mod.build_commands([(PKG, "TestA")], ["-race"])[0].argv


def test_build_commands_does_not_duplicate_json_if_caller_passed_it():
    argv = mod.build_commands([(PKG, "TestA")], ["-race", "-json"])[0].argv
    assert argv.count("-json") == 1


# --- an empty shard is not a crash -----------------------------------------


def test_resolve_workers_never_returns_zero():
    """`--total` above the test count leaves trailing shards empty; a bucket of
    zero packages made ThreadPoolExecutor raise ValueError."""
    assert mod.resolve_workers(0, None) >= 1
    assert mod.resolve_workers(3, None) >= 1
    assert mod.resolve_workers(3, 2) == 2


def test_run_shard_on_an_empty_selection_succeeds_without_running_go(tmp_path: Path) -> None:
    assert mod.run_shard(tmp_path, [], ["-race"]) == 0


def test_go_filter_covers_the_workflow_that_configures_the_shards():
    """The shard count, the shard args and the go flags all live in ci.yml.

    Without this, a PR that only edits the matrix -- widening `shard:` to six, or
    changing `-race` -- touches no .go file and no sharder, so `tests-go` is
    *skipped*, and the summary gate treats skipped as OK. The new configuration
    ships having run zero Go tests. Same class as the sharder entry above, and as
    the paths-filter incident of March 2026 the whole job comment is about.
    """
    assert ".github/workflows/ci.yml" in _go_filter()


def test_go_filter_covers_the_go_module_files():
    """A dependency bump touches only `pocketbase/go.mod` and `pocketbase/go.sum`.

    The filter used to list `go.mod` and `go.sum` at the repo *root*, where no Go
    module has ever existed -- the module is `pocketbase/go.mod`, and go.work is
    all that sits at the root. `pocketbase/**/*.go` does not help either: a
    dependency bump changes no .go file. So every Dependabot Go PR matched
    nothing here, `tests-go` was *skipped*, and the summary gate counts skipped
    as OK.

    That is not hypothetical. kindred#2629 (PocketBase 0.39.11 -> 0.40.1, which
    bumps the minimum Go to 1.27 and moves the whole codebase onto
    `encoding/json/v2`) reached review having run zero Go tests. Upstream's own
    release note for that version says not to push it blindly. Same false-green
    class as the two entries above, and as the paths-filter incident of March 2026.
    """
    patterns = _go_filter()
    assert "pocketbase/go.mod" in patterns
    assert "pocketbase/go.sum" in patterns


def test_go_filter_covers_the_workspace_file():
    """go.work pins its own `go` directive, and it gates every Go command.

    It must be >= the directive in pocketbase/go.mod or the toolchain refuses to
    load the workspace at all (`go.work lists go X, but module requires go Y`),
    which is how kindred#2629 went red. Editing it is a Go-toolchain change and
    has to be able to run the Go tests.
    """
    assert "go.work" in _go_filter()


def _all_filters() -> dict[str, list[str]]:
    filters = _ci_workflow()["jobs"]["detect-changes"]["steps"][1]["with"]["filters"]
    parsed = yaml.safe_load(filters)
    assert isinstance(parsed, dict)
    return parsed


def test_backend_filter_covers_the_workspace_file():
    """go-lint runs `go vet ./...`, which loads the workspace before anything else.

    A go.work-only change -- the fix for kindred#2629 is exactly that -- is a real
    input to that job, and nothing else in `backend` matches it.
    """
    assert "go.work" in _all_filters()["backend"]


def test_no_filter_watches_a_root_go_module_that_does_not_exist():
    """`go.mod`/`go.sum` at the root match nothing -- there is no root module.

    Leaving them in is what made the hole above look covered on a read-through:
    the filter appeared to watch the module files, so nobody checked which ones.
    `backend` carried the same two dead entries and was only ever right by
    accident, via its broader `pocketbase/**`.
    """
    assert not (REPO_ROOT / "go.mod").exists(), "a root module now exists; revisit the go filter"
    for name, patterns in _all_filters().items():
        assert "go.mod" not in patterns, f"{name} watches a nonexistent root go.mod"
        assert "go.sum" not in patterns, f"{name} watches a nonexistent root go.sum"

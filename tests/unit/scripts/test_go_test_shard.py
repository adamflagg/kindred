"""Tests for the Go test sharder.

`go test -race ./...` is the longest job in CI (~390s of a ~400s critical path),
and ~90% of that is the race detector's ~10x multiplier over 2717 serial tests.
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


def test_parse_reported_tests_reads_top_level_results():
    output = "\n".join(
        [
            "=== RUN   TestAlpha",
            "--- PASS: TestAlpha (0.10s)",
            "--- FAIL: TestBeta (1.00s)",
            "--- SKIP: TestGamma (0.00s)",
            "ok  \tgithub.com/camp/kindred/pocketbase/sync\t1.234s",
        ]
    )
    assert mod.parse_reported_tests(output) == {"TestAlpha", "TestBeta", "TestGamma"}


def test_parse_reported_tests_ignores_indented_subtests():
    output = "\n".join(
        [
            "--- PASS: TestAlpha (0.10s)",
            "    --- PASS: TestAlpha/sub_case (0.01s)",
            "        --- PASS: TestAlpha/sub_case/deeper (0.00s)",
        ]
    )
    assert mod.parse_reported_tests(output) == {"TestAlpha"}


def test_parse_reported_tests_on_empty_output():
    assert mod.parse_reported_tests("") == set()


def test_verify_reported_accepts_an_exact_match():
    mod.verify_reported(PKG, {"TestA", "TestB"}, {"TestA", "TestB"})


def test_verify_reported_rejects_a_missing_test():
    """A `-run` regex that quietly matches nothing is the false-green case."""
    with pytest.raises(mod.ShardError, match="TestB"):
        mod.verify_reported(PKG, {"TestA", "TestB"}, {"TestA"})


def test_verify_reported_tolerates_extra_reported_tests():
    """Go may report a parent the sharder did not select; that is not a shortfall."""
    mod.verify_reported(PKG, {"TestA"}, {"TestA", "TestSomethingElse"})


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


# --- Go's own test-result cache -------------------------------------------


def test_is_cached_result_detects_the_cached_marker():
    assert mod.is_cached_result("ok  \tgithub.com/camp/kindred/pocketbase/sync\t(cached)\n")


def test_is_cached_result_is_false_for_a_real_run():
    assert not mod.is_cached_result("ok  \tgithub.com/camp/kindred/pocketbase/sync\t1.234s\n")


def test_is_cached_result_ignores_the_word_elsewhere():
    assert not mod.is_cached_result("--- PASS: TestCachedTokenIsReused (0.01s)\n")


def test_verify_reported_skips_the_check_on_a_cached_result():
    """A cached `ok` prints no per-test lines, but it is not a coverage hole.

    Go keys its test cache on the test binary *and* the command line, `-run`
    regex included, so a cache hit is a genuine prior pass of exactly this
    selection. Treating the missing `--- PASS` lines as a shortfall would turn a
    warm GOCACHE into a red shard.
    """
    output = "ok  \tgithub.com/camp/kindred/pocketbase/sync\t(cached)\n"
    mod.verify_reported(PKG, {"TestA", "TestB"}, mod.parse_reported_tests(output), output=output)


def test_verify_reported_still_fails_a_shortfall_on_an_uncached_run():
    output = "--- PASS: TestA (0.10s)\nok  \tpkg\t0.400s\n"
    with pytest.raises(mod.ShardError, match="TestB"):
        mod.verify_reported(PKG, {"TestA", "TestB"}, mod.parse_reported_tests(output), output=output)


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

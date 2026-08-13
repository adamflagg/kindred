#!/usr/bin/env python3
"""Run one shard of the Go test suite.

`go test -race ./...` was the longest job in CI by a wide margin -- ~390s of a
~400s critical path, against ~156s for the next-slowest job. Almost none of that
is test volume. Measured on this tree, the same suite runs in 43s without
`-race` and ~300s with it: the race detector costs about 10x, and it pays that
tax serially, because the Go tree has exactly one `t.Parallel()` in it, so no two
tests in a package ever overlap. Two packages carry it all -- `sync` at 297s and
`lodging` at 143s, with the other nine adding up to ~15s.

This script splits that serial run across a CI matrix. It deliberately does NOT
shard by package: `sync` alone would still be a 297s shard. It shards at the
individual test-function level, so the two heavy packages get cut up too.

The whole design is shaped by one failure mode. A partition that quietly stops
covering some tests still reports green, which is the paths-filter incident of
March 2026 wearing a different hat. So:

  * `partition` deals tests out round-robin over a *sorted* inventory. Sorting
    makes the split independent of `go list` ordering; round-robin spreads the
    name-clustered slow tests (every `TestLodgingAssignmentsSync*` pays the same
    ~3s schema build) instead of piling a cluster into one shard.
  * The inventory is read live from `go test -list` on every run, so a newly
    added test is picked up by construction -- there is no checked-in list of
    test names to drift.
  * After running, each shard reads back which tests actually reported a result
    and fails if anything it selected did not run. A `-run` regex that matches
    nothing looks exactly like a passing shard from the outside; this is what
    catches it.

Usage:
    python3 scripts/ci/go_test_shard.py --shard 0 --total 4 -- -race -v
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_GO_DIR = REPO_ROOT / "pocketbase"

# `go test -list` emits benchmarks, fuzz targets and examples alongside tests.
# Benchmarks do not run under a plain `go test`, so selecting them would inflate
# the inventory and make the reported-back check fail. Fuzz targets (seed corpus)
# and examples with output comments *do* run and must stay in.
RUNNABLE_PREFIXES = ("Test", "Fuzz", "Example")

# Top-level results start at column 0; subtests are indented by Go.
RESULT_LINE = re.compile(r"^--- (?:PASS|FAIL|SKIP): (\S+)")

# A cache hit replaces the whole per-test transcript with a single summary line.
CACHED_LINE = re.compile(r"^ok\s+\S+\s+\(cached\)\s*$", re.MULTILINE)


class ShardError(Exception):
    """A shard did not cover what it claimed to cover."""


def parse_list_output(raw: str) -> list[str]:
    """Pull runnable test-function names out of `go test -list` output."""
    names = []
    for line in raw.splitlines():
        name = line.strip()
        if not name or " " in name or "\t" in name:
            continue
        if name.startswith(RUNNABLE_PREFIXES):
            names.append(name)
    return names


def collect_inventory(go_dir: Path) -> list[tuple[str, str]]:
    """Enumerate every (package, test) pair in the tree.

    Uses `-json` rather than plain `-list` because plain output only separates
    packages by a trailing `ok <pkg>` line, which interleaves unusably once Go
    lists packages in parallel. The JSON stream tags every line with its package.
    """
    proc = subprocess.run(
        ["go", "test", "-list", ".*", "-json", "./..."],
        cwd=go_dir,
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise ShardError(f"`go test -list` failed ({proc.returncode}):\n{proc.stderr}")

    inventory: list[tuple[str, str]] = []
    for line in proc.stdout.splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if event.get("Action") != "output":
            continue
        package = event.get("Package")
        if not package:
            continue
        for name in parse_list_output(event.get("Output", "")):
            inventory.append((package, name))
    return inventory


def partition(inventory: list[tuple[str, str]], total: int) -> list[list[tuple[str, str]]]:
    """Deal the inventory into `total` buckets, round-robin over sorted order."""
    if total < 1:
        raise ValueError(f"shard total must be >= 1, got {total}")
    ordered = sorted(inventory)
    buckets: list[list[tuple[str, str]]] = [[] for _ in range(total)]
    for index, item in enumerate(ordered):
        buckets[index % total].append(item)
    return buckets


def build_run_regex(names: list[str]) -> str:
    """Build a `-run` pattern anchored to whole top-level test names.

    Anchoring keeps `TestParent` from also selecting `TestParentExtra`, while
    `-run` semantics still admit subtests: Go splits both the pattern and the
    test name on `/` and matches element-wise, so a single-element pattern only
    ever constrains the top level.
    """
    return "^(" + "|".join(re.escape(n) for n in names) + ")$"


def parse_reported_tests(output: str) -> set[str]:
    """Collect the top-level test names that produced a result line."""
    return {m.group(1) for line in output.splitlines() if (m := RESULT_LINE.match(line))}


def is_cached_result(output: str) -> bool:
    """True when Go served this package from its test-result cache."""
    return CACHED_LINE.search(output) is not None


def verify_reported(
    package: str,
    selected: set[str],
    reported: set[str],
    output: str = "",
) -> None:
    """Fail if a selected test produced no result.

    Extra reported names are fine -- Go can surface a parent this shard did not
    explicitly select. A *missing* one means the `-run` regex silently dropped
    coverage, which would otherwise pass as green.

    A cache hit is exempt, because it prints one `ok ... (cached)` line and no
    per-test transcript at all. That is not a coverage hole: Go keys the test
    cache on the test binary *and* the command line, `-run` regex included, so a
    hit is a real prior pass of exactly this selection. Without the exemption a
    warm GOCACHE would turn every unchanged package red.
    """
    if is_cached_result(output):
        return
    missing = sorted(selected - reported)
    if missing:
        raise ShardError(
            f"{package}: {len(missing)} selected test(s) never ran: {', '.join(missing[:10])}"
            + (" ..." if len(missing) > 10 else "")
        )


def group_by_package(items: list[tuple[str, str]]) -> dict[str, list[str]]:
    grouped: dict[str, list[str]] = {}
    for package, name in items:
        grouped.setdefault(package, []).append(name)
    return grouped


@dataclass(frozen=True)
class PackageRun:
    package: str
    names: tuple[str, ...]
    argv: list[str]


def build_commands(selected: list[tuple[str, str]], go_args: list[str]) -> list[PackageRun]:
    """One `go test` invocation per package, heaviest package first.

    Each package gets its own `-run` regex rather than one union regex over the
    whole shard. A union regex is applied to every package it is handed, so two
    packages sharing a test name would run it twice here and never there. The
    per-package scoping costs nothing and removes the coupling.

    Ordering matters for the thread pool below: `sync` and `lodging` carry ~97%
    of the runtime, so they must start first rather than be picked up last.
    """
    grouped = group_by_package(selected)
    ordered = sorted(grouped.items(), key=lambda kv: (-len(kv[1]), kv[0]))
    return [
        PackageRun(
            package=package,
            names=tuple(sorted(names)),
            argv=["go", "test", *go_args, "-run", build_run_regex(sorted(names)), package],
        )
        for package, names in ordered
    ]


def run_shard(
    go_dir: Path,
    selected: list[tuple[str, str]],
    go_args: list[str],
    jobs: int | None = None,
) -> int:
    """Run this shard's packages concurrently, verifying coverage as they land.

    Sharding by test name means one `go test` call per package, which throws away
    the cross-package parallelism a plain `go test ./...` gets for free -- and
    that is not a rounding error: running a shard's slice of `sync` (~74s) after
    its slice of `lodging` (~37s) rather than alongside it costs half the win.
    A pool restores it. Output is captured per package and flushed as one block,
    so concurrency does not interleave the logs.
    """
    commands = build_commands(selected, go_args)
    workers = jobs or min(len(commands), os.cpu_count() or 1)
    failed = False

    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {
            pool.submit(subprocess.run, run.argv, cwd=go_dir, capture_output=True, text=True): run for run in commands
        }
        for future in concurrent.futures.as_completed(futures):
            run = futures[future]
            proc = future.result()
            print(f"::group::{run.package} ({len(run.names)} tests)", flush=True)
            sys.stdout.write(proc.stdout)
            sys.stderr.write(proc.stderr)
            print("::endgroup::", flush=True)

            if proc.returncode != 0:
                failed = True
            try:
                verify_reported(
                    run.package,
                    set(run.names),
                    parse_reported_tests(proc.stdout),
                    output=proc.stdout,
                )
            except ShardError as exc:
                print(f"::error::{exc}", file=sys.stderr)
                failed = True
    return 1 if failed else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--shard", type=int, required=True, help="0-based shard index")
    parser.add_argument("--total", type=int, required=True, help="number of shards")
    parser.add_argument("--plan", action="store_true", help="print this shard's tests and exit")
    parser.add_argument(
        "--from-json",
        metavar="PATH",
        help="read the inventory from a JSON file ('-' for stdin) instead of invoking go",
    )
    parser.add_argument("--dir", type=Path, default=DEFAULT_GO_DIR, help="Go module directory")
    parser.add_argument(
        "--jobs",
        type=int,
        default=None,
        help="concurrent `go test` invocations (default: CPU count)",
    )
    parser.add_argument("go_args", nargs="*", help="extra flags forwarded to `go test`")
    args = parser.parse_args(argv)

    if args.total < 1:
        print(f"error: --total must be >= 1, got {args.total}", file=sys.stderr)
        return 2
    if args.jobs is not None and args.jobs < 1:
        print(f"error: --jobs must be >= 1, got {args.jobs}", file=sys.stderr)
        return 2
    if not 0 <= args.shard < args.total:
        print(
            f"error: --shard must be in [0, {args.total}), got {args.shard}",
            file=sys.stderr,
        )
        return 2

    try:
        if args.from_json:
            raw = sys.stdin.read() if args.from_json == "-" else Path(args.from_json).read_text()
            inventory = [(row["package"], row["test"]) for row in json.loads(raw)]
        else:
            inventory = collect_inventory(args.dir)
    except ShardError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    if not inventory:
        # Zero tests four times over is a green CI that checked nothing.
        print("error: test inventory is empty -- `go test -list` found no tests", file=sys.stderr)
        return 2

    selected = partition(inventory, args.total)[args.shard]
    print(
        f"shard {args.shard}/{args.total}: {len(selected)} of {len(inventory)} tests"
        f" across {len(group_by_package(selected))} package(s)",
        file=sys.stderr,
    )

    if args.plan:
        for _, name in selected:
            print(name)
        return 0

    return run_shard(args.dir, selected, args.go_args, jobs=args.jobs)


if __name__ == "__main__":
    sys.exit(main())

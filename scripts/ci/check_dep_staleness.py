#!/usr/bin/env python3
"""Proactive dependency floor-staleness checker (warn-only CI guard).

Compares every declared dependency floor against the latest version published on
its registry and flags floors that have fallen behind -- one or more MAJOR versions
for a 1.x+ package, or a large MINOR gap for a 0.x package (which has no "major" to
speak of). The canonical case is the "croniter pattern": shipped as ``croniter>=2.0.0``
while the ecosystem had moved to 6.x. Dependabot only surfaces these as throttled
individual major-bump PRs, so
a stale floor picked at implementation time can sit unnoticed for weeks. This
check makes the gap visible on every manifest-touching PR and on a weekly cron.

Scope: PyPI (``pyproject.toml`` ``>=`` floors) and npm (``package.json`` ``^``/``~``
ranges, plus the ``overrides`` block, whose floors are load-bearing security pins and
were unscanned until kindred#2731). Where a sibling ``package-lock.json`` exists the
RESOLVED version is reported alongside the floor: `npm ci` installs the lock, not the
range, so a satisfied floor over a frozen lock is invisible from the manifest alone. Go modules use semantic-import-versioning -- a new major is a new import
path you adopt deliberately -- so there is no "stale floor" to detect there.

Warn-only: the checker always exits 0. It reports via stdout, ``::warning::``
annotations, and ``$GITHUB_STEP_SUMMARY``. It never blocks a merge.

Usage:
    python scripts/ci/check_dep_staleness.py                 # scan repo manifests (network)
    python scripts/ci/check_dep_staleness.py --from-json -   # classify rows from stdin (offline)
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import re
import sys
import tomllib
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
HTTP_TIMEOUT = 20

SEVERITY_HIGH = "high"
SEVERITY_MEDIUM = "medium"
SEVERITY_OK = "ok"
SEVERITY_UNKNOWN = "unknown"
SEVERITY_AHEAD = "ahead"

# 0.x packages have no "major" in the usual sense and churn fast; only flag a
# genuinely large minor gap to avoid drowning the signal in 0.x noise.
ZEROX_MINOR_MEDIUM = 5
ZEROX_MINOR_HIGH = 10

# npm manifests scanned in repo mode (deduped per (name, floor), so divergent
# floors for the same package across manifests are each reported).
NPM_MANIFESTS = ("frontend/package.json", "package.json", "pocketbase/package.json")


# --------------------------------------------------------------------------- #
# Version math (pure)
# --------------------------------------------------------------------------- #


def parse_version(value: str) -> tuple[int, int, int] | None:
    """Return ``(major, minor, patch)`` from a version string, or ``None``.

    Tolerates a leading ``v`` and trailing segments (e.g. PyPI type-stub date
    suffixes like ``7.2.2.20260408`` -> ``(7, 2, 2)``).
    """
    match = re.match(r"^\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?", value.strip())
    if not match:
        return None
    return (int(match.group(1)), int(match.group(2) or 0), int(match.group(3) or 0))


def classify_gap(floor: str, latest: str | None) -> tuple[str, str]:
    """Classify how far a declared ``floor`` is behind ``latest``.

    Returns ``(severity, human_label)``.
    """
    if latest is None or latest.startswith("ERR"):
        return (SEVERITY_UNKNOWN, "registry lookup failed")

    floor_v = parse_version(floor)
    latest_v = parse_version(latest)
    if floor_v is None or latest_v is None:
        return (SEVERITY_UNKNOWN, "unparseable version")

    # 0.x on both sides: compare the minor segment.
    if floor_v[0] == 0 and latest_v[0] == 0:
        gap = latest_v[1] - floor_v[1]
        if gap < 0:
            return (SEVERITY_AHEAD, "floor ahead of latest")
        if gap >= ZEROX_MINOR_HIGH:
            return (SEVERITY_HIGH, f"{gap} 0.x-minors behind")
        if gap >= ZEROX_MINOR_MEDIUM:
            return (SEVERITY_MEDIUM, f"{gap} 0.x-minors behind")
        return (SEVERITY_OK, f"{gap} 0.x-minors behind")

    major_gap = latest_v[0] - floor_v[0]
    if major_gap < 0:
        return (SEVERITY_AHEAD, "floor ahead of latest")
    if major_gap == 0:
        return (SEVERITY_OK, "current major")
    if major_gap == 1:
        return (SEVERITY_MEDIUM, "1 major behind")
    return (SEVERITY_HIGH, f"{major_gap} majors behind")


# --------------------------------------------------------------------------- #
# Manifest parsing (pure)
# --------------------------------------------------------------------------- #

_PYPI_SPEC = re.compile(r"^([A-Za-z0-9._-]+)(?:\[[^\]]*\])?\s*>=\s*([0-9][\w.]*)")
_NPM_SPEC = re.compile(r"^[\^~]?v?([0-9][\w.]*)$")

# An `overrides` floor is written as a RANGE, not a pinned spec, so it needs a
# looser pattern than _NPM_SPEC: `^8.5.28`, `~3.1.0`, `>=5.0.9`, `>4` and a bare
# `1.2.3` all declare a floor.
_NPM_FLOOR_ANY = re.compile(r"^\s*(?:[\^~]|>=?|=)?\s*v?([0-9][\w.]*)")
# `>=X` / `>X` with no `<` anywhere: satisfied by every future release forever.
_NPM_UNBOUNDED = re.compile(r"^\s*>=?[^<]*$")


def parse_pypi_floors(pyproject: dict[str, Any]) -> list[tuple[str, str]]:
    """Extract ``(name, floor)`` from a parsed ``pyproject.toml`` (main + groups)."""
    specs: list[str] = list(pyproject.get("project", {}).get("dependencies", []))
    for group in pyproject.get("dependency-groups", {}).values():
        specs += [s for s in group if isinstance(s, str)]

    out: list[tuple[str, str]] = []
    for spec in specs:
        match = _PYPI_SPEC.match(spec)
        if match:
            out.append((match.group(1), match.group(2)))
    return out


def parse_npm_floors(package_json: dict[str, Any]) -> list[tuple[str, str]]:
    """Extract ``(name, floor)`` from a parsed ``package.json`` (deps + devDeps)."""
    out: list[tuple[str, str]] = []
    for section in ("dependencies", "devDependencies"):
        for name, spec in package_json.get(section, {}).items():
            match = _NPM_SPEC.match(str(spec))
            if match:
                out.append((name, match.group(1)))
    return out


def parse_npm_override_floors(package_json: dict[str, Any]) -> list[tuple[str, str, bool]]:
    """Extract ``(name, floor, unbounded)`` from a package.json ``overrides`` block.

    Overrides were unscanned until kindred#2731, which is how four of them rotted
    unnoticed (kindred#2716). They deserve MORE scrutiny than a normal dep, not
    less: an override exists to force a security floor onto a transitive package,
    so it is load-bearing by construction and nothing else watches it.

    A nested value (``{"pkg": {"dep": "range"}}``) scopes an override to one
    parent rather than declaring a floor, and is skipped.
    """
    out: list[tuple[str, str, bool]] = []
    for name, spec in (package_json.get("overrides") or {}).items():
        if not isinstance(spec, str):
            continue
        match = _NPM_FLOOR_ANY.match(spec)
        if match:
            out.append((name, match.group(1), bool(_NPM_UNBOUNDED.match(spec))))
    return out


def classify_floor_shape(unbounded: bool) -> tuple[str, str]:
    """Classify a floor by SHAPE rather than by version distance.

    An unbounded floor is a defect at any version distance, which is exactly why
    every gap rule in this module misses it. Dependabot evaluates the MANIFEST:
    against `>=8.5.26` the latest postcss already satisfies the range, so there
    is no edit to propose and it closes the bump as redundant -- while `npm ci`
    keeps installing the LOCK, frozen wherever it was. Nothing goes red anywhere.
    Bounding the range (a caret is enough) restores a proposable edit.
    """
    if unbounded:
        return (SEVERITY_MEDIUM, "unbounded floor -- invisible to Dependabot")
    return (SEVERITY_OK, "bounded")


def parse_npm_resolved(package_lock: dict[str, Any]) -> dict[str, str]:
    """Map top-level package name -> version actually RESOLVED in the lockfile.

    The floor says what is permitted; this says what is installed. `npm ci` reads
    the lock, so this is the number that ships.
    """
    out: dict[str, str] = {}
    for path, meta in (package_lock.get("packages") or {}).items():
        if not path.startswith("node_modules/"):
            continue
        name = path[len("node_modules/") :]
        if "/node_modules/" in name:
            continue
        version = (meta or {}).get("version")
        if isinstance(version, str):
            out[name] = version
    return out


# --------------------------------------------------------------------------- #
# Registry lookups (network)
# --------------------------------------------------------------------------- #


def _fetch_json(url: str) -> Any:
    request = urllib.request.Request(url, headers={"User-Agent": "kindred-dep-staleness/1.0"})
    with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT) as response:
        return json.load(response)


def fetch_latest(eco: str, name: str) -> str | None:
    """Return the latest published version for ``name`` on ``eco`` (or ``ERR:...``)."""
    try:
        if eco == "pypi":
            data = _fetch_json(f"https://pypi.org/pypi/{urllib.parse.quote(name)}/json")
            return str(data["info"]["version"])
        quoted = urllib.parse.quote(name, safe="@/")
        return str(_fetch_json(f"https://registry.npmjs.org/{quoted}/latest")["version"])
    except Exception as exc:
        return f"ERR:{type(exc).__name__}"


# --------------------------------------------------------------------------- #
# Evaluation + reporting (pure)
# --------------------------------------------------------------------------- #

_SORT_ORDER = {
    SEVERITY_HIGH: 0,
    SEVERITY_MEDIUM: 1,
    SEVERITY_AHEAD: 2,
    SEVERITY_UNKNOWN: 3,
    SEVERITY_OK: 4,
}


def evaluate(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Annotate ``{eco,name,floor[,resolved,unbounded],latest}`` rows.

    Two independent defects are graded and the worse one wins:

    * version distance -- how far the declared floor trails latest (the original
      croniter check);
    * floor SHAPE -- an unbounded `>=` range, which is a defect at any distance
      and which every version rule above therefore scores as OK.

    ``resolved`` is advisory: it never changes severity, it just prints what is
    actually installed next to what the floor permits, so a satisfied floor over
    a frozen lock is visible in the table rather than having to be inferred.
    """
    evaluated: list[dict[str, Any]] = []
    for row in rows:
        severity, label = classify_gap(row["floor"], row.get("latest"))
        shape_sev, shape_label = classify_floor_shape(bool(row.get("unbounded")))
        if _SORT_ORDER.get(shape_sev, 9) < _SORT_ORDER.get(severity, 9):
            severity, label = shape_sev, shape_label
        elif _is_flagged(shape_sev):
            label = f"{label}; {shape_label}"

        extra: dict[str, Any] = {}
        resolved = row.get("resolved")
        latest = row.get("latest")
        if isinstance(resolved, str):
            if isinstance(latest, str) and resolved != latest:
                extra["resolved_label"] = f"lock on {resolved}, latest {latest}"
            else:
                extra["resolved_label"] = f"lock on {resolved}"
        evaluated.append({**row, **extra, "severity": severity, "label": label})
    evaluated.sort(key=lambda r: (_SORT_ORDER.get(r["severity"], 9), r["eco"], r["name"].lower()))
    return evaluated


def _is_flagged(severity: str) -> bool:
    return severity in (SEVERITY_HIGH, SEVERITY_MEDIUM)


def render_summary(rows: list[dict[str, Any]]) -> str:
    """Render a Markdown report of flagged rows (for ``$GITHUB_STEP_SUMMARY``)."""
    flagged = [r for r in rows if _is_flagged(r["severity"])]
    unknown = [r for r in rows if r["severity"] == SEVERITY_UNKNOWN]
    lines = ["## Dependency floor staleness", ""]
    if not flagged:
        if unknown:
            # No flags, but lookups failed -- staleness is indeterminate, not clear.
            lines.append(
                f"⚠️ {len(unknown)} of {len(rows)} registry lookups failed — "
                "staleness could not be determined for those deps."
            )
        else:
            lines.append(f"✅ No stale floors — all {len(rows)} declared deps are within one major of latest.")
        return "\n".join(lines) + "\n"

    lines += [
        f"⚠️ {len(flagged)} of {len(rows)} declared floors are behind latest (see the Gap column).",
        "",
        "| Severity | Eco | Package | Floor | Lock | Latest | Gap |",
        "|----------|-----|---------|-------|------|--------|-----|",
    ]
    badge = {SEVERITY_HIGH: "🔴 high", SEVERITY_MEDIUM: "🟡 med"}
    for r in flagged:
        lines.append(
            f"| {badge.get(r['severity'], r['severity'])} | {r['eco']} | `{r['name']}` "
            f"| {r['floor']} | {r.get('resolved') or '—'} | {r['latest']} | {r['label']} |"
        )
    if unknown:
        lines += ["", f"_{len(unknown)} registry lookup(s) failed — those deps were not evaluated._"]
    lines += [
        "",
        "_Floors are `>=` (PyPI) / `^`/`~`/`>=` (npm, including `overrides`). A stale floor "
        "usually means the lock already resolved higher but the declared minimum was never "
        "revisited -- but the Lock column can also show the reverse, which is worse: an "
        "unbounded floor Dependabot reads as permanently satisfied while the lock stays frozen "
        "behind it (kindred#2716)._",
    ]
    return "\n".join(lines) + "\n"


def collect_repo_rows(root: Path) -> list[dict[str, Any]]:
    """Collect ``{eco,name,floor}`` rows from the repo's manifests (no network)."""
    rows: list[dict[str, Any]] = []

    pyproject_path = root / "pyproject.toml"
    if pyproject_path.exists():
        pyproject = tomllib.loads(pyproject_path.read_text())
        for name, floor in parse_pypi_floors(pyproject):
            rows.append({"eco": "pypi", "name": name, "floor": floor})

    # Dedup on (name, floor): identical pins across manifests collapse to one row,
    # but a divergent (possibly stale) floor in a later manifest is still reported.
    seen_npm: set[tuple[str, str]] = set()
    for manifest in NPM_MANIFESTS:
        path = root / manifest
        if not path.exists():
            continue
        package_json = json.loads(path.read_text())

        # What the sibling lockfile actually resolved. `npm ci` installs THIS,
        # not the manifest range, so it is the version that ships.
        lock_path = path.parent / "package-lock.json"
        resolved: dict[str, str] = {}
        if lock_path.exists():
            resolved = parse_npm_resolved(json.loads(lock_path.read_text()))

        declared: list[tuple[str, str, bool]] = [(n, f, False) for n, f in parse_npm_floors(package_json)]
        # Overrides last so a package declared in both keeps its dep-section row
        # and does not dedup the override away.
        declared += parse_npm_override_floors(package_json)

        for name, floor, unbounded in declared:
            if (name, floor) in seen_npm:
                continue
            seen_npm.add((name, floor))
            row: dict[str, Any] = {"eco": "npm", "name": name, "floor": floor}
            if unbounded:
                row["unbounded"] = True
            if name in resolved:
                row["resolved"] = resolved[name]
            rows.append(row)
    return rows


def _emit(rows: list[dict[str, Any]]) -> int:
    """Print the report + GitHub annotations, write the step summary. Always 0."""
    flagged = [r for r in rows if _is_flagged(r["severity"])]

    print(f"{'SEV':<8} {'ECO':<5} {'PACKAGE':<34} {'FLOOR':<14} {'LATEST':<14} GAP")
    print("-" * 92)
    for r in rows:
        if _is_flagged(r["severity"]) or r["severity"] in (SEVERITY_UNKNOWN, SEVERITY_AHEAD):
            print(
                f"{r['severity']:<8} {r['eco']:<5} {r['name']:<34} {r['floor']:<14} "
                f"{r.get('latest')!s:<14} {r['label']}"
            )

    for r in flagged:
        # GitHub annotation -> visible inline on the workflow run.
        lock = f", {r['resolved_label']}" if r.get("resolved_label") else ""
        print(
            f"::warning title=Stale dependency floor::{r['name']} ({r['eco']}) floor "
            f"{r['floor']} is {r['label']} (latest {r['latest']}{lock})"
        )

    summary = render_summary(rows)
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as handle:
            handle.write(summary)

    print(f"\n{len(flagged)} flagged of {len(rows)} declared deps.")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--from-json",
        metavar="PATH",
        help="Read pre-resolved [{eco,name,floor,latest}] rows from PATH ('-' for stdin) "
        "and classify them offline, instead of scanning manifests and hitting registries.",
    )
    args = parser.parse_args(argv)

    if args.from_json:
        raw = sys.stdin.read() if args.from_json == "-" else Path(args.from_json).read_text()
        rows = evaluate(json.loads(raw))
        return _emit(rows)

    declared = collect_repo_rows(REPO_ROOT)
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
        latest = list(pool.map(lambda r: fetch_latest(r["eco"], r["name"]), declared))
    for row, version in zip(declared, latest, strict=True):
        row["latest"] = version
    return _emit(evaluate(declared))


if __name__ == "__main__":
    raise SystemExit(main())

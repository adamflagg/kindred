#!/usr/bin/env python3
"""Verify every Renovate custom-manager regex still matches the pin it targets.

Renovate reports NO error when a customManager regex matches zero files -- it
silently manages nothing, and the run stays green. A moved line or a dropped
`# renovate:` marker comment would therefore disable an update path with no
signal at all. This script asserts each expected dependency is still captured,
so that failure is loud instead.

Deliberately asserts only that a dep is FOUND with a version-shaped value, never
that it equals a specific version -- otherwise every Renovate bump would fail CI.

Pure stdlib, mirroring scripts/ci/check_dep_staleness.py.
"""

import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
RENOVATE_CONFIG = REPO_ROOT / "renovate.json"

# Every dependency a customManager must still capture. Names match the
# `depName=` value in the marker comments (or depNameTemplate in the config).
EXPECTED_DEPS = {
    "golangci/golangci-lint",
    "rhysd/actionlint",
    "hadolint/hadolint",
    "aquasecurity/trivy",
    "go",
}

VERSION_SHAPE = re.compile(r"^v?\d+\.\d+")


def strip_regex_delimiters(pattern: str) -> str:
    """managerFilePatterns wrap regexes in `/.../`; anything else is a glob."""
    if len(pattern) >= 2 and pattern.startswith("/") and pattern.endswith("/"):
        return pattern[1:-1]
    raise SystemExit(
        f"managerFilePatterns entry {pattern!r} is not /-delimited, so Renovate "
        "reads it as a glob, not a regex. Wrap it in forward slashes."
    )


def repo_files() -> list[Path]:
    return [p for p in REPO_ROOT.rglob("*") if p.is_file() and ".git" not in p.parts and "node_modules" not in p.parts]


def main() -> int:
    if not RENOVATE_CONFIG.is_file():
        print(f"ERROR: {RENOVATE_CONFIG} not found", file=sys.stderr)
        return 1

    config = json.loads(RENOVATE_CONFIG.read_text())
    managers = config.get("customManagers", [])
    if not managers:
        print("ERROR: renovate.json defines no customManagers", file=sys.stderr)
        return 1

    all_files = repo_files()
    found: dict[str, str] = {}

    for manager in managers:
        file_res = [re.compile(strip_regex_delimiters(p)) for p in manager["managerFilePatterns"]]
        match_res = [re.compile(s) for s in manager["matchStrings"]]
        default_dep = manager.get("depNameTemplate")

        for path in all_files:
            rel = path.relative_to(REPO_ROOT).as_posix()
            if not any(fr.search(rel) for fr in file_res):
                continue
            try:
                text = path.read_text()
            except UnicodeDecodeError, OSError:
                continue
            for mr in match_res:
                for m in mr.finditer(text):
                    groups = m.groupdict()
                    dep = groups.get("depName") or default_dep
                    value = groups.get("currentValue")
                    if dep and value:
                        found[dep] = value

    missing = EXPECTED_DEPS - found.keys()
    malformed = {d: v for d, v in found.items() if d in EXPECTED_DEPS and not VERSION_SHAPE.match(v)}

    for dep in sorted(found):
        marker = "  " if dep in EXPECTED_DEPS else "? "
        print(f"{marker}{dep} = {found[dep]}")

    if missing:
        print(
            "\nERROR: no customManager captured these deps -- their regex "
            "matches nothing and Renovate will silently skip them:",
            file=sys.stderr,
        )
        for dep in sorted(missing):
            print(f"  - {dep}", file=sys.stderr)
        return 1

    if malformed:
        print("\nERROR: captured a non-version-shaped value:", file=sys.stderr)
        for dep, value in sorted(malformed.items()):
            print(f"  - {dep} = {value!r}", file=sys.stderr)
        return 1

    print(f"\nOK: all {len(EXPECTED_DEPS)} expected pins captured.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

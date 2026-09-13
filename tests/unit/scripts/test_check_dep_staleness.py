"""Tests for the dependency floor-staleness checker.

The checker compares each declared dependency floor (`pyproject.toml` `>=`,
`package.json` `^`/`~`) against the latest version published on its registry and
flags floors that are one or more MAJOR versions behind -- the croniter pattern
(`>=2.0.0` while the latest is 6.x). Network lookups are exercised offline via the
`--from-json` CLI contract; the classification math is unit-tested directly.
"""

import importlib.util
import json
import subprocess
import sys
from pathlib import Path
from types import ModuleType
from typing import Any

SCRIPT_PATH = Path(__file__).parents[3] / "scripts" / "ci" / "check_dep_staleness.py"


def _load_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("check_dep_staleness", SCRIPT_PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


mod = _load_module()


def run_cli(rows: list[dict[str, Any]], extra: list[str] | None = None) -> tuple[int, str, str]:
    result = subprocess.run(
        [sys.executable, str(SCRIPT_PATH), "--from-json", "-", *(extra or [])],
        input=json.dumps(rows),
        capture_output=True,
        text=True,
    )
    return result.returncode, result.stdout, result.stderr


# --------------------------- parse_version ---------------------------


def test_parse_version_three_segments():
    assert mod.parse_version("2.0.0") == (2, 0, 0)
    assert mod.parse_version("15.0.0") == (15, 0, 0)


def test_parse_version_partial_segments():
    assert mod.parse_version("9.15") == (9, 15, 0)
    assert mod.parse_version("15") == (15, 0, 0)


def test_parse_version_zerox():
    assert mod.parse_version("0.46.0") == (0, 46, 0)


def test_parse_version_date_suffixed_pypi_stub():
    # types-* packages carry a trailing date segment; only the first three count.
    assert mod.parse_version("7.2.2.20260408") == (7, 2, 2)


def test_parse_version_v_prefix():
    assert mod.parse_version("v1.2.3") == (1, 2, 3)


def test_parse_version_unparseable():
    assert mod.parse_version("not-a-version") is None
    assert mod.parse_version("*") is None


# --------------------------- classify_gap ---------------------------


def test_classify_major_behind_is_high():
    # The cases this guard exists to catch.
    assert mod.classify_gap("2.0.0", "6.2.2")[0] == mod.SEVERITY_HIGH  # croniter
    assert mod.classify_gap("5.9.0", "7.2.2")[0] == mod.SEVERITY_HIGH  # psutil
    assert mod.classify_gap("13.0.0", "15.0.0")[0] == mod.SEVERITY_HIGH  # rich


def test_classify_one_major_behind_is_medium():
    assert mod.classify_gap("6.0.0", "7.1.0")[0] == mod.SEVERITY_MEDIUM  # pytest-cov


def test_classify_current_major_is_ok():
    assert mod.classify_gap("19.2.4", "19.2.7")[0] == mod.SEVERITY_OK
    assert mod.classify_gap("3.9.0", "3.14.0")[0] == mod.SEVERITY_OK


def test_classify_zerox_small_minor_gap_is_ok():
    # 0.x packages move fast; a couple of minors behind is not "behind the curve".
    assert mod.classify_gap("0.46.0", "0.48.0")[0] == mod.SEVERITY_OK


def test_classify_zerox_large_minor_gap_is_flagged():
    sev, _ = mod.classify_gap("0.17.1", "0.30.0")
    assert sev in (mod.SEVERITY_MEDIUM, mod.SEVERITY_HIGH)


def test_classify_floor_ahead_of_latest():
    assert mod.classify_gap("3.0.0", "2.9.0")[0] == mod.SEVERITY_AHEAD


def test_classify_unknown_latest():
    assert mod.classify_gap("1.0.0", None)[0] == mod.SEVERITY_UNKNOWN
    assert mod.classify_gap("1.0.0", "ERR:boom")[0] == mod.SEVERITY_UNKNOWN


def test_classify_label_mentions_majors():
    _, label = mod.classify_gap("2.0.0", "6.2.2")
    assert "4" in label
    assert "major" in label.lower()


# --------------------------- manifest parsing ---------------------------


def test_parse_pypi_floors_extracts_name_and_floor():
    pyproject = {
        "project": {
            "dependencies": [
                "croniter>=2.0.0",
                "uvicorn[standard]>=0.46.0",
                "PyJWT[crypto]>=2.13.0",
            ]
        },
        "dependency-groups": {"dev": ["pytest>=9.0.3"]},
    }
    floors = dict(mod.parse_pypi_floors(pyproject))
    assert floors["croniter"] == "2.0.0"
    assert floors["uvicorn"] == "0.46.0"  # extras stripped
    assert floors["PyJWT"] == "2.13.0"
    assert floors["pytest"] == "9.0.3"  # dev group included


def test_parse_pypi_floors_skips_non_floor_specs():
    pyproject = {"project": {"dependencies": ["somepkg==1.2.3", "another"]}}
    assert mod.parse_pypi_floors(pyproject) == []


def test_parse_npm_floors_strips_range_prefix():
    package_json = {
        "dependencies": {"react": "^19.2.4", "leaflet": "~1.9.4"},
        "devDependencies": {"vite": "^8.0.14"},
    }
    floors = dict(mod.parse_npm_floors(package_json))
    assert floors["react"] == "19.2.4"
    assert floors["leaflet"] == "1.9.4"
    assert floors["vite"] == "8.0.14"


def test_parse_npm_floors_skips_non_semver_specs():
    package_json = {
        "dependencies": {
            "x": "*",
            "y": "workspace:*",
            "z": "github:user/repo",
        }
    }
    assert mod.parse_npm_floors(package_json) == []


# --------------------------- CLI contract (warn-only) ---------------------------


def test_cli_flags_stale_floor_in_output():
    rows = [
        {"eco": "pypi", "name": "croniter", "floor": "2.0.0", "latest": "6.2.2"},
        {"eco": "pypi", "name": "rich", "floor": "13.0.0", "latest": "15.0.0"},
    ]
    _, out, _ = run_cli(rows)
    assert "croniter" in out
    assert "rich" in out


def test_cli_is_warn_only_exit_zero_even_when_stale():
    rows = [{"eco": "pypi", "name": "croniter", "floor": "2.0.0", "latest": "6.2.2"}]
    code, _, _ = run_cli(rows)
    assert code == 0, "warn-mode checker must never fail CI"


def test_cli_clean_input_exit_zero():
    rows = [{"eco": "npm", "name": "react", "floor": "19.2.4", "latest": "19.2.7"}]
    code, out, _ = run_cli(rows)
    assert code == 0
    assert "react" not in out or "0 " in out  # not flagged


def test_cli_emits_github_warning_annotations():
    rows = [{"eco": "pypi", "name": "psutil", "floor": "5.9.0", "latest": "7.2.2"}]
    _, out, _ = run_cli(rows)
    assert "::warning" in out  # surfaced as a GitHub annotation


# --------------------------- render_summary ---------------------------


def test_render_summary_no_false_all_clear_when_all_lookups_failed():
    # If every registry lookup failed, staleness is indeterminate -- the summary
    # must NOT claim an all-clear (regression guard for the false-green bug).
    rows = mod.evaluate(
        [
            {"eco": "pypi", "name": "rich", "floor": "13.0.0", "latest": "ERR:URLError"},
            {"eco": "pypi", "name": "psutil", "floor": "5.9.0", "latest": None},
        ]
    )
    summary = mod.render_summary(rows)
    assert "No stale floors" not in summary
    assert "lookup" in summary.lower()  # surfaces that lookups failed


def test_render_summary_clean_run_still_reports_all_clear():
    rows = mod.evaluate([{"eco": "npm", "name": "react", "floor": "19.2.4", "latest": "19.2.7"}])
    summary = mod.render_summary(rows)
    assert "No stale floors" in summary


def test_render_summary_zerox_flagged_not_described_as_major():
    # A 0.x package flagged on a large MINOR gap must not be called a major-version gap.
    rows = mod.evaluate([{"eco": "npm", "name": "somepkg", "floor": "0.17.1", "latest": "0.30.0"}])
    summary = mod.render_summary(rows)
    assert "somepkg" in summary
    assert "major version" not in summary.lower()


# --------------------------- collect_repo_rows (npm dedup) ---------------------------


def _write_manifest(path: Path, deps: dict[str, str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"dependencies": deps}))


def test_collect_repo_rows_reports_divergent_npm_floors(tmp_path):
    # Same package, different floors across manifests: the later (possibly stale)
    # floor must NOT be hidden by a repo-wide name-only dedup.
    _write_manifest(tmp_path / "frontend" / "package.json", {"eslint": "^10.4.0"})
    _write_manifest(tmp_path / "pocketbase" / "package.json", {"eslint": "^9.0.0"})
    rows = mod.collect_repo_rows(tmp_path)
    eslint_floors = {r["floor"] for r in rows if r["name"] == "eslint"}
    assert eslint_floors == {"10.4.0", "9.0.0"}


def test_collect_repo_rows_dedupes_identical_npm_floors(tmp_path):
    # Identical (name, floor) across manifests is redundant -- report it once.
    _write_manifest(tmp_path / "frontend" / "package.json", {"eslint": "^10.4.0"})
    _write_manifest(tmp_path / "pocketbase" / "package.json", {"eslint": "^10.4.0"})
    rows = mod.collect_repo_rows(tmp_path)
    assert sum(1 for r in rows if r["name"] == "eslint") == 1


# --------------------------- overrides (kindred#2731) ---------------------------
#
# The four floors that rotted in #2716 were invisible here on TWO counts: this
# checker scanned only `dependencies`/`devDependencies`, never `overrides`; and
# `_NPM_SPEC` matches `^`/`~`/bare only, so a `>=8.5.26` would not have parsed
# even if it had been scanned. An override exists precisely to force a security
# floor, which makes it the LAST thing that should go unwatched.


def test_parse_npm_override_floors_reads_string_overrides():
    floors = {n: f for n, f, _ in mod.parse_npm_override_floors({"overrides": {"postcss": "^8.5.28"}})}
    assert floors == {"postcss": "8.5.28"}


def test_parse_npm_override_floors_reads_unbounded_floors():
    """`>=X` must PARSE here even though `_NPM_SPEC` rejects it for deps."""
    rows = mod.parse_npm_override_floors({"overrides": {"undici": ">=8.10.1"}})
    assert [(n, f) for n, f, _ in rows] == [("undici", "8.10.1")]


def test_unbounded_override_floor_is_flagged_as_unbounded():
    rows = mod.parse_npm_override_floors({"overrides": {"undici": ">=8.10.1"}})
    assert rows[0][2] is True, "`>=X` has no ceiling -- Dependabot sees it as permanently satisfied"


def test_caret_override_floor_is_not_unbounded():
    rows = mod.parse_npm_override_floors({"overrides": {"undici": "^8.10.2"}})
    assert rows[0][2] is False, "a caret bounds at the major, so Dependabot can still propose a bump"


def test_parse_npm_override_floors_skips_nested_scoped_overrides():
    """`{"pkg": {"dep": "range"}}` scopes an override to one parent -- not a floor."""
    rows = mod.parse_npm_override_floors({"overrides": {"eslint-plugin-jsx-a11y": {"eslint": "^10.0.0"}}})
    assert rows == []


def test_unbounded_floor_is_flagged_even_when_version_is_current():
    """The whole point: an unbounded floor is a defect at ANY version distance.

    postcss `>=8.5.26` with latest 8.5.28 is zero majors behind, so every
    version-gap rule in this module calls it OK -- and Dependabot still closed
    the bump as redundant while the lock sat on 8.5.26.
    """
    severity, label = mod.classify_floor_shape(unbounded=True)
    assert mod._is_flagged(severity)
    assert "unbounded" in label.lower()


def test_bounded_floor_shape_is_ok():
    severity, _ = mod.classify_floor_shape(unbounded=False)
    assert not mod._is_flagged(severity)


# --------------------------- resolved-vs-latest ---------------------------


def test_parse_npm_resolved_reads_lock_versions():
    lock = {"packages": {"": {}, "node_modules/postcss": {"version": "8.5.26"}}}
    assert mod.parse_npm_resolved(lock)["postcss"] == "8.5.26"


def test_evaluate_surfaces_resolved_behind_latest():
    """A row carrying `resolved` reports the gap the FLOOR alone cannot show."""
    rows = mod.evaluate(
        [{"eco": "npm", "name": "postcss", "floor": "8.5.26", "resolved": "8.5.26", "latest": "8.5.28"}]
    )
    assert rows[0]["resolved"] == "8.5.26"
    assert rows[0].get("resolved_label")


def test_cli_flags_unbounded_floor_in_output():
    code, out, _ = run_cli([{"eco": "npm", "name": "undici", "floor": "8.10.1", "unbounded": True, "latest": "8.10.2"}])
    assert code == 0, "checker stays warn-only"
    assert "undici" in out
    assert "unbounded" in out.lower()


def _write_npm_pair(root: Path, sub: str, floor: str, locked: str) -> None:
    (root / sub).mkdir()
    (root / sub / "package.json").write_text(json.dumps({"devDependencies": {"eslint": floor}}))
    (root / sub / "package-lock.json").write_text(
        json.dumps({"packages": {"": {}, "node_modules/eslint": {"version": locked}}})
    )


def test_dedup_keeps_divergent_lock_resolutions(tmp_path, monkeypatch):
    """Same name+floor in two manifests, different locks -> BOTH rows survive.

    frontend/ and pocketbase/ carry separate lockfiles and separate Dependabot
    groups (`eslint` vs `pb-eslint`), so an identical declared floor routinely
    resolves to different versions -- the moment one group's bump merges and the
    other's does not. Deduping on (name, floor) alone drops whichever row comes
    second, and nothing guarantees that is the fresher one: in this fixture it
    is the STALER lock that disappears, which is the one a staleness checker
    exists to show.
    """
    _write_npm_pair(tmp_path, "frontend", "^10.9.1", "10.10.0")
    _write_npm_pair(tmp_path, "pocketbase", "^10.9.1", "10.9.1")
    monkeypatch.setattr(mod, "NPM_MANIFESTS", ("frontend/package.json", "pocketbase/package.json"))

    rows = [r for r in mod.collect_repo_rows(tmp_path) if r["name"] == "eslint"]

    assert {r["resolved"] for r in rows} == {"10.9.1", "10.10.0"}, f"a lock was deduped away: {rows}"


def test_dedup_still_collapses_identical_floor_and_resolution(tmp_path, monkeypatch):
    """The dedup must still do its job when the resolutions agree."""
    _write_npm_pair(tmp_path, "frontend", "^10.9.1", "10.10.0")
    _write_npm_pair(tmp_path, "pocketbase", "^10.9.1", "10.10.0")
    monkeypatch.setattr(mod, "NPM_MANIFESTS", ("frontend/package.json", "pocketbase/package.json"))

    rows = [r for r in mod.collect_repo_rows(tmp_path) if r["name"] == "eslint"]

    assert len(rows) == 1, f"identical floor AND resolution should collapse to one row: {rows}"

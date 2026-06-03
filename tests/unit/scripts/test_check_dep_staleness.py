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

SCRIPT_PATH = Path(__file__).parents[3] / "scripts" / "ci" / "check_dep_staleness.py"


def _load_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("check_dep_staleness", SCRIPT_PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


mod = _load_module()


def run_cli(rows: list[dict[str, str]], extra: list[str] | None = None) -> tuple[int, str, str]:
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

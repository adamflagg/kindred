"""Tests for the Renovate custom-manager checker.

The checker exists because a Renovate `customManager` whose regex matches zero
files produces NO error -- the run stays green having managed nothing. So the
checker itself must fail loudly, and these tests pin the two ways it could stop
doing that: a regex-translation bug that makes every marker match, or a
file-pattern bug that makes every marker miss.

`tests/unit/scripts/test_ci_path_filters.py` owns the separate question of
whether CI can still *trigger* the checker. This file owns whether the checker
is right when it runs.

The mutation tests run against a synthetic tree via a patched `REPO_ROOT`
rather than the real repo, so they stay hermetic and fast.
"""

import importlib.util
import json
import re
import subprocess
import sys
from pathlib import Path
from types import ModuleType

import pytest

REPO_ROOT = Path(__file__).parents[3]
SCRIPT_PATH = REPO_ROOT / "scripts" / "ci" / "check_renovate_managers.py"
RENOVATE_CONFIG = REPO_ROOT / "renovate.json"


def _load_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("check_renovate_managers", SCRIPT_PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


mod = _load_module()


# --------------------------- strip_regex_delimiters ---------------------------


def test_strip_regex_delimiters_unwraps_a_delimited_pattern():
    assert mod.strip_regex_delimiters("/^docker/healthcheck/go\\.mod$/") == "^docker/healthcheck/go\\.mod$"


def test_strip_regex_delimiters_rejects_a_bare_glob():
    """A bare pattern is read by Renovate as a glob and matches nothing, silently.

    Failing loudly here is the whole point -- the alternative is a manager that
    is configured, reports no error, and manages nothing.
    """
    with pytest.raises(SystemExit) as exc:
        mod.strip_regex_delimiters(".github/workflows/**.yml")
    assert "glob" in str(exc.value)


# --------------------------- js_regex_to_python ---------------------------


def test_js_named_groups_are_translated():
    assert mod.js_regex_to_python("(?<depName>.+?)") == "(?P<depName>.+?)"


def test_js_lookbehind_is_left_alone():
    """`(?<=` and `(?<!` are lookbehind, not named groups, in both engines."""
    assert mod.js_regex_to_python("(?<=x)y") == "(?<=x)y"
    assert mod.js_regex_to_python("(?<!x)y") == "(?<!x)y"


def test_translated_matchstrings_compile_under_python_re():
    config = json.loads(RENOVATE_CONFIG.read_text())
    for manager in config["customManagers"]:
        for raw in manager["matchStrings"]:
            re.compile(mod.js_regex_to_python(raw))


# --------------------------- the shipped config ---------------------------


def test_the_real_repo_passes():
    """The checked-in markers and config agree, right now."""
    result = subprocess.run(
        [sys.executable, str(SCRIPT_PATH)],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    for dep in mod.EXPECTED_DEPS:
        assert dep in result.stdout


def test_every_expected_dep_has_a_rule_or_a_manager_that_names_it():
    """`EXPECTED_DEPS` must stay in step with what renovate.json actually manages.

    A dep listed here but named nowhere in the config is a checker asserting
    over something Renovate was never told about.
    """
    config = json.loads(RENOVATE_CONFIG.read_text())
    named = {n for rule in config["packageRules"] for n in rule.get("matchDepNames", [])}
    named |= {m["depNameTemplate"] for m in config["customManagers"] if "depNameTemplate" in m}
    assert named >= mod.EXPECTED_DEPS, f"not named in renovate.json: {mod.EXPECTED_DEPS - named}"


# --------------------------- mutation tests ---------------------------


def _fake_repo(tmp_path: Path, workflow_body: str) -> Path:
    """A minimal tree carrying the shipped renovate.json and one workflow."""
    (tmp_path / ".github" / "workflows").mkdir(parents=True)
    (tmp_path / "docker" / "healthcheck").mkdir(parents=True)
    (tmp_path / "renovate.json").write_text(RENOVATE_CONFIG.read_text())
    (tmp_path / ".github" / "workflows" / "ci.yml").write_text(workflow_body)
    (tmp_path / "docker" / "healthcheck" / "go.mod").write_text("module x\n\ngo 1.24\n")
    return tmp_path


def _run_against(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> int:
    monkeypatch.setattr(mod, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(mod, "RENOVATE_CONFIG", tmp_path / "renovate.json")
    return int(mod.main())


ALL_MARKERS = """\
jobs:
  a:
    steps:
    - uses: golangci/golangci-lint-action@v1
      with:
        # renovate: datasource=github-releases depName=golangci/golangci-lint
        version: v2.13.2
    - uses: aquasecurity/setup-trivy@v1
      with:
        # renovate: datasource=github-releases depName=aquasecurity/trivy
        version: v0.69.3
    - run: |
        # renovate: datasource=github-releases depName=rhysd/actionlint
        ACTIONLINT_VERSION="1.7.12"
    - run: |
        # renovate: datasource=docker depName=hadolint/hadolint
        HADOLINT_VERSION=v2.15.1
"""


def test_all_markers_present_passes(tmp_path, monkeypatch):
    assert _run_against(_fake_repo(tmp_path, ALL_MARKERS), monkeypatch) == 0


def test_a_dropped_marker_fails(tmp_path, monkeypatch):
    body = ALL_MARKERS.replace("        # renovate: datasource=github-releases depName=aquasecurity/trivy\n", "")
    assert _run_against(_fake_repo(tmp_path, body), monkeypatch) == 1


def test_a_blank_line_between_marker_and_target_fails(tmp_path, monkeypatch):
    """`\\s+` would cross the gap and silently re-bind to the NEXT version line.

    The anchor is `[ \\t]*\\n[ \\t]*` precisely so this is a miss, not a
    mismatch -- a manager pointed at the wrong line is worse than one pointed
    at nothing, because the checker would not notice.
    """
    body = ALL_MARKERS.replace(
        "depName=golangci/golangci-lint\n        version:",
        "depName=golangci/golangci-lint\n\n        version:",
    )
    assert _run_against(_fake_repo(tmp_path, body), monkeypatch) == 1


def test_an_intervening_comment_fails(tmp_path, monkeypatch):
    body = ALL_MARKERS.replace(
        "depName=golangci/golangci-lint\n        version:",
        "depName=golangci/golangci-lint\n        # unrelated note\n        version:",
    )
    assert _run_against(_fake_repo(tmp_path, body), monkeypatch) == 1


def test_a_lowercase_shell_version_var_is_not_matched(tmp_path, monkeypatch):
    """JS RegExp has no inline case-insensitive flag, so shell pins are UPPERCASE.

    A lowercase `version=` must miss rather than half-work, or the convention
    that makes one pattern serve every shell pin quietly stops holding.
    """
    body = ALL_MARKERS.replace('ACTIONLINT_VERSION="1.7.12"', 'version="1.7.12"')
    assert _run_against(_fake_repo(tmp_path, body), monkeypatch) == 1


def test_a_non_version_shaped_value_fails(tmp_path, monkeypatch):
    body = ALL_MARKERS.replace("version: v0.69.3", "version: latest")
    assert _run_against(_fake_repo(tmp_path, body), monkeypatch) == 1


def test_a_missing_go_mod_fails(tmp_path, monkeypatch):
    repo = _fake_repo(tmp_path, ALL_MARKERS)
    (repo / "docker" / "healthcheck" / "go.mod").unlink()
    assert _run_against(repo, monkeypatch) == 1


def test_a_bare_glob_file_pattern_is_rejected(tmp_path, monkeypatch):
    repo = _fake_repo(tmp_path, ALL_MARKERS)
    config = json.loads((repo / "renovate.json").read_text())
    config["customManagers"][0]["managerFilePatterns"] = [".github/workflows/**.yml"]
    (repo / "renovate.json").write_text(json.dumps(config))
    with pytest.raises(SystemExit):
        _run_against(repo, monkeypatch)


def test_no_custom_managers_fails(tmp_path, monkeypatch):
    repo = _fake_repo(tmp_path, ALL_MARKERS)
    config = json.loads((repo / "renovate.json").read_text())
    config["customManagers"] = []
    (repo / "renovate.json").write_text(json.dumps(config))
    assert _run_against(repo, monkeypatch) == 1

"""Tests for scripts/setup/synthetic/build_synthetic_db.py.

The builder is LOCAL ONLY (it reads the real DB), so these tests cover the pure,
importable helpers only — chiefly that the camp scrub/gate tokens are derived from
the gitignored branding config and that a missing/empty config fails LOUDLY rather
than silently scrubbing nothing (issue #1623, leak-gate hardening).

A fictional camp name ("Camp Wildwood" / "Wildwood") stands in for the real brand.
"""

import importlib
import json
from pathlib import Path

import pytest


@pytest.fixture
def build_mod():
    return importlib.import_module("scripts.setup.synthetic.build_synthetic_db")


def _write_branding(path: Path, data: dict[str, str]) -> Path:
    path.write_text(json.dumps(data))
    return path


def test_camp_scrub_config_derives_from_branding(build_mod, tmp_path):
    branding = _write_branding(
        tmp_path / "branding.local.json",
        {"camp_name": "Camp Wildwood", "camp_name_short": "Wildwood"},
    )
    replacements, gate_tokens = build_mod._camp_scrub_config(branding)
    # longest-first so "Camp Wildwood" scrubs before its substring "Wildwood"
    assert replacements[0][0] == "Camp Wildwood"
    assert dict(replacements) == {"Camp Wildwood": "Camp Kindred", "Wildwood": "Kindred"}
    assert set(gate_tokens) == {"Camp Wildwood", "Wildwood"}
    # the real brand is never hardcoded into the (public) builder module
    assert "Tawonga" not in Path(build_mod.__file__).read_text()


def test_camp_scrub_config_missing_branding_fails_loud(build_mod, tmp_path):
    with pytest.raises(FileNotFoundError):
        build_mod._camp_scrub_config(tmp_path / "does_not_exist.json")


def test_camp_scrub_config_empty_tokens_fails_loud(build_mod, tmp_path):
    branding = _write_branding(tmp_path / "branding.local.json", {"unrelated": "value"})
    with pytest.raises(ValueError):
        build_mod._camp_scrub_config(branding)

import json
import re
import subprocess
from pathlib import Path

from bunking.rbac.permissions import PERMISSION_INFO, Permission
from scripts.guide.export_facts import FACTS_PATH, HELP_AREAS, build_facts, render

REPO = Path(__file__).resolve().parents[3]


def test_every_permission_is_exported_with_its_label_and_screens():
    facts = build_facts()
    assert set(facts["permissions"]) == set(PERMISSION_INFO)
    info = PERMISSION_INFO[Permission.BUNKING_MANAGE]
    exported = facts["permissions"][Permission.BUNKING_MANAGE]
    assert exported["label"] == info.label
    assert exported["screens"][0] == {"name": info.screens[0].name, "path": info.screens[0].path}


def test_help_keys_come_from_the_frontend_registry():
    registry = json.loads((REPO / "frontend/src/help/helpKeys.json").read_text())
    facts = build_facts()
    assert set(facts["help_keys"]) == {e["key"] for e in registry}
    assert facts["help_keys"]["aid.today"]["area"] == "aid"


def test_render_is_deterministic_and_ends_with_newline():
    a, b = render(build_facts()), render(build_facts())
    assert a == b
    assert a.endswith("\n")
    assert list(json.loads(a)) == sorted(json.loads(a))


def test_committed_file_is_fresh():
    assert FACTS_PATH.read_text() == render(build_facts()), "run: uv run python -m scripts.guide.export_facts"


def test_check_flag_fails_on_a_stale_file(tmp_path):
    stale = tmp_path / "facts.json"
    stale.write_text("{}\n")
    r = subprocess.run(
        ["uv", "run", "python", "-m", "scripts.guide.export_facts", "--check", "--path", str(stale)],
        cwd=REPO,
        capture_output=True,
        text=True,
    )
    assert r.returncode == 1
    assert "stale" in r.stdout + r.stderr


def test_help_areas_match_the_typescript_list():
    src = (REPO / "frontend/src/help/resolveHelpKey.ts").read_text()
    m = re.search(r"HELP_AREAS\s*=\s*\[(.*?)\]", src, re.DOTALL)
    assert m, "HELP_AREAS not found in resolveHelpKey.ts"
    assert re.findall(r"'([^']+)'", m.group(1)) == HELP_AREAS

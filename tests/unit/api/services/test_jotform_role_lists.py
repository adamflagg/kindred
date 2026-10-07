"""The three Jotform field-map role lists cannot drift.

Go's `jotform.Roles` resolves every role on a pull, the API validates staff
saves against `JOTFORM_ROLES`, and the admin card renders a select per key of
`JOTFORM_ROLE_LABELS`. A role added to one and not the others is either never
resolved, refused on save, or never shown to staff -- each silently.
"""

from __future__ import annotations

import re
from pathlib import Path

from api.services.jotform_queue import JOTFORM_ROLES

REPO_ROOT = Path(__file__).resolve().parents[4]
GO_JOTFORM = REPO_ROOT / "pocketbase" / "jotform"
TS_LABELS = REPO_ROOT / "frontend" / "src" / "components" / "admin" / "lodging" / "jotformRoles.ts"


def _go_roles() -> list[str]:
    constants = {
        name: value
        for path in GO_JOTFORM.glob("*.go")
        for name, value in re.findall(r'^\s*(Role\w+)\s*=\s*"([^"]+)"', path.read_text(), re.MULTILINE)
    }
    block = re.search(r"var Roles = \[\]string\{(.*?)\n\}", (GO_JOTFORM / "mapping.go").read_text(), re.DOTALL)
    assert block, "could not find jotform.Roles in mapping.go"
    tokens = [t.strip() for t in block.group(1).replace("\n", " ").split(",") if t.strip()]
    return [t.strip('"') if t.startswith('"') else constants[t] for t in tokens]


def _ts_roles() -> list[str]:
    block = re.search(r"JOTFORM_ROLE_LABELS[^{]*\{(.*?)\n\}", TS_LABELS.read_text(), re.DOTALL)
    assert block, "could not find JOTFORM_ROLE_LABELS"
    return re.findall(r"^\s*(\w+):", block.group(1), re.MULTILINE)


def test_python_matches_go_in_order() -> None:
    assert list(JOTFORM_ROLES) == _go_roles()


def test_the_admin_card_labels_every_role_in_order() -> None:
    assert _ts_roles() == list(JOTFORM_ROLES)


def test_the_note_to_directors_is_a_role() -> None:
    assert "director_notes" in JOTFORM_ROLES

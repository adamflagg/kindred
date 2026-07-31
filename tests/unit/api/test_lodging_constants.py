"""The lodging surface's collection names and PHI permission must exist.

Collection names are centralised (never inlined as string literals) so a
rename is one edit, and the PHI permission must exist in BOTH permission
files — the TypeScript file's own docstring says it mirrors the Python one.

Note on the work queue: the unresolved-cabin-string work queue is
``lodging_ingest_issues`` (created by the ingest plan), filtered to
``kind = "unresolved_alias"``. The surfaces plan's draft defined a second
collection, ``lodging_unresolved_aliases``; the cross-plan ruling rejected it
because the ingest model is a superset and its sole producer. There is one
work queue, and this test pins that.
"""

import re
from pathlib import Path

from api.constants import collections
from bunking.rbac.permissions import ALL_PERMISSIONS, PERMISSION_DESCRIPTIONS, Permission

REPO_ROOT = Path(__file__).resolve().parents[3]


def test_lodging_collection_constants_exist() -> None:
    assert collections.LODGING_AREAS == "lodging_areas"
    assert collections.LODGING_UNITS == "lodging_units"
    assert collections.LODGING_UNIT_ALIASES == "lodging_unit_aliases"
    assert collections.LODGING_MERGES == "lodging_merges"
    assert collections.LODGING_AVAILABILITY == "lodging_availability"
    assert collections.LODGING_ASSIGNMENTS == "lodging_assignments"
    assert collections.LODGING_ASSIGNMENT_HISTORY == "lodging_assignment_history"


def test_ingest_issue_queue_constant_is_the_single_work_queue() -> None:
    """One work queue, owned by ingest — not a second surfaces-only collection."""
    assert collections.LODGING_INGEST_ISSUES == "lodging_ingest_issues"
    assert not hasattr(collections, "LODGING_UNRESOLVED_ALIASES")


def test_supporting_collection_constants_exist() -> None:
    assert collections.HOUSEHOLDS == "households"
    assert collections.FAMILY_CAMP_ADULTS == "family_camp_adults"
    assert collections.FAMILY_CAMP_REGISTRATIONS == "family_camp_registrations"
    assert collections.FAMILY_CAMP_MEDICAL == "family_camp_medical"
    assert collections.PERSON_CUSTOM_VALUES == "person_custom_values"
    assert collections.CUSTOM_FIELD_DEFS == "custom_field_defs"


def test_lodging_phi_permission_is_registered() -> None:
    assert Permission.LODGING_PHI == "lodging.phi"
    assert Permission.LODGING_PHI in ALL_PERMISSIONS
    assert Permission.LODGING_PHI in PERMISSION_DESCRIPTIONS


def test_typescript_permission_file_mirrors_python() -> None:
    """frontend/src/constants/permissions.ts declares it mirrors permissions.py.

    Matched by pattern rather than literal: the guarantee is that the key
    and value are both present, and pinning the quote style and trailing
    comma makes prettier's formatting a test failure.
    """
    ts = (REPO_ROOT / "frontend" / "src" / "constants" / "permissions.ts").read_text()
    assert re.search(r"""LODGING_PHI:\s*['"]lodging\.phi['"]""", ts)

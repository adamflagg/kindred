"""The lodging surface's collection names must exist.

Collection names are centralised (never inlined as string literals) so a
rename is one edit. kindred#2312 removed the separate `lodging.phi`
permission (RBAC here is screen-reduction, not a data boundary; the one
endpoint it gated now gates on `bunking.manage` like every sibling on its
router) — this file pins that it stays gone from both permission files, the
TypeScript one included since its own docstring says it mirrors the Python
one.

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
from api.constants.lodging import (
    ADULT_NAME_PLACEHOLDERS,
    INFANT_BED_EXEMPT_MONTHS,
    is_attending_adult_name,
)
from bunking.rbac.permissions import ALL_PERMISSIONS, PERMISSION_DESCRIPTIONS, Permission

REPO_ROOT = Path(__file__).resolve().parents[3]


def test_lodging_collection_constants_exist() -> None:
    assert collections.LODGING_AREAS == "lodging_areas"
    assert collections.LODGING_UNITS == "lodging_units"
    assert collections.LODGING_UNIT_ALIASES == "lodging_unit_aliases"
    assert collections.LODGING_AVAILABILITY == "lodging_availability"
    assert collections.LODGING_ASSIGNMENTS == "lodging_assignments"
    assert collections.LODGING_ASSIGNMENT_HISTORY == "lodging_assignment_history"


def test_lodging_write_in_collection_constants_exist() -> None:
    """kindred#2382, PR 1 of 4 — the write-in occupancy pair.

    `lodging_availability` conflated two unrelated questions through one
    boolean: `family_available = true` on a staff cabin is a staff<->family
    ROLE override for the weekend, and `false` is an OCCUPANCY — somebody is
    in the room. The owner ruled (2026-08-15) that the ROLE is NOT
    scenario-scoped and the occupancy IS, so occupancy moves to its own
    live+draft pair beside `lodging_assignments`/`_draft` and availability
    keeps only the role half.

    A nullable `scenario` sentinel column was explicitly rejected — see this
    module's sibling note in `api/services/lodging_repository.py`, which
    records why `lodging_assignments` dropped its own.
    """
    assert collections.LODGING_WRITE_INS == "lodging_write_ins"
    assert collections.LODGING_WRITE_INS_DRAFT == "lodging_write_ins_draft"


def test_weekend_status_constant_exists() -> None:
    """kindred#2092. Its own collection, NOT a column on camp_sessions.

    SessionsSync deletes local sessions CampMinder stopped returning, and a
    cancelled weekend is exactly the one it may stop returning — so a column on
    that row would be deleted by the event it exists to record.
    """
    assert collections.LODGING_SESSION_STATUS == "lodging_session_status"


def test_lodging_merge_constants_are_gone() -> None:
    """1500000134 deleted both `lodging_merges` and `lodging_merges_draft`
    outright, collapsing the three placement targets into one `units`
    relation. A constant naming either collection would name a table that no
    longer exists."""
    assert not hasattr(collections, "LODGING_MERGES")
    assert not hasattr(collections, "LODGING_MERGES_DRAFT")


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


def test_lodging_phi_permission_stays_removed() -> None:
    """kindred#2312: the separate `lodging.phi` permission is gone for good.

    `ALL_PERMISSIONS` is derived from `Permission`'s own attributes, so
    removing the class attribute already dropped it from the set and the
    description map — this pins that nothing re-adds either independently.
    """
    assert not hasattr(Permission, "LODGING_PHI")
    assert "lodging.phi" not in ALL_PERMISSIONS
    assert "lodging.phi" not in PERMISSION_DESCRIPTIONS


def test_typescript_permission_file_has_no_lodging_phi() -> None:
    """frontend/src/constants/permissions.ts declares it mirrors permissions.py.

    kindred#2312 removed `LODGING_PHI` from the Python side; this pins that
    the TypeScript mirror does not resurrect it independently.
    """
    ts = (REPO_ROOT / "frontend" / "src" / "constants" / "permissions.ts").read_text()
    assert not re.search(r"""LODGING_PHI\s*:\s*['"]lodging\.phi['"]""", ts)


def test_infant_bed_exemption_is_eighteen_months_hardcoded() -> None:
    """kindred#2046, settled by the owner: 18 MONTHS, not 1.5 years.

    Whole months, because the input is `birthdate` measured against
    `camp_sessions.start_date`. It is emphatically NOT a threshold on
    `persons.age`: that column is CampMinder's `yy.mm` as a REAL, where the
    fractional part never exceeds `.11`, so `age < 1.5` reads as "under 24
    months" and discounts every 19-23 month old the ruling says must keep a
    bed. Measured on 2026's rostered cohort, the naive form discounts 44
    children where the derived rule discounts 26.
    """
    assert INFANT_BED_EXEMPT_MONTHS == 18


def test_adult_name_placeholders_are_lowercase_tokens() -> None:
    """The set is compared against a casefolded, stripped name, so every
    member must already be lowercase or it can never match."""
    assert frozenset({"na", "n/a", "none", "-", "0", "no"}) == ADULT_NAME_PLACEHOLDERS
    assert all(token == token.lower() for token in ADULT_NAME_PLACEHOLDERS)


def test_is_attending_adult_name_rejects_blanks_and_placeholders() -> None:
    assert is_attending_adult_name("Emma Johnson")
    # A real surname that merely CONTAINS a placeholder token is not one.
    assert is_attending_adult_name("Nona Garcia")
    assert not is_attending_adult_name("")
    assert not is_attending_adult_name("   ")
    assert not is_attending_adult_name("NA")
    assert not is_attending_adult_name(" n/a ")
    assert not is_attending_adult_name("None")
    assert not is_attending_adult_name("-")
    assert not is_attending_adult_name("0")
    assert not is_attending_adult_name("No")


def test_typescript_household_identity_mirrors_the_placeholder_set() -> None:
    """kindred#1925 step 5. The board must not render an adult the party size
    refuses to count, so the two surfaces share ONE token list.

    Grepped rather than executed: there is no JS runtime here. The guarantee
    is that every Python token appears as a quoted string literal in
    `householdIdentity.ts`'s placeholder set, so adding a token on one side
    and not the other is a test failure rather than a silent divergence.
    """
    ts = (REPO_ROOT / "frontend" / "src" / "components" / "weekend" / "householdIdentity.ts").read_text()
    block = re.search(r"ADULT_NAME_PLACEHOLDERS[^=]*=\s*new Set\(\[(.*?)\]\)", ts, re.DOTALL)
    assert block is not None, "householdIdentity.ts must export an ADULT_NAME_PLACEHOLDERS Set"
    tokens = set(re.findall(r"'([^']*)'", block.group(1)))
    assert tokens == set(ADULT_NAME_PLACEHOLDERS)

"""Tests for RBAC permission constants."""

import re
from pathlib import Path

from bunking.rbac.permissions import (
    ADMIN_ONLY_AREAS,
    ALL_PERMISSIONS,
    PERMISSION_AREAS,
    PERMISSION_DESCRIPTIONS,
    PERMISSION_INFO,
    Permission,
    PermissionInfo,
    Screen,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
TS_PERMISSIONS = REPO_ROOT / "frontend" / "src" / "constants" / "permissions.ts"


class TestPermissionConstants:
    """Verify permission registry is complete and consistent."""

    def test_all_permissions_is_frozen_set(self):
        assert isinstance(ALL_PERMISSIONS, frozenset)

    def test_expected_permissions_exist(self):
        expected = {
            "bunking.manage",
            "financial_aid.casework",
            "financial_aid.funding_sources",
            "financial_aid.grantors",
            "financial_aid.rules",
            "financial_aid.summary",
            "financial_aid.view",
            "metrics.financial",
            "metrics.geo",
            "registration.manage",
            "sheets.export",
            "staff.hiring",
            "users.manage",
        }
        assert expected == ALL_PERMISSIONS

    def test_permission_class_attributes_match_values(self):
        assert Permission.BUNKING_MANAGE == "bunking.manage"
        assert Permission.FINANCIAL_AID_CASEWORK == "financial_aid.casework"
        assert Permission.FINANCIAL_AID_FUNDING_SOURCES == "financial_aid.funding_sources"
        assert Permission.FINANCIAL_AID_GRANTORS == "financial_aid.grantors"
        assert Permission.FINANCIAL_AID_RULES == "financial_aid.rules"
        assert Permission.FINANCIAL_AID_SUMMARY == "financial_aid.summary"
        assert Permission.FINANCIAL_AID_VIEW == "financial_aid.view"
        assert Permission.METRICS_FINANCIAL == "metrics.financial"
        assert Permission.METRICS_GEO == "metrics.geo"
        assert Permission.REGISTRATION_MANAGE == "registration.manage"
        assert Permission.SHEETS_EXPORT == "sheets.export"
        assert Permission.STAFF_HIRING == "staff.hiring"
        assert Permission.USERS_MANAGE == "users.manage"

    def test_no_duplicate_values(self):
        values = [getattr(Permission, a) for a in dir(Permission) if a.isupper()]
        assert len(values) == len(set(values))

    def test_every_permission_has_a_description(self):
        """The Roles editor and /api/permissions show these; a blank one is a
        permission nobody can assign knowingly."""
        missing = sorted(p for p in ALL_PERMISSIONS if not PERMISSION_DESCRIPTIONS.get(p, "").strip())
        assert missing == []
        assert set(PERMISSION_DESCRIPTIONS) == set(ALL_PERMISSIONS)

    def test_permission_names_are_lowercase_dotted(self):
        """Lowercase `area.action`, letters and single underscores only. This keeps
        the substring check below sufficient: with no quotes, commas or capitals in
        a name, a PocketBase `~` match cannot span two entries of the stored JSON
        array, and SQLite LIKE's ASCII case-folding cannot join two names."""
        pattern = re.compile(r"^[a-z]+(_[a-z]+)*\.[a-z]+(_[a-z]+)*$")
        bad = sorted(p for p in ALL_PERMISSIONS if not pattern.match(p))
        assert bad == []

    def test_no_permission_is_a_substring_of_another(self):
        """PocketBase rules test `@request.auth.cached_permissions ~ "<perm>"`,
        which compiles to SQLite `LIKE '%<perm>%'`: case-insensitive substring
        over the stored JSON array. If one name were a substring of another
        (`financial_aid.view` inside `financial_aid.view_all`), a rule gating
        the short one would admit holders of the long one (campership spec §14.1)."""
        clashes = sorted(
            (short, long_)
            for short in ALL_PERMISSIONS
            for long_ in ALL_PERMISSIONS
            if short != long_ and short.casefold() in long_.casefold()
        )
        assert clashes == []

    def test_typescript_mirror_matches_python(self):
        """frontend/src/constants/permissions.ts is the Roles editor's source and
        says it mirrors this file. A permission missing there cannot be assigned
        in the GUI; one only there is assignable but checked nowhere."""
        ts = TS_PERMISSIONS.read_text()
        block = ts.split("export const Permission = {", 1)[1].split("} as const", 1)[0]
        ts_values = set(re.findall(r"^\s+[A-Z_]+:\s*'([^']+)',?\s*$", block, re.MULTILINE))
        assert ts_values == set(ALL_PERMISSIONS)

    def test_lodging_phi_permission_no_longer_exists(self):
        """kindred#2312: RBAC here is screen-reduction, not a data boundary.

        `lodging.phi` gated exactly one endpoint, and every sibling endpoint
        on that router already gates on `bunking.manage`. Removed rather than
        merely unused, so a future `hasattr` check or stale docstring cannot
        resurrect it by accident.
        """
        assert not hasattr(Permission, "LODGING_PHI")
        assert "lodging.phi" not in ALL_PERMISSIONS


class TestPermissionInfo:
    """The Permissions tab and the drawers read these; a permission without copy
    would render as a bare codename nobody can assign knowingly."""

    def test_every_permission_has_info(self):
        assert set(PERMISSION_INFO) == set(ALL_PERMISSIONS)
        assert all(isinstance(v, PermissionInfo) for v in PERMISSION_INFO.values())

    def test_areas_are_known_and_all_used(self):
        used = {info.area for info in PERMISSION_INFO.values()}
        assert used <= set(PERMISSION_AREAS)
        assert used == set(PERMISSION_AREAS), "an area with no permission renders an empty card"

    def test_labels_and_shorts_are_unique_and_non_empty(self):
        labels = [i.label for i in PERMISSION_INFO.values()]
        shorts = [i.short for i in PERMISSION_INFO.values()]
        assert all(s.strip() for s in labels + shorts)
        assert len(set(labels)) == len(labels)
        assert len(set(shorts)) == len(shorts)

    def test_screens_are_routes(self):
        for code, info in PERMISSION_INFO.items():
            assert isinstance(info.screens, tuple), code
            for screen in info.screens:
                assert isinstance(screen, Screen)
                assert screen.name.strip(), code
                assert screen.path.startswith("/"), (code, screen.path)
                assert " " not in screen.path, (code, screen.path)

    def test_metrics_financial_has_no_screen(self):
        """Nothing checks it (spec M8); the tab says so instead of inventing a screen."""
        assert PERMISSION_INFO["metrics.financial"].screens == ()

    def test_descriptions_are_plain_sentences(self):
        """Plain wording (spec M4): a full sentence, not a developer fragment."""
        for code, text in PERMISSION_DESCRIPTIONS.items():
            assert text.endswith("."), code
            assert text[0].isupper(), code

    def test_admin_only_areas(self):
        assert ADMIN_ONLY_AREAS == (
            "Manage › Sync",
            "Manage › Config",
            "Manage › Audit log",
            "Summer › Debug",
            "Camperships › Kit",
            "Role editing",
        )

    def test_aid_view_screens_cover_every_view_gated_section(self):
        """Every Camperships section financial_aid.view opens (aidNav.ts) is listed."""
        paths = [s.path for s in PERMISSION_INFO["financial_aid.view"].screens]
        assert paths == ["/aid", "/aid/requests", "/aid/grants", "/aid/money", "/aid/season", "/aid/reports"]

    def test_descriptions_contain_no_codenames(self):
        """Staff read descriptions verbatim (spec M4): no `area.action` codenames."""
        for code, text in PERMISSION_DESCRIPTIONS.items():
            for codename in ALL_PERMISSIONS:
                assert codename not in text, (code, codename)
            assert not re.search(r"\b[a-z_]+\.[a-z_]+\b", text), code

    def test_add_on_permissions_say_they_only_add(self):
        for code in ("financial_aid.casework", "financial_aid.rules"):
            assert "only adds" in PERMISSION_DESCRIPTIONS[code], code
        assert "Scenarios" in PERMISSION_DESCRIPTIONS["financial_aid.rules"]

    def test_bunking_manage_does_not_claim_to_open_the_boards(self):
        """The Summer and Weekend boards are open to every signed-in user (App.tsx)."""
        text = PERMISSION_DESCRIPTIONS["bunking.manage"]
        assert "open to every signed-in user" in text
        assert "opens the" not in text

    def test_staff_hiring_discloses_admin_only_data(self):
        assert "admin-only" in PERMISSION_DESCRIPTIONS["staff.hiring"]

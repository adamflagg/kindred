"""Tests for RBAC permission constants."""

from bunking.rbac.permissions import ALL_PERMISSIONS, Permission


class TestPermissionConstants:
    """Verify permission registry is complete and consistent."""

    def test_all_permissions_is_frozen_set(self):
        assert isinstance(ALL_PERMISSIONS, frozenset)

    def test_expected_permissions_exist(self):
        expected = {
            "bunking.manage",
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
        assert Permission.METRICS_FINANCIAL == "metrics.financial"
        assert Permission.METRICS_GEO == "metrics.geo"
        assert Permission.REGISTRATION_MANAGE == "registration.manage"
        assert Permission.SHEETS_EXPORT == "sheets.export"
        assert Permission.STAFF_HIRING == "staff.hiring"
        assert Permission.USERS_MANAGE == "users.manage"

    def test_no_duplicate_values(self):
        values = [getattr(Permission, a) for a in dir(Permission) if a.isupper()]
        assert len(values) == len(set(values))

    def test_lodging_phi_permission_no_longer_exists(self):
        """kindred#2312: RBAC here is screen-reduction, not a data boundary.

        `lodging.phi` gated exactly one endpoint, and every sibling endpoint
        on that router already gates on `bunking.manage`. Removed rather than
        merely unused, so a future `hasattr` check or stale docstring cannot
        resurrect it by accident.
        """
        assert not hasattr(Permission, "LODGING_PHI")
        assert "lodging.phi" not in ALL_PERMISSIONS

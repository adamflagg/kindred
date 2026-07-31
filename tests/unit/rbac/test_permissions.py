"""Tests for RBAC permission constants."""

from bunking.rbac.permissions import ALL_PERMISSIONS, Permission


class TestPermissionConstants:
    """Verify permission registry is complete and consistent."""

    def test_all_permissions_is_frozen_set(self):
        assert isinstance(ALL_PERMISSIONS, frozenset)

    def test_expected_permissions_exist(self):
        expected = {
            "bunking.manage",
            "lodging.phi",
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
        assert Permission.LODGING_PHI == "lodging.phi"
        assert Permission.METRICS_FINANCIAL == "metrics.financial"
        assert Permission.METRICS_GEO == "metrics.geo"
        assert Permission.REGISTRATION_MANAGE == "registration.manage"
        assert Permission.SHEETS_EXPORT == "sheets.export"
        assert Permission.STAFF_HIRING == "staff.hiring"
        assert Permission.USERS_MANAGE == "users.manage"

    def test_no_duplicate_values(self):
        values = [getattr(Permission, a) for a in dir(Permission) if a.isupper()]
        assert len(values) == len(set(values))

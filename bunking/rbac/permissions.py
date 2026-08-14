"""
Permission constants for Kindred RBAC.

Permissions are developer-defined strings that gate access to features.
They are stored as JSON arrays on roles and cached on user records.
Add new permissions here when adding new gated features.
"""


class Permission:
    """Permission codenames. Used in backend checks and exposed to frontend via API."""

    BUNKING_MANAGE = "bunking.manage"
    METRICS_FINANCIAL = "metrics.financial"
    METRICS_GEO = "metrics.geo"
    REGISTRATION_MANAGE = "registration.manage"
    SHEETS_EXPORT = "sheets.export"
    STAFF_HIRING = "staff.hiring"
    USERS_MANAGE = "users.manage"


ALL_PERMISSIONS: frozenset[str] = frozenset(getattr(Permission, attr) for attr in dir(Permission) if attr.isupper())

PERMISSION_DESCRIPTIONS: dict[str, str] = {
    Permission.BUNKING_MANAGE: "Manage requests, scenarios, solver runs",
    Permission.METRICS_FINANCIAL: "View financial projections and revenue data",
    Permission.METRICS_GEO: "View and manage geographic data",
    Permission.REGISTRATION_MANAGE: "Edit registration dates, budgets, and grade eligibility",
    Permission.SHEETS_EXPORT: "Trigger and view Google Sheets exports",
    Permission.STAFF_HIRING: "View staff cabin retention analysis",
    Permission.USERS_MANAGE: "Assign and revoke roles on other users",
}

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
    SYNC_RUN = "sync.run"
    USERS_MANAGE = "users.manage"


ALL_PERMISSIONS: frozenset[str] = frozenset(getattr(Permission, attr) for attr in dir(Permission) if attr.isupper())

PERMISSION_DESCRIPTIONS: dict[str, str] = {
    Permission.BUNKING_MANAGE: "Manage requests, scenarios, solver runs",
    Permission.METRICS_FINANCIAL: "View financial projections and revenue data",
    Permission.METRICS_GEO: "View and manage geographic data",
    Permission.SYNC_RUN: "Run CampMinder syncs",
    Permission.USERS_MANAGE: "Assign roles and manage users",
}

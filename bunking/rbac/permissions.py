"""
Permission constants for Kindred RBAC.

Permissions are developer-defined strings that gate access to features.
They are stored as JSON arrays on roles and cached on user records.
Add new permissions here when adding new gated features.
"""


class Permission:
    """Permission codenames. Used in backend checks and exposed to frontend via API."""

    BUNKING_VIEW = "bunking.view"
    BUNKING_MANAGE = "bunking.manage"
    METRICS_VIEW = "metrics.view"
    METRICS_FINANCIAL = "metrics.financial"
    METRICS_GEO = "metrics.geo"
    SYNC_RUN = "sync.run"
    SOLVER_CONFIGURE = "solver.configure"
    USERS_MANAGE = "users.manage"


ALL_PERMISSIONS: frozenset[str] = frozenset(getattr(Permission, attr) for attr in dir(Permission) if attr.isupper())

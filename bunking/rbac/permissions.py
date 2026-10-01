"""
Permission constants for Kindred RBAC.

Permissions are developer-defined strings that gate access to features.
They are stored as JSON arrays on roles and cached on user records.
Add new permissions here when adding new gated features.

frontend/src/constants/permissions.ts mirrors this class (the Roles editor
reads it); tests/unit/rbac/test_permissions.py fails if they drift. No name may
be a substring of another: PocketBase rules match with a case-insensitive LIKE.
"""

from dataclasses import dataclass


class Permission:
    """Permission codenames. Used in backend checks and exposed to frontend via API."""

    BUNKING_MANAGE = "bunking.manage"
    FINANCIAL_AID_CASEWORK = "financial_aid.casework"
    FINANCIAL_AID_RULES = "financial_aid.rules"
    FINANCIAL_AID_SUMMARY = "financial_aid.summary"
    FINANCIAL_AID_VIEW = "financial_aid.view"
    METRICS_FINANCIAL = "metrics.financial"
    METRICS_GEO = "metrics.geo"
    REGISTRATION_MANAGE = "registration.manage"
    SHEETS_EXPORT = "sheets.export"
    STAFF_HIRING = "staff.hiring"
    USERS_MANAGE = "users.manage"


ALL_PERMISSIONS: frozenset[str] = frozenset(getattr(Permission, attr) for attr in dir(Permission) if attr.isupper())

PERMISSION_DESCRIPTIONS: dict[str, str] = {
    Permission.BUNKING_MANAGE: (
        "Place campers and families: edit bunk requests, run scenarios and the solver, "
        "and edit the summer and weekend boards."
    ),
    Permission.FINANCIAL_AID_CASEWORK: (
        "Work a family's aid: move stages, record cancellations, set appeal amounts and "
        "cost overrides, assign grants, clear the posting worklist."
    ),
    Permission.FINANCIAL_AID_RULES: (
        "Set the aid rules and budget, run scenarios, approve rounds and set session capacity."
    ),
    Permission.FINANCIAL_AID_SUMMARY: (
        "See Camperships totals for reporting. Small groups are hidden, so no family can be picked out."
    ),
    Permission.FINANCIAL_AID_VIEW: "See each family's aid: applications, requests, awards and postings.",
    Permission.METRICS_FINANCIAL: (
        "Nothing yet. It was meant for revenue projections, but no screen checks it, so granting it changes nothing."
    ),
    Permission.METRICS_GEO: "See and edit the geographic data behind the maps.",
    Permission.REGISTRATION_MANAGE: "Set registration dates, budgets and grade eligibility.",
    Permission.SHEETS_EXPORT: "Run the Google Sheets exports and see how they went.",
    Permission.STAFF_HIRING: "See the staff cabin-retention analysis.",
    Permission.USERS_MANAGE: (
        "Give and remove other staff's roles. The Users page won't let them change admins or their own roles."
    ),
}


@dataclass(frozen=True)
class Screen:
    """A place in the app a permission opens. `path` is a real route."""

    name: str
    path: str


@dataclass(frozen=True)
class PermissionInfo:
    """How the Users page explains a permission (spec 2026-10-01 §3.1).

    `label` stands alone (drawers, chips); `short` is shown under its area
    heading, where the area already says "Camperships". Code, not data: these are
    tied to routes and to what the code actually gates. Admins may override only
    the description, in PocketBase (`permission_descriptions`).
    """

    label: str
    short: str
    area: str
    screens: tuple[Screen, ...]


PERMISSION_AREAS: tuple[str, ...] = ("Summer and Weekend", "Camperships", "Analytics", "Manage tools", "People")

PERMISSION_INFO: dict[str, PermissionInfo] = {
    Permission.BUNKING_MANAGE: PermissionInfo(
        "Bunking and housing",
        "Bunking and housing",
        "Summer and Weekend",
        (
            Screen("Summer board", "/summer/sessions"),
            Screen("Weekend board", "/weekend/sessions"),
            Screen("Manage › Lodging", "/manage/lodging"),
        ),
    ),
    Permission.FINANCIAL_AID_VIEW: PermissionInfo(
        "Camperships: family detail",
        "Family detail",
        "Camperships",
        (Screen("Camperships", "/aid"), Screen("Camperships › Requests", "/aid/requests")),
    ),
    Permission.FINANCIAL_AID_SUMMARY: PermissionInfo(
        "Camperships: totals only",
        "Totals only",
        "Camperships",
        (Screen("Camperships › Reports", "/aid/reports"),),
    ),
    Permission.FINANCIAL_AID_CASEWORK: PermissionInfo(
        "Camperships: casework",
        "Casework",
        "Camperships",
        (Screen("Camperships › Requests", "/aid/requests"), Screen("Camperships › Money", "/aid/money")),
    ),
    Permission.FINANCIAL_AID_RULES: PermissionInfo(
        "Camperships: rules and budget",
        "Rules and budget",
        "Camperships",
        (Screen("Camperships › Season", "/aid/season"),),
    ),
    Permission.METRICS_FINANCIAL: PermissionInfo("Financial projections", "Financial projections", "Analytics", ()),
    Permission.METRICS_GEO: PermissionInfo(
        "Geographic data", "Geographic data", "Analytics", (Screen("Manage › Geo Data", "/manage/geo"),)
    ),
    Permission.STAFF_HIRING: PermissionInfo(
        "Staff retention",
        "Staff retention",
        "Analytics",
        (Screen("Analytics › Staff Analysis", "/analytics/retention/staff"),),
    ),
    Permission.REGISTRATION_MANAGE: PermissionInfo(
        "Registration settings",
        "Registration settings",
        "Manage tools",
        (Screen("Manage › Registration", "/manage/registration"),),
    ),
    Permission.SHEETS_EXPORT: PermissionInfo(
        "Google Sheets export", "Google Sheets export", "Manage tools", (Screen("Manage › Sheets", "/manage/sheets"),)
    ),
    Permission.USERS_MANAGE: PermissionInfo("Assign roles", "Assign roles", "People", (Screen("Users", "/users"),)),
}

ADMIN_ONLY_AREAS: tuple[str, ...] = (
    "Manage › Sync",
    "Manage › Config",
    "Manage › Audit log",
    "Creating and editing roles",
)

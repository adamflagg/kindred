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
    FINANCIAL_AID_GRANTORS = "financial_aid.grantors"
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
        "Place campers and families: edit bunk requests, run scenarios and the solver, edit the summer "
        "and weekend boards and manage lodging. Both boards are open to every signed-in user; this adds the editing."
    ),
    Permission.FINANCIAL_AID_CASEWORK: (
        "Work a family's aid on the Requests and household pages: move stages, record cancellations, "
        "set appeal amounts and cost overrides, assign grants and clear the posting worklist. "
        "It only adds editing to the screens that family-detail access opens."
    ),
    Permission.FINANCIAL_AID_GRANTORS: (
        "Add, edit and retire grantors, match CampMinder's aid descriptions to them, and set each description's "
        "reporting group and incentive flag. "
        "Anyone with family-detail access can already see the grantor list."
    ),
    Permission.FINANCIAL_AID_RULES: (
        "Set the aid rules and budget, approve rounds and use the Season › Scenarios tab. "
        "It only adds these to the Camperships screens that family-detail access opens."
    ),
    Permission.FINANCIAL_AID_SUMMARY: (
        "See Camperships totals by ZIP and program for reporting, without any one family's records."
    ),
    Permission.FINANCIAL_AID_VIEW: "See each family's aid: applications, requests, awards and postings.",
    Permission.METRICS_FINANCIAL: (
        "Nothing yet. It was meant for revenue projections, but no screen checks it, so granting it changes nothing."
    ),
    Permission.METRICS_GEO: "See and edit the geographic data behind the maps.",
    Permission.REGISTRATION_MANAGE: "Set registration dates, budgets and grade eligibility.",
    Permission.SHEETS_EXPORT: "Run the Google Sheets exports and see how they went.",
    Permission.STAFF_HIRING: (
        "Open the Staff Analysis page. Its staff figures are admin-only today, so only admins see data there."
    ),
    Permission.USERS_MANAGE: (
        "Give and remove other staff's roles. They can't change their own or an admin's roles, "
        "or give or remove one that includes user management."
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
        (
            Screen("Camperships", "/aid"),
            Screen("Camperships › Requests", "/aid/requests"),
            Screen("Camperships › Money", "/aid/money"),
            Screen("Camperships › Season", "/aid/season"),
            Screen("Camperships › Reports", "/aid/reports"),
        ),
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
    Permission.FINANCIAL_AID_GRANTORS: PermissionInfo(
        "Camperships: grantors",
        "Grantors",
        "Camperships",
        (Screen("Camperships › Money › Funders", "/aid/money/funders"),),
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
    "Summer › Debug",
    "Camperships › Kit",
    "Role editing",
)

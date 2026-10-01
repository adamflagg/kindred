"""Permission registry models (spec 2026-10-01-users-page-uplift-design §3.1).

The code defaults only. Admin wording overrides live in PocketBase
(`permission_descriptions`) and are merged in the browser.
"""

from __future__ import annotations

from pydantic import BaseModel


class PermissionScreen(BaseModel):
    name: str
    path: str


class PermissionEntry(BaseModel):
    codename: str
    description: str
    label: str
    short: str
    area: str
    screens: list[PermissionScreen]


class PermissionRegistryResponse(BaseModel):
    permissions: list[PermissionEntry]
    areas: list[str]
    admin_only: list[str]
    total: int

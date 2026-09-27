"""Admin audit log API models (spec 2026-09-26-admin-audit-log-design §6).

Admin-only and read-only: PocketBase's Go hooks write the log, FastAPI only
reads it. Reads are not logged.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

AuditType = Literal["access", "roles", "view_as", "settings", "pb_admin", "sign_in"]
# The screen's type buttons. Sign-ins have their own toggle (`sign_ins`), off by default.
# `access` includes giving or taking a person's role; `roles` is role definitions only.
FilterType = Literal["access", "roles", "view_as", "settings", "pb_admin"]
ActorKind = Literal["user", "superuser", "system"]

PER_PAGE_CHOICES: tuple[int, ...] = (10, 15, 25)
DEFAULT_PER_PAGE = 10


class AuditLogEntry(BaseModel):
    """One line on the screen. A view-as session is ONE entry: its start row,
    with `ended` set from the matching stop row (null: no end recorded)."""

    id: str
    created: str
    type: AuditType
    action: str
    actor_kind: ActorKind
    actor_id: str = ""
    actor_email: str = ""
    actor_name: str = ""
    collection: str = ""
    record_id: str = ""
    target_label: str = ""
    before: dict[str, Any] | None = None
    after: dict[str, Any] | None = None
    fields: list[str] = Field(default_factory=list)
    session_id: str = ""
    detail: dict[str, Any] | None = None
    ip: str = ""
    ended: str | None = None


class AuditLogPage(BaseModel):
    items: list[AuditLogEntry]
    page: int
    per_page: int
    total: int


class AuditLogActor(BaseModel):
    email: str
    name: str = ""


class AuditLogActors(BaseModel):
    """Everyone who appears as an actor, for the person picker."""

    actors: list[AuditLogActor]

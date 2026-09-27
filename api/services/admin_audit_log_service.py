"""Reads the admin audit log for the Manage > Audit Log tab (spec 2026-09-26 §6).

Through FastAPI's superuser client: `admin_audit_log` has all five PocketBase
rules null, and the router gates every call on `is_admin` first.

Two things the screen needs that the table does not hold directly:

* A view-as session is two rows (start, stop) sharing a `session_id`, and the
  screen shows ONE line. Stop rows are filtered out of the page and each start
  row on the page gets `ended` from its stop, so `total` counts lines.
* `q` searches who did it, the target, collection, record id and changed field
  names -- never the before/after values, which can be long and would surface
  family data in results.
"""

from __future__ import annotations

import asyncio
from collections.abc import Sequence
from datetime import datetime
from typing import Any

from api.constants.collections import ADMIN_AUDIT_LOG
from api.schemas.admin_audit_log import AuditLogActor, AuditLogActors, AuditLogEntry, AuditLogPage
from api.utils.pb_filters import pb_escape

# The fields `q` matches. before, after and detail are deliberately absent.
SEARCHED_FIELDS: tuple[str, ...] = ("actor_name", "actor_email", "target_label", "collection", "record_id", "fields")
ALL_FILTER_TYPES: tuple[str, ...] = ("access", "roles", "view_as", "settings", "pb_admin")
SIGN_IN = "sign_in"
VIEW_AS_STOP = "view_as_stop"
PAGE_SIZE = 500


def build_filter(*, types: Sequence[str], actor: str | None, q: str | None, sign_ins: bool) -> str:
    """The PocketBase filter for one screen state. Spaces around operators are
    required (pocketbase/CLAUDE.md); every user value goes through pb_escape."""
    clauses = [f"action != '{VIEW_AS_STOP}'"]
    wanted = [t for t in ALL_FILTER_TYPES if t in set(types)]
    if wanted:
        if sign_ins:
            wanted.append(SIGN_IN)
        clauses.append("(" + " || ".join(f"type = '{t}'" for t in wanted) + ")")
    elif not sign_ins:
        clauses.append(f"type != '{SIGN_IN}'")
    if actor and actor.strip():
        clauses.append(f'actor_email = "{pb_escape(actor.strip())}"')
    if q and q.strip():
        needle = pb_escape(q.strip())
        clauses.append("(" + " || ".join(f'{field} ~ "{needle}"' for field in SEARCHED_FIELDS) + ")")
    return " && ".join(clauses)


def _iso(value: Any) -> str:
    """The SDK parses `created` into a naive UTC datetime (seconds kept); send ISO-8601 Z."""
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%dT%H:%M:%SZ")
    return str(value or "")


def _json_object(value: Any) -> dict[str, Any] | None:
    return value if isinstance(value, dict) else None


def to_entry(record: Any) -> AuditLogEntry:
    return AuditLogEntry(
        id=record.id,
        created=_iso(record.created),
        type=record.type,
        action=record.action,
        actor_kind=record.actor_kind,
        actor_id=getattr(record, "actor_id", "") or "",
        actor_email=getattr(record, "actor_email", "") or "",
        actor_name=getattr(record, "actor_name", "") or "",
        collection=getattr(record, "collection", "") or "",
        record_id=getattr(record, "record_id", "") or "",
        target_label=getattr(record, "target_label", "") or "",
        before=_json_object(getattr(record, "before", None)),
        after=_json_object(getattr(record, "after", None)),
        fields=(getattr(record, "fields", "") or "").split(),
        session_id=getattr(record, "session_id", "") or "",
        detail=_json_object(getattr(record, "detail", None)),
        ip=getattr(record, "ip", "") or "",
    )


class AdminAuditLogService:
    def __init__(self, pb: Any) -> None:
        self.pb = pb

    async def list_page(
        self, *, types: Sequence[str], actor: str | None, q: str | None, sign_ins: bool, page: int, per_page: int
    ) -> AuditLogPage:
        query = {"filter": build_filter(types=types, actor=actor, q=q, sign_ins=sign_ins), "sort": "-created,-id"}
        result = await asyncio.to_thread(self.pb.collection(ADMIN_AUDIT_LOG).get_list, page, per_page, query)
        items = [to_entry(r) for r in result.items]
        await self._attach_view_as_ends(items)
        return AuditLogPage(items=items, page=page, per_page=per_page, total=result.total_items)

    async def _attach_view_as_ends(self, items: list[AuditLogEntry]) -> None:
        sessions = sorted({i.session_id for i in items if i.action == "view_as_start" and i.session_id})
        if not sessions:
            return
        either = " || ".join(f'session_id = "{pb_escape(s)}"' for s in sessions)
        stops = await asyncio.to_thread(
            self.pb.collection(ADMIN_AUDIT_LOG).get_full_list,
            batch=PAGE_SIZE,
            query_params={"filter": f"action = '{VIEW_AS_STOP}' && ({either})", "sort": "created"},
        )
        ended: dict[str, str] = {}
        for stop in stops:
            ended.setdefault(stop.session_id, _iso(stop.created))  # the first stop ends the session
        for item in items:
            if item.action == "view_as_start":
                item.ended = ended.get(item.session_id)

    async def list_actors(self) -> AuditLogActors:
        rows = await asyncio.to_thread(
            self.pb.collection(ADMIN_AUDIT_LOG).get_full_list,
            batch=PAGE_SIZE,
            query_params={"filter": 'actor_email != ""', "fields": "actor_email,actor_name", "sort": "-created"},
        )
        names: dict[str, str] = {}
        for row in rows:  # newest first: the most recent non-empty name wins
            email = row.actor_email
            if email not in names or (not names[email] and row.actor_name):
                names[email] = row.actor_name or ""
        actors = [AuditLogActor(email=email, name=name) for email, name in names.items()]
        actors.sort(key=lambda a: ((a.name or a.email).lower(), a.email))
        return AuditLogActors(actors=actors)

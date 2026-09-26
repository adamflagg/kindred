"""Board notes -- one staff Note per subject per session registration.

Layered plans (owner, 2026-09-25): a standard note (scenario '') shows on the
CampMinder live view and in every scenario of that session; inside a scenario
an optional plan-only note adds to it and never replaces it. "Keep on all
plans" (promote) is the only path from a plan to the standard note, and it
APPENDS. Creating a scenario from another scenario copies the source's
plan-only notes; deleting a scenario cascades them away in PocketBase.

`SubjectNoteStore` is the PocketBase I/O and the ONLY place a filter string is
spelled; `SubjectNoteService` holds the rules.
"""

import asyncio
from dataclasses import dataclass, replace
from datetime import datetime
from typing import Any

from api.schemas.subject_notes import SubjectNoteKey, SubjectNoteOut
from api.utils.pb_filters import pb_escape
from pocketbase import PocketBase

from ..constants.collections import SUBJECT_NOTES

# get_full_list pages with LIMIT/OFFSET; without a stable ORDER BY a row can be
# skipped or duplicated across pages (see api/routers/scenarios.py STABLE_SORT).
STABLE_SORT = "id"


@dataclass(frozen=True)
class NoteKey:
    subject_kind: str
    subject_cm_id: int
    session_cm_id: int
    year: int
    scenario: str

    @classmethod
    def of(cls, request: SubjectNoteKey) -> NoteKey:
        return cls(
            subject_kind=request.subject_kind,
            subject_cm_id=request.subject_cm_id,
            session_cm_id=request.session_cm_id,
            year=request.year,
            scenario=request.scenario,
        )

    def standard(self) -> NoteKey:
        return replace(self, scenario="")

    def row(self) -> dict[str, Any]:
        return {
            "subject_kind": self.subject_kind,
            "subject_cm_id": self.subject_cm_id,
            "session_cm_id": self.session_cm_id,
            "year": self.year,
            "scenario": self.scenario,
        }


def key_filter(key: NoteKey) -> str:
    return (
        f'subject_kind = "{key.subject_kind}" && subject_cm_id = {int(key.subject_cm_id)} '
        f"&& session_cm_id = {int(key.session_cm_id)} && year = {int(key.year)} "
        f'&& scenario = "{pb_escape(key.scenario)}"'
    )


def board_filter(session_cm_ids: list[int], year: int, scenario: str) -> str:
    sessions = " || ".join(f"session_cm_id = {int(s)}" for s in session_cm_ids)
    layers = 'scenario = ""' if not scenario else f'scenario = "" || scenario = "{pb_escape(scenario)}"'
    return f"year = {int(year)} && ({sessions}) && ({layers})"


def to_out(record: Any) -> SubjectNoteOut:
    updated = getattr(record, "updated", "")
    return SubjectNoteOut(
        subject_kind=str(getattr(record, "subject_kind", "")),
        subject_cm_id=int(getattr(record, "subject_cm_id", 0) or 0),
        session_cm_id=int(getattr(record, "session_cm_id", 0) or 0),
        scenario=str(getattr(record, "scenario", "") or ""),
        body=str(getattr(record, "body", "") or ""),
        updated_by=str(getattr(record, "updated_by", "") or ""),
        updated=updated.isoformat() if isinstance(updated, datetime) else str(updated or ""),
    )


class SubjectNoteStore:
    """subject_notes I/O. Every call goes through `asyncio.to_thread`: the SDK is sync."""

    def __init__(self, pb: PocketBase) -> None:
        self._pb = pb

    def _collection(self) -> Any:
        return self._pb.collection(SUBJECT_NOTES)

    async def _list(self, filter_str: str) -> list[Any]:
        rows = await asyncio.to_thread(
            self._collection().get_full_list,
            query_params={"filter": filter_str, "sort": STABLE_SORT},
        )
        return list(rows)

    async def find(self, key: NoteKey) -> Any | None:
        rows = await self._list(key_filter(key))
        return rows[0] if rows else None

    async def list_for(self, *, session_cm_ids: list[int], year: int, scenario: str) -> list[Any]:
        if not session_cm_ids:
            return []
        return await self._list(board_filter(session_cm_ids, year, scenario))

    async def list_plan_notes(self, scenario: str) -> list[Any]:
        return await self._list(f'scenario = "{pb_escape(scenario)}"')

    async def create(self, data: dict[str, Any]) -> Any:
        return await asyncio.to_thread(self._collection().create, data)

    async def update(self, record_id: str, data: dict[str, Any]) -> Any:
        return await asyncio.to_thread(self._collection().update, record_id, data)

    async def delete(self, record_id: str) -> None:
        await asyncio.to_thread(self._collection().delete, record_id)

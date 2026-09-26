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

from pocketbase.client import ClientResponseError  # type: ignore[attr-defined]

from api.schemas.subject_notes import (
    NOTE_BODY_MAX,
    SubjectNoteKey,
    SubjectNoteOut,
    SubjectNotePromoteRequest,
    SubjectNoteWriteRequest,
    SubjectNoteWriteResponse,
)
from api.utils.pb_error import pb_error_to_http
from api.utils.pb_filters import pb_escape
from api.utils.session_metrics import get_session_from_expand
from pocketbase import PocketBase

from ..constants.collections import SAVED_SCENARIOS, SUBJECT_NOTES
from .session_context import build_session_context

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


class SubjectNoteScopeError(ValueError):
    """The scenario does not belong to the note's session (HTTP 422)."""


class ScenarioNotFoundError(LookupError):
    """The named scenario does not exist (HTTP 404)."""


class NothingToPromoteError(LookupError):
    """There is no plan-only note to keep on all plans (HTTP 404)."""


class PromotedNoteTooLongError(ValueError):
    """Appending the plan-only note would pass the 2000-character cap (HTTP 422)."""


class SubjectNoteService:
    def __init__(self, pb: PocketBase, store: SubjectNoteStore | None = None) -> None:
        self._pb = pb
        self._store = store if store is not None else SubjectNoteStore(pb)

    async def validate_scope(self, *, session_cm_id: int, year: int, scenario: str) -> list[int]:
        """Refuse a note or a read whose scenario does not belong to its session.

        Returns `session_cm_id`'s session family (summer main + its AG
        sessions; any other session is a family of one) -- what a board read
        covers. `build_session_context` raises 404 for a session that does not
        exist in `year`.

        With a scenario: `saved_scenarios.session` is a PocketBase relation
        (there is no session_cm_id column), so the scenario's own session is
        expanded, its year must match, and `session_cm_id` must be in THAT
        session's family. This refuses a scenario selected for a different
        session -- the case `weekendScenario.ts` says nothing else on the
        server catches -- and an AG camper's note inside its main session's
        scenario passes, because AG is in main's family.
        """
        ctx = await build_session_context(session_cm_id, year, self._pb)
        if scenario:
            family = await self._scenario_family(scenario, year)
            if session_cm_id not in family:
                raise SubjectNoteScopeError(f"Scenario {scenario} belongs to a different session than {session_cm_id}")
        return list(ctx.related_session_ids)

    async def _scenario_family(self, scenario: str, year: int) -> list[int]:
        try:
            record = await asyncio.to_thread(
                self._pb.collection(SAVED_SCENARIOS).get_one, scenario, {"expand": "session"}
            )
        except ClientResponseError as exc:
            if exc.status == 404:
                raise ScenarioNotFoundError(f"Scenario {scenario} was not found") from exc
            raise
        session = get_session_from_expand(record)
        session_cm_id = int(getattr(session, "cm_id", 0) or 0) if session is not None else 0
        if session_cm_id <= 0:
            raise SubjectNoteScopeError(f"Scenario {scenario} names a session that no longer resolves")
        if int(getattr(record, "year", 0) or 0) != year:
            raise SubjectNoteScopeError(f"Scenario {scenario} is not a {year} scenario")
        ctx = await build_session_context(session_cm_id, year, self._pb)
        return list(ctx.related_session_ids)

    async def list_for_board(self, *, session_cm_id: int, year: int, scenario: str) -> list[SubjectNoteOut]:
        related = await self.validate_scope(session_cm_id=session_cm_id, year=year, scenario=scenario)
        rows = await self._store.list_for(session_cm_ids=related, year=year, scenario=scenario)
        return [to_out(row) for row in rows]

    async def save(self, request: SubjectNoteWriteRequest, *, updated_by: str) -> SubjectNoteWriteResponse:
        await self.validate_scope(session_cm_id=request.session_cm_id, year=request.year, scenario=request.scenario)
        return await self._write(NoteKey.of(request), request.body.strip(), updated_by)

    async def promote(self, request: SubjectNotePromoteRequest, *, updated_by: str) -> SubjectNoteWriteResponse:
        """ "Keep on all plans": APPEND the plan-only note to the standard note.

        The standard note is written BEFORE the plan-only row is deleted, so a
        failure between the two leaves the text in both places, never in
        neither.
        """
        await self.validate_scope(session_cm_id=request.session_cm_id, year=request.year, scenario=request.scenario)
        plan_key = NoteKey.of(request)
        plan = await self._store.find(plan_key)
        if plan is None:
            raise NothingToPromoteError(f"No plan-only note in scenario {request.scenario} to keep on all plans")
        moved = str(getattr(plan, "body", "") or "").strip()
        standard_key = plan_key.standard()
        standard = await self._store.find(standard_key)
        current = str(getattr(standard, "body", "") or "").strip() if standard is not None else ""
        merged = f"{current}\n\n{moved}" if current else moved
        if len(merged) > NOTE_BODY_MAX:
            raise PromotedNoteTooLongError(
                f"Keeping this on all plans would make the note {len(merged)} characters "
                f"(the limit is {NOTE_BODY_MAX}); shorten one of them first"
            )
        result = await self._write(standard_key, merged, updated_by)
        await self._delete_quietly(plan)
        return result

    async def copy_plan_notes(self, source_scenario: str, target_scenario: str) -> int:
        """Copy one scenario's plan-only notes onto a new scenario. Standard notes
        already show in every scenario, so they are never copied."""
        rows = await self._store.list_plan_notes(source_scenario)
        for row in rows:
            await self._store.create(
                {
                    "subject_kind": str(row.subject_kind),
                    "subject_cm_id": int(row.subject_cm_id),
                    "session_cm_id": int(row.session_cm_id),
                    "year": int(row.year),
                    "scenario": target_scenario,
                    "body": str(row.body),
                    "updated_by": str(getattr(row, "updated_by", "") or ""),
                }
            )
        return len(rows)

    async def _write(self, key: NoteKey, body: str, updated_by: str) -> SubjectNoteWriteResponse:
        existing = await self._store.find(key)
        if not body:
            if existing is not None:
                await self._delete_quietly(existing)
            return SubjectNoteWriteResponse(note=None, deleted=True)
        data = {**key.row(), "body": body, "updated_by": updated_by[:200]}
        if existing is not None:
            return SubjectNoteWriteResponse(
                note=to_out(await self._store.update(str(existing.id), data)), deleted=False
            )
        try:
            created = await self._store.create(data)
        except ClientResponseError as exc:
            # Two saves of the same key race: both find nothing, both create,
            # and the unique index refuses the loser with a 400. The loser
            # adopts the winner's row, which by construction is this key.
            if exc.status != 400:
                raise
            winner = await self._store.find(key)
            if winner is None:
                raise
            created = await self._store.update(str(winner.id), data)
        return SubjectNoteWriteResponse(note=to_out(created), deleted=False)

    async def _delete_quietly(self, record: Any) -> None:
        """Only "already gone" is swallowed; any other refusal keeps its status."""
        try:
            await self._store.delete(str(record.id))
        except ClientResponseError as exc:
            if exc.status != 404:
                raise pb_error_to_http(exc) from exc

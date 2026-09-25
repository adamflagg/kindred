"""PocketBase reads and writes for the Jotform admin (kindred#2759).

Through FastAPI's superuser client: the three tables are `bunking.manage`-read
and superuser-write in PocketBase, and the router gates every call on
`bunking.manage` before reaching here.

Every paged read ends its sort on `id`: `get_full_list` pages by LIMIT/OFFSET,
and without a total order a page boundary can skip or repeat a row.

The reads a weekend's Requests tab and its staff actions issue take an
optional `session_cm_id` (kindred#2839 follow-up): one weekend's rows alone,
still within the year. Omitted, they read the year, as the Manage tab's counts
and the board's picker do. Measured on the dev database, the year's answers
were ~90% of the queue's read time. The value is an int, never interpolated
from a string a client typed.
"""

from __future__ import annotations

import asyncio
from typing import Any

from api.constants.collections import (
    ATTENDEES,
    CAMP_SESSIONS,
    JOTFORM_ANSWERS,
    JOTFORM_FORMS,
    JOTFORM_SUBMISSIONS,
    LODGING_WRITE_INS,
    LODGING_WRITE_INS_DRAFT,
    SAVED_SCENARIOS,
)
from api.constants.filters import ACTIVE_ENROLLED_FILTER
from api.services.lodging_repository import ADULT_SESSION_TYPE, STABLE_SORT
from api.utils.pb_filters import pb_escape

PAGE_SIZE = 1000


def _weekend(field: str, session_cm_id: int | None) -> str:
    """The filter clause narrowing a year's read to one weekend, or "" for the year."""
    return "" if session_cm_id is None else f" && {field} = {int(session_cm_id)}"


class JotformRepository:
    def __init__(self, pb: Any) -> None:
        self.pb = pb

    async def _page(self, collection: str, query_params: dict[str, Any]) -> list[Any]:
        rows: list[Any] = await asyncio.to_thread(
            self.pb.collection(collection).get_full_list, batch=PAGE_SIZE, query_params=query_params
        )
        return rows

    async def fetch_adult_sessions(self, year: int) -> list[Any]:
        """The active season's adult weekends -- built dynamically, never a hardcoded list."""
        return await self._page(
            CAMP_SESSIONS,
            query_params={
                "filter": f"year = {year} && session_type = '{ADULT_SESSION_TYPE}'",
                "sort": f"start_date,{STABLE_SORT}",
            },
        )

    async def fetch_forms(self, year: int) -> list[Any]:
        return await self._page(JOTFORM_FORMS, query_params={"filter": f"year = {year}", "sort": STABLE_SORT})

    async def fetch_submissions(self, year: int, *, session_cm_id: int | None = None) -> list[Any]:
        return await self._page(
            JOTFORM_SUBMISSIONS,
            query_params={
                "filter": f"year = {year} && jotform_status != 'DELETED'" + _weekend("session_cm_id", session_cm_id),
                "sort": f"submitted_at,{STABLE_SORT}",
            },
        )

    async def fetch_answers(self, year: int, *, session_cm_id: int | None = None) -> list[Any]:
        return await self._page(
            JOTFORM_ANSWERS,
            query_params={
                "filter": f"submission.year = {year} && submission.jotform_status != 'DELETED'"
                + _weekend("submission.session_cm_id", session_cm_id),
                "fields": "submission,question_id,question_text,question_type,answer_text,answer_json,order",
                "sort": STABLE_SORT,
            },
        )

    async def fetch_enrolled_guests(self, year: int, *, session_cm_id: int | None = None) -> list[Any]:
        return await self._page(
            ATTENDEES,
            query_params={
                "filter": f"year = {year} && {ACTIVE_ENROLLED_FILTER} && session.session_type = '{ADULT_SESSION_TYPE}'"
                + _weekend("session.cm_id", session_cm_id),
                "expand": "person,session",
                "sort": STABLE_SORT,
            },
        )

    async def upsert_form(
        self,
        *,
        year: int,
        session_cm_id: int,
        form_id: str,
        field_map: dict[str, str],
        field_map_meta: dict[str, dict[str, str]],
        enabled: bool,
        clear_definition: bool = False,
    ) -> Any:
        """`clear_definition` drops the questions snapshot and title the pull
        stored, for a weekend repointed at a different form."""
        existing = await self._page(
            JOTFORM_FORMS,
            query_params={"filter": f"year = {year} && session_cm_id = {session_cm_id}", "sort": STABLE_SORT},
        )
        body: dict[str, Any] = {
            "year": year,
            "session_cm_id": session_cm_id,
            "form_id": form_id,
            "field_map": field_map,
            "field_map_meta": field_map_meta,
            "enabled": enabled,
        }
        if clear_definition:
            body.update({"questions": None, "form_title": ""})
        collection = self.pb.collection(JOTFORM_FORMS)
        if existing:
            return await asyncio.to_thread(collection.update, existing[0].id, body)
        return await asyncio.to_thread(collection.create, body)

    async def fetch_submission(self, submission_id: str) -> Any | None:
        rows = await self._page(
            JOTFORM_SUBMISSIONS,
            query_params={"filter": f"submission_id = '{pb_escape(submission_id)}'", "sort": STABLE_SORT},
        )
        return rows[0] if rows else None

    async def update_submission(self, record_id: str, body: dict[str, Any]) -> None:
        await asyncio.to_thread(self.pb.collection(JOTFORM_SUBMISSIONS).update, record_id, body)

    # --- Board write-ins (kindred#2759 follow-up) ------------------------------
    #
    # Read year-wide for the year's queue, which offers every adult weekend's at
    # once; a weekend's Requests tab and a write-in link pass `session_cm_id`
    # and read that weekend's alone (see the module docstring).

    async def fetch_live_write_ins(self, year: int, *, session_cm_id: int | None = None) -> list[Any]:
        return await self._page(
            LODGING_WRITE_INS,
            query_params={
                "filter": f"year = {year}" + _weekend("session_cm_id", session_cm_id),
                "expand": "unit",
                "sort": STABLE_SORT,
            },
        )

    async def fetch_draft_write_ins(self, year: int, *, session_cm_id: int | None = None) -> list[Any]:
        """Every scenario's write-ins: a link is to the write-in wherever it
        appears, so a write-in made inside a scenario can be linked too."""
        return await self._page(
            LODGING_WRITE_INS_DRAFT,
            query_params={
                "filter": f"year = {year}" + _weekend("session_cm_id", session_cm_id),
                "expand": "unit",
                "sort": STABLE_SORT,
            },
        )

    async def fetch_weekend_scenarios(self, year: int, session_cm_id: int) -> list[Any]:
        """One weekend's saved scenarios (kindred#2828 ruling 2026-09-25). The
        Requests tab checks its `?scenario=` against these -- a scenario of
        another weekend, or none at all, is refused -- and names the scenario a
        filing is linked in. Both terms are numbers: nothing client-supplied is
        interpolated."""
        return await self._page(
            SAVED_SCENARIOS,
            query_params={"filter": f"year = {year} && session.cm_id = {session_cm_id}", "sort": STABLE_SORT},
        )

    async def set_write_in_key(self, table: str, record_id: str, key: str) -> None:
        """Stamp a write-in row with its link key. A PATCH of that one field, so
        nothing else on the row moves."""
        if table not in (LODGING_WRITE_INS, LODGING_WRITE_INS_DRAFT):
            raise ValueError(f"not a write-in table: {table}")
        await asyncio.to_thread(self.pb.collection(table).update, record_id, {"write_in_key": key})

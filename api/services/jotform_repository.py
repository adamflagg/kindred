"""PocketBase reads and writes for the Jotform admin (kindred#2759).

Through FastAPI's superuser client: the three tables are `bunking.manage`-read
and superuser-write in PocketBase, and the router gates every call on
`bunking.manage` before reaching here.

Every paged read ends its sort on `id`: `get_full_list` pages by LIMIT/OFFSET,
and without a total order a page boundary can skip or repeat a row.
"""

from __future__ import annotations

import asyncio
from typing import Any

from api.constants.collections import ATTENDEES, CAMP_SESSIONS, JOTFORM_ANSWERS, JOTFORM_FORMS, JOTFORM_SUBMISSIONS
from api.constants.filters import ACTIVE_ENROLLED_FILTER
from api.services.lodging_repository import ADULT_SESSION_TYPE, STABLE_SORT
from api.utils.pb_filters import pb_escape

PAGE_SIZE = 1000


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

    async def fetch_submissions(self, year: int) -> list[Any]:
        return await self._page(
            JOTFORM_SUBMISSIONS,
            query_params={
                "filter": f"year = {year} && jotform_status != 'DELETED'",
                "sort": f"submitted_at,{STABLE_SORT}",
            },
        )

    async def fetch_answers(self, year: int) -> list[Any]:
        return await self._page(
            JOTFORM_ANSWERS,
            query_params={
                "filter": f"submission.year = {year} && submission.jotform_status != 'DELETED'",
                "fields": "submission,question_id,question_text,question_type,answer_text,answer_json,order",
                "sort": STABLE_SORT,
            },
        )

    async def fetch_enrolled_guests(self, year: int) -> list[Any]:
        return await self._page(
            ATTENDEES,
            query_params={
                "filter": f"year = {year} && {ACTIVE_ENROLLED_FILTER} && session.session_type = '{ADULT_SESSION_TYPE}'",
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

"""
ID Translation Cache Service.

Provides efficient CM ID <-> PB ID translations with caching.
"""

from __future__ import annotations

import asyncio
import logging

from pocketbase import PocketBase

logger = logging.getLogger(__name__)


class IDLookupCache:
    """
    Cache for CM ID <-> PB ID translations.

    The bunk_assignments_draft table uses PocketBase relation IDs, but the solver
    works internally with CampMinder IDs. This class provides efficient translation
    between the two ID systems with caching to minimize database queries.
    """

    def __init__(self, pb_client: PocketBase, year: int):
        self.pb = pb_client
        self.year = year
        self._person_cm_to_pb: dict[int, str] = {}
        self._person_pb_to_cm: dict[str, int] = {}
        self._bunk_cm_to_pb: dict[int, str] = {}
        self._bunk_pb_to_cm: dict[str, int] = {}
        self._session_cm_to_pb: dict[int, str] = {}
        self._session_pb_to_cm: dict[str, int] = {}
        self._bunk_plan_cache: dict[tuple[int, int, int], str] = {}  # (bunk_cm_id, session_cm_id, year) -> pb_id

    async def get_person_pb_id(self, cm_id: int) -> str | None:
        """Get PocketBase ID for a person from CampMinder ID."""
        if cm_id in self._person_cm_to_pb:
            return self._person_cm_to_pb[cm_id]

        persons = await asyncio.to_thread(
            self.pb.collection("persons").get_full_list,
            query_params={"filter": f"cm_id = {cm_id} && year = {self.year}"},
        )
        if persons:
            pb_id = persons[0].id
            self._person_cm_to_pb[cm_id] = pb_id
            self._person_pb_to_cm[pb_id] = cm_id
            return pb_id
        return None

    async def get_bunk_pb_id(self, cm_id: int) -> str | None:
        """Get PocketBase ID for a bunk from CampMinder ID."""
        if cm_id in self._bunk_cm_to_pb:
            return self._bunk_cm_to_pb[cm_id]

        bunks = await asyncio.to_thread(
            self.pb.collection("bunks").get_full_list,
            query_params={"filter": f"cm_id = {cm_id} && year = {self.year}"},
        )
        if bunks:
            pb_id = bunks[0].id
            self._bunk_cm_to_pb[cm_id] = pb_id
            self._bunk_pb_to_cm[pb_id] = cm_id
            return pb_id
        return None

    async def get_session_pb_id(self, cm_id: int) -> str | None:
        """Get PocketBase ID for a session from CampMinder ID and year."""
        if cm_id in self._session_cm_to_pb:
            return self._session_cm_to_pb[cm_id]

        sessions = await asyncio.to_thread(
            self.pb.collection("camp_sessions").get_full_list,
            query_params={"filter": f"cm_id = {cm_id} && year = {self.year}"},
        )
        if sessions:
            pb_id = sessions[0].id
            self._session_cm_to_pb[cm_id] = pb_id
            self._session_pb_to_cm[pb_id] = cm_id
            return pb_id
        return None

    async def get_person_cm_id(self, pb_id: str) -> int | None:
        """Get CampMinder ID for a person from PocketBase ID."""
        if pb_id in self._person_pb_to_cm:
            return self._person_pb_to_cm[pb_id]

        try:
            person = await asyncio.to_thread(self.pb.collection("persons").get_one, pb_id)
            cm_id_val = getattr(person, "cm_id", None)
            if cm_id_val is None:
                return None
            cm_id = int(cm_id_val)
            self._person_pb_to_cm[pb_id] = cm_id
            self._person_cm_to_pb[cm_id] = pb_id
            return cm_id
        except Exception:
            return None

    async def get_bunk_cm_id(self, pb_id: str) -> int | None:
        """Get CampMinder ID for a bunk from PocketBase ID."""
        if pb_id in self._bunk_pb_to_cm:
            return self._bunk_pb_to_cm[pb_id]

        try:
            bunk = await asyncio.to_thread(self.pb.collection("bunks").get_one, pb_id)
            cm_id_val = getattr(bunk, "cm_id", None)
            if cm_id_val is None:
                return None
            cm_id = int(cm_id_val)
            self._bunk_pb_to_cm[pb_id] = cm_id
            self._bunk_cm_to_pb[cm_id] = pb_id
            return cm_id
        except Exception:
            return None

    async def get_session_cm_id(self, pb_id: str) -> int | None:
        """Get CampMinder ID for a session from PocketBase ID."""
        if pb_id in self._session_pb_to_cm:
            return self._session_pb_to_cm[pb_id]

        try:
            session = await asyncio.to_thread(self.pb.collection("camp_sessions").get_one, pb_id)
            cm_id_val = getattr(session, "cm_id", None)
            if cm_id_val is None:
                return None
            cm_id = int(cm_id_val)
            self._session_pb_to_cm[pb_id] = cm_id
            self._session_cm_to_pb[cm_id] = pb_id
            return cm_id
        except Exception:
            return None

    async def batch_load_persons(self, session_cm_id: int, year: int) -> None:
        """Pre-load person mappings for all attendees in a session."""
        try:
            attendees = await asyncio.to_thread(
                self.pb.collection("attendees").get_full_list,
                query_params={"filter": f"session_cm_id = {session_cm_id} && year = {year}", "expand": "person"},
            )
            for attendee in attendees:
                if hasattr(attendee, "expand") and attendee.expand and "person" in attendee.expand:
                    person = attendee.expand["person"]
                    self._person_cm_to_pb[person.cm_id] = person.id
                    self._person_pb_to_cm[person.id] = person.cm_id
            logger.info(f"Batch loaded {len(self._person_cm_to_pb)} person mappings for session {session_cm_id}")
        except Exception as e:
            logger.error(f"Error batch loading persons: {e}")

    async def batch_load_bunks(self, session_cm_id: int, year: int) -> None:
        """Pre-load bunk mappings for all bunks in a session's bunk plans."""
        try:
            bunk_plans = await asyncio.to_thread(
                self.pb.collection("bunk_plans").get_full_list,
                query_params={"filter": f"session_cm_id = {session_cm_id} && year = {year}", "expand": "bunk"},
            )
            for plan in bunk_plans:
                if hasattr(plan, "expand") and plan.expand and "bunk" in plan.expand:
                    bunk = plan.expand["bunk"]
                    self._bunk_cm_to_pb[bunk.cm_id] = bunk.id
                    self._bunk_pb_to_cm[bunk.id] = bunk.cm_id
                    # Also cache the bunk_plan lookup
                    self._bunk_plan_cache[(bunk.cm_id, session_cm_id, year)] = plan.id
            logger.info(f"Batch loaded {len(self._bunk_cm_to_pb)} bunk mappings for session {session_cm_id}")
        except Exception as e:
            logger.error(f"Error batch loading bunks: {e}")

    async def get_bunk_plan_id(self, bunk_cm_id: int, session_cm_id: int, year: int) -> str | None:
        """Get PocketBase ID for a bunk_plan from bunk CM ID, session CM ID, and year.

        Uses PB ID lookups since relation filters (bunk.cm_id) don't work reliably.
        """
        cache_key = (bunk_cm_id, session_cm_id, year)
        if cache_key in self._bunk_plan_cache:
            return self._bunk_plan_cache[cache_key]

        # First resolve the PB IDs for bunk and session
        bunk_pb_id = await self.get_bunk_pb_id(bunk_cm_id)
        session_pb_id = await self.get_session_pb_id(session_cm_id)

        if not bunk_pb_id or not session_pb_id:
            logger.warning(
                f"Cannot lookup bunk_plan: bunk_pb_id={bunk_pb_id}, session_pb_id={session_pb_id} "
                f"for bunk_cm={bunk_cm_id}, session_cm={session_cm_id}"
            )
            return None

        # Look up the bunk_plan using PB IDs
        try:
            plans = await asyncio.to_thread(
                self.pb.collection("bunk_plans").get_full_list,
                query_params={"filter": f'bunk = "{bunk_pb_id}" && session = "{session_pb_id}" && year = {year}'},
            )
            if plans:
                pb_id = plans[0].id
                self._bunk_plan_cache[cache_key] = pb_id
                return pb_id
            else:
                logger.warning(f"No bunk_plan found for bunk={bunk_pb_id}, session={session_pb_id}, year={year}")
        except Exception as e:
            logger.error(f"Error looking up bunk_plan: {e}")
        return None

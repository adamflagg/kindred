"""
Data Fetcher Service - Functions for fetching and preparing solver data.

This service handles:
- Fetching session data from PocketBase
- Preparing input for the DirectBunkingSolver
"""

from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from typing import Any

from fastapi import HTTPException
from pocketbase.client import ClientResponseError  # type: ignore[attr-defined]

from bunking.direct_solver import (
    DirectBunk,
    DirectBunkAssignment,
    DirectBunkRequest,
    DirectPerson,
    DirectSolverInput,
    HistoricalBunkingRecord,
)
from pocketbase import PocketBase

from ..dependencies import pb
from .session_context import build_session_context

logger = logging.getLogger(__name__)


async def fetch_session_data_v2(
    session_cm_id: int,
    year: int,
    pb_client: PocketBase | None = None,
    scenario: str | None = None,
) -> tuple[list[Any], list[Any], list[Any], list[Any], list[Any]]:
    """Fetch all data needed for solving from PocketBase using V2 schema.

    Args:
        session_cm_id: CampMinder session ID
        year: Year for scoping the data (required)
        pb_client: Optional PocketBase client (defaults to global)
        scenario: Optional PocketBase ID of saved_scenario - when provided, reads
                  assignments from bunk_assignments_draft instead of bunk_assignments

    Returns:
        Tuple of (attendees, bunks, requests, assignments, bunk_plans)
    """
    client = pb_client or pb
    try:
        # Build session context (validates session exists for year, provides pre-built filters)
        ctx = await build_session_context(session_cm_id, year, client)
        logger.info(f"Session {ctx.session_cm_id} - Found related sessions: {ctx.related_session_ids}")

        # Use pre-built filters from SessionContext
        session_relation_filter = ctx.session_relation_filter
        session_id_filter = ctx.session_id_filter

        # Fetch attendees for all related sessions
        attendees = await asyncio.to_thread(
            client.collection("attendees").get_full_list,
            query_params={
                "filter": f'({session_relation_filter}) && status = "enrolled" && year = {ctx.year}',
                "expand": "session",
            },
        )

        # Log attendee counts by session
        attendees_by_session: defaultdict[int, int] = defaultdict(int)
        for attendee in attendees:
            session_cm_id_val = (
                getattr(attendee.expand.get("session"), "cm_id", None)
                if hasattr(attendee, "expand") and attendee.expand
                else None
            )
            if session_cm_id_val:
                attendees_by_session[session_cm_id_val] += 1
        logger.info(f"Fetched {len(attendees)} total attendees: {dict(attendees_by_session)}")

        # Fetch bunk plans for all related sessions
        bunk_plans = await asyncio.to_thread(
            client.collection("bunk_plans").get_full_list,
            query_params={"filter": f"({session_relation_filter}) && year = {ctx.year}", "expand": "bunk,session"},
        )

        # Get unique bunk CampMinder IDs from expanded relation
        bunk_cm_ids = []
        for plan in bunk_plans:
            if hasattr(plan, "expand") and plan.expand:
                bunk = plan.expand.get("bunk")
                if bunk and hasattr(bunk, "cm_id"):
                    bunk_cm_ids.append(bunk.cm_id)
        bunk_cm_ids = list(set(bunk_cm_ids))

        # Fetch bunks by CampMinder IDs (with year filter to avoid cross-year duplicates)
        bunks_list = []
        if bunk_cm_ids:
            filter_str = " || ".join([f"cm_id = {cm_id}" for cm_id in bunk_cm_ids])
            bunks_list = await asyncio.to_thread(
                client.collection("bunks").get_full_list,
                query_params={"filter": f"({filter_str}) && year = {ctx.year}"},
            )

        # Get person CampMinder IDs from attendees
        person_cm_ids = [getattr(a, "person_id", None) for a in attendees if getattr(a, "person_id", None)]

        # Fetch persons using CampMinder IDs (with year filter)
        persons_dict = {}
        batch_size = 50
        if person_cm_ids:
            for i in range(0, len(person_cm_ids), batch_size):
                batch_ids = person_cm_ids[i : i + batch_size]
                filter_str = " || ".join([f"cm_id = {cm_id}" for cm_id in batch_ids])
                batch_persons = await asyncio.to_thread(
                    client.collection("persons").get_full_list,
                    query_params={"filter": f"({filter_str}) && year = {ctx.year}"},
                )
                for person in batch_persons:
                    persons_dict[getattr(person, "cm_id", 0)] = person

        # Attach persons to attendees for compatibility
        for attendee in attendees:
            person_id = getattr(attendee, "person_id", None)
            if person_id and person_id in persons_dict:
                if not hasattr(attendee, "expand"):
                    attendee.expand = {}
                attendee.expand["person"] = persons_dict[person_id]

        # Fetch bunk requests
        requests = []
        if person_cm_ids:
            for i in range(0, len(person_cm_ids), batch_size):
                batch_ids = person_cm_ids[i : i + batch_size]
                filter_str = " || ".join([f"requester_id = {cm_id}" for cm_id in batch_ids])
                batch_requests = await asyncio.to_thread(
                    client.collection("bunk_requests").get_full_list,
                    query_params={
                        "filter": f'({filter_str}) && ({session_id_filter}) && year = {ctx.year} && status = "resolved"',
                    },
                )
                requests.extend(batch_requests)

        # Fetch bunk assignments - from draft table if scenario provided, else production
        assignments = []
        assignments_collection = "bunk_assignments_draft" if scenario else "bunk_assignments"
        if person_cm_ids:
            for i in range(0, len(person_cm_ids), batch_size):
                batch_ids = person_cm_ids[i : i + batch_size]
                filter_str = " || ".join([f"person.cm_id = {cm_id}" for cm_id in batch_ids])
                # Add scenario filter for draft assignments
                base_filter = f"({filter_str}) && ({session_relation_filter}) && year = {ctx.year}"
                if scenario:
                    base_filter += f' && scenario = "{scenario}"'
                batch_assignments = await asyncio.to_thread(
                    client.collection(assignments_collection).get_full_list,
                    query_params={
                        "filter": base_filter,
                        "expand": "person,session,bunk",
                    },
                )
                assignments.extend(batch_assignments)
        logger.info(f"Fetched {len(assignments)} assignments from {assignments_collection}")

        return attendees, bunks_list, requests, assignments, bunk_plans

    except ClientResponseError as e:
        logger.error(f"Failed to fetch session data for CM ID {session_cm_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to fetch session data: {str(e)}")


async def fetch_historical_bunking(
    session_cm_id: int,
    current_year: int,
    pb_client: PocketBase | None = None,
) -> list[HistoricalBunkingRecord]:
    """Fetch prior year bunk assignments for same session (1 year back).

    Used by the level_progression constraint to ensure returning campers
    don't regress to lower bunk levels.

    Args:
        session_cm_id: CampMinder session ID
        current_year: The current year we're solving for
        pb_client: Optional PocketBase client (defaults to global)

    Returns:
        List of HistoricalBunkingRecord with person_cm_id and bunk_name
    """
    client = pb_client or pb
    prior_year = current_year - 1

    try:
        # Fetch prior year assignments for this session
        # Note: We use session.cm_id because session IDs are reused across years
        assignments = await asyncio.to_thread(
            client.collection("bunk_assignments").get_full_list,
            query_params={
                "filter": f"session.cm_id = {session_cm_id} && year = {prior_year}",
                "expand": "person,bunk",
            },
        )

        historical_records = []
        for assignment in assignments:
            expand = getattr(assignment, "expand", {}) or {}

            # Get person cm_id from expanded relation
            person_data = expand.get("person") if isinstance(expand, dict) else getattr(expand, "person", None)
            person_cm_id = person_data.cm_id if person_data and hasattr(person_data, "cm_id") else None

            # Get bunk name from expanded relation
            bunk_data = expand.get("bunk") if isinstance(expand, dict) else getattr(expand, "bunk", None)
            bunk_name = bunk_data.name if bunk_data and hasattr(bunk_data, "name") else None

            if person_cm_id and bunk_name:
                historical_records.append(
                    HistoricalBunkingRecord(
                        person_cm_id=person_cm_id,
                        bunk_name=bunk_name,
                        year=prior_year,
                    )
                )

        logger.info(
            f"Fetched {len(historical_records)} historical bunking records "
            f"for session {session_cm_id}, year {prior_year}"
        )
        return historical_records

    except ClientResponseError as e:
        logger.warning(f"Failed to fetch historical bunking for session {session_cm_id}: {e}")
        # Return empty list on error - historical data is optional
        return []


def prepare_direct_solver_input(
    attendees: list[Any],
    bunks: list[Any],
    requests: list[Any],
    assignments: list[Any],
    bunk_plans: list[Any],
    historical_bunking: list[HistoricalBunkingRecord] | None = None,
) -> DirectSolverInput:
    """Prepare data for direct solver without transformation.

    Args:
        attendees: List of attendee records
        bunks: List of bunk records
        requests: List of bunk request records
        assignments: List of existing assignment records
        bunk_plans: List of bunk plan records
        historical_bunking: Optional list of prior year bunk assignments for level progression
    """
    # Create DirectPerson objects from attendees
    persons = []
    person_cm_id_set = set()

    for attendee in attendees:
        expand = getattr(attendee, "expand", {}) or {}

        # Handle expand as either dict or object
        person = None
        if isinstance(expand, dict) and "person" in expand:
            person = expand["person"]
        elif hasattr(expand, "person"):
            person = expand.person

        if not person:
            logger.warning(f"Attendee {attendee.id} missing person data")
            continue

        person_cm_id = getattr(attendee, "person_id", None)

        if not person_cm_id or person_cm_id in person_cm_id_set:
            continue

        person_cm_id_set.add(person_cm_id)

        # Get session cm_id from expanded session relation
        session_cm_id_val = None
        session_data = expand.get("session") if isinstance(expand, dict) else getattr(expand, "session", None)
        if session_data and hasattr(session_data, "cm_id"):
            session_cm_id_val = session_data.cm_id

        direct_person = DirectPerson(
            campminder_person_id=person_cm_id,
            first_name=getattr(person, "first_name", ""),
            last_name=getattr(person, "last_name", ""),
            grade=getattr(person, "grade", 0),
            birthdate=getattr(person, "birthdate", ""),
            gender=getattr(person, "gender", None),
            friend_group_id=None,
            session_cm_id=session_cm_id_val if session_cm_id_val is not None else 0,
        )
        persons.append(direct_person)

    # Determine which sessions are AG sessions based on session_type field
    session_ids_in_data = set()
    ag_session_ids = set()
    for attendee in attendees:
        expand = getattr(attendee, "expand", {}) or {}
        session_data = expand.get("session") if isinstance(expand, dict) else getattr(expand, "session", None)
        if session_data and hasattr(session_data, "cm_id"):
            session_ids_in_data.add(session_data.cm_id)
            session_type = getattr(session_data, "session_type", "")
            if session_type == "ag":
                ag_session_ids.add(session_data.cm_id)

    logger.info(f"Processing sessions: {session_ids_in_data}")
    logger.info(f"Identified AG sessions (by session_type): {ag_session_ids}")

    # Create bunk_cm_id to session_cm_id mapping from bunk_plans
    bunk_to_session: dict[int, list[int]] = {}
    for plan in bunk_plans:
        expand = getattr(plan, "expand", {}) or {}
        bunk_data = expand.get("bunk") if isinstance(expand, dict) else getattr(expand, "bunk", None)
        bunk_cm_id = bunk_data.cm_id if bunk_data and hasattr(bunk_data, "cm_id") else None
        session_data = expand.get("session") if isinstance(expand, dict) else getattr(expand, "session", None)
        session_cm_id_val = session_data.cm_id if session_data and hasattr(session_data, "cm_id") else None
        if bunk_cm_id and session_cm_id_val:
            if bunk_cm_id not in bunk_to_session:
                bunk_to_session[bunk_cm_id] = []
            bunk_to_session[bunk_cm_id].append(session_cm_id_val)

    # Create DirectBunk objects with session information
    direct_bunks = []
    for bunk in bunks:
        bunk_sessions = bunk_to_session.get(bunk.cm_id, [])
        if not bunk_sessions:
            logger.warning(f"Bunk {bunk.name} (CM ID: {bunk.cm_id}) has no session mapping")
            continue

        is_ag_bunk = "AG" in bunk.name or "ag" in bunk.name.lower()

        for session_cm_id in bunk_sessions:
            is_ag_session = session_cm_id in ag_session_ids

            if is_ag_bunk and not is_ag_session:
                logger.debug(f"Skipping AG bunk {bunk.name} for non-AG session {session_cm_id}")
                continue
            if not is_ag_bunk and is_ag_session:
                logger.debug(f"Skipping non-AG bunk {bunk.name} for AG session {session_cm_id}")
                continue

            direct_bunks.append(
                DirectBunk(
                    id=bunk.id,
                    campminder_id=bunk.cm_id,
                    name=bunk.name,
                    capacity=getattr(bunk, "max_size", 12),
                    area=getattr(bunk, "area", None),
                    gender=getattr(bunk, "gender", None),
                    session_cm_id=session_cm_id,
                )
            )

    # Create DirectBunkRequest objects
    direct_requests = [
        DirectBunkRequest(
            id=req.id,
            requester_person_cm_id=req.requester_id,
            requested_person_cm_id=getattr(req, "requestee_id", None),
            request_type=req.request_type,
            priority=getattr(req, "priority", 5),
            session_cm_id=req.session_id,
            year=req.year,
            confidence_score=getattr(req, "confidence_score", 0.0),
            status=getattr(req, "status", "pending"),
            original_text=getattr(req, "original_text", None),
            age_preference_target=getattr(req, "age_preference_target", None),
            friend_group_id=getattr(req, "friend_group_id", None),
            source_field=getattr(req, "source_field", None),
        )
        for req in requests
    ]

    # Create DirectBunkAssignment objects for existing assignments
    direct_assignments = []
    for assignment in assignments:
        expand = getattr(assignment, "expand", {}) or {}
        person_data = expand.get("person") if isinstance(expand, dict) else getattr(expand, "person", None)
        person_cm_id = person_data.cm_id if person_data and hasattr(person_data, "cm_id") else None
        session_data = expand.get("session") if isinstance(expand, dict) else getattr(expand, "session", None)
        session_cm_id_val = session_data.cm_id if session_data and hasattr(session_data, "cm_id") else None
        bunk_data = expand.get("bunk") if isinstance(expand, dict) else getattr(expand, "bunk", None)
        bunk_cm_id = bunk_data.cm_id if bunk_data and hasattr(bunk_data, "cm_id") else None

        if person_cm_id and session_cm_id_val and bunk_cm_id:
            direct_assignments.append(
                DirectBunkAssignment(
                    person_cm_id=person_cm_id,
                    session_cm_id=session_cm_id_val,
                    bunk_cm_id=bunk_cm_id,
                    year=assignment.year,
                    is_locked=getattr(assignment, "is_locked", False),
                )
            )

    return DirectSolverInput(
        persons=persons,
        requests=direct_requests,
        bunks=direct_bunks,
        existing_assignments=direct_assignments,
        historical_bunking=historical_bunking or [],
    )

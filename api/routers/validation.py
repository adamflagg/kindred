"""
Validation Router - Bunking validation endpoints.

This router provides endpoints for validating bunking assignments
against constraints and rules.
"""

from __future__ import annotations

import asyncio
import logging
import os
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException
from pocketbase.client import ClientResponseError  # type: ignore[attr-defined]

from bunking.bunking_validator import BunkingValidator, HistoricalBunkingRecord
from bunking.models import (
    Bunk,
    BunkAssignment,
    BunkRequest,
    Person,
    Session,
)

from ..dependencies import pb
from ..schemas import ValidateBunkingRequest
from ..services.session_context import build_session_context

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["validation"])


@dataclass
class BunkPlanData:
    """Data class for bunk plan validation."""

    session_cm_id: int
    bunk_cm_id: int


@dataclass
class AttendeeData:
    """Data class for attendee validation."""

    person_cm_id: int
    session_cm_id: int


def calculate_age(birthdate_str: str) -> float:
    """Calculate age in CampMinder format (years.months)."""
    if not birthdate_str:
        return 0.0
    try:
        from datetime import date

        birthdate = datetime.fromisoformat(birthdate_str.replace("Z", "+00:00")).date()
        today = date.today()

        years = today.year - birthdate.year
        months = today.month - birthdate.month

        if months < 0 or (months == 0 and today.day < birthdate.day):
            years -= 1
            months += 12

        if today.day < birthdate.day:
            months -= 1
            if months < 0:
                months = 11

        # Return in CampMinder format: 12.02 for 12 years, 2 months
        return years + (months / 100)
    except Exception as e:
        logger.error(f"Error calculating age from {birthdate_str}: {e}")
        return 0.0


@router.post("/validate-bunking")
async def validate_bunking(request: ValidateBunkingRequest) -> dict[str, Any]:
    """Validate current bunking assignments for a session."""
    try:
        logger.info(f"Validate bunking request received: {request}")

        # Build session context from request (validates session exists for year)
        ctx = await build_session_context(request.session_cm_id, request.year, pb)
        logger.info(f"Session {ctx.session_cm_id} - Found related sessions: {ctx.related_session_ids}")

        # Create Session model object for the validator
        session = Session(
            id=ctx.session_pb_id,
            campminder_id=str(ctx.session_cm_id),
            name=ctx.session_name,
            session_type=ctx.session_type,
            start_date=None,  # Validator doesn't use dates
            end_date=None,
            year=ctx.year,
        )

        # Use pre-built filter from SessionContext for relation fields
        session_relation_filter = ctx.session_pb_id_filter

        # Fetch bunk plans for all related sessions (expand bunk relation)
        bunk_plans_data = await asyncio.to_thread(
            pb.collection("bunk_plans").get_full_list,
            query_params={"filter": f"({session_relation_filter}) && year = {ctx.year}", "expand": "bunk"},
        )

        # Extract unique bunk CampMinder IDs from expanded plans
        bunk_cm_ids = []
        for plan in bunk_plans_data:
            expand = getattr(plan, "expand", {}) or {}
            bunk_data = expand.get("bunk") if isinstance(expand, dict) else getattr(expand, "bunk", None)
            if bunk_data and hasattr(bunk_data, "cm_id"):
                bunk_cm_ids.append(bunk_data.cm_id)
        bunk_cm_ids = list(set(bunk_cm_ids))

        # Fetch bunks using the CampMinder IDs (with year filter to avoid duplicates)
        bunks_data = []
        if bunk_cm_ids:
            bunk_filter = " || ".join(f"cm_id = {cm_id}" for cm_id in bunk_cm_ids)
            bunks_data = await asyncio.to_thread(
                pb.collection("bunks").get_full_list,
                query_params={"filter": f"({bunk_filter}) && year = {ctx.year}"},
            )

        # Build bunk list from year-filtered query
        bunks = []
        logger.info(f"Fetched {len(bunks_data)} bunks for year {ctx.year}")
        for bunk_data in bunks_data:
            bunk = Bunk(
                id=bunk_data.id,
                campminder_id=str(getattr(bunk_data, "cm_id", "")),
                name=getattr(bunk_data, "name", ""),
                area=getattr(bunk_data, "area", None),
                division_cm_id=str(getattr(bunk_data, "division_id", None))
                if getattr(bunk_data, "division_id", None)
                else None,
                max_size=getattr(bunk_data, "max_size", 12),
                is_locked=getattr(bunk_data, "is_locked", False),
            )
            bunks.append(bunk)

        # Fetch active enrolled attendees for all related sessions
        # Filter: is_active = 1 AND status_id = 2 (enrolled status)
        # See CLAUDE.md "Attendee Active Status Filtering"
        attendees_data = await asyncio.to_thread(
            pb.collection("attendees").get_full_list,
            query_params={
                "filter": f"({session_relation_filter}) && year = {ctx.year} && is_active = 1 && status_id = 2",
                "expand": "session",
            },
        )

        # Extract person CampMinder IDs from attendees
        person_cm_ids: list[int] = [
            int(getattr(attendee, "person_id", 0))
            for attendee in attendees_data
            if getattr(attendee, "person_id", None) is not None
        ]
        person_cm_ids = list(set(person_cm_ids))
        logger.info(f"Need to fetch {len(person_cm_ids)} persons")

        # Fetch persons in batches to avoid URL length limits
        persons = []
        if person_cm_ids:
            batch_size = 50
            chunks = [person_cm_ids[i : i + batch_size] for i in range(0, len(person_cm_ids), batch_size)]

            async def fetch_person_chunk(chunk_ids: list[int]) -> list[Any]:
                person_filter = " || ".join(f"cm_id = {cm_id}" for cm_id in chunk_ids)
                return await asyncio.to_thread(
                    pb.collection("persons").get_full_list,
                    query_params={"filter": f"({person_filter}) && year = {ctx.year}"},
                )

            chunk_results = await asyncio.gather(*[fetch_person_chunk(chunk) for chunk in chunks])

            # Deduplicate persons by cm_id (persons table may have duplicates)
            seen_cm_ids: set[int] = set()
            for batch_persons in chunk_results:
                for person_data in batch_persons:
                    cm_id = person_data.cm_id
                    if cm_id in seen_cm_ids:
                        continue
                    seen_cm_ids.add(cm_id)
                    # Use None for missing grades to avoid counting them as grade 0
                    raw_grade = getattr(person_data, "grade", None)
                    person = Person(
                        id=person_data.id,
                        campminder_id=str(cm_id),
                        name=f"{getattr(person_data, 'first_name', '')} {getattr(person_data, 'last_name', '')}".strip(),
                        grade=raw_grade if raw_grade is not None else None,
                        age=calculate_age(getattr(person_data, "birthdate", "")),
                        gender=getattr(person_data, "gender", None),
                    )
                    persons.append(person)

        logger.info(f"Validation: Created {len(persons)} Person objects for session {session.campminder_id}")

        # Data integrity checks
        missing_grades = [p for p in persons if p.grade is None]
        if missing_grades:
            logger.warning(f"Found {len(missing_grades)} persons with no grade data")

        # Log grade distribution
        grade_dist: dict[int, int] = {}
        for p in persons:
            if p.grade is not None:
                grade_dist[p.grade] = grade_dist.get(p.grade, 0) + 1
        logger.info(f"Grade distribution: {grade_dist}")

        # Fetch assignments
        if request.scenario:
            # Query draft assignments for the specific scenario
            filter_str = f'scenario = "{request.scenario}" && ({session_relation_filter}) && year = {ctx.year}'
            assignments_data = await asyncio.to_thread(
                pb.collection("bunk_assignments_draft").get_full_list,
                query_params={"filter": filter_str, "expand": "person,session,bunk"},
            )
        else:
            # Query main assignments
            filter_str = f"({session_relation_filter}) && year = {ctx.year}"
            assignments_data = await asyncio.to_thread(
                pb.collection("bunk_assignments").get_full_list,
                query_params={"filter": filter_str, "expand": "person,session,bunk"},
            )

        assignments = []
        for assignment_data in assignments_data:
            expand = getattr(assignment_data, "expand", {}) or {}
            person_data = expand.get("person") if isinstance(expand, dict) else getattr(expand, "person", None)
            session_data = expand.get("session") if isinstance(expand, dict) else getattr(expand, "session", None)
            bunk_data = expand.get("bunk") if isinstance(expand, dict) else getattr(expand, "bunk", None)

            person_cm_id = person_data.cm_id if person_data and hasattr(person_data, "cm_id") else None
            session_cm_id_val = session_data.cm_id if session_data and hasattr(session_data, "cm_id") else None
            bunk_cm_id = bunk_data.cm_id if bunk_data and hasattr(bunk_data, "cm_id") else None

            if person_cm_id and session_cm_id_val and bunk_cm_id:
                assignment = BunkAssignment(
                    id=assignment_data.id,
                    person_cm_id=str(person_cm_id),
                    bunk_cm_id=str(bunk_cm_id),
                    session_cm_id=str(session_cm_id_val),
                    year=getattr(assignment_data, "year", ctx.year),
                    is_manual=getattr(assignment_data, "is_manual", False),
                )
                assignments.append(assignment)

        logger.info(f"Validation: Found {len(assignments)} assignments")
        if request.scenario:
            logger.info(f"Using scenario {request.scenario} draft assignments")
        else:
            logger.info("Using production assignments")

        # Fetch bunk requests for all related sessions (use pre-built filter from ctx)
        requests_data = await asyncio.to_thread(
            pb.collection("bunk_requests").get_full_list,
            query_params={"filter": f'({ctx.session_id_filter}) && year = {ctx.year} && status != "declined"'},
        )

        requests = []
        for request_data in requests_data:
            bunk_request = BunkRequest(
                id=request_data.id,
                requester_person_cm_id=str(getattr(request_data, "requester_id", "")),
                requested_person_cm_id=str(getattr(request_data, "requestee_id", None))
                if getattr(request_data, "requestee_id", None)
                else None,
                request_type=getattr(request_data, "request_type", ""),
                priority=getattr(request_data, "priority", 5),
                status=getattr(request_data, "status", "pending"),
                session_cm_id=str(getattr(request_data, "session_id", "")),
                year=getattr(request_data, "year", ctx.year),
                source_field=getattr(request_data, "source_field", None),
                ai_reasoning=getattr(request_data, "ai_reasoning", None),
                ai_p1_reasoning=getattr(request_data, "ai_p1_reasoning", None),
                age_preference_target=getattr(request_data, "age_preference_target", None),
            )
            requests.append(bunk_request)

        # Get all related sessions for breakdown (filter by year to avoid cross-year contamination)
        all_sessions_data = await asyncio.to_thread(
            pb.collection("camp_sessions").get_full_list,
            query_params={
                "filter": f"({' || '.join([f'cm_id = {sid}' for sid in ctx.related_session_ids])}) && year = {ctx.year}"
            },
        )
        all_sessions = [
            Session(
                id=s.id,
                campminder_id=str(getattr(s, "cm_id", "")),
                name=getattr(s, "name", ""),
                session_type=getattr(s, "type", ""),
                start_date=getattr(s, "start_date", None),
                end_date=getattr(s, "end_date", None),
                year=getattr(s, "year", ctx.year),
            )
            for s in all_sessions_data
        ]

        # Convert bunk_plans to have expected field names for validator
        bunk_plans_for_validator = []
        for plan in bunk_plans_data:
            expand = getattr(plan, "expand", {}) or {}
            bunk_data = expand.get("bunk") if isinstance(expand, dict) else getattr(expand, "bunk", None)
            session_data = expand.get("session") if isinstance(expand, dict) else getattr(expand, "session", None)
            bunk_cm_id = bunk_data.cm_id if bunk_data and hasattr(bunk_data, "cm_id") else None
            session_cm_id_val = session_data.cm_id if session_data and hasattr(session_data, "cm_id") else None
            if bunk_cm_id and session_cm_id_val:
                bp = BunkPlanData(session_cm_id=session_cm_id_val, bunk_cm_id=bunk_cm_id)
                bunk_plans_for_validator.append(bp)

        # Convert attendees to have expected field names for validator
        attendees_for_validator = []
        for attendee in attendees_data:
            person_cm_id = getattr(attendee, "person_id", None)
            expand = getattr(attendee, "expand", {}) or {}
            session_data = expand.get("session") if isinstance(expand, dict) else getattr(expand, "session", None)
            session_cm_id_val = session_data.cm_id if session_data and hasattr(session_data, "cm_id") else None
            if person_cm_id and session_cm_id_val:
                att = AttendeeData(person_cm_id=person_cm_id, session_cm_id=session_cm_id_val)
                attendees_for_validator.append(att)

        # Fetch historical bunking data (prior year) for level regression validation
        # Include session for same-session comparison (CampMinder reuses session IDs across years)
        historical_bunking = []
        prior_year = ctx.year - 1
        try:
            historical_data = await asyncio.to_thread(
                pb.collection("bunk_assignments").get_full_list,
                query_params={
                    "filter": f"year = {prior_year}",
                    "expand": "bunk,person,session",
                },
            )
            for hist in historical_data:
                expand = getattr(hist, "expand", {}) or {}
                person_data = expand.get("person") if isinstance(expand, dict) else getattr(expand, "person", None)
                bunk_data = expand.get("bunk") if isinstance(expand, dict) else getattr(expand, "bunk", None)
                session_data = expand.get("session") if isinstance(expand, dict) else getattr(expand, "session", None)

                person_cm_id = person_data.cm_id if person_data and hasattr(person_data, "cm_id") else None
                bunk_name = bunk_data.name if bunk_data and hasattr(bunk_data, "name") else None
                session_cm_id = session_data.cm_id if session_data and hasattr(session_data, "cm_id") else None

                if person_cm_id and bunk_name:
                    historical_bunking.append(
                        HistoricalBunkingRecord(
                            person_cm_id=person_cm_id,
                            bunk_name=bunk_name,
                            year=prior_year,
                            session_cm_id=session_cm_id,
                        )
                    )
            logger.info(f"Fetched {len(historical_bunking)} historical bunk assignments from {prior_year}")
        except Exception as e:
            logger.warning(f"Failed to fetch historical bunking data: {e}")
            # Continue without historical data - level regression won't be checked

        # Run validation
        validator = BunkingValidator()

        validation_result = validator.validate_bunking(
            session=session,
            bunks=bunks,
            assignments=assignments,
            persons=persons,
            requests=requests,
            scenario=request.scenario,
            all_sessions=all_sessions,
            bunk_plans=bunk_plans_for_validator,
            attendees=attendees_for_validator,
            historical_bunking=historical_bunking if historical_bunking else None,
        )

        return validation_result.model_dump()

    except ClientResponseError as e:
        if e.status == 404:
            raise HTTPException(status_code=404, detail="Session not found")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error during bunking validation: {e}", exc_info=True)
        if os.environ.get("ENV", "development") == "development":
            raise HTTPException(status_code=500, detail=f"Validation error: {str(e)}")
        else:
            raise HTTPException(status_code=500, detail="Failed to validate bunking")

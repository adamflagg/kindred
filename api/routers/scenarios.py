"""
Scenarios Router - Endpoints for managing draft scenario bunking assignments.

This router handles:
- Creating, updating, and deleting scenarios
- Managing draft assignments within scenarios
- Copying assignments from production to scenarios
- Solving scenarios with the constraint solver
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime
from typing import Annotated, Any
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, HTTPException, Path, Query
from pocketbase.client import ClientResponseError  # type: ignore[attr-defined]

from bunking.models import (
    ClearScenarioRequest,
    CreateScenarioRequest,
    SavedScenario,
    ScenarioAssignmentUpdate,
    UpdateScenarioRequest,
)
from bunking.solver.objective_evaluator import evaluate_objective

from ..dependencies import pb, solver_runs
from ..services.session_context import build_session_context
from ..services.solver_runner import run_solver_task_v2

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/scenarios", tags=["scenarios"])


# ========================================
# Scenario CRUD
# ========================================


@router.post("")
async def create_scenario(request: CreateScenarioRequest) -> SavedScenario:
    """Create a new scenario, optionally copying from production data."""
    try:
        # Build session context from request (validates session exists for year)
        ctx = await build_session_context(request.session_cm_id, request.year, pb)

        # Create the scenario record with year
        scenario_data = {
            "name": request.name,
            "session": ctx.session_pb_id,  # Use PB ID for relation
            "session_cm_id": request.session_cm_id,  # Keep CM ID for queries
            "year": request.year,  # Store year in scenario
            "created_by": request.created_by or "system",
            "description": request.description,
            "is_active": True,
        }

        scenario = await asyncio.to_thread(pb.collection("saved_scenarios").create, scenario_data)

        # Use pre-built filter from SessionContext
        session_filter_relation = ctx.session_relation_filter

        # Determine copy source
        copy_source_assignments = []

        if request.copy_from_scenario:
            logger.info(f"Copying assignments from scenario: {request.copy_from_scenario}")
            copy_source_assignments = await asyncio.to_thread(
                pb.collection("bunk_assignments_draft").get_full_list,
                query_params={
                    "filter": f'scenario = "{request.copy_from_scenario}" && ({session_filter_relation}) && year = {ctx.year}',
                    "expand": "person,session,bunk,bunk_plan",
                },
            )
        elif request.should_copy_from_production:
            logger.info("Copying assignments from production for all related sessions")
            copy_source_assignments = await asyncio.to_thread(
                pb.collection("bunk_assignments").get_full_list,
                query_params={
                    "filter": f"({session_filter_relation}) && year = {ctx.year}",
                    "expand": "person,session,bunk",
                },
            )

        # If we have assignments to copy
        if copy_source_assignments:
            bunk_plan_map = {}
            if request.should_copy_from_production and not request.copy_from_scenario:
                bunk_plans = await asyncio.to_thread(
                    pb.collection("bunk_plans").get_full_list,
                    query_params={
                        "filter": f"({session_filter_relation}) && year = {ctx.year}",
                        "expand": "bunk,session",
                    },
                )
                for plan in bunk_plans:
                    plan_expand = getattr(plan, "expand", {}) or {}
                    bunk_data = (
                        plan_expand.get("bunk") if isinstance(plan_expand, dict) else getattr(plan_expand, "bunk", None)
                    )
                    bunk_cm_id = bunk_data.cm_id if bunk_data and hasattr(bunk_data, "cm_id") else None
                    if bunk_cm_id:
                        bunk_plan_map[bunk_cm_id] = getattr(plan, "cm_id", 0)

            # Copy each assignment to new scenario
            for assignment in copy_source_assignments:
                if request.should_copy_from_production and not request.copy_from_scenario:
                    assign_expand = getattr(assignment, "expand", {}) or {}
                    person_data = (
                        assign_expand.get("person")
                        if isinstance(assign_expand, dict)
                        else getattr(assign_expand, "person", None)
                    )
                    session_data = (
                        assign_expand.get("session")
                        if isinstance(assign_expand, dict)
                        else getattr(assign_expand, "session", None)
                    )
                    bunk_data = (
                        assign_expand.get("bunk")
                        if isinstance(assign_expand, dict)
                        else getattr(assign_expand, "bunk", None)
                    )

                    person_cm_id = person_data.cm_id if person_data and hasattr(person_data, "cm_id") else None
                    session_cm_id = session_data.cm_id if session_data and hasattr(session_data, "cm_id") else None
                    bunk_cm_id = bunk_data.cm_id if bunk_data and hasattr(bunk_data, "cm_id") else None

                    if not all([person_cm_id, session_cm_id, bunk_cm_id]):
                        logger.warning("Missing expanded relation data for assignment")
                        continue

                    if bunk_cm_id not in bunk_plan_map:
                        logger.warning(f"No bunk_plan found for bunk_cm_id {bunk_cm_id}")
                        continue

                    # Use the session context's ID cache
                    # Handle potential None values with type narrowing
                    if person_cm_id is None or bunk_cm_id is None or session_cm_id is None:
                        logger.warning("Missing CM ID in assignment copy")
                        continue
                    person_pb_id = await ctx.id_cache.get_person_pb_id(person_cm_id)
                    bunk_pb_id = await ctx.id_cache.get_bunk_pb_id(bunk_cm_id)
                    session_pb_id = await ctx.id_cache.get_session_pb_id(session_cm_id)
                    bunk_plan_pb_id = await ctx.id_cache.get_bunk_plan_id(bunk_cm_id, session_cm_id, ctx.year)

                    if not all([person_pb_id, bunk_pb_id, session_pb_id]):
                        logger.warning("Failed to resolve PB IDs for production copy")
                        continue

                    draft_data = {
                        "scenario": scenario.id,
                        "person": person_pb_id,
                        "bunk": bunk_pb_id,
                        "session": session_pb_id,
                        "bunk_plan": bunk_plan_pb_id,
                        "year": getattr(assignment, "year", ctx.year),
                        "assignment_locked": False,
                    }
                else:
                    draft_data = {
                        "scenario": scenario.id,
                        "person": getattr(assignment, "person", None),
                        "bunk": getattr(assignment, "bunk", None),
                        "session": getattr(assignment, "session", None),
                        "bunk_plan": getattr(assignment, "bunk_plan", None),
                        "year": getattr(assignment, "year", ctx.year),
                        "assignment_locked": getattr(assignment, "assignment_locked", False),
                    }

                await asyncio.to_thread(pb.collection("bunk_assignments_draft").create, draft_data)

        return SavedScenario(
            id=scenario.id,
            name=str(getattr(scenario, "name", "")),
            session_cm_id=int(getattr(scenario, "session_cm_id", request.session_cm_id)),
            year=ctx.year,
            is_active=bool(getattr(scenario, "is_active", True)),
            description=str(getattr(scenario, "description", "")),
            created_by=str(getattr(scenario, "created_by", "")),
        )

    except ClientResponseError as e:
        logger.error(f"PocketBase error creating scenario: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating scenario: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to create scenario: {str(e)}")


@router.get("")
async def list_scenarios(
    session_id: Annotated[int, Query(description="Session CampMinder ID")],
    year: Annotated[int, Query(description="Year to filter by")],  # Now required
    include_inactive: Annotated[bool, Query(description="Include inactive scenarios")] = False,
) -> list[SavedScenario]:
    """List all scenarios for a session and its related sessions."""
    try:
        # Build session context (validates session exists for year)
        ctx = await build_session_context(session_id, year, pb)
        session_filter = " || ".join([f"session_cm_id = {sid}" for sid in ctx.related_session_ids])

        # Filter by session and year
        filter_str = f"({session_filter}) && year = {ctx.year}"
        if not include_inactive:
            filter_str += " && is_active = true"

        scenarios = await asyncio.to_thread(
            pb.collection("saved_scenarios").get_full_list, query_params={"filter": filter_str}
        )

        result: list[SavedScenario] = []
        for s in scenarios:
            result.append(
                SavedScenario(
                    id=s.id,
                    name=str(getattr(s, "name", "")),
                    session_cm_id=int(getattr(s, "session_cm_id", 0)),
                    year=int(getattr(s, "year", ctx.year)),
                    is_active=bool(getattr(s, "is_active", True)),
                    description=str(getattr(s, "description", "")),
                    created_by=str(getattr(s, "created_by", "")),
                )
            )

        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error listing scenarios: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to list scenarios: {str(e)}")


@router.get("/score")
async def evaluate_score(
    session_id: Annotated[int, Query(description="Session CampMinder ID")],
    year: Annotated[int, Query(description="Year")],
    scenario_id: Annotated[str | None, Query(description="Scenario ID (omit for production)")] = None,
) -> dict[str, Any]:
    """Evaluate the solver objective score for a scenario or production assignments.

    Returns the EXACT same score the solver optimizer would produce, allowing
    accurate comparison between different scenarios or between scenario and production.

    Score components:
    - Request satisfaction (with priority weighting, source multipliers, diminishing returns)
    - Age/grade flow bonuses (target grade distribution)
    - Penalties (grade spread, capacity, occupancy)
    """
    try:
        # Build session context
        ctx = await build_session_context(session_id, year, pb)
        session_filter = ctx.session_relation_filter
        session_id_filter = ctx.session_id_filter

        # Fetch bunk requests for the session
        requests_raw = await asyncio.to_thread(
            pb.collection("bunk_requests").get_full_list,
            query_params={
                "filter": f"({session_id_filter}) && year = {year}",
            },
        )

        # Convert requests to evaluator format
        requests = []
        for r in requests_raw:
            req_dict = {
                "requester_id": getattr(r, "requester_id", None),
                "requestee_id": getattr(r, "requestee_id", None),
                "request_type": getattr(r, "request_type", ""),
                "priority": getattr(r, "priority", 5),
                "source_field": getattr(r, "source_field", None),
            }
            ai_reasoning = getattr(r, "ai_reasoning", None)
            if isinstance(ai_reasoning, dict):
                req_dict["csv_source_fields"] = ai_reasoning.get("csv_source_fields", [])
            requests.append(req_dict)

        # Fetch assignments - from draft if scenario specified, else production
        if scenario_id:
            assignments_raw = await asyncio.to_thread(
                pb.collection("bunk_assignments_draft").get_full_list,
                query_params={
                    "filter": f'scenario = "{scenario_id}" && ({session_filter}) && year = {year}',
                    "expand": "person,bunk",
                },
            )
        else:
            assignments_raw = await asyncio.to_thread(
                pb.collection("bunk_assignments").get_full_list,
                query_params={
                    "filter": f"({session_filter}) && year = {year}",
                    "expand": "person,bunk",
                },
            )

        # Build assignment map (person_cm_id -> bunk_cm_id)
        assignment_map: dict[int, int] = {}
        for a in assignments_raw:
            expand = getattr(a, "expand", {}) or {}
            person_data = expand.get("person") if isinstance(expand, dict) else getattr(expand, "person", None)
            bunk_data = expand.get("bunk") if isinstance(expand, dict) else getattr(expand, "bunk", None)

            if person_data and bunk_data:
                person_cm_id = getattr(person_data, "cm_id", None)
                bunk_cm_id = getattr(bunk_data, "cm_id", None)
                if person_cm_id and bunk_cm_id:
                    assignment_map[int(person_cm_id)] = int(bunk_cm_id)

        # Fetch persons with session info (needed for age/grade flow)
        persons_raw = await asyncio.to_thread(
            pb.collection("persons").get_full_list,
            query_params={"filter": f"year = {year}"},
        )
        persons = [
            {
                "cm_id": getattr(p, "cm_id", None),
                "grade": getattr(p, "grade", None),
                "gender": getattr(p, "gender", None),
                "age": getattr(p, "age", None),
                "session_cm_id": session_id,  # For age/grade flow calculation
            }
            for p in persons_raw
        ]

        # Fetch bunks with session info
        bunks_raw = await asyncio.to_thread(
            pb.collection("bunks").get_full_list,
            query_params={"filter": f"year = {year}"},
        )
        bunks = [
            {
                "cm_id": getattr(b, "cm_id", None),
                "name": getattr(b, "name", None),
                "gender": getattr(b, "gender", None),
                "capacity": getattr(b, "max_size", None),
                "session_cm_id": session_id,  # For age/grade flow calculation
            }
            for b in bunks_raw
        ]

        # Evaluate using the exact solver objective function
        breakdown = evaluate_objective(assignment_map, requests, persons, bunks)

        return {
            "scenario_id": scenario_id,
            "session_id": session_id,
            "year": year,
            # Main scores (matches SolverScoreResult interface)
            "total_score": breakdown.total_score,
            "request_satisfaction_score": breakdown.request_satisfaction_score,
            "soft_penalty_score": breakdown.penalty_score,  # Frontend expects soft_penalty_score
            # Request stats
            "total_requests": breakdown.total_requests,
            "satisfied_requests": breakdown.satisfied_requests,
            "satisfaction_rate": breakdown.satisfaction_rate,
            # Detailed breakdowns
            "field_scores": breakdown.field_breakdown,  # Frontend expects field_scores
            "penalties": breakdown.penalties,
            # Additional detail (not in original interface but useful)
            "age_grade_flow_score": breakdown.age_grade_flow_score,
            "grade_flow_details": breakdown.grade_flow_details,
        }

    except Exception as e:
        logger.error(f"Error evaluating score: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to evaluate score: {str(e)}")


@router.get("/{scenario_id}")
async def get_scenario(
    scenario_id: Annotated[str, Path(description="Scenario ID")],
    include_assignments: Annotated[bool, Query(description="Include bunk assignments")] = True,
) -> SavedScenario | dict[str, Any]:
    """Get a specific scenario with optional assignments."""
    try:
        scenario = await asyncio.to_thread(pb.collection("saved_scenarios").get_one, scenario_id)

        # Include year in response (required field now)
        scenario_result = SavedScenario(
            id=scenario.id,
            name=str(getattr(scenario, "name", "")),
            session_cm_id=int(getattr(scenario, "session_cm_id", 0)),
            year=int(getattr(scenario, "year", 0)),
            is_active=bool(getattr(scenario, "is_active", True)),
            description=str(getattr(scenario, "description", "")),
            created_by=str(getattr(scenario, "created_by", "")),
        )

        if include_assignments:
            # Filter assignments by scenario and year for safety
            scenario_year = getattr(scenario, "year", None)
            filter_str = f'scenario = "{scenario_id}"'
            if scenario_year:
                filter_str += f" && year = {scenario_year}"

            assignments = await asyncio.to_thread(
                pb.collection("bunk_assignments_draft").get_full_list,
                query_params={"filter": filter_str, "expand": "person,session,bunk,bunk_plan"},
            )

            return {"scenario": scenario_result, "assignments": assignments}

        return scenario_result

    except ClientResponseError as e:
        if e.status == 404:
            raise HTTPException(status_code=404, detail="Scenario not found")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error getting scenario: {e}")
        raise HTTPException(status_code=500, detail="Failed to get scenario")


@router.put("/{scenario_id}")
async def update_scenario(scenario_id: str, request: UpdateScenarioRequest) -> SavedScenario:
    """Update scenario metadata."""
    try:
        update_data: dict[str, Any] = {}
        if request.name is not None:
            update_data["name"] = request.name
        if request.description is not None:
            update_data["description"] = request.description
        if request.is_active is not None:
            update_data["is_active"] = request.is_active

        if not update_data:
            raise HTTPException(status_code=400, detail="No fields to update")

        update_data["updated"] = datetime.now(UTC).isoformat()

        scenario = await asyncio.to_thread(pb.collection("saved_scenarios").update, scenario_id, update_data)

        return SavedScenario(
            id=scenario.id,
            name=str(getattr(scenario, "name", "")),
            session_cm_id=int(getattr(scenario, "session_cm_id", 0)),
            year=int(getattr(scenario, "year", 0)),
            is_active=bool(getattr(scenario, "is_active", True)),
            description=str(getattr(scenario, "description", "")),
            created_by=str(getattr(scenario, "created_by", "")),
        )

    except ClientResponseError as e:
        if e.status == 404:
            raise HTTPException(status_code=404, detail="Scenario not found")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error updating scenario: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to update scenario: {str(e)}")


@router.delete("/{scenario_id}")
async def delete_scenario(scenario_id: str) -> dict[str, str]:
    """Delete a scenario and all its data."""
    try:
        scenario = await asyncio.to_thread(pb.collection("saved_scenarios").get_one, scenario_id)

        # Delete all related draft assignments first
        draft_assignments = await asyncio.to_thread(
            pb.collection("bunk_assignments_draft").get_full_list,
            query_params={"filter": f'scenario = "{scenario_id}"'},
        )

        for assignment in draft_assignments:
            await asyncio.to_thread(pb.collection("bunk_assignments_draft").delete, assignment.id)

        # Delete the scenario
        await asyncio.to_thread(pb.collection("saved_scenarios").delete, scenario_id)

        return {"message": f"Scenario '{getattr(scenario, 'name', scenario_id)}' deleted successfully"}

    except ClientResponseError as e:
        if e.status == 404:
            raise HTTPException(status_code=404, detail="Scenario not found")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error deleting scenario: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to delete scenario: {str(e)}")


# ========================================
# Scenario Assignment Management
# ========================================


@router.put("/{scenario_id}/assignments")
async def update_scenario_assignment(scenario_id: str, update: ScenarioAssignmentUpdate) -> dict[str, Any]:
    """Update a single assignment in a scenario.

    Uses relation-based schema with PocketBase IDs.
    Frontend sends CampMinder IDs which are looked up to get PocketBase IDs.
    """
    logger.info(f"update_scenario_assignment called: scenario_id={scenario_id}, update={update}")
    try:
        # Build session context from the update request (validates session/year)
        ctx = await build_session_context(update.session_cm_id, update.year, pb)

        scenario = await asyncio.to_thread(pb.collection("saved_scenarios").get_one, scenario_id, {"expand": "session"})
        logger.debug(f"Found scenario: id={scenario.id}, session={getattr(scenario, 'session', None)}")

        session_pb_id = ctx.session_pb_id
        session_cm_id = ctx.session_cm_id
        logger.debug(f"Session: pb_id={session_pb_id}, cm_id={session_cm_id}, year={ctx.year}")

        # Look up person PocketBase ID from CampMinder ID (with year filter)
        persons = await asyncio.to_thread(
            pb.collection("persons").get_full_list,
            query_params={"filter": f"cm_id = {update.person_id} && year = {ctx.year}"},
        )
        if not persons:
            raise HTTPException(
                status_code=404, detail=f"Person with cm_id {update.person_id} not found for year {ctx.year}"
            )
        person_pb_id = persons[0].id

        # Check if assignment exists
        existing = await asyncio.to_thread(
            pb.collection("bunk_assignments_draft").get_full_list,
            query_params={"filter": f'scenario = "{scenario_id}" && person = "{person_pb_id}" && year = {ctx.year}'},
        )

        if update.bunk_id is None:
            # Remove assignment
            if existing:
                await asyncio.to_thread(pb.collection("bunk_assignments_draft").delete, existing[0].id)
                return {"message": "Assignment removed", "person_id": update.person_id, "changed": True}
            else:
                return {"message": "No change needed", "person_id": update.person_id, "changed": False}

        else:
            # Look up bunk PocketBase ID from CampMinder ID (with year filter)
            bunks = await asyncio.to_thread(
                pb.collection("bunks").get_full_list,
                query_params={"filter": f"cm_id = {update.bunk_id} && year = {ctx.year}"},
            )
            if not bunks:
                raise HTTPException(
                    status_code=404, detail=f"Bunk with cm_id {update.bunk_id} not found for year {ctx.year}"
                )
            bunk_pb_id = bunks[0].id

            if existing:
                # Update existing assignment
                existing_record = existing[0]
                record_id_val = existing_record.get("id") if isinstance(existing_record, dict) else existing_record.id
                record_id = str(record_id_val) if record_id_val else ""

                update_assignment_data: dict[str, str | bool] = {"bunk": bunk_pb_id}
                if update.locked is not None:
                    update_assignment_data["assignment_locked"] = update.locked

                await asyncio.to_thread(
                    pb.collection("bunk_assignments_draft").update, record_id, update_assignment_data
                )

                return {
                    "message": "Assignment updated successfully",
                    "person_id": update.person_id,
                    "bunk_id": update.bunk_id,
                    "changed": True,
                }

            else:
                # Create new assignment - use session context
                bunk_plan_filter = (
                    f"bunk.cm_id = {update.bunk_id} && session.cm_id = {session_cm_id} && year = {ctx.year}"
                )
                logger.debug(f"Looking up bunk_plan with filter: {bunk_plan_filter}")
                bunk_plans = await asyncio.to_thread(
                    pb.collection("bunk_plans").get_full_list, query_params={"filter": bunk_plan_filter}
                )

                if not bunk_plans:
                    logger.warning(
                        f"No bunk_plan found: bunk_cm_id={update.bunk_id}, session_cm_id={session_cm_id}, year={ctx.year}"
                    )
                    raise HTTPException(
                        status_code=400,
                        detail=f"No bunk plan found for bunk cm_id {update.bunk_id} in session cm_id {session_cm_id} (year={ctx.year})",
                    )

                bunk_plan_pb_id = bunk_plans[0].id

                new_assignment = {
                    "scenario": scenario_id,
                    "person": person_pb_id,
                    "bunk": bunk_pb_id,
                    "session": session_pb_id,
                    "bunk_plan": bunk_plan_pb_id,
                    "year": ctx.year,
                    "assignment_locked": update.locked if update.locked is not None else False,
                }

                logger.info(f"Creating draft assignment: {new_assignment}")
                try:
                    await asyncio.to_thread(pb.collection("bunk_assignments_draft").create, new_assignment)
                except ClientResponseError as create_error:
                    logger.error(
                        f"Failed to create draft assignment: status={create_error.status}, data={getattr(create_error, 'data', None)}"
                    )
                    logger.error(f"Assignment data was: {new_assignment}")
                    raise

                return {
                    "message": "Assignment created successfully",
                    "person_id": update.person_id,
                    "bunk_id": update.bunk_id,
                    "changed": True,
                }

    except ClientResponseError as e:
        logger.error(
            f"PocketBase error in update_scenario_assignment: status={e.status}, body={getattr(e, 'data', None)}"
        )
        logger.error(f"Scenario ID: {scenario_id}, Update: {update}")
        if e.status == 404:
            raise HTTPException(status_code=404, detail="Scenario not found")
        error_detail = str(e)
        if hasattr(e, "data") and e.data:
            error_detail = f"PocketBase error: {e.data}"
        raise HTTPException(status_code=400, detail=error_detail)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating assignment: {e}", exc_info=True)
        logger.error(f"Scenario ID: {scenario_id}")
        logger.error(f"Update data: {update}")
        if "existing" in locals():
            logger.error(f"Existing assignments: {existing}")
        raise HTTPException(status_code=500, detail=f"Failed to update assignment: {str(e)}")


# ========================================
# Scenario Solver Operations
# ========================================


@router.post("/{scenario_id}/analyze")
async def analyze_scenario(scenario_id: str) -> None:
    """Analyze the current assignments in a scenario."""
    raise HTTPException(status_code=501, detail="Analysis functionality is being reimplemented")


@router.post("/{scenario_id}/solve")
async def solve_scenario(scenario_id: str, background_tasks: BackgroundTasks) -> dict[str, str]:
    """Run the solver on a scenario.

    Reads existing assignments from bunk_assignments_draft (not production)
    and produces optimized assignments for the scenario.
    """
    try:
        scenario = await asyncio.to_thread(pb.collection("saved_scenarios").get_one, scenario_id)

        session_cm_id: int = getattr(scenario, "session_cm_id", 0)
        scenario_year: int = getattr(scenario, "year", 0)

        run_id = str(uuid4())
        solver_runs[run_id] = {
            "id": run_id,
            "status": "pending",
            "scenario": scenario_id,
            "session_id": session_cm_id,
            "year": scenario_year,
            "started_at": datetime.now(UTC),
        }

        # Run solver with scenario parameter - this causes fetch_session_data_v2
        # to read from bunk_assignments_draft instead of bunk_assignments
        background_tasks.add_task(
            run_solver_task_v2,
            run_id=run_id,
            session_cm_id=session_cm_id,
            year=scenario_year,
            respect_locks=True,
            time_limit=30,
            include_analysis=False,
            scenario=scenario_id,  # Pass PocketBase ID of the scenario
        )

        return {"run_id": run_id, "status": "started", "message": "Solver run started for scenario"}

    except ClientResponseError as e:
        if e.status == 404:
            raise HTTPException(status_code=404, detail="Scenario not found")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error starting solver for scenario: {e}")
        raise HTTPException(status_code=500, detail="Failed to start solver")


@router.post("/{scenario_id}/clear")
async def clear_scenario(scenario_id: str, request: ClearScenarioRequest) -> dict[str, str | int]:
    """Clear all assignments in a scenario."""
    try:
        # Verify scenario exists (raises 404 if not found)
        await asyncio.to_thread(pb.collection("saved_scenarios").get_one, scenario_id)

        # Use year from request for scoping (required field now)
        filter_str = f'scenario = "{scenario_id}" && year = {request.year}'

        assignments = await asyncio.to_thread(
            pb.collection("bunk_assignments_draft").get_full_list, query_params={"filter": filter_str}
        )

        deleted_count = 0
        for assignment in assignments:
            await asyncio.to_thread(pb.collection("bunk_assignments_draft").delete, assignment.id)
            deleted_count += 1

        return {
            "message": f"Cleared {deleted_count} assignments from scenario for year {request.year}",
        }

    except ClientResponseError as e:
        if e.status == 404:
            raise HTTPException(status_code=404, detail="Scenario not found")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error clearing scenario: {e}")
        raise HTTPException(status_code=500, detail="Failed to clear scenario")

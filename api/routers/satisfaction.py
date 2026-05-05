"""Satisfaction Router — GET /api/satisfaction.

Returns per-camper satisfaction state for a session × scenario combo. Used by
the frontend BunkRequestProvider as the single source of truth for alert
triangles, sidebar slices, and per-request Met/Unmet pills, replacing the
deleted frontend predicates.

Mirrors social_graph.py's auth + scenario routing pattern. Uses
SessionContext to widen scope to AG-related sessions automatically — a main
session with AG children gets satisfaction computed across the cluster.
"""

from __future__ import annotations

import asyncio
import time
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from api.dependencies import pb
from api.services.session_context import build_session_context
from bunking.auth_middleware import AuthUser, get_current_user
from bunking.logging_config import get_logger
from bunking.rbac.dependencies import require_permission
from bunking.rbac.permissions import Permission
from bunking.satisfaction import session_satisfaction
from bunking.satisfaction.api_shape import SatisfactionResponse

logger = get_logger(__name__)

router = APIRouter(tags=["satisfaction"])


@router.get("/api/satisfaction", response_model=SatisfactionResponse)
async def get_satisfaction(
    session: Annotated[int, Query(..., description="CampMinder session cm_id.")],
    year: Annotated[int, Query(..., description="Camp year.")],
    scenario: Annotated[
        str | None,
        Query(description="PocketBase scenario id; omit for production assignments."),
    ] = None,
    user: AuthUser = Depends(get_current_user),
    _: None = Depends(require_permission(Permission.BUNKING_MANAGE)),
) -> SatisfactionResponse:
    """Compute per-camper satisfaction for a session × scenario.

    Scope automatically widens to AG-related sessions via SessionContext, so
    a main session with AG children returns satisfaction for all campers in
    the cluster.
    """
    start = time.perf_counter()

    ctx = await build_session_context(session, year, pb)

    response = await asyncio.to_thread(
        session_satisfaction,
        session_cm_ids=ctx.related_session_ids,
        year=year,
        scenario_id=scenario,
        pb_client=pb,
    )

    elapsed_ms = int((time.perf_counter() - start) * 1000)
    logger.info(
        "satisfaction computed",
        extra={
            "session": session,
            "related_sessions": ctx.related_session_ids,
            "scenario": scenario,
            "camper_count": len(response.campers),
            "request_count": sum(len(c.per_request) for c in response.campers.values()),
            "elapsed_ms": elapsed_ms,
        },
    )
    return response

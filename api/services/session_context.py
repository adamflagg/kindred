"""
Session Context Service - Centralized session/year validation and filter building.

This service provides a single source of truth for session-scoped operations,
eliminating duplicated code across routers for:
- Session existence validation
- Related session ID lookup (AG sessions for main sessions)
- Filter string building for PocketBase queries
- ID translation caching

Usage:
    ctx = await build_session_context(session_cm_id, year, pb_client)
    # Now use ctx.session_relation_filter, ctx.session_id_filter, ctx.year
    # for all PocketBase queries in the endpoint
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass

from fastapi import HTTPException

from pocketbase import PocketBase

from .id_cache import IDLookupCache
from .session_utils import get_related_session_ids

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class SessionContext:
    """
    Immutable context for session-scoped operations.

    This dataclass holds all the validated session information and pre-built
    filter strings needed for PocketBase queries within a single request.

    Attributes:
        session_cm_id: CampMinder session ID
        year: The year for this session (critical for year-scoped queries)
        session_pb_id: PocketBase record ID for the session
        session_name: Human-readable session name
        session_type: Session type (main, ag, embedded)
        related_session_ids: List of CM IDs including this session and related AG sessions
        session_relation_filter: Filter for relation fields (e.g., "session.cm_id = X || ...")
        session_id_filter: Filter for direct cm_id fields (e.g., "session_id = X || ...")
        session_pb_id_filter: Filter for PB ID relation fields (e.g., 'session = "abc" || ...')
        id_cache: Cached ID translation for persons, bunks, sessions
    """

    session_cm_id: int
    year: int
    session_pb_id: str
    session_name: str
    session_type: str
    related_session_ids: list[int]
    session_relation_filter: str
    session_id_filter: str
    session_pb_id_filter: str
    id_cache: IDLookupCache


async def build_session_context(
    session_cm_id: int,
    year: int,
    pb_client: PocketBase,
) -> SessionContext:
    """
    Build validated session context with all common data.

    This function performs session existence validation, gathers related sessions,
    and pre-builds all the filter strings needed for PocketBase queries.

    Args:
        session_cm_id: CampMinder ID of the session to validate
        year: The year to scope the query (required, no defaults)
        pb_client: PocketBase client for database queries

    Returns:
        SessionContext with all validated data and pre-built filters

    Raises:
        HTTPException 404: If session doesn't exist for the given year
    """
    # Validate session exists for year
    sessions = await asyncio.to_thread(
        pb_client.collection("camp_sessions").get_full_list,
        query_params={"filter": f"cm_id = {session_cm_id} && year = {year}"},
    )

    if not sessions:
        raise HTTPException(
            status_code=404,
            detail=f"Session with CampMinder ID {session_cm_id} not found for year {year}",
        )

    session = sessions[0]

    # Get related session IDs (includes AG sessions for main sessions)
    related_ids = await get_related_session_ids(session_cm_id, year, pb_client)

    # Get PocketBase record IDs for related sessions (needed for relation filtering)
    related_sessions = await asyncio.to_thread(
        pb_client.collection("camp_sessions").get_full_list,
        query_params={"filter": f"({' || '.join([f'cm_id = {sid}' for sid in related_ids])}) && year = {year}"},
    )
    related_session_pb_ids = [s.id for s in related_sessions]

    session_name = getattr(session, "name", "")
    logger.info(
        f"SessionContext built for session {session_cm_id} ({session_name}) "
        f"year {year}, related sessions: {related_ids}"
    )

    # Build filter strings
    # For CM ID fields like "session.cm_id = X" or "session_cm_id = X"
    session_relation_filter = " || ".join([f"session.cm_id = {sid}" for sid in related_ids])
    session_id_filter = " || ".join([f"session_id = {sid}" for sid in related_ids])

    # For PocketBase relation fields using record IDs
    session_pb_id_filter = " || ".join([f'session = "{sid}"' for sid in related_session_pb_ids])

    return SessionContext(
        session_cm_id=session_cm_id,
        year=year,
        session_pb_id=session.id,
        session_name=session_name,
        session_type=getattr(session, "session_type", ""),
        related_session_ids=related_ids,
        session_relation_filter=session_relation_filter,
        session_id_filter=session_id_filter,
        session_pb_id_filter=session_pb_id_filter,
        id_cache=IDLookupCache(pb_client, year),
    )


async def batch_load_session_data(ctx: SessionContext, pb_client: PocketBase) -> None:
    """
    Pre-load ID caches for all persons and bunks in a session.

    Call this before processing assignments or requests to minimize
    individual database lookups.

    Args:
        ctx: The session context to load data for
        pb_client: PocketBase client for database queries
    """
    # Load person and bunk mappings in parallel
    await asyncio.gather(
        ctx.id_cache.batch_load_persons(ctx.session_cm_id, ctx.year),
        ctx.id_cache.batch_load_bunks(ctx.session_cm_id, ctx.year),
    )

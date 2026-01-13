"""
Session utilities for the Bunking API.

This module provides session-related utility functions used across multiple routers.
"""

from __future__ import annotations

import asyncio
import logging

from pocketbase import PocketBase

from ..dependencies import pb

logger = logging.getLogger(__name__)


async def get_related_session_ids(session_cm_id: int, year: int, pb_client: PocketBase | None = None) -> list[int]:
    """
    Get all related session IDs for a given session.

    Only AG (All-Gender) sessions are considered "related" to their parent main session.
    Embedded sessions (2a, 2b, 3a) are fully independent and solved separately.

    Args:
        session_cm_id: The CampMinder ID of the main session
        year: The year to filter by (CampMinder reuses session IDs across years)
        pb_client: Optional PocketBase client to use

    Returns:
        List of all related session CampMinder IDs (including the original)
    """
    client = pb_client or pb
    related_ids = [session_cm_id]

    try:
        # Get the main session info - filter by year since cm_id is reused across years
        main_sessions = await asyncio.to_thread(
            client.collection("camp_sessions").get_full_list,
            query_params={"filter": f"cm_id = {session_cm_id} && year = {year}"},
        )

        if not main_sessions:
            logger.warning(f"Session {session_cm_id} for year {year} not found")
            return related_ids

        main_session = main_sessions[0]
        session_name = getattr(main_session, "name", "")
        session_type = getattr(main_session, "session_type", "")

        # Only main sessions have related AG sessions
        # Embedded sessions are independent - they have no children
        if session_type != "main":
            logger.info(f"Session {session_cm_id} ({session_name}) is type '{session_type}' - no related sessions")
            return related_ids

        # Find AG sessions that have this session as their parent (for the same year)
        # AG sessions have session_type='ag' and parent_id pointing to main session's cm_id
        ag_sessions = await asyncio.to_thread(
            client.collection("camp_sessions").get_full_list,
            query_params={"filter": f'session_type = "ag" && parent_id = {session_cm_id} && year = {year}'},
        )

        for session in ag_sessions:
            related_ids.append(getattr(session, "cm_id", 0))

        logger.info(f"Session {session_cm_id} ({session_name}) year {year} has related AG sessions: {related_ids}")

    except Exception as e:
        logger.error(f"Error finding related sessions for {session_cm_id}: {e}")

    return related_ids

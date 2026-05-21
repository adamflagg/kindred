"""Session Repository - Data access for camp sessions

Provides methods to query camp session data and find related sessions."""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any

from bunking.logging_config import get_logger
from pocketbase import PocketBase

if TYPE_CHECKING:
    from ..pocketbase_wrapper import PocketBaseWrapper

logger = get_logger(__name__)

# Valid session types for bunking
VALID_BUNKING_SESSION_TYPES = {"main", "embedded", "ag"}


class SessionRepository:
    """Repository for camp session data"""

    def __init__(self, pb_client: PocketBase | PocketBaseWrapper | None = None, cache: Any = None) -> None:
        """Initialize repository"""
        self.pb = pb_client
        self.cache = cache

    def find_by_cm_id(self, cm_id: int) -> dict[str, Any] | None:
        """Find a session by its CampMinder ID.

        Args:
            cm_id: The CampMinder session ID

        Returns:
            Session data dict or None if not found
        """
        if not self.pb:
            return None

        try:
            result = self.pb.collection("camp_sessions").get_list(1, 1, query_params={"filter": f"cm_id = {cm_id}"})
            if result.items:
                session = result.items[0]
                return {
                    "id": session.id,
                    "cm_id": getattr(session, "cm_id", None),
                    "name": getattr(session, "name", ""),
                    "year": getattr(session, "year", None),
                    "session_type": getattr(session, "session_type", None),
                    "parent_id": getattr(session, "parent_id", None),
                }
            return None
        except Exception as e:
            logger.error(f"Error finding session {cm_id}: {e}")
            return None

    def get_friendly_name(self, session_cm_id: int) -> str:
        """Get friendly name for a session CampMinder ID.

        Looks up the session name from the database. Falls back to a generic
        format if database is unavailable.

        Args:
            session_cm_id: CampMinder session ID

        Returns:
            Friendly session name like "Session 2" or "Session 3a"
        """
        # Try DB lookup (if client available)
        if self.pb:
            try:
                result = self.pb.collection("camp_sessions").get_list(
                    1, 1, query_params={"filter": f"cm_id = {session_cm_id}"}
                )
                if result.items:
                    name: str = getattr(result.items[0], "name", "")
                    return name
            except Exception as e:
                logger.debug(f"DB lookup failed for session {session_cm_id}: {e}")

        # Fallback to generic format
        return f"Session {session_cm_id}"

    def get_all_for_year(self, year: int) -> list[dict[str, Any]]:
        """Get all sessions for a given year.

        Args:
            year: The year to filter by

        Returns:
            List of session data dicts
        """
        if not self.pb:
            return []

        try:
            sessions = self.pb.collection("camp_sessions").get_full_list(query_params={"filter": f"year = {year}"})
            return [
                {
                    "id": s.id,
                    "cm_id": getattr(s, "cm_id", None),
                    "name": getattr(s, "name", ""),
                    "year": getattr(s, "year", None),
                    "session_type": getattr(s, "session_type", None),
                    "parent_id": getattr(s, "parent_id", None),
                }
                for s in sessions
            ]
        except Exception as e:
            logger.error(f"Error getting sessions for year {year}: {e}")
            return []

    def get_valid_bunking_session_ids(self, year: int) -> set[int]:
        """Get CampMinder IDs of all valid bunking sessions for a year.

        Valid bunking sessions are:
        - session_type = "main" (e.g., Session 1, 2, 3, 4)
        - session_type = "embedded" (e.g., Session 2a, 2b, 3a)
        - session_type = "ag" (e.g., All-Gender sessions)

        Excludes family camps and other non-bunking session types.

        Args:
            year: The year to filter by

        Returns:
            Set of CampMinder session IDs for valid bunking sessions
        """
        if not self.pb:
            return set()

        try:
            # Query all sessions for the year with valid bunking types
            sessions = self.pb.collection("camp_sessions").get_full_list(query_params={"filter": f"year = {year}"})
            result: set[int] = set()
            for s in sessions:
                if getattr(s, "session_type", None) in VALID_BUNKING_SESSION_TYPES:
                    cm_id = getattr(s, "cm_id", None)
                    if cm_id is not None:
                        result.add(cm_id)
            return result
        except Exception as e:
            logger.error(f"Error getting valid bunking sessions for year {year}: {e}")
            return set()

    def is_valid_bunking_session(self, session_cm_id: int, year: int) -> bool:
        """Check if a session is a valid bunking session for the given year.

        Args:
            session_cm_id: CampMinder session ID to check
            year: The year to check

        Returns:
            True if the session is valid for bunking, False otherwise
        """
        return session_cm_id in self.get_valid_bunking_session_ids(year)

    def get_related_session_ids(self, session_cm_id: int, year: int | None = None) -> list[int]:
        """Get all related session IDs for a given session.

        Related sessions use the parent_id field in the database:
        - For MAIN sessions: Returns self + any AG sessions that have parent_id = this session
        - For AG sessions: Returns self + the parent main session (from parent_id)
        - For EMBEDDED sessions: Returns only self (embedded sessions are independent)

        NOTE: Embedded sessions (2a, 2b, 3a) are INDEPENDENT - they share physical bunks
        but run during different time periods, so they are NOT considered related.

        Args:
            session_cm_id: The CampMinder ID of the session
            year: Optional year filter (defaults to current year)

        Returns:
            List of all related session CampMinder IDs (including the original)
        """
        if not self.pb:
            return [session_cm_id]

        related_ids = [session_cm_id]
        # Note: year parameter kept for API compatibility but not used in current implementation
        # (AG parent/child relationships are by CM ID, not filtered by year)

        try:
            # Get the session info
            sessions = self.pb.collection("camp_sessions").get_full_list(
                query_params={"filter": f"cm_id = {session_cm_id}"}
            )

            if not sessions:
                logger.warning(f"Session {session_cm_id} not found")
                return related_ids

            session = sessions[0]
            session_type = getattr(session, "session_type", None)
            parent_id = getattr(session, "parent_id", None)

            # If this is an AG session, add its parent main session
            if session_type == "ag" and parent_id:
                related_ids.append(parent_id)
                logger.debug(f"AG session {session_cm_id} has parent: {parent_id}")

            # If this is a main session, find any AG sessions that reference it
            if session_type == "main":
                ag_children = self.pb.collection("camp_sessions").get_full_list(
                    query_params={"filter": f'session_type = "ag" && parent_id = {session_cm_id}'}
                )
                for ag in ag_children:
                    ag_cm_id = getattr(ag, "cm_id", None)
                    if ag_cm_id is not None and ag_cm_id not in related_ids:
                        related_ids.append(ag_cm_id)
                if ag_children:
                    logger.debug(
                        f"Main session {session_cm_id} has AG children: {[getattr(ag, 'cm_id', None) for ag in ag_children]}"
                    )

            # Embedded sessions are independent - no related sessions to add
            if session_type == "embedded":
                logger.debug(f"Embedded session {session_cm_id} is independent")

            logger.info(
                f"Session {session_cm_id} ({getattr(session, 'name', 'unknown')}) has related sessions: {related_ids}"
            )

        except Exception as e:
            logger.error(f"Error finding related sessions for {session_cm_id}: {e}")

        return related_ids

    # =========================================================================
    # Session Resolution
    # =========================================================================

    def resolve_session_cm_ids(self, session_name: str, year: int) -> list[int]:
        """Resolve a session identifier to CampMinder session IDs.

        Accepts "all" for all valid bunking sessions, or a numeric cm_id string
        for a specific session. The old friendly-name system (_extract_friendly_name,
        resolve_session_name) was removed — it caused name collisions when multiple
        sessions mapped to the same short name (e.g., Taste of Camp 1 and 2 both
        mapped to "1") and pulled in cross-year AG ghost sessions.

        Args:
            session_name: "all" for all bunking sessions, or a cm_id string
            year: The year to resolve sessions for

        Returns:
            List of CampMinder session IDs

        Raises:
            ValueError: If session_name is not "all" or a valid integer
        """
        normalized = session_name.strip().lower()

        # "0" is a legacy alias for "all" (used by documented data-reset commands)
        if normalized in ("all", "0"):
            return list(self.get_valid_bunking_session_ids(year))

        try:
            cm_id = int(normalized)
        except ValueError:
            raise ValueError(f"Invalid session '{session_name}'. Use 'all' for all sessions or a numeric cm_id.")

        # Expand main sessions to include their AG children
        return self.get_related_session_ids(cm_id)


# Module-level async function for backward compatibility with solver_service_v2
async def get_related_session_ids_async(session_cm_id: int, pb_client: PocketBase | None = None) -> list[int]:
    """Async wrapper for get_related_session_ids.

    This provides backward compatibility for async code that imports this function.

    Args:
        session_cm_id: The CampMinder ID of the main session
        pb_client: Optional PocketBase client to use

    Returns:
        List of all related session CampMinder IDs (including the original)
    """
    repo = SessionRepository(pb_client)
    return await asyncio.to_thread(repo.get_related_session_ids, session_cm_id)

"""Social Graph Adapters

Adapter classes that bridge the SocialGraph to other components.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .social_graph import SocialGraph


class SocialGraphSignalsAdapter:
    """Adapter that wraps SocialGraph for confidence scorer.

    Provides a get_signals() interface that the confidence scorer expects,
    bridging to the underlying SocialGraph implementation.

    The adapter determines the appropriate session for signal lookup based
    on the requester's enrollments or falls back to available sessions.
    """

    def __init__(self, social_graph: SocialGraph, person_sessions_getter: Callable[[], dict[int, list[int]]]):
        """Initialize the adapter.

        Args:
            social_graph: The SocialGraph instance
            person_sessions_getter: Callable that returns person_cm_id -> session_cm_ids mapping
        """
        self.social_graph = social_graph
        self._get_person_sessions = person_sessions_getter

    def get_signals(self, requester_cm_id: int, target_cm_id: int) -> dict[str, bool | int | float | None]:
        """Get social signals for a requester-target pair.

        Determines the appropriate session to use based on the requester's
        enrollments or falls back to available sessions in the graph.

        Args:
            requester_cm_id: The requester's CampMinder ID
            target_cm_id: The target's CampMinder ID

        Returns:
            Dict with social signal data (in_ego_network, social_distance, etc.)
        """
        # Get current person-session mapping
        person_sessions = self._get_person_sessions()

        # Try to determine session from person-session mapping
        session_cm_id = None
        if requester_cm_id in person_sessions:
            sessions = person_sessions[requester_cm_id]
            if sessions:
                session_cm_id = sessions[0]  # Use first session

        # If we can't determine session, try each session until we find one with data
        if session_cm_id is None:
            for sid in self.social_graph.session_cm_ids:
                if self.social_graph.graphs.get(sid) and requester_cm_id in self.social_graph.graphs[sid]:
                    session_cm_id = sid
                    break

        # If still no session, use first available
        if session_cm_id is None and self.social_graph.session_cm_ids:
            session_cm_id = self.social_graph.session_cm_ids[0]

        if session_cm_id is None:
            # No sessions available, return empty signals
            return {
                "in_ego_network": False,
                "social_distance": 999,
                "shared_connections": 0,
                "network_density": None,  # Keep consistent types
                "ego_network_size": 0,
            }

        return self.social_graph.get_social_signals(requester_cm_id, target_cm_id, session_cm_id)

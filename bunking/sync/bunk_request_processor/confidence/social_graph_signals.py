"""Social Graph Signals Service - Provides social network signals for confidence scoring

This is a simplified interface that can be implemented by different
social graph backends (NetworkX, custom graph DB, etc.)"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class SocialGraphSignals(ABC):
    """Abstract interface for social graph signal providers"""

    @abstractmethod
    def get_signals(self, requester_cm_id: int, target_cm_id: int) -> dict[str, Any]:
        """Get social graph signals between two people.

        Args:
            requester_cm_id: The person making the request
            target_cm_id: The person being requested

        Returns:
            Dictionary with social signals:
            - in_ego_network: bool - Target is in requester's ego network
            - social_distance: int - Shortest path length (999 if not connected)
            - shared_connections: int - Number of mutual connections
            - network_density: float - Local network density around the pair
            - ego_network_size: int - Size of requester's ego network
        """
        pass


class NetworkXSocialGraphSignals(SocialGraphSignals):
    """NetworkX implementation of social graph signals"""

    def __init__(self, networkx_analyzer: Any) -> None:
        """Initialize with NetworkX analyzer.

        Args:
            networkx_analyzer: NetworkXAnalyzer instance
        """
        self.analyzer = networkx_analyzer

    def get_signals(self, requester_cm_id: int, target_cm_id: int) -> dict[str, Any]:
        """Get social signals from NetworkX graph"""
        if not self.analyzer:
            return self._default_signals()

        # Use the existing NetworkX analyzer method
        result: dict[str, Any] = self.analyzer.get_social_signals_for_scoring(requester_cm_id, target_cm_id)
        return result

    def _default_signals(self) -> dict[str, Any]:
        """Default signals when no graph is available"""
        return {
            "in_ego_network": False,
            "social_distance": 999,
            "shared_connections": 0,
            "network_density": 0.0,
            "ego_network_size": 0,
        }

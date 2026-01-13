"""Interfaces for the name resolution system.

Defines contracts for resolution strategies and results."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any

from ..core.models import Person


@dataclass
class ResolutionResult:
    """Result of a name resolution attempt"""

    person: Person | None = None
    confidence: float = 0.0
    method: str = "unknown"
    candidates: list[Person] | None = None
    metadata: dict[str, Any] | None = None

    def __post_init__(self) -> None:
        """Initialize defaults"""
        if self.candidates is None:
            self.candidates = []
        if self.metadata is None:
            self.metadata = {}

    @property
    def is_resolved(self) -> bool:
        """Check if resolution was successful"""
        return self.person is not None

    @property
    def is_ambiguous(self) -> bool:
        """Check if multiple candidates were found"""
        return len(self.candidates or []) > 1

    @property
    def needs_review(self) -> bool:
        """Check if manual review is needed"""
        metadata = self.metadata or {}
        return (
            self.is_ambiguous
            or (self.is_resolved and self.confidence < 0.8)
            or bool(metadata.get("below_threshold", False))
        )

    @property
    def is_impossible(self) -> bool:
        """Check if request is impossible to satisfy.

        This means we found an exact match but the target person
        is in a different session, so bunking together is impossible.
        """
        metadata = self.metadata or {}
        return bool(metadata.get("impossible", False))


class ResolutionStrategy(ABC):
    """Base class for name resolution strategies"""

    @abstractmethod
    def resolve(
        self, name: str, requester_cm_id: int, session_cm_id: int | None = None, year: int | None = None
    ) -> ResolutionResult:
        """Attempt to resolve a name to a Person.

        Args:
            name: The name to resolve
            requester_cm_id: The person making the request
            session_cm_id: Optional session context
            year: Year context for the resolution

        Returns:
            ResolutionResult with the outcome
        """
        pass

    @property
    @abstractmethod
    def name(self) -> str:
        """Strategy name for logging and debugging"""
        pass

    def resolve_with_context(
        self,
        name: str,
        requester_cm_id: int,
        session_cm_id: int | None = None,
        year: int | None = None,
        candidates: list[Person] | None = None,
        attendee_info: dict[int, dict[str, Any]] | None = None,
        all_persons: list[Person] | None = None,
    ) -> ResolutionResult:
        """Resolve a name with pre-loaded context data.

        This is an optional method for batch optimization. If not implemented,
        the pipeline will fall back to the regular resolve method.

        Args:
            name: Name to resolve
            requester_cm_id: Person making the request
            session_cm_id: Optional session context
            year: Year context for resolution
            candidates: Pre-loaded candidate persons for this name
            attendee_info: Pre-loaded attendee info dict {cm_id: {'session_cm_id': ..., 'school': ..., etc.}}
            all_persons: All persons in the system, for fallback phonetic matching

        Returns:
            ResolutionResult with the outcome
        """
        # Default implementation falls back to regular resolve
        return self.resolve(name, requester_cm_id, session_cm_id, year)

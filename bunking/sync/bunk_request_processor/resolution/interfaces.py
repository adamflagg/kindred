"""Interfaces for the name resolution system.

Defines contracts for resolution strategies and results."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import Enum
from typing import Any

from ..core.models import Person


class SessionMatch(Enum):
    """Tri-state classification for target's session vs requester's session.

    Values match the existing metadata["session_match"] strings so call sites
    can stamp `match.value` directly into ResolutionResult metadata.
    """

    SAME = "exact"
    DIFFERENT = "different"
    UNKNOWN = "unknown"


@dataclass
class ResolutionResult:
    """Result of a name resolution attempt"""

    person: Person | None = None
    confidence: float = 0.0
    method: str = "unknown"
    candidates: list[Person] | None = None
    metadata: dict[str, Any] | None = None
    target_name: str = ""  # Original name being resolved (for debugging)

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
        self,
        name: str,
        requester_cm_id: int,
        session_cm_id: int | None = None,
        year: int | None = None,
        candidates: list[Person] | None = None,
        attendee_info: dict[int, dict[str, Any]] | None = None,
        all_persons: list[Person] | None = None,
    ) -> ResolutionResult:
        """Resolve a name to a Person.

        When candidates/attendee_info/all_persons are provided, uses pre-loaded data
        for batch optimization. Otherwise falls back to database queries.
        """
        pass

    @property
    @abstractmethod
    def name(self) -> str:
        """Strategy name for logging and debugging"""
        pass

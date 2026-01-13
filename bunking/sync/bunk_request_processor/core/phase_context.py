"""PhaseContext - Immutable context passed between processing phases.

Extracts shared state from orchestrator.py to reduce coupling between phases.
Each phase receives this context rather than accessing orchestrator internals.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class PhaseContext:
    """Immutable context passed between processing phases.

    Contains all the shared data that phases need to access without
    directly referencing the orchestrator. This improves testability
    and reduces coupling.

    Attributes:
        year: The year being processed
        session_cm_ids: List of session CM IDs being processed
        person_sessions: Mapping of person_cm_id -> list of session_cm_ids
        session_attendees: Mapping of session_cm_id -> set of person_cm_ids
        ai_config: AI configuration values
    """

    year: int
    session_cm_ids: tuple[int, ...] | list[int] = field(default_factory=list)
    person_sessions: dict[int, list[int]] = field(default_factory=dict)
    session_attendees: dict[int, set[int]] = field(default_factory=dict)
    ai_config: dict[str, Any] = field(default_factory=dict)

    def get_person_sessions(self, person_cm_id: int) -> list[int]:
        """Get the sessions a person is attending.

        Args:
            person_cm_id: The person's CampMinder ID

        Returns:
            List of session CM IDs the person is in, or empty list if unknown
        """
        return self.person_sessions.get(person_cm_id, [])

    def is_person_in_session(self, person_cm_id: int, session_cm_id: int) -> bool:
        """Check if a person is in a specific session.

        Args:
            person_cm_id: The person's CampMinder ID
            session_cm_id: The session's CampMinder ID

        Returns:
            True if person is in the session, False otherwise
        """
        return session_cm_id in self.get_person_sessions(person_cm_id)

    def get_session_attendees(self, session_cm_id: int) -> set[int]:
        """Get all attendees for a session.

        Args:
            session_cm_id: The session's CampMinder ID

        Returns:
            Set of person CM IDs in the session, or empty set if unknown
        """
        return self.session_attendees.get(session_cm_id, set())

    def get_config(self, key: str, default: Any = None) -> Any:
        """Get an AI config value with a default fallback.

        Args:
            key: The config key to look up
            default: Value to return if key is not found

        Returns:
            The config value or the default
        """
        return self.ai_config.get(key, default)

    def are_in_same_session(self, person1_cm_id: int, person2_cm_id: int) -> bool:
        """Check if two people are in the same session.

        Args:
            person1_cm_id: First person's CampMinder ID
            person2_cm_id: Second person's CampMinder ID

        Returns:
            True if they share at least one session, False otherwise
        """
        sessions1 = set(self.get_person_sessions(person1_cm_id))
        sessions2 = set(self.get_person_sessions(person2_cm_id))
        return bool(sessions1 & sessions2)

    @classmethod
    def create_minimal(cls, year: int) -> PhaseContext:
        """Create a minimal context with just the year.

        Useful for testing or simple cases.

        Args:
            year: The year being processed

        Returns:
            PhaseContext with empty collections
        """
        return cls(year=year)

    @classmethod
    def create_for_session(
        cls,
        year: int,
        session_cm_id: int,
        attendee_cm_ids: set[int] | None = None,
        ai_config: dict[str, Any] | None = None,
    ) -> PhaseContext:
        """Create a context for processing a single session.

        Args:
            year: The year being processed
            session_cm_id: The session's CampMinder ID
            attendee_cm_ids: Set of person CM IDs in the session
            ai_config: Optional AI configuration

        Returns:
            PhaseContext configured for the session
        """
        attendee_set = attendee_cm_ids or set()
        session_attendees = {session_cm_id: attendee_set}

        # Build person_sessions from attendees
        person_sessions = {person_id: [session_cm_id] for person_id in attendee_set}

        return cls(
            year=year,
            session_cm_ids=[session_cm_id],
            person_sessions=person_sessions,
            session_attendees=session_attendees,
            ai_config=ai_config or {},
        )

"""Group resolvers for expanding group references into individual bunk requests.

Group references like "bunk with sibling", "same cabin as last year bunkmates",
or "with classmates" get expanded into concrete person-to-person requests."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Protocol, runtime_checkable

from bunking.logging_config import get_logger
from bunking.sync.bunk_request_processor.core.models import (
    ParsedRequest,
    Person,
    RequestType,
)

if TYPE_CHECKING:
    from bunking.sync.bunk_request_processor.data.repositories.attendee_repository import AttendeeRepository
    from bunking.sync.bunk_request_processor.data.repositories.person_repository import PersonRepository

logger = get_logger(__name__)


@dataclass
class ResolvedGroupMember:
    """A single member resolved from a group expansion.

    Attributes:
        person: The resolved Person object
        confidence: Confidence score for this expansion (0.0 to 1.0)
        request_type: The type of request (BUNK_WITH or NOT_BUNK_WITH)
        metadata: Additional context about the expansion
    """

    person: Person
    confidence: float
    request_type: RequestType
    metadata: dict[str, Any] = field(default_factory=dict)


@runtime_checkable
class GroupResolver(Protocol):
    """Protocol defining the interface for group resolution strategies."""

    @property
    def base_confidence(self) -> float:
        """Base confidence score for this resolver type."""
        ...

    def resolve(
        self,
        requester_cm_id: int,
        parsed_request: ParsedRequest,
        session_cm_id: int,
    ) -> list[ResolvedGroupMember]:
        """Resolve a group reference into individual members.

        Args:
            requester_cm_id: CampMinder ID of the person making the request
            parsed_request: The parsed request containing the group reference
            session_cm_id: The session this request applies to

        Returns:
            List of ResolvedGroupMember objects, one per expanded person
        """
        ...


class SiblingResolver:
    """Resolves sibling group references using household_id matching.

    Expands requests like "bunk with sibling" into individual requests
    for each sibling found via the person repository.
    """

    def __init__(self, person_repo: PersonRepository, year: int) -> None:
        self._person_repo = person_repo
        self._year = year

    @property
    def base_confidence(self) -> float:
        return 0.95

    def resolve(
        self,
        requester_cm_id: int,
        parsed_request: ParsedRequest,
        session_cm_id: int,
    ) -> list[ResolvedGroupMember]:
        """Resolve sibling references by looking up household members.

        Args:
            requester_cm_id: CampMinder ID of the requester
            parsed_request: The parsed request with group_kind=SIBLING
            session_cm_id: The session this request applies to

        Returns:
            List of ResolvedGroupMember for each sibling found
        """
        siblings = self._person_repo.find_siblings(requester_cm_id, self._year)

        if not siblings:
            logger.debug("No siblings found for person %s in year %s", requester_cm_id, self._year)
            return []

        result = []
        for sibling in siblings:
            member = ResolvedGroupMember(
                person=sibling,
                confidence=self.base_confidence,
                request_type=parsed_request.request_type,
                metadata={"expanded_from": "sibling"},
            )
            result.append(member)

        logger.info(
            "Resolved %d sibling(s) for person %s: %s",
            len(result),
            requester_cm_id,
            [s.person.full_name for s in result],
        )
        return result

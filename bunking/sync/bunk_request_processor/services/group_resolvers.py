"""Group resolvers for expanding group references into individual bunk requests.

Group references like "bunk with sibling", "same cabin as last year bunkmates",
or "with classmates" get expanded into concrete person-to-person requests."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Protocol, runtime_checkable

from bunking.logging_config import get_logger
from bunking.sync.bunk_request_processor.core.models import (
    GroupKind,
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


class BunkmateResolver:
    """Resolves prior year bunkmate group references.

    Expands requests like "same cabin as last year" into individual BUNK_WITH
    requests for each returning bunkmate from the prior year's cabin assignment.
    """

    def __init__(self, attendee_repo: AttendeeRepository, person_repo: PersonRepository, year: int) -> None:
        self._attendee_repo = attendee_repo
        self._person_repo = person_repo
        self._year = year

    @property
    def base_confidence(self) -> float:
        return 0.90

    def resolve(
        self,
        requester_cm_id: int,
        parsed_request: ParsedRequest,
        session_cm_id: int,
    ) -> list[ResolvedGroupMember]:
        """Resolve prior year bunkmate references.

        Looks up the requester's cabin from last year, finds returning
        bunkmates, and creates BUNK_WITH requests for each.

        Args:
            requester_cm_id: CampMinder ID of the requester
            parsed_request: The parsed request with group_kind=LAST_YEAR_BUNKMATES
            session_cm_id: The session this request applies to

        Returns:
            List of ResolvedGroupMember for each returning bunkmate
        """
        bunkmate_data = self._attendee_repo.find_prior_year_bunkmates(requester_cm_id, session_cm_id, self._year)

        if not bunkmate_data or not bunkmate_data.get("cm_ids"):
            logger.debug("No prior year bunkmates found for person %s", requester_cm_id)
            return []

        prior_bunk = bunkmate_data.get("prior_bunk")
        prior_year = bunkmate_data.get("prior_year")

        result = []
        for cm_id in bunkmate_data["cm_ids"]:
            person = self._person_repo.find_by_cm_id(cm_id)
            if person is None:
                logger.warning("Could not resolve bunkmate cm_id %s to a Person", cm_id)
                continue

            member = ResolvedGroupMember(
                person=person,
                confidence=self.base_confidence,
                request_type=RequestType.BUNK_WITH,
                metadata={
                    "expanded_from": "last_year_bunkmates",
                    "prior_bunk": prior_bunk,
                    "prior_year": prior_year,
                },
            )
            result.append(member)

        logger.info(
            "Resolved %d bunkmate(s) for person %s from %s (year %s): %s",
            len(result),
            requester_cm_id,
            prior_bunk,
            prior_year,
            [m.person.full_name for m in result],
        )
        return result


class _SchoolCongregationBaseResolver:
    """Base class for school and congregation resolvers.

    Shared logic: look up all session attendees, resolve to Person objects,
    then filter by a matching field value, grade (+-1), gender, and exclude self.
    """

    def __init__(self, person_repo: PersonRepository, attendee_repo: AttendeeRepository, year: int) -> None:
        self._person_repo = person_repo
        self._attendee_repo = attendee_repo
        self._year = year

    @property
    def base_confidence(self) -> float:
        return 0.85

    def _get_field_value(self, person: Person) -> str | None:
        """Get the field value to match on (school or congregation).

        Subclasses must override this.
        """
        raise NotImplementedError

    def _expanded_from_label(self) -> str:
        """Label for the expanded_from metadata field.

        Subclasses must override this.
        """
        raise NotImplementedError

    def resolve(
        self,
        requester_cm_id: int,
        parsed_request: ParsedRequest,
        session_cm_id: int,
    ) -> list[ResolvedGroupMember]:
        """Resolve group references by matching a shared attribute among session peers.

        Filters: same field value, same session, +-1 grade, same gender, exclude self.

        Args:
            requester_cm_id: CampMinder ID of the requester
            parsed_request: The parsed request
            session_cm_id: The session this request applies to

        Returns:
            List of ResolvedGroupMember for each matching peer
        """
        # Look up the requester to get their field value, grade, and gender
        requester = self._person_repo.find_by_cm_id(requester_cm_id)
        if requester is None:
            logger.warning("Could not find requester %s for group resolution", requester_cm_id)
            return []

        requester_field = self._get_field_value(requester)
        if not requester_field:
            logger.debug(
                "No %s data for requester %s, skipping group expansion",
                self._expanded_from_label(),
                requester_cm_id,
            )
            return []

        requester_grade = requester.grade
        requester_gender = getattr(requester, "gender", None)

        # Get all session attendees
        attendees = self._attendee_repo.get_session_attendees(session_cm_id, self._year)
        if not attendees:
            return []

        # Get cm_ids for bulk lookup (exclude self)
        peer_cm_ids = [a["person_cm_id"] for a in attendees if a["person_cm_id"] != requester_cm_id]
        if not peer_cm_ids:
            return []

        # Bulk fetch persons
        persons_dict = self._person_repo.bulk_find_by_cm_ids(peer_cm_ids)

        # Filter peers
        result = []
        for cm_id in peer_cm_ids:
            person = persons_dict.get(cm_id)
            if person is None:
                continue

            # Check matching field value
            peer_field = self._get_field_value(person)
            if not peer_field or peer_field != requester_field:
                continue

            # Check grade (+-1)
            peer_grade = person.grade
            if requester_grade is None or peer_grade is None:
                continue
            if abs(requester_grade - peer_grade) > 1:
                continue

            # Check gender
            peer_gender = getattr(person, "gender", None)
            if requester_gender is None or peer_gender is None:
                continue
            if peer_gender != requester_gender:
                continue

            member = ResolvedGroupMember(
                person=person,
                confidence=self.base_confidence,
                request_type=parsed_request.request_type,
                metadata={"expanded_from": self._expanded_from_label()},
            )
            result.append(member)

        logger.info(
            "Resolved %d %s peer(s) for person %s (%s): %s",
            len(result),
            self._expanded_from_label(),
            requester_cm_id,
            requester_field,
            [m.person.full_name for m in result],
        )
        return result


class ClassmateResolver(_SchoolCongregationBaseResolver):
    """Resolves classmate group references by matching school.

    Finds campers at the same school, in the same session,
    within +-1 grade, matching gender.
    """

    def _get_field_value(self, person: Person) -> str | None:
        return person.school

    def _expanded_from_label(self) -> str:
        return "classmates"


class CongregationResolver(_SchoolCongregationBaseResolver):
    """Resolves congregation group references by matching normalized_congregation.

    Finds campers in the same congregation, in the same session,
    within +-1 grade, matching gender. Congregation data is stored
    in person.metadata['normalized_congregation'].
    """

    def _get_field_value(self, person: Person) -> str | None:
        return person.metadata.get("normalized_congregation") if person.metadata else None

    def _expanded_from_label(self) -> str:
        return "congregation"


def build_resolver_registry(
    attendee_repo: AttendeeRepository,
    person_repo: PersonRepository,
    year: int,
) -> dict[GroupKind, GroupResolver]:
    """Build a registry mapping each GroupKind to its resolver.

    Args:
        attendee_repo: Repository for attendee/bunkmate lookups
        person_repo: Repository for person/sibling lookups
        year: The current year for all resolvers

    Returns:
        Dict mapping GroupKind to initialized GroupResolver instances
    """
    return {
        GroupKind.SIBLING: SiblingResolver(person_repo, year),
        GroupKind.LAST_YEAR_BUNKMATES: BunkmateResolver(attendee_repo, person_repo, year),
        GroupKind.CLASSMATES: ClassmateResolver(person_repo, attendee_repo, year),
        GroupKind.CONGREGATION: CongregationResolver(person_repo, attendee_repo, year),
    }

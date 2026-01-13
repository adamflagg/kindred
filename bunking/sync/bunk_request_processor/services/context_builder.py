"""Context Builder Service - Constructs appropriate contexts for each processing phase"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import TYPE_CHECKING, Any

from ..core.models import Person
from ..integration.ai_service import AIRequestContext
from ..shared.constants import LAST_YEAR_BUNKMATES_PLACEHOLDER
from ..shared.nickname_groups import find_nickname_variations

if TYPE_CHECKING:
    from ..data.repositories import AttendeeRepository, PersonRepository

logger = logging.getLogger(__name__)


class ContextBuilder:
    """Builds appropriate contexts for each phase of processing.

    including ambiguity-type-based candidate search and self-reference prevention.
    """

    def __init__(
        self,
        person_repository: PersonRepository | None = None,
        attendee_repository: AttendeeRepository | None = None,
        config_service: Any | None = None,
    ):
        """Initialize context builder with optional dependencies.

        Args:
            person_repository: Repository for person data access
            attendee_repository: Repository for attendee data access
            config_service: Configuration service for AI config
        """
        self.person_repository = person_repository
        self.attendee_repository = attendee_repository
        self.config_service = config_service

    def build_parse_only_context(
        self,
        requester_name: str,
        requester_cm_id: int,
        requester_grade: str,
        session_cm_id: int,
        session_name: str,
        year: int,
        field_name: str,
        additional_data: dict[str, Any] | None = None,
    ) -> AIRequestContext:
        """Build context for Phase 1 parse-only mode.

        This context tells the AI to extract request structure without
        attempting to match names to specific person IDs.
        """
        additional_context = {
            "parse_only": True,  # CRITICAL FLAG
            "field_type": field_name,
            "csv_source_field": field_name,
            "NEVER_USE_AS_TARGET": requester_cm_id,  # Self-reference prevention
            "requester_grade": requester_grade,
            "session_name": session_name,
        }

        # Add any additional data
        if additional_data:
            additional_context.update(additional_data)

        return AIRequestContext(
            requester_name=requester_name,
            requester_cm_id=requester_cm_id,
            session_cm_id=session_cm_id,
            year=year,
            additional_context=additional_context,
        )

    def build_disambiguation_context(
        self,
        target_name: str,
        candidates: list[Person],
        requester_name: str,
        requester_cm_id: int,
        requester_school: str | None,
        session_cm_id: int,
        session_name: str,
        year: int,
        ambiguity_reason: str,
        local_confidence: float,
        needs_historical: bool = False,
    ) -> AIRequestContext:
        """Build context for Phase 3 AI disambiguation.

        - Includes NEVER_USE_AS_TARGET to prevent self-references (line 2732)
          - 'multiple_matches' -> use provided candidates
          - 'first_name_only_or_unclear' -> fresh phonetic search
          - Default -> age-filtered session attendees
        """
        # Determine which candidates to use based on ambiguity type
        final_candidates = self._select_candidates_by_ambiguity_type(
            ambiguity_reason=ambiguity_reason,
            provided_candidates=candidates,
            target_name=target_name,
            requester_cm_id=requester_cm_id,
            session_cm_id=session_cm_id,
            year=year,
        )

        # Format candidates with relevant details
        candidates_data = self._format_candidates(final_candidates[:5])  # Top 5 only

        additional_context: dict[str, Any] = {
            "parse_only": False,  # We want ID matching now
            "candidates": candidates_data,
            "target_name": target_name,
            "ambiguity_reason": ambiguity_reason,
            "local_confidence": local_confidence,
            "requester_school": requester_school,
            "session_name": session_name,
            "disambiguation_mode": True,  # Signal this is disambiguation
            "needs_historical_context": needs_historical,
            "NEVER_USE_AS_TARGET": requester_cm_id,
        }

        if self.config_service:
            try:
                ai_config = self.config_service.get_ai_config()
                nickname_mappings = ai_config.get("name_matching", {}).get("common_nicknames", {})
                additional_context["nickname_mappings"] = nickname_mappings
            except Exception as e:
                logger.warning(f"Failed to get nickname_mappings from config: {e}")

        if needs_historical:
            additional_context["previous_year"] = year - 1
            if self.attendee_repository:
                try:
                    prior_bunkmates = self.attendee_repository.find_prior_year_bunkmates(
                        requester_cm_id,
                        session_cm_id,
                        year,
                    )
                    additional_context["previous_year_bunkmates"] = prior_bunkmates if prior_bunkmates else None
                except Exception as e:
                    logger.warning(f"Failed to fetch prior year bunkmates: {e}")
                    additional_context["previous_year_bunkmates"] = None

        return AIRequestContext(
            requester_name=requester_name,
            requester_cm_id=requester_cm_id,
            session_cm_id=session_cm_id,
            year=year,
            additional_context=additional_context,
        )

    def _select_candidates_by_ambiguity_type(
        self,
        ambiguity_reason: str,
        provided_candidates: list[Person],
        target_name: str,
        requester_cm_id: int,
        session_cm_id: int,
        year: int,
    ) -> list[Person]:
        """Select candidates based on ambiguity type.

        - 'multiple_matches' -> use specific candidate_ids from metadata
        - 'first_name_only_or_unclear' -> fresh phonetic search (up to 20)
        - Default -> age-filtered session attendees fallback
        """
        # If we have provided candidates and ambiguity is 'multiple_matches', use them
        if provided_candidates and "multiple_matches" in ambiguity_reason.lower():
            return provided_candidates

        # If no repositories available, fall back to provided candidates
        if not self.attendee_repository:
            return provided_candidates

        if "first_name_only" in ambiguity_reason.lower() or "unclear" in ambiguity_reason.lower():
            if target_name and self.person_repository:
                phonetic_results = self.get_phonetically_similar_attendees(
                    target_name=target_name,
                    requester_cm_id=requester_cm_id,
                    session_cm_id=session_cm_id,
                    year=year,
                    max_results=20,
                )
                # Convert dict results to Person objects
                return self._dicts_to_persons(phonetic_results)

        if not provided_candidates:
            age_filtered = self.get_age_filtered_session_attendees(
                requester_cm_id=requester_cm_id,
                session_cm_id=session_cm_id,
                year=year,
            )
            return self._dicts_to_persons(age_filtered)

        return provided_candidates

    def _dicts_to_persons(self, attendee_dicts: list[dict[str, Any]]) -> list[Person]:
        """Convert list of attendee dicts to Person objects"""
        persons = []
        for d in attendee_dicts:
            person = Person(
                cm_id=d.get("person_id", 0),
                first_name=d.get("first_name", d.get("name", "").split()[0] if d.get("name") else ""),
                last_name=d.get(
                    "last_name",
                    d.get("name", "").split()[-1] if d.get("name") and len(d.get("name", "").split()) > 1 else "",
                ),
                grade=d.get("grade"),
                school=d.get("school"),
                birth_date=d.get("birth_date"),
            )
            persons.append(person)
        return persons

    def get_phonetically_similar_attendees(
        self,
        target_name: str,
        requester_cm_id: int,
        session_cm_id: int,
        year: int,
        max_results: int = 20,
    ) -> list[dict[str, Any]]:
        """Get attendees with phonetically similar names to the target.

        - Same-session attendees only
        - First 3 letters matching (line 2826)
        - Reverse prefix matching (line 2827)
        - Nickname group matching (line 2828)
        - Limits to max_results (default 20)
        - Excludes requester

        Args:
            target_name: Name to find similar matches for
            requester_cm_id: The requester (for session context and exclusion)
            session_cm_id: Session to search within
            year: Year for attendee lookup
            max_results: Maximum number of results to return

        Returns:
            List of attendee dicts with similar names
        """
        if not self.attendee_repository or not self.person_repository:
            return []

        similar_attendees: list[dict[str, Any]] = []

        # Parse target name
        target_parts = target_name.lower().split()
        if not target_parts:
            return []

        target_first = target_parts[0]
        target_first_3 = target_first[:3] if len(target_first) >= 3 else target_first

        # Get nickname variations for target
        target_nicknames = set(find_nickname_variations(target_first))
        target_nicknames.add(target_first.lower())

        # Get all session attendees
        session_attendees = self.attendee_repository.get_session_attendees(session_cm_id, year)

        # Get all person CM IDs from attendees
        person_cm_ids_raw = [a.get("person_cm_id") for a in session_attendees if a.get("person_cm_id")]
        person_cm_ids: list[int] = [cm_id for cm_id in person_cm_ids_raw if cm_id is not None]

        if not person_cm_ids:
            return []

        # Bulk load person data
        persons_by_id = self.person_repository.bulk_find_by_cm_ids(person_cm_ids)

        # Check each attendee for phonetic similarity
        for attendee in session_attendees:
            person_cm_id = attendee.get("person_cm_id")

            # Skip requester
            if person_cm_id == requester_cm_id:
                continue

            if person_cm_id is None:
                continue
            person = persons_by_id.get(person_cm_id)
            if not person:
                continue

            first_name = (person.first_name or "").lower()
            if not first_name:
                continue

            first_name_3 = first_name[:3] if len(first_name) >= 3 else first_name

            is_match = False

            # 1. First 3 letters matching (line 2826)
            if (
                first_name.startswith(target_first_3)
                or (len(first_name_3) >= 3 and first_name_3 == target_first_3)
                or len(first_name) >= 2
                and target_first.startswith(first_name[: min(3, len(first_name))])
                or first_name in target_nicknames
            ):
                is_match = True
            else:
                # Check if person's name variations include target
                person_nicknames = set(find_nickname_variations(first_name))
                person_nicknames.add(first_name)
                if target_first in person_nicknames:
                    is_match = True

            if is_match:
                attendee_data = {
                    "name": f"{person.first_name} {person.last_name}",
                    "first_name": person.first_name,
                    "last_name": person.last_name,
                    "person_id": person_cm_id,
                    "grade": person.grade,
                    "age": self._calculate_age(person.birth_date) if person.birth_date else None,
                    "session": session_cm_id,
                    "session_cm_id": session_cm_id,
                }
                similar_attendees.append(attendee_data)

                if len(similar_attendees) >= max_results:
                    break

        return similar_attendees

    def get_age_filtered_session_attendees(
        self,
        requester_cm_id: int,
        session_cm_id: int,
        year: int,
    ) -> list[dict[str, Any]]:
        """Get age-filtered attendees from the same session.

        - Uses config's max_age_difference_months (default 24)
        - Returns attendees within age range
        - Excludes requester

        Args:
            requester_cm_id: The person making the request
            session_cm_id: Session to get attendees from
            year: Year for attendee lookup

        Returns:
            List of attendee info dicts with name, person_id, grade, age, session
        """
        if not self.attendee_repository:
            return []

        # Get config value for max age difference
        max_age_diff_months = 24  # Default
        if self.config_service:
            try:
                ai_config = self.config_service.get_ai_config()
                context_config = ai_config.get("context_building", {})
                max_age_diff_months = context_config.get("max_age_difference_months", 24)
            except Exception:
                pass

        # Use repository's age-filtered method
        peers = self.attendee_repository.get_age_filtered_session_peers(
            person_cm_id=requester_cm_id,
            session_cm_id=session_cm_id,
            year=year,
            max_age_diff_months=max_age_diff_months,
        )

        # Get prior year bunkmates to populate was_bunkmate flag
        prior_bunkmate_ids: set[int] = set()
        try:
            prior_data = self.attendee_repository.find_prior_year_bunkmates(requester_cm_id, session_cm_id, year)
            if prior_data and prior_data.get("cm_ids"):
                prior_bunkmate_ids = set(prior_data["cm_ids"])
        except Exception as e:
            logger.debug(f"Could not get prior bunkmates for was_bunkmate flag: {e}")

        result = []
        for person in peers:
            # Skip requester (shouldn't be in results, but double-check)
            if person.cm_id == requester_cm_id:
                continue

            attendee_data = {
                "name": f"{person.first_name} {person.last_name}",
                "first_name": person.first_name,
                "last_name": person.last_name,
                "person_id": person.cm_id,
                "grade": person.grade,
                "age": self._calculate_age(person.birth_date) if person.birth_date else None,
                "session": session_cm_id,
                "session_cm_id": session_cm_id,
                "was_bunkmate": person.cm_id in prior_bunkmate_ids,
            }
            result.append(attendee_data)

        return result

    def build_historical_context(
        self,
        requester_cm_id: int,
        target_name: str,
        session_name: str,
        previous_year: int,
        previous_attendees: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Build historical context for requests that need prior year information.

        This is used when AI signals it needs historical context for
        requests like "same as last year".
        """
        # Filter to relevant attendees only
        relevant_attendees = self._filter_relevant_attendees(target_name, previous_attendees, requester_cm_id)

        return {
            "previous_year": previous_year,
            "previous_year_attendees": relevant_attendees,
            "session_name": session_name,
            "historical_context_type": "filtered",  # Not full list
        }

    def _format_candidates(self, candidates: list[Person]) -> list[dict[str, Any]]:
        """Format candidate information for AI disambiguation.

        Includes parent/guardian names when available to help disambiguate
        campers who might be referred to by their parents' last names.
        """
        formatted = []

        for candidate in candidates:
            candidate_data = {
                "person_id": candidate.cm_id,
                "name": f"{candidate.first_name} {candidate.last_name}",
                "first_name": candidate.first_name,
                "last_name": candidate.last_name,
                "preferred_name": candidate.preferred_name,
                "school": candidate.school,
                "grade": candidate.grade,
                "age": self._calculate_age(candidate.birth_date) if candidate.birth_date else None,
            }

            # Add parent/guardian names if available
            # This helps AI disambiguate when requests use parent surnames
            # Format: "Mother: Sarah Katz, Father: David Smith"
            parent_names = candidate.parent_names_formatted
            if parent_names:
                candidate_data["parents"] = parent_names

            # Add social signals if available in metadata
            if hasattr(candidate, "metadata") and candidate.metadata:
                if "social_distance" in candidate.metadata:
                    candidate_data["social_distance"] = candidate.metadata["social_distance"]
                if "mutual_connections" in candidate.metadata:
                    candidate_data["mutual_connections"] = candidate.metadata["mutual_connections"]
                if "found_by" in candidate.metadata:
                    candidate_data["found_by"] = candidate.metadata["found_by"]
                if "in_same_session" in candidate.metadata:
                    candidate_data["in_same_session"] = candidate.metadata["in_same_session"]

            formatted.append(candidate_data)

        return formatted

    def _filter_relevant_attendees(
        self, target_name: str, attendees: list[dict[str, Any]], requester_cm_id: int
    ) -> list[dict[str, Any]]:
        """Filter attendees to only those potentially relevant for the target name.

        This reduces the context size for historical lookups.
        """
        if not target_name or target_name == LAST_YEAR_BUNKMATES_PLACEHOLDER:
            # For generic "last year" requests, return bunkmates only
            return [a for a in attendees if a.get("was_bunkmate", False)]

        # For specific names, filter by name similarity
        target_parts = target_name.lower().split()
        if not target_parts:
            return []

        relevant = []
        for attendee in attendees:
            # Skip self
            if attendee.get("person_id") == requester_cm_id:
                continue

            # Check name similarity
            first_name = (attendee.get("first_name") or "").lower()
            last_name = (attendee.get("last_name") or "").lower()

            # First name match or partial match
            if (
                target_parts[0] in first_name
                or first_name in target_parts[0]
                or len(target_parts) > 1
                and (target_parts[-1] in last_name or last_name in target_parts[-1])
            ):
                relevant.append(attendee)

        # Limit to top 20 to keep context reasonable
        return relevant[:20]

    def _calculate_age(self, birth_date: str | datetime) -> int | None:
        """Calculate age from birth date string or datetime"""
        if not birth_date:
            return None

        try:
            from datetime import datetime

            # Handle both string and datetime inputs
            if isinstance(birth_date, str):
                birth = datetime.strptime(birth_date[:10], "%Y-%m-%d")
            else:
                birth = birth_date

            today = datetime.now()
            age = today.year - birth.year
            if today.month < birth.month or (today.month == birth.month and today.day < birth.day):
                age -= 1
            return age
        except Exception:
            return None

"""Exact match strategy for name resolution.

Implements exact name matching with session context awareness."""

from __future__ import annotations

from typing import Any

from ...core.models import Person
from ...data.repositories import AttendeeRepository, PersonRepository
from ...shared import last_name_matches, parse_name
from ..interfaces import ResolutionResult
from .base_match_strategy import BaseMatchStrategy


class ExactMatchStrategy(BaseMatchStrategy):
    """Strategy for exact name matching.

    Inherits shared disambiguation logic from BaseMatchStrategy.
    """

    def __init__(
        self,
        person_repository: PersonRepository,
        attendee_repository: AttendeeRepository,
        config: dict[str, Any] | None = None,
    ):
        """Initialize the exact match strategy.

        Args:
            person_repository: Repository for person data access
            attendee_repository: Repository for attendee data access
            config: Optional config dict with confidence values
        """
        super().__init__(person_repository, attendee_repository, config)
        self._strategy_name = "exact_match"

    def resolve(
        self, name: str, requester_cm_id: int, session_cm_id: int | None = None, year: int | None = None
    ) -> ResolutionResult:
        """Attempt exact name resolution.

        Args:
            name: Name to resolve (expected format: "First Last")
            requester_cm_id: Person making the request
            session_cm_id: Optional session context
            year: Year context for resolution

        Returns:
            ResolutionResult with match outcome
        """
        # Parse the name
        parsed = parse_name(name)
        if not parsed.is_complete:
            # Exact match requires full name
            return ResolutionResult(confidence=0.0, method=self.name, metadata={"reason": "incomplete_name"})

        # Search for exact matches, filtering by year if available
        matches = self.person_repo.find_by_name(parsed.first.title(), parsed.last.title(), year=year)

        # Filter out self-references using base class method
        matches = self._filter_self_references(matches, requester_cm_id)

        if not matches:
            # Try matching via parent surname
            result = self._try_parent_surname_match(
                parsed.first.title(), parsed.last.title(), requester_cm_id, session_cm_id, year
            )
            if result.is_resolved or result.is_ambiguous:
                return result

        if not matches:
            return ResolutionResult(confidence=0.0, method=self.name, metadata={"reason": "no_match"})

        if len(matches) == 1:
            # Single match - check session if available
            if year:
                # Get requester session if not provided
                if session_cm_id is None:
                    requester_info = self.attendee_repo.get_by_person_and_year(requester_cm_id, year)
                    if requester_info:
                        session_cm_id = requester_info["session_cm_id"]

                if session_cm_id:
                    # Verify session match
                    sessions_map = self.attendee_repo.bulk_get_sessions_for_persons([matches[0].cm_id], year)
                    match_session = sessions_map.get(matches[0].cm_id)

                    if match_session == session_cm_id:
                        return ResolutionResult(
                            person=matches[0],
                            confidence=0.95,
                            method=self.name,
                            metadata={"match_type": "unique", "session_match": "exact"},
                        )
                    else:
                        return ResolutionResult(
                            person=matches[0],
                            confidence=0.85,  # Lower confidence for different session
                            method=self.name,
                            metadata={"match_type": "unique", "session_match": "different"},
                        )
                else:
                    # No session context available
                    return ResolutionResult(
                        person=matches[0],
                        confidence=0.90,  # Lower confidence without session verification
                        method=self.name,
                        metadata={"match_type": "unique", "no_session_info": True},
                    )
            else:
                # No year context
                return ResolutionResult(
                    person=matches[0],
                    confidence=0.90,  # Lower confidence without year context
                    method=self.name,
                    metadata={"match_type": "unique"},
                )

        # Multiple matches - try to disambiguate with session
        if year:
            return self._disambiguate_with_session(matches, requester_cm_id, session_cm_id, year)

        # Multiple matches without year context
        return ResolutionResult(
            candidates=matches,
            confidence=0.5,
            method=self.name,
            metadata={"ambiguity_reason": "multiple_matches_no_year", "match_count": len(matches)},
        )

    def _disambiguate_with_session(
        self, matches: list[Person], requester_cm_id: int, session_cm_id: int | None, year: int
    ) -> ResolutionResult:
        """Disambiguate multiple matches using session information"""
        # Get requester's session if not provided
        if session_cm_id is None:
            requester_info = self.attendee_repo.get_by_person_and_year(requester_cm_id, year)
            if requester_info:
                session_cm_id = requester_info["session_cm_id"]

        if not session_cm_id:
            # Can't disambiguate without session
            return ResolutionResult(
                candidates=matches,
                confidence=0.5,
                method=self.name,
                metadata={"ambiguity_reason": "multiple_matches_no_session", "match_count": len(matches)},
            )

        # Get sessions for all matches
        match_cm_ids = [m.cm_id for m in matches]
        sessions_map = self.attendee_repo.bulk_get_sessions_for_persons(match_cm_ids, year)

        # Filter by same session
        same_session_matches = [m for m in matches if sessions_map.get(m.cm_id) == session_cm_id]

        if len(same_session_matches) == 1:
            # Unique match in same session
            return ResolutionResult(
                person=same_session_matches[0],
                confidence=0.95,
                method=self.name,
                metadata={"match_type": "unique_same_session", "session_match": "exact"},
            )
        elif len(same_session_matches) > 1:
            # Still ambiguous within session
            return ResolutionResult(
                candidates=same_session_matches,
                confidence=0.5,
                method=self.name,
                metadata={
                    "ambiguity_reason": "multiple_same_session_matches",
                    "match_count": len(same_session_matches),
                    "session_match": "exact",
                },
            )
        else:
            # No matches in same session - mark as IMPOSSIBLE
            # The target exists but is in a different session, so bunking is impossible
            if len(matches) == 1:
                return ResolutionResult(
                    person=matches[0],  # Include who we found for reference
                    confidence=0.0,
                    method=self.name,
                    metadata={
                        "impossible": True,
                        "impossible_reason": "target_in_different_session",
                        "match_type": "exact_different_session",
                        "target_session": sessions_map.get(matches[0].cm_id),
                        "requester_session": session_cm_id,
                    },
                )
            else:
                # Multiple exact matches, all in different sessions
                return ResolutionResult(
                    candidates=matches,
                    confidence=0.0,
                    method=self.name,
                    metadata={
                        "impossible": True,
                        "impossible_reason": "all_matches_in_different_sessions",
                        "match_count": len(matches),
                    },
                )

    def _try_parent_surname_match(
        self, first_name: str, last_name: str, requester_cm_id: int, session_cm_id: int | None, year: int | None
    ) -> ResolutionResult:
        """Try matching first name + parent's last name.

        When the provided last name doesn't match the camper's last name,
        check if it matches a parent's last name. This handles cases where
        requests use the "wrong" parent's surname.

        Confidence is slightly lower (0.90 vs 0.95) than direct matches.
        """
        # Check if person_repo has name_cache with parent surname support
        if not hasattr(self.person_repo, "name_cache") or not self.person_repo.name_cache:
            # No cache available, try iterating through all persons
            return self._try_parent_surname_match_via_db(first_name, last_name, requester_cm_id, session_cm_id, year)

        # Use cache's parent surname lookup
        matches = self.person_repo.name_cache.find_by_parent_surname(first_name, last_name)

        # Filter out self-references
        matches = self._filter_self_references(matches, requester_cm_id)

        if not matches:
            return ResolutionResult(confidence=0.0, method=self.name)

        if len(matches) == 1:
            # Single match via parent surname
            confidence = 0.90  # Slightly lower than direct match (0.95)
            if year and session_cm_id:
                sessions_map = self.attendee_repo.bulk_get_sessions_for_persons([matches[0].cm_id], year)
                if sessions_map.get(matches[0].cm_id) == session_cm_id:
                    confidence = 0.90
                else:
                    confidence = 0.80  # Lower for different session
            return ResolutionResult(
                person=matches[0],
                confidence=confidence,
                method=self.name,
                metadata={
                    "match_type": "parent_surname",
                    "parent_last_name": last_name,
                    "camper_last_name": matches[0].last_name,
                },
            )

        # Multiple matches - ambiguous
        return ResolutionResult(
            candidates=matches,
            confidence=0.45,
            method=self.name,
            metadata={
                "ambiguity_reason": "multiple_parent_surname_matches",
                "match_count": len(matches),
                "match_type": "parent_surname",
            },
        )

    def _try_parent_surname_match_via_db(
        self, first_name: str, last_name: str, requester_cm_id: int, session_cm_id: int | None, year: int | None
    ) -> ResolutionResult:
        """Fallback parent surname matching via database scan.

        Used when name_cache is not available.
        """
        # Get all persons and filter by parent surname
        try:
            all_persons = self.person_repo.get_all_for_phonetic_matching(year=year)
        except Exception:
            return ResolutionResult(confidence=0.0, method=self.name)

        matches = []
        first_lower = first_name.lower()
        last_lower = last_name.lower()

        for person in all_persons:
            # Check if first name matches
            person_first = (person.first_name or "").lower()
            person_preferred = (person.preferred_name or "").lower()
            if person_first != first_lower and person_preferred != first_lower:
                continue

            # Check if last name matches any parent surname
            for parent_surname in person.parent_last_names:
                if parent_surname.lower() == last_lower:
                    matches.append(person)
                    break

        # Filter out self-references
        matches = self._filter_self_references(matches, requester_cm_id)

        if not matches:
            return ResolutionResult(confidence=0.0, method=self.name)

        if len(matches) == 1:
            return ResolutionResult(
                person=matches[0],
                confidence=0.90,
                method=self.name,
                metadata={
                    "match_type": "parent_surname",
                    "parent_last_name": last_name,
                    "camper_last_name": matches[0].last_name,
                },
            )

        return ResolutionResult(
            candidates=matches,
            confidence=0.45,
            method=self.name,
            metadata={
                "ambiguity_reason": "multiple_parent_surname_matches",
                "match_count": len(matches),
                "match_type": "parent_surname",
            },
        )

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
        """Resolve using pre-loaded candidates and attendee info.

        This optimized method uses pre-loaded data to avoid database queries.
        """
        # Parse the name
        parsed = parse_name(name)
        if not parsed.is_complete:
            # Exact match requires full name
            return ResolutionResult(confidence=0.0, method=self.name, metadata={"reason": "incomplete_name"})

        # Filter candidates for exact name match (with compound last name support)
        first_t, last_t = parsed.first.title(), parsed.last.title()
        if candidates is not None:
            matches = [
                c for c in candidates if c.first_name.title() == first_t and last_name_matches(last_t, c.last_name)
            ]
        else:
            # Fall back to database query if no candidates provided
            matches = self.person_repo.find_by_name(first_t, last_t, year=year)

        # Filter out self-references
        matches = self._filter_self_references(matches, requester_cm_id)

        if not matches:
            # Try matching via parent surname with pre-loaded candidates (or all_persons for fallback)
            parent_pool = candidates if candidates else all_persons
            result = self._try_parent_surname_match_with_context(
                first_t, last_t, requester_cm_id, session_cm_id, year, parent_pool, attendee_info
            )
            if result.is_resolved or result.is_ambiguous:
                return result
            return ResolutionResult(confidence=0.0, method=self.name, metadata={"reason": "no_match"})

        if len(matches) == 1:
            # Single match - check session if available
            if year and attendee_info:
                # Get requester session if not provided
                # attendee_info format: {cm_id: {'session_cm_id': ..., 'school': ..., etc.}}
                if session_cm_id is None:
                    requester_info = attendee_info.get(requester_cm_id, {})
                    session_cm_id = requester_info.get("session_cm_id")

                if session_cm_id:
                    # Check match's session
                    match_info = attendee_info.get(matches[0].cm_id, {})
                    match_session = match_info.get("session_cm_id")

                    if match_session == session_cm_id:
                        return ResolutionResult(
                            person=matches[0],
                            confidence=0.95,
                            method=self.name,
                            metadata={"match_type": "unique", "session_match": "exact"},
                        )
                    else:
                        return ResolutionResult(
                            person=matches[0],
                            confidence=0.85,  # Lower confidence for different session
                            method=self.name,
                            metadata={"match_type": "unique", "session_match": "different"},
                        )
                else:
                    # No session context available
                    return ResolutionResult(
                        person=matches[0],
                        confidence=0.90,  # Lower confidence without session verification
                        method=self.name,
                        metadata={"match_type": "unique", "no_session_info": True},
                    )
            else:
                # No year context or attendee info
                return ResolutionResult(
                    person=matches[0],
                    confidence=0.90,  # Lower confidence without year context
                    method=self.name,
                    metadata={"match_type": "unique"},
                )

        # Multiple matches - try to disambiguate with session
        if year and attendee_info:
            return self._disambiguate_with_context(matches, requester_cm_id, session_cm_id, year, attendee_info)

        # Multiple matches without year context
        return ResolutionResult(
            candidates=matches,
            confidence=0.5,
            method=self.name,
            metadata={"ambiguity_reason": "multiple_matches_no_year", "match_count": len(matches)},
        )

    def _disambiguate_with_context(
        self,
        matches: list[Person],
        requester_cm_id: int,
        session_cm_id: int | None,
        year: int,
        attendee_info: dict[int, dict[str, Any]],
    ) -> ResolutionResult:
        """Disambiguate using pre-loaded attendee info.

        attendee_info format: {cm_id: {'session_cm_id': ..., 'school': ..., 'grade': ..., etc.}}
        """
        # Get requester's session if not provided
        if session_cm_id is None:
            requester_info = attendee_info.get(requester_cm_id, {})
            session_cm_id = requester_info.get("session_cm_id")

        if not session_cm_id:
            # Can't disambiguate without session
            return ResolutionResult(
                candidates=matches,
                confidence=0.5,
                method=self.name,
                metadata={"ambiguity_reason": "multiple_matches_no_session", "match_count": len(matches)},
            )

        # Filter by same session using pre-loaded data
        same_session_matches = [
            m for m in matches if attendee_info.get(m.cm_id, {}).get("session_cm_id") == session_cm_id
        ]

        if len(same_session_matches) == 1:
            # Unique match in same session
            return ResolutionResult(
                person=same_session_matches[0],
                confidence=0.95,
                method=self.name,
                metadata={"match_type": "unique_same_session", "session_match": "exact"},
            )
        elif len(same_session_matches) > 1:
            # Still ambiguous within session
            return ResolutionResult(
                candidates=same_session_matches,
                confidence=0.5,
                method=self.name,
                metadata={
                    "ambiguity_reason": "multiple_same_session_matches",
                    "match_count": len(same_session_matches),
                    "session_match": "exact",
                },
            )
        else:
            # No matches in same session - mark as IMPOSSIBLE
            # The target exists but is in a different session, so bunking is impossible
            if len(matches) == 1:
                target_session = attendee_info.get(matches[0].cm_id, {}).get("session_cm_id")
                return ResolutionResult(
                    person=matches[0],  # Include who we found for reference
                    confidence=0.0,
                    method=self.name,
                    metadata={
                        "impossible": True,
                        "impossible_reason": "target_in_different_session",
                        "match_type": "exact_different_session",
                        "target_session": target_session,
                        "requester_session": session_cm_id,
                    },
                )
            else:
                # Multiple exact matches, all in different sessions
                return ResolutionResult(
                    candidates=matches,
                    confidence=0.0,
                    method=self.name,
                    metadata={
                        "impossible": True,
                        "impossible_reason": "all_matches_in_different_sessions",
                        "match_count": len(matches),
                    },
                )

    def _try_parent_surname_match_with_context(
        self,
        first_name: str,
        last_name: str,
        requester_cm_id: int,
        session_cm_id: int | None,
        year: int | None,
        candidates: list[Person] | None,
        attendee_info: dict[int, dict[str, Any]] | None,
    ) -> ResolutionResult:
        """Try matching first name + parent's last name using pre-loaded data.

        Uses pre-loaded candidates instead of database queries.
        """
        if not candidates:
            # No candidates to search - fall back to database method
            return self._try_parent_surname_match(first_name, last_name, requester_cm_id, session_cm_id, year)

        matches = []
        first_lower = first_name.lower()
        last_lower = last_name.lower()

        for person in candidates:
            # Check if first name matches
            person_first = (person.first_name or "").lower()
            person_preferred = (person.preferred_name or "").lower()
            if person_first != first_lower and person_preferred != first_lower:
                continue

            # Check if last name matches any parent surname
            for parent_surname in person.parent_last_names:
                if parent_surname.lower() == last_lower:
                    matches.append(person)
                    break

        # Filter out self-references
        matches = self._filter_self_references(matches, requester_cm_id)

        if not matches:
            return ResolutionResult(confidence=0.0, method=self.name)

        if len(matches) == 1:
            # Determine session match for confidence
            confidence = 0.90  # Base for parent surname match
            if session_cm_id and attendee_info:
                match_session = attendee_info.get(matches[0].cm_id, {}).get("session_cm_id")
                if match_session != session_cm_id:
                    confidence = 0.80  # Lower for different session

            return ResolutionResult(
                person=matches[0],
                confidence=confidence,
                method=self.name,
                metadata={
                    "match_type": "parent_surname",
                    "parent_last_name": last_name,
                    "camper_last_name": matches[0].last_name,
                },
            )

        return ResolutionResult(
            candidates=matches,
            confidence=0.45,
            method=self.name,
            metadata={
                "ambiguity_reason": "multiple_parent_surname_matches",
                "match_count": len(matches),
                "match_type": "parent_surname",
            },
        )

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
        self,
        name: str,
        requester_cm_id: int,
        session_cm_id: int | None = None,
        year: int | None = None,
        candidates: list[Person] | None = None,
        attendee_info: dict[int, dict[str, Any]] | None = None,
        all_persons: list[Person] | None = None,
    ) -> ResolutionResult:
        """Resolve using optional pre-loaded candidates and attendee info.

        When candidates/attendee_info are provided, uses in-memory filtering
        for batch optimization. Otherwise falls back to database queries.
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
                c
                for c in candidates
                if (c.first_name.title() == first_t or (c.preferred_name and c.preferred_name.title() == first_t))
                and last_name_matches(last_t, c.last_name)
            ]
        else:
            # Fall back to database query if no candidates provided
            matches = self.person_repo.find_by_name(first_t, last_t, year=year)

        # Filter out self-references
        matches = self._filter_self_references(matches, requester_cm_id)

        # Deduplicate by cm_id — person records may have duplicates across years
        seen_cm_ids: set[int] = set()
        unique_matches: list[Person] = []
        for m in matches:
            if m.cm_id not in seen_cm_ids:
                seen_cm_ids.add(m.cm_id)
                unique_matches.append(m)
        matches = unique_matches

        if not matches:
            # Try matching via parent surname with pre-loaded candidates (or all_persons for fallback)
            parent_pool = candidates or all_persons
            result = self._try_parent_surname_match(
                first_t, last_t, requester_cm_id, session_cm_id, year, parent_pool, attendee_info
            )
            if result.is_resolved or result.is_ambiguous:
                return result
            return ResolutionResult(confidence=0.0, method=self.name, metadata={"reason": "no_match"})

        if len(matches) == 1:
            # Single match - check session if available via pre-loaded attendee_info
            if year and attendee_info is not None:
                # Get requester session if not provided
                # attendee_info format: {cm_id: {'session_cm_id': ..., 'school': ..., etc.}}
                if session_cm_id is None:
                    requester_info = attendee_info.get(requester_cm_id, {})
                    session_cm_id = requester_info.get("session_cm_id")

                if session_cm_id:
                    match_session = attendee_info.get(matches[0].cm_id, {}).get("session_cm_id")
                    if self._is_same_session_via_attendee_info(matches[0].cm_id, session_cm_id, attendee_info):
                        return ResolutionResult(
                            person=matches[0],
                            confidence=0.95,
                            method=self.name,
                            metadata={"sub_method": "unique", "session_match": "exact"},
                        )
                    elif match_session is not None:
                        # Target enrolled in a different bunking session
                        return ResolutionResult(
                            person=matches[0],
                            confidence=0.85,  # Lower confidence for different session
                            method=self.name,
                            metadata={"sub_method": "unique", "session_match": "different"},
                        )
                    else:
                        # No session data for target in enrolled-only map.
                        # Could be cancelled, waitlisted, or not enrolled.
                        # Disposition handled by ConflictDetector.
                        return ResolutionResult(
                            person=matches[0],
                            confidence=0.90,
                            method=self.name,
                            metadata={"sub_method": "unique", "session_match": "unknown"},
                        )
                else:
                    # No session context available
                    return ResolutionResult(
                        person=matches[0],
                        confidence=0.90,  # Lower confidence without session verification
                        method=self.name,
                        metadata={"sub_method": "unique", "no_session_info": True},
                    )
            elif year:
                # No attendee_info: DB fallback for session lookup
                effective_session = session_cm_id
                if effective_session is None:
                    db_requester_info = self.attendee_repo.get_by_person_and_year(requester_cm_id, year)
                    if db_requester_info:
                        effective_session = db_requester_info["session_cm_id"]

                if effective_session:
                    sessions_map = self.attendee_repo.bulk_get_sessions_for_persons([matches[0].cm_id], year)
                    match_session = sessions_map.get(matches[0].cm_id)

                    if match_session == effective_session:
                        return ResolutionResult(
                            person=matches[0],
                            confidence=0.95,
                            method=self.name,
                            metadata={"sub_method": "unique", "session_match": "exact"},
                        )
                    elif match_session is not None:
                        return ResolutionResult(
                            person=matches[0],
                            confidence=0.85,
                            method=self.name,
                            metadata={"sub_method": "unique", "session_match": "different"},
                        )
                    else:
                        return ResolutionResult(
                            person=matches[0],
                            confidence=0.90,
                            method=self.name,
                            metadata={"sub_method": "unique", "session_match": "unknown"},
                        )
                else:
                    return ResolutionResult(
                        person=matches[0],
                        confidence=0.90,
                        method=self.name,
                        metadata={"sub_method": "unique", "no_session_info": True},
                    )
            else:
                # No year context
                return ResolutionResult(
                    person=matches[0],
                    confidence=0.90,  # Lower confidence without year context
                    method=self.name,
                    metadata={"sub_method": "unique"},
                )

        # Multiple matches - try to disambiguate with session
        if year:
            return self._disambiguate_with_session(matches, requester_cm_id, session_cm_id, year, attendee_info)

        # Multiple matches without year context
        return ResolutionResult(
            candidates=matches,
            confidence=0.5,
            method=self.name,
            metadata={"ambiguity_reason": "multiple_matches_no_year", "match_count": len(matches)},
        )

    @staticmethod
    def _is_same_session_via_attendee_info(
        person_cm_id: int,
        session_cm_id: int,
        attendee_info: dict[int, dict[str, Any]],
    ) -> bool:
        """Check if a person is enrolled in the given session, using pre-loaded attendee_info.

        Prefers session_cm_ids (multi-enrollment) when available, falls back to singular
        session_cm_id for backward compatibility.
        """
        info = attendee_info.get(person_cm_id, {})
        match_sessions = info.get("session_cm_ids", [])
        if match_sessions:
            return session_cm_id in match_sessions
        return info.get("session_cm_id") == session_cm_id

    def _disambiguate_with_session(
        self,
        matches: list[Person],
        requester_cm_id: int,
        session_cm_id: int | None,
        year: int,
        attendee_info: dict[int, dict[str, Any]] | None = None,
    ) -> ResolutionResult:
        """Disambiguate multiple matches using session information.

        When attendee_info is provided, uses pre-loaded data for batch optimization.
        Otherwise falls back to database queries.
        """
        if attendee_info is not None:
            # Fast path: use pre-loaded attendee_info
            if session_cm_id is None:
                requester_info = attendee_info.get(requester_cm_id, {})
                session_cm_id = requester_info.get("session_cm_id")

            if not session_cm_id:
                return ResolutionResult(
                    candidates=matches,
                    confidence=0.5,
                    method=self.name,
                    metadata={"ambiguity_reason": "multiple_matches_no_session", "match_count": len(matches)},
                )

            same_session_matches = [
                m for m in matches if self._is_same_session_via_attendee_info(m.cm_id, session_cm_id, attendee_info)
            ]

            if len(same_session_matches) == 1:
                return ResolutionResult(
                    person=same_session_matches[0],
                    confidence=0.95,
                    method=self.name,
                    metadata={"sub_method": "unique_same_session", "session_match": "exact"},
                )
            elif len(same_session_matches) > 1:
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
                if len(matches) == 1:
                    target_session = attendee_info.get(matches[0].cm_id, {}).get("session_cm_id")
                    return ResolutionResult(
                        person=matches[0],
                        confidence=0.0,
                        method=self.name,
                        metadata={
                            "impossible": True,
                            "impossible_reason": "target_in_different_session",
                            "sub_method": "exact_different_session",
                            "target_session": target_session,
                            "requester_session": session_cm_id,
                        },
                    )
                else:
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
        else:
            # DB fallback: query attendee_repo
            if session_cm_id is None:
                db_requester_info = self.attendee_repo.get_by_person_and_year(requester_cm_id, year)
                if db_requester_info:
                    session_cm_id = db_requester_info["session_cm_id"]

            if not session_cm_id:
                return ResolutionResult(
                    candidates=matches,
                    confidence=0.5,
                    method=self.name,
                    metadata={"ambiguity_reason": "multiple_matches_no_session", "match_count": len(matches)},
                )

            match_cm_ids = [m.cm_id for m in matches]
            sessions_map = self.attendee_repo.bulk_get_sessions_for_persons(match_cm_ids, year)

            same_session_matches = [m for m in matches if sessions_map.get(m.cm_id) == session_cm_id]

            if len(same_session_matches) == 1:
                return ResolutionResult(
                    person=same_session_matches[0],
                    confidence=0.95,
                    method=self.name,
                    metadata={"sub_method": "unique_same_session", "session_match": "exact"},
                )
            elif len(same_session_matches) > 1:
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
                if len(matches) == 1:
                    return ResolutionResult(
                        person=matches[0],
                        confidence=0.0,
                        method=self.name,
                        metadata={
                            "impossible": True,
                            "impossible_reason": "target_in_different_session",
                            "sub_method": "exact_different_session",
                            "target_session": sessions_map.get(matches[0].cm_id),
                            "requester_session": session_cm_id,
                        },
                    )
                else:
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
        self,
        first_name: str,
        last_name: str,
        requester_cm_id: int,
        session_cm_id: int | None,
        year: int | None,
        candidates: list[Person] | None = None,
        attendee_info: dict[int, dict[str, Any]] | None = None,
    ) -> ResolutionResult:
        """Try matching first name + parent's last name.

        When candidates are provided, uses in-memory filtering for batch optimization.
        Otherwise falls back to name_cache or database scan.

        Confidence is slightly lower (0.90 vs 0.95) than direct matches.
        """
        if candidates is not None:
            # Fast path: search pre-loaded candidates
            matches = []
            first_lower = first_name.lower()
            last_lower = last_name.lower()

            for person in candidates:
                person_first = (person.first_name or "").lower()
                person_preferred = (person.preferred_name or "").lower()
                if person_first != first_lower and person_preferred != first_lower:
                    continue
                for parent_surname in person.parent_last_names:
                    if parent_surname.lower() == last_lower:
                        matches.append(person)
                        break

            matches = self._filter_self_references(matches, requester_cm_id)

            if not matches:
                return ResolutionResult(confidence=0.0, method=self.name)

            if len(matches) == 1:
                confidence = 0.90  # Base for parent surname match
                if session_cm_id and attendee_info:
                    if not self._is_same_session_via_attendee_info(matches[0].cm_id, session_cm_id, attendee_info):
                        confidence = 0.80  # Lower for different session

                return ResolutionResult(
                    person=matches[0],
                    confidence=confidence,
                    method=self.name,
                    metadata={
                        "sub_method": "parent_surname",
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
                    "sub_method": "parent_surname",
                },
            )

        # No candidates provided: try name_cache first, then DB scan
        if not hasattr(self.person_repo, "name_cache") or not self.person_repo.name_cache:
            return self._try_parent_surname_match_via_db(first_name, last_name, requester_cm_id, session_cm_id, year)

        # Use cache's parent surname lookup
        matches = self.person_repo.name_cache.find_by_parent_surname(first_name, last_name)
        matches = self._filter_self_references(matches, requester_cm_id)

        if not matches:
            return ResolutionResult(confidence=0.0, method=self.name)

        if len(matches) == 1:
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
                    "sub_method": "parent_surname",
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
                "sub_method": "parent_surname",
            },
        )

    def _try_parent_surname_match_via_db(
        self, first_name: str, last_name: str, requester_cm_id: int, session_cm_id: int | None, year: int | None
    ) -> ResolutionResult:
        """Fallback parent surname matching via database scan.

        Used when name_cache is not available.
        """
        try:
            all_persons = self.person_repo.get_all_for_phonetic_matching(year=year)
        except Exception:
            return ResolutionResult(confidence=0.0, method=self.name)

        matches = []
        first_lower = first_name.lower()
        last_lower = last_name.lower()

        for person in all_persons:
            person_first = (person.first_name or "").lower()
            person_preferred = (person.preferred_name or "").lower()
            if person_first != first_lower and person_preferred != first_lower:
                continue

            for parent_surname in person.parent_last_names:
                if parent_surname.lower() == last_lower:
                    matches.append(person)
                    break

        matches = self._filter_self_references(matches, requester_cm_id)

        if not matches:
            return ResolutionResult(confidence=0.0, method=self.name)

        if len(matches) == 1:
            return ResolutionResult(
                person=matches[0],
                confidence=0.90,
                method=self.name,
                metadata={
                    "sub_method": "parent_surname",
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
                "sub_method": "parent_surname",
            },
        )

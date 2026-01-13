"""School disambiguation strategy for name resolution.

Uses school information to help disambiguate between multiple candidates
with the same or similar names."""

from __future__ import annotations

from typing import Any

from ...core.models import Person
from ...data.repositories import AttendeeRepository, PersonRepository
from ...shared import parse_name
from ..interfaces import ResolutionResult, ResolutionStrategy


class SchoolDisambiguationStrategy(ResolutionStrategy):
    """Strategy for disambiguating names using school information"""

    def __init__(self, person_repository: PersonRepository, attendee_repository: AttendeeRepository):
        """Initialize the school disambiguation strategy.

        Args:
            person_repository: Repository for person data access
            attendee_repository: Repository for attendee data access
        """
        self.person_repo = person_repository
        self.attendee_repo = attendee_repository

    @property
    def name(self) -> str:
        """Strategy name for logging"""
        return "school_disambiguation"

    def resolve(
        self, name: str, requester_cm_id: int, session_cm_id: int | None = None, year: int | None = None
    ) -> ResolutionResult:
        """Attempt to disambiguate names using school information.

        This strategy is typically used when other strategies return
        multiple candidates. It uses school information to narrow down
        the possibilities.

        Args:
            name: Name to resolve
            requester_cm_id: Person making the request
            session_cm_id: Optional session context
            year: Year context for resolution

        Returns:
            ResolutionResult with disambiguation outcome
        """
        # Parse the name
        parsed = parse_name(name)
        if not parsed.is_complete:
            # Can't do school disambiguation without full name
            return ResolutionResult(confidence=0.0, method=self.name, metadata={"reason": "incomplete_name"})

        # Find candidates by name, filtering by year to avoid historical duplicates
        candidates = self.person_repo.find_by_name(parsed.first.title(), parsed.last.title(), year=year)

        # Filter out self-references
        candidates = [c for c in candidates if c.cm_id != requester_cm_id]

        if not candidates:
            return ResolutionResult(confidence=0.0, method=self.name, metadata={"reason": "no_matches"})

        if len(candidates) == 1:
            # Only one candidate - no disambiguation needed
            return ResolutionResult(
                person=candidates[0],
                confidence=0.90,  # High confidence for exact match
                method=self.name,
                metadata={"match_type": "single_exact_match"},
            )

        # Multiple candidates - try school disambiguation

        # Get requester's school information
        requester = self.person_repo.find_by_cm_id(requester_cm_id)
        if not requester or not requester.school:
            # Can't disambiguate without requester's school
            return ResolutionResult(
                candidates=candidates,
                confidence=0.0,
                method=self.name,
                metadata={"ambiguity_reason": "no_requester_school", "match_count": len(candidates)},
            )

        # Check which candidates share the requester's school (with location matching)
        same_school_candidates = [
            c
            for c in candidates
            if c.school
            and self._schools_match(
                candidate_school=c.school,
                requester_school=requester.school,
                candidate_city=c.city,
                requester_city=requester.city,
                candidate_state=c.state,
                requester_state=requester.state,
            )
        ]

        if not same_school_candidates:
            # No candidates from same school
            return ResolutionResult(
                candidates=candidates,
                confidence=0.0,
                method=self.name,
                metadata={"ambiguity_reason": "no_same_school_matches", "match_count": len(candidates)},
            )

        if len(same_school_candidates) == 1:
            # Exactly one candidate from same school
            result = self._try_grade_disambiguation(same_school_candidates, requester, session_cm_id, year)
            if result.is_resolved:
                return result

            # Return the school match even without grade disambiguation
            return ResolutionResult(
                person=same_school_candidates[0],
                confidence=0.75,  # Good confidence for school match
                method=self.name,
                metadata={
                    "match_type": "same_school",
                    "match_count": len(same_school_candidates),
                    "school": requester.school,
                },
            )

        # Multiple candidates from same school - try grade disambiguation
        result = self._try_grade_disambiguation(same_school_candidates, requester, session_cm_id, year)
        if result.is_resolved:
            return result

        # Still ambiguous even with school
        return ResolutionResult(
            candidates=same_school_candidates,
            confidence=0.5,
            method=self.name,
            metadata={
                "ambiguity_reason": "multiple_same_school_matches",
                "match_count": len(candidates),
                "requester_school": requester.school,
            },
        )

    # School name abbreviation mappings for normalization
    SCHOOL_ABBREVIATIONS = {
        "middle school": "ms",
        "elementary school": "es",
        "elementary": "es",
        "high school": "hs",
        "junior high": "jh",
        "junior high school": "jh",
        "primary school": "ps",
        "public school": "ps",
        "p.s.": "ps",
        "saint": "st",
        "st.": "st",
        "academy": "acad",
        "preparatory": "prep",
        "prep school": "prep",
        "montessori": "mont",
        "christian": "chr",
        "catholic": "cath",
        "international": "intl",
        "magnet": "mag",
        "charter": "chtr",
    }

    def _normalize_school_name(self, school: str) -> str:
        """Normalize a school name for fuzzy matching.

        Handles common abbreviations like:
        - "Middle School" ↔ "MS"
        - "Elementary School" ↔ "ES"
        - "High School" ↔ "HS"
        - "Saint" ↔ "St."
        - etc.

        Args:
            school: School name to normalize

        Returns:
            Normalized school name (lowercase, abbreviations expanded)
        """
        if not school:
            return ""

        # Lowercase and strip
        normalized = school.strip().lower()

        # Remove common punctuation
        normalized = normalized.replace(".", "").replace("'", "").replace(",", "")

        # Apply abbreviation mappings (longer phrases first to avoid partial matches)
        for full_form, abbrev in sorted(self.SCHOOL_ABBREVIATIONS.items(), key=lambda x: -len(x[0])):
            normalized = normalized.replace(full_form, abbrev)

        # Collapse multiple spaces
        normalized = " ".join(normalized.split())

        return normalized

    def _schools_match(
        self,
        candidate_school: str,
        requester_school: str,
        candidate_city: str | None = None,
        requester_city: str | None = None,
        candidate_state: str | None = None,
        requester_state: str | None = None,
    ) -> bool:
        """Check if two schools match using location-based disambiguation.

        Uses fuzzy school name matching (with abbreviation normalization)
        combined with location matching when available.

        Matching rules:
        - School name: Fuzzy (normalized abbreviations + containment)
        - City: Case-insensitive exact match
        - State: Case-insensitive exact match

        If either party lacks city/state, falls back to school-name-only matching.

        Args:
            candidate_school: Candidate's school name
            requester_school: Requester's school name
            candidate_city: Candidate's city (optional)
            requester_city: Requester's city (optional)
            candidate_state: Candidate's state (optional)
            requester_state: Requester's state (optional)

        Returns:
            True if schools match (with location if available), False otherwise
        """
        if not candidate_school or not requester_school:
            return False

        # Normalize school names with abbreviation handling
        cs = self._normalize_school_name(candidate_school)
        rs = self._normalize_school_name(requester_school)

        # Check if schools match (exact or containment after normalization)
        schools_match = False
        if cs == rs:
            schools_match = True
        elif cs in rs or rs in cs:
            # Check if one is contained in the other
            schools_match = True

        if not schools_match:
            return False

        # If both parties have location data, require city + state match
        requester_has_location = bool(requester_city and requester_state)
        candidate_has_location = bool(candidate_city and candidate_state)

        if requester_has_location and candidate_has_location:
            # City: case-insensitive exact match (checked above that these are not None)
            assert requester_city is not None and candidate_city is not None
            city_match = candidate_city.strip().lower() == requester_city.strip().lower()
            # State: case-insensitive exact match
            assert requester_state is not None and candidate_state is not None
            state_match = candidate_state.strip().lower() == requester_state.strip().lower()
            return city_match and state_match

        # If either lacks location data, school name match is sufficient
        return True

    def _try_grade_disambiguation(
        self, candidates: list[Person], requester: Person, session_cm_id: int | None, year: int | None
    ) -> ResolutionResult:
        """Try to disambiguate using grade level"""
        if not requester.grade:
            return ResolutionResult(confidence=0.0, method=self.name)

        # Filter candidates in same grade
        same_grade_candidates = [c for c in candidates if c.grade and c.grade == requester.grade]

        if len(same_grade_candidates) == 1:
            # Verify session if possible
            confidence = 0.85  # High confidence for school + grade match

            if year and session_cm_id:
                # Check if candidate is in same session
                sessions_map = self.attendee_repo.bulk_get_sessions_for_persons([same_grade_candidates[0].cm_id], year)
                candidate_session = sessions_map.get(same_grade_candidates[0].cm_id)

                if candidate_session == session_cm_id:
                    confidence = 0.90  # Very high for school + grade + session
                elif candidate_session is not None:
                    confidence = 0.75  # Lower if different session

            return ResolutionResult(
                person=same_grade_candidates[0],
                confidence=confidence,
                method=self.name,
                metadata={"match_type": "same_school_same_grade", "school": requester.school, "grade": requester.grade},
            )

        # Try candidates in adjacent grades
        # requester.grade is not None (checked at line 274)
        assert requester.grade is not None
        close_grade_candidates = [c for c in candidates if c.grade and abs(c.grade - requester.grade) <= 1]

        if len(close_grade_candidates) == 1:
            # close_grade_candidates[0].grade is not None (filtered above)
            assert close_grade_candidates[0].grade is not None
            return ResolutionResult(
                person=close_grade_candidates[0],
                confidence=0.70,  # Lower confidence for adjacent grade
                method=self.name,
                metadata={
                    "match_type": "same_school_close_grade",
                    "grade_diff": abs(close_grade_candidates[0].grade - requester.grade),
                },
            )

        if close_grade_candidates:
            # Find the closest grade match
            # All candidates in close_grade_candidates have grade not None (filtered above)
            # requester.grade is also not None (checked at line 303)
            assert requester.grade is not None
            requester_grade_val = requester.grade  # Capture for lambda
            closest = min(close_grade_candidates, key=lambda c: abs((c.grade or 0) - requester_grade_val))
            # Check if it's uniquely closest
            assert closest.grade is not None
            grade_diff = abs(closest.grade - requester.grade)
            same_distance = [
                c
                for c in close_grade_candidates
                if c.grade is not None and abs(c.grade - requester_grade_val) == grade_diff
            ]

            if len(same_distance) == 1:
                return ResolutionResult(
                    person=closest,
                    confidence=0.65,  # Lower confidence for grade proximity
                    method=self.name,
                    metadata={"match_type": "same_school_closest_grade", "grade_diff": grade_diff},
                )

        return ResolutionResult(confidence=0.0, method=self.name)

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
            # Can't do school disambiguation without full name
            return ResolutionResult(confidence=0.0, method=self.name, metadata={"reason": "incomplete_name"})

        # Use all_persons as fallback when candidates is empty (single-name targets)
        school_pool = candidates if candidates else all_persons

        # If no pool to search, can't do school disambiguation
        if not school_pool:
            return ResolutionResult(confidence=0.0, method=self.name, metadata={"reason": "no_candidates"})

        # Filter candidates by name match (case-insensitive)
        first_l, last_l = parsed.first.lower(), parsed.last.lower()
        matching_candidates = [
            c for c in school_pool if c.first_name.lower() == first_l and c.last_name.lower() == last_l
        ]

        # Filter out self-references
        matching_candidates = [c for c in matching_candidates if c.cm_id != requester_cm_id]

        if not matching_candidates:
            return ResolutionResult(confidence=0.0, method=self.name, metadata={"reason": "no_matches"})

        if len(matching_candidates) == 1:
            # Only one candidate - no disambiguation needed
            return ResolutionResult(
                person=matching_candidates[0],
                confidence=0.90,  # High confidence for exact match
                method=self.name,
                metadata={"match_type": "single_exact_match"},
            )

        # Multiple candidates - try school disambiguation

        # Get requester's info from pre-loaded data or person
        requester_school = None
        requester_grade = None
        requester_city = None
        requester_state = None
        if attendee_info and requester_cm_id in attendee_info:
            requester_school = attendee_info[requester_cm_id].get("school")
            requester_grade = attendee_info[requester_cm_id].get("grade")
            requester_city = attendee_info[requester_cm_id].get("city")
            requester_state = attendee_info[requester_cm_id].get("state")
        else:
            # Fall back to database query for requester info
            requester = self.person_repo.find_by_cm_id(requester_cm_id)
            if requester:
                requester_school = requester.school
                requester_grade = requester.grade
                requester_city = requester.city
                requester_state = requester.state

        if not requester_school:
            # Can't disambiguate without requester's school
            return ResolutionResult(
                candidates=matching_candidates,
                confidence=0.0,
                method=self.name,
                metadata={"ambiguity_reason": "no_requester_school", "match_count": len(matching_candidates)},
            )

        # Check which candidates share the requester's school (with location matching)
        same_school_candidates = [
            c
            for c in matching_candidates
            if c.school
            and self._schools_match(
                candidate_school=c.school,
                requester_school=requester_school,
                candidate_city=c.city,
                requester_city=requester_city,
                candidate_state=c.state,
                requester_state=requester_state,
            )
        ]

        if not same_school_candidates:
            # No candidates from same school
            return ResolutionResult(
                candidates=matching_candidates,
                confidence=0.0,
                method=self.name,
                metadata={"ambiguity_reason": "no_same_school_matches", "match_count": len(matching_candidates)},
            )

        if len(same_school_candidates) == 1:
            # Exactly one candidate from same school
            result = self._try_grade_disambiguation_with_context(
                same_school_candidates, requester_cm_id, requester_grade, session_cm_id, year, attendee_info
            )
            if result.is_resolved:
                return result

            # Return the school match even without grade disambiguation
            return ResolutionResult(
                person=same_school_candidates[0],
                confidence=0.75,  # Good confidence for school match
                method=self.name,
                metadata={
                    "match_type": "same_school",
                    "match_count": len(same_school_candidates),
                    "school": requester_school,
                },
            )

        # Multiple candidates from same school - try grade disambiguation
        result = self._try_grade_disambiguation_with_context(
            same_school_candidates, requester_cm_id, requester_grade, session_cm_id, year, attendee_info
        )
        if result.is_resolved:
            return result

        # Still ambiguous even with school
        return ResolutionResult(
            candidates=same_school_candidates,
            confidence=0.5,
            method=self.name,
            metadata={
                "ambiguity_reason": "multiple_same_school_matches",
                "match_count": len(matching_candidates),
                "requester_school": requester_school,
            },
        )

    def _try_grade_disambiguation_with_context(
        self,
        candidates: list[Person],
        requester_cm_id: int,
        requester_grade: int | None,
        session_cm_id: int | None,
        year: int | None,
        attendee_info: dict[int, dict[str, Any]] | None,
    ) -> ResolutionResult:
        """Try to disambiguate using grade level with pre-loaded data"""
        if not requester_grade:
            return ResolutionResult(confidence=0.0, method=self.name)

        # Filter candidates in same grade
        same_grade_candidates = [c for c in candidates if c.grade and c.grade == requester_grade]

        if len(same_grade_candidates) == 1:
            # Verify session if possible
            confidence = 0.85  # High confidence for school + grade match

            if year and session_cm_id and attendee_info:
                # Check if candidate is in same session using pre-loaded data
                candidate_cm_id = same_grade_candidates[0].cm_id
                if candidate_cm_id in attendee_info:
                    candidate_session = attendee_info[candidate_cm_id].get("session_cm_id")

                    if candidate_session == session_cm_id:
                        confidence = 0.90  # Very high for school + grade + session
                    elif candidate_session is not None:
                        confidence = 0.75  # Lower if different session

            return ResolutionResult(
                person=same_grade_candidates[0],
                confidence=confidence,
                method=self.name,
                metadata={"match_type": "same_school_same_grade", "grade": requester_grade},
            )

        # Try candidates in adjacent grades
        # requester_grade is not None (checked at line 486)
        assert requester_grade is not None
        close_grade_candidates = [c for c in candidates if c.grade and abs(c.grade - requester_grade) <= 1]

        if len(close_grade_candidates) == 1:
            # close_grade_candidates[0].grade is not None (filtered above)
            assert close_grade_candidates[0].grade is not None
            return ResolutionResult(
                person=close_grade_candidates[0],
                confidence=0.70,  # Lower confidence for adjacent grade
                method=self.name,
                metadata={
                    "match_type": "same_school_close_grade",
                    "grade_diff": abs(close_grade_candidates[0].grade - requester_grade),
                },
            )

        if close_grade_candidates:
            # Find the closest grade match
            # All candidates in close_grade_candidates have grade not None (filtered above)
            closest = min(close_grade_candidates, key=lambda c: abs((c.grade or 0) - requester_grade))
            assert closest.grade is not None
            # Check if it's uniquely closest
            grade_diff = abs(closest.grade - requester_grade)
            same_distance = [
                c
                for c in close_grade_candidates
                if c.grade is not None and abs(c.grade - requester_grade) == grade_diff
            ]

            if len(same_distance) == 1:
                return ResolutionResult(
                    person=closest,
                    confidence=0.65,  # Lower confidence for grade proximity
                    method=self.name,
                    metadata={"match_type": "same_school_closest_grade", "grade_diff": grade_diff},
                )

        return ResolutionResult(confidence=0.0, method=self.name)

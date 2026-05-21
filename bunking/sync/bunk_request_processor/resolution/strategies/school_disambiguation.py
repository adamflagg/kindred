"""School disambiguation strategy for name resolution.

Uses school information to help disambiguate between multiple candidates
with the same or similar names."""

from typing import Any, ClassVar

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

    # School name abbreviation mappings for normalization
    SCHOOL_ABBREVIATIONS: ClassVar[dict[str, str]] = {
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
            assert requester_city is not None
            assert candidate_city is not None
            city_match = candidate_city.strip().lower() == requester_city.strip().lower()
            # State: case-insensitive exact match
            assert requester_state is not None
            assert candidate_state is not None
            state_match = candidate_state.strip().lower() == requester_state.strip().lower()
            return city_match and state_match

        # If either lacks location data, school name match is sufficient
        return True

    def _try_grade_disambiguation(
        self,
        candidates: list[Person],
        requester_cm_id: int,
        requester_grade: int | None = None,
        requester_school: str | None = None,
        session_cm_id: int | None = None,
        year: int | None = None,
        attendee_info: dict[int, dict[str, Any]] | None = None,
    ) -> ResolutionResult:
        """Try to disambiguate using grade level.

        Accepts pre-loaded requester_grade/requester_school directly (fast path when
        attendee_info is available) or falls back to a DB lookup via person_repo when
        they are not provided.
        """
        # Resolve requester grade/school if not supplied directly
        if requester_grade is None or requester_school is None:
            if attendee_info and requester_cm_id in attendee_info:
                requester_grade = requester_grade or attendee_info[requester_cm_id].get("grade")
                requester_school = requester_school or attendee_info[requester_cm_id].get("school")
            else:
                requester_person = self.person_repo.find_by_cm_id(requester_cm_id)
                if requester_person:
                    requester_grade = requester_grade or requester_person.grade
                    requester_school = requester_school or requester_person.school

        if not requester_grade:
            return ResolutionResult(confidence=0.0, method=self.name)

        # Filter candidates in same grade
        same_grade_candidates = [c for c in candidates if c.grade and c.grade == requester_grade]

        if len(same_grade_candidates) == 1:
            # Verify session if possible
            confidence = 0.85  # High confidence for school + grade match

            if year and session_cm_id:
                candidate_cm_id = same_grade_candidates[0].cm_id
                if attendee_info and candidate_cm_id in attendee_info:
                    # Use pre-loaded session data
                    candidate_session = attendee_info[candidate_cm_id].get("session_cm_id")
                else:
                    # Fall back to DB lookup
                    sessions_map = self.attendee_repo.bulk_get_sessions_for_persons([candidate_cm_id], year)
                    candidate_session = sessions_map.get(candidate_cm_id)

                if candidate_session == session_cm_id:
                    confidence = 0.90  # Very high for school + grade + session
                elif candidate_session is not None:
                    confidence = 0.75  # Lower if different session

            return ResolutionResult(
                person=same_grade_candidates[0],
                confidence=confidence,
                method=self.name,
                metadata={
                    "sub_method": "same_school_same_grade",
                    "school": requester_school,
                    "grade": requester_grade,
                },
            )

        # Try candidates in adjacent grades
        # requester_grade is not None (checked above)
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
                    "sub_method": "same_school_close_grade",
                    "school": requester_school,
                    "grade_diff": abs(close_grade_candidates[0].grade - requester_grade),
                },
            )

        if close_grade_candidates:
            # Find the closest grade match
            # All candidates in close_grade_candidates have grade not None (filtered above)
            # requester_grade is also not None (checked above)
            requester_grade_val = requester_grade  # Capture for lambda
            closest = min(close_grade_candidates, key=lambda c: abs((c.grade or 0) - requester_grade_val))
            assert closest.grade is not None
            # Check if it's uniquely closest
            grade_diff = abs(closest.grade - requester_grade)
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
                    metadata={
                        "sub_method": "same_school_closest_grade",
                        "school": requester_school,
                        "grade_diff": grade_diff,
                    },
                )

        return ResolutionResult(confidence=0.0, method=self.name)

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
        """Resolve using pre-loaded candidates and attendee info."""
        # Parse the name
        parsed = parse_name(name)
        if not parsed.is_complete:
            # Can't do school disambiguation without full name
            return ResolutionResult(confidence=0.0, method=self.name, metadata={"reason": "incomplete_name"})

        # Use all_persons as fallback when candidates is empty (single-name targets)
        school_pool = candidates or all_persons

        # If no pre-loaded pool, fall back to database candidate lookup
        if not school_pool:
            db_candidates = self.person_repo.find_by_name(parsed.first.title(), parsed.last.title(), year=year)
            db_candidates = [c for c in db_candidates if c.cm_id != requester_cm_id]
            if not db_candidates:
                return ResolutionResult(confidence=0.0, method=self.name, metadata={"reason": "no_matches"})
            if len(db_candidates) == 1:
                return ResolutionResult(
                    person=db_candidates[0],
                    confidence=0.90,
                    method=self.name,
                    metadata={"sub_method": "single_exact_match"},
                )
            # Continue with DB-loaded candidates as the pool
            school_pool = db_candidates

        # Filter candidates by name match (case-insensitive), including preferred names
        # (e.g., "Bobby" matches a person with first_name="Robert", preferred_name="Bobby")
        first_l, last_l = parsed.first.lower(), parsed.last.lower()
        matching_candidates = [
            c
            for c in school_pool
            if (c.first_name.lower() == first_l or (c.preferred_name and c.preferred_name.lower() == first_l))
            and c.last_name.lower() == last_l
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
                metadata={"sub_method": "single_exact_match"},
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
            result = self._try_grade_disambiguation(
                same_school_candidates,
                requester_cm_id,
                requester_grade=requester_grade,
                requester_school=requester_school,
                session_cm_id=session_cm_id,
                year=year,
                attendee_info=attendee_info,
            )
            if result.is_resolved:
                return result

            # Return the school match even without grade disambiguation
            return ResolutionResult(
                person=same_school_candidates[0],
                confidence=0.75,  # Good confidence for school match
                method=self.name,
                metadata={
                    "sub_method": "same_school",
                    "match_count": len(same_school_candidates),
                    "school": requester_school,
                },
            )

        # Multiple candidates from same school - try grade disambiguation
        result = self._try_grade_disambiguation(
            same_school_candidates,
            requester_cm_id,
            requester_grade=requester_grade,
            requester_school=requester_school,
            session_cm_id=session_cm_id,
            year=year,
            attendee_info=attendee_info,
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

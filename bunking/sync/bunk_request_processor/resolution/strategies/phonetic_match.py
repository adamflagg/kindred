"""Phonetic match strategy for name resolution.

Implements phonetic matching using Soundex and Metaphone algorithms
to find names that sound similar but are spelled differently.

Also integrates nickname group matching to find names like Mike=Michael.

Confidence values are loaded from PocketBase config to avoid hardcoding."""

from __future__ import annotations

from typing import Any

from ...core.models import Person
from ...data.repositories import AttendeeRepository, PersonRepository
from ...shared import parse_name
from ...shared.nickname_groups import find_nickname_variations, get_nickname_groups
from ..interfaces import ResolutionResult
from .base_match_strategy import BaseMatchStrategy

# Default fallback values when config is missing
DEFAULT_SOUNDEX_BASE = 0.70
DEFAULT_METAPHONE_BASE = 0.65
DEFAULT_NICKNAME_BASE = 0.75
DEFAULT_CONFIDENCE = 0.60
DEFAULT_SESSION_MATCH = 0.75
DEFAULT_SAME_SESSION_BOOST = 0.05
DEFAULT_DIFFERENT_SESSION_PENALTY = -0.20
DEFAULT_NOT_ENROLLED_PENALTY = -0.05  # Person not in attendee list for this year


class PhoneticMatchStrategy(BaseMatchStrategy):
    """Strategy for phonetic name matching.

    Inherits shared disambiguation logic from BaseMatchStrategy.
    """

    def __init__(
        self,
        person_repository: PersonRepository,
        attendee_repository: AttendeeRepository,
        config: dict[str, Any] | None = None,
    ):
        """Initialize the phonetic match strategy.

        Args:
            person_repository: Repository for person data access
            attendee_repository: Repository for attendee data access
            config: Optional config dict with confidence values from PocketBase
        """
        super().__init__(person_repository, attendee_repository, config)
        self._strategy_name = "phonetic_match"

    def _get_confidence(self, key: str, default: float) -> float:
        """Get confidence value from config with fallback to default.

        Args:
            key: Config key like 'soundex_base', 'session_match', etc.
            default: Default value if not in config

        Returns:
            Confidence value from config or default
        """
        return float(self.config.get(key, default))

    def _apply_session_adjustment_simple(
        self, base_confidence: float, person_session: int | None, requester_session: int | None
    ) -> float:
        """Apply session-based confidence adjustment using session IDs directly.

        This is a simplified version for when we have session IDs already looked up.

        Args:
            base_confidence: Starting confidence value
            person_session: Session the matched person is in
            requester_session: Session the requester is in

        Returns:
            Adjusted confidence value
        """
        if requester_session is None:
            # No session context - apply slight penalty
            penalty = float(self._get_confidence("not_enrolled_penalty", DEFAULT_NOT_ENROLLED_PENALTY))
            return base_confidence + penalty

        if person_session is None:
            # Person not in known session - apply slight penalty
            penalty = float(self._get_confidence("not_enrolled_penalty", DEFAULT_NOT_ENROLLED_PENALTY))
            return base_confidence + penalty

        if person_session == requester_session:
            # Same session - apply boost
            boost = float(self._get_confidence("same_session_boost", DEFAULT_SAME_SESSION_BOOST))
            return base_confidence + boost
        else:
            # Different session - apply penalty
            penalty = float(self._get_confidence("different_session_penalty", DEFAULT_DIFFERENT_SESSION_PENALTY))
            return base_confidence + penalty

    def resolve(
        self, name: str, requester_cm_id: int, session_cm_id: int | None = None, year: int | None = None
    ) -> ResolutionResult:
        """Attempt phonetic name resolution.

        Args:
            name: Name to resolve
            requester_cm_id: Person making the request
            session_cm_id: Optional session context
            year: Year context for resolution

        Returns:
            ResolutionResult with match outcome
        """
        parsed = parse_name(name)
        if not parsed.first:
            return ResolutionResult(confidence=0.0, method=self.name, metadata={"reason": "empty_name"})

        # Try Soundex matching for full names
        if parsed.is_complete:
            # Fetch all persons ONCE and reuse across all phonetic algorithms
            # This is a key optimization - previously each _try_* method fetched independently
            all_persons = self.person_repo.get_all_for_phonetic_matching(year=year)

            # Convert to list for helper methods (maintains backward compatibility)
            name_parts = [parsed.first, parsed.last]
            result = self._try_soundex_match(name_parts, requester_cm_id, session_cm_id, year, all_persons)
            if result.is_resolved or result.is_ambiguous:
                return result

            # Try Metaphone matching as fallback
            result = self._try_metaphone_match(name_parts, requester_cm_id, session_cm_id, year, all_persons)
            if result.is_resolved or result.is_ambiguous:
                return result

            # Try nickname matching as final fallback
            result = self._try_nickname_match(name_parts, requester_cm_id, session_cm_id, year, all_persons)
            if result.is_resolved or result.is_ambiguous:
                return result

            # Try parent surname phonetic matching (e.g., "Emma Smidt" → Smith parent)
            result = self._try_parent_surname_phonetic_match(
                name_parts, requester_cm_id, session_cm_id, year, all_persons
            )
            if result.is_resolved or result.is_ambiguous:
                return result

        # No phonetic match found
        return ResolutionResult(confidence=0.0, method=self.name, metadata={"reason": "no_phonetic_match"})

    def _try_soundex_match(
        self,
        name_parts: list[str],
        requester_cm_id: int,
        session_cm_id: int | None,
        year: int | None,
        all_persons: list[Person],
    ) -> ResolutionResult:
        """Try matching using Soundex algorithm"""
        first_name = name_parts[0]
        last_name = name_parts[-1]

        # Generate Soundex codes
        first_soundex = self._soundex(first_name)
        last_soundex = self._soundex(last_name)

        matches = []
        for person in all_persons:
            # Check if Soundex codes match
            if self._soundex(person.first_name) == first_soundex and self._soundex(person.last_name) == last_soundex:
                matches.append(person)

        # Filter out self-references
        matches = self._filter_self_references(matches, requester_cm_id)

        if not matches:
            return ResolutionResult(confidence=0.0, method=self.name)

        if len(matches) == 1:
            confidence = self._calculate_confidence(matches[0], requester_cm_id, session_cm_id, year, is_soundex=True)
            return ResolutionResult(
                person=matches[0],
                confidence=confidence,
                method=self.name,
                metadata={"match_type": "soundex", "algorithm": "soundex"},
            )

        # Multiple matches - try to disambiguate with session
        if year and session_cm_id:
            result = self._disambiguate_with_session(matches, requester_cm_id, session_cm_id, year)
            if result.is_resolved:
                if result.metadata is not None:
                    result.metadata["match_type"] = "soundex_with_session"
                    result.metadata["algorithm"] = "soundex"
                return result

        return ResolutionResult(
            candidates=matches,
            confidence=0.4,
            method=self.name,
            metadata={
                "ambiguity_reason": "multiple_soundex_matches",
                "match_count": len(matches),
                "algorithm": "soundex",
            },
        )

    def _try_metaphone_match(
        self,
        name_parts: list[str],
        requester_cm_id: int,
        session_cm_id: int | None,
        year: int | None,
        all_persons: list[Person],
    ) -> ResolutionResult:
        """Try matching using Metaphone algorithm"""
        first_name = name_parts[0]
        last_name = name_parts[-1]

        # Generate Metaphone codes
        first_metaphone = self._metaphone(first_name)
        last_metaphone = self._metaphone(last_name)

        matches = []
        for person in all_persons:
            # Check if Metaphone codes match
            if (
                self._metaphone(person.first_name) == first_metaphone
                and self._metaphone(person.last_name) == last_metaphone
            ):
                matches.append(person)

        # Filter out self-references
        matches = self._filter_self_references(matches, requester_cm_id)

        if not matches:
            return ResolutionResult(confidence=0.0, method=self.name)

        if len(matches) == 1:
            confidence = self._calculate_confidence(matches[0], requester_cm_id, session_cm_id, year, is_metaphone=True)
            return ResolutionResult(
                person=matches[0],
                confidence=confidence,
                method=self.name,
                metadata={"match_type": "metaphone", "algorithm": "metaphone"},
            )

        # Multiple matches - try to disambiguate
        if year and session_cm_id:
            result = self._disambiguate_with_session(matches, requester_cm_id, session_cm_id, year)
            if result.is_resolved:
                if result.metadata is not None:
                    result.metadata["match_type"] = "metaphone_with_session"
                    result.metadata["algorithm"] = "metaphone"
                return result

        return ResolutionResult(
            candidates=matches,
            confidence=0.35,
            method=self.name,
            metadata={
                "ambiguity_reason": "multiple_metaphone_matches",
                "match_count": len(matches),
                "algorithm": "metaphone",
            },
        )

    def _try_nickname_match(
        self,
        name_parts: list[str],
        requester_cm_id: int,
        session_cm_id: int | None,
        year: int | None,
        all_persons: list[Person],
    ) -> ResolutionResult:
        """Try matching using nickname groups.

        _names_match_with_nicknames() is called during phonetic search.

        This allows matching 'Mike Smith' -> 'Michael Smith', 'Kate Johnson' -> 'Katherine Johnson', etc.
        """
        search_first = name_parts[0].lower()
        search_last = name_parts[-1].lower()

        # Get all nickname variations for the search first name
        search_variations = set([search_first])
        search_variations.update(v.lower() for v in find_nickname_variations(search_first))

        # Get all nickname groups for bidirectional lookup
        nickname_groups = get_nickname_groups()

        matches = []
        for person in all_persons:
            person_first = person.first_name.lower() if person.first_name else ""
            person_last = person.last_name.lower() if person.last_name else ""

            # Last name must match (case-insensitive)
            if person_last != search_last:
                continue

            # Check if first names match via nickname groups
            if self._names_match_via_nicknames(search_first, person_first, nickname_groups):
                matches.append(person)

        # Filter out self-references
        matches = self._filter_self_references(matches, requester_cm_id)

        if not matches:
            return ResolutionResult(confidence=0.0, method=self.name)

        if len(matches) == 1:
            confidence = self._calculate_confidence(matches[0], requester_cm_id, session_cm_id, year, is_nickname=True)
            return ResolutionResult(
                person=matches[0],
                confidence=confidence,
                method=self.name,
                metadata={"match_type": "nickname", "algorithm": "nickname"},
            )

        # Multiple matches - try to disambiguate with session
        if year and session_cm_id:
            result = self._disambiguate_with_session(matches, requester_cm_id, session_cm_id, year)
            if result.is_resolved:
                if result.metadata is not None:
                    result.metadata["match_type"] = "nickname_with_session"
                    result.metadata["algorithm"] = "nickname"
                return result

        return ResolutionResult(
            candidates=matches,
            confidence=0.45,
            method=self.name,
            metadata={
                "ambiguity_reason": "multiple_nickname_matches",
                "match_count": len(matches),
                "algorithm": "nickname",
            },
        )

    def _try_parent_surname_phonetic_match(
        self,
        name_parts: list[str],
        requester_cm_id: int,
        session_cm_id: int | None,
        year: int | None,
        all_persons: list[Person],
    ) -> ResolutionResult:
        """Try matching using phonetic comparison of last name against parent surnames.

        Example: "Emma Smidt" → matches camper Emma Johnson whose parent is "Smith"
        because "Smidt" sounds like "Smith" (Soundex or Metaphone match).
        """
        first_name = name_parts[0]
        last_name = name_parts[-1]

        # Generate phonetic codes for the search last name
        last_soundex = self._soundex(last_name)
        last_metaphone = self._metaphone(last_name)

        # Get nickname variations for first name
        first_variations = set([first_name.lower()])
        first_variations.update(v.lower() for v in find_nickname_variations(first_name))

        matches = []
        for person in all_persons:
            # Check first name matches (including nicknames)
            person_first = person.first_name.lower() if person.first_name else ""
            if person_first not in first_variations:
                # Also check preferred name
                person_pref = (person.preferred_name or "").lower()
                if person_pref not in first_variations:
                    continue

            # Check if any parent surname phonetically matches
            for parent_surname in person.parent_last_names:
                parent_soundex = self._soundex(parent_surname)
                parent_metaphone = self._metaphone(parent_surname)

                if last_soundex == parent_soundex or last_metaphone == parent_metaphone:
                    matches.append(person)
                    break  # Found a match, no need to check other parent surnames

        # Filter out self-references
        matches = self._filter_self_references(matches, requester_cm_id)

        if not matches:
            return ResolutionResult(confidence=0.0, method=self.name)

        if len(matches) == 1:
            confidence = self._calculate_confidence(matches[0], requester_cm_id, session_cm_id, year, is_soundex=True)
            # Reduce confidence for parent surname phonetic match
            confidence = min(confidence - 0.05, 0.80)
            return ResolutionResult(
                person=matches[0],
                confidence=confidence,
                method=self.name,
                metadata={
                    "match_type": "parent_surname_phonetic",
                    "algorithm": "soundex+metaphone",
                    "search_surname": last_name,
                },
            )

        # Multiple matches - try to disambiguate with session
        if year and session_cm_id:
            result = self._disambiguate_with_session(matches, requester_cm_id, session_cm_id, year)
            if result.is_resolved:
                if result.metadata is not None:
                    result.metadata["match_type"] = "parent_surname_phonetic"
                    result.metadata["algorithm"] = "soundex+metaphone"
                result.confidence = min(result.confidence - 0.05, 0.80)
                return result

        return ResolutionResult(
            candidates=matches,
            confidence=0.40,
            method=self.name,
            metadata={
                "ambiguity_reason": "multiple_parent_surname_phonetic_matches",
                "match_count": len(matches),
                "algorithm": "soundex+metaphone",
            },
        )

    def _names_match_via_nicknames(self, name1: str, name2: str, nickname_groups: list[set[str]]) -> bool:
        """Check if two names match via nickname groups.

        (_names_match_with_nicknames method).

        Args:
            name1: First name (lowercase)
            name2: Second name (lowercase)
            nickname_groups: List of nickname group sets

        Returns:
            True if names match exactly or are in the same nickname group
        """
        # Exact match
        if name1 == name2:
            return True

        # Check if both names are in the same nickname group
        return any(name1 in group and name2 in group for group in nickname_groups)

    def _soundex(self, name: str) -> str:
        """Generate Soundex code for a name.

        Soundex algorithm:
        1. Keep the first letter
        2. Replace consonants with digits
        3. Remove vowels and h, w, y
        4. Limit to 4 characters, pad with 0s if needed
        """
        if not name:
            return "0000"

        # Convert to uppercase
        name = name.upper()

        # Save the first letter
        soundex = name[0]

        # Mapping of letters to digits
        mapping = {
            "B": "1",
            "F": "1",
            "P": "1",
            "V": "1",
            "C": "2",
            "G": "2",
            "J": "2",
            "K": "2",
            "Q": "2",
            "S": "2",
            "X": "2",
            "Z": "2",
            "D": "3",
            "T": "3",
            "L": "4",
            "M": "5",
            "N": "5",
            "R": "6",
        }

        # Process remaining letters
        last_digit = mapping.get(name[0], "0")  # Get digit for first letter
        for letter in name[1:]:
            digit = mapping.get(letter, "0")
            if digit != "0" and digit != last_digit:
                soundex += digit
            last_digit = digit

        # Pad with zeros or truncate to length 4
        soundex = soundex[:4].ljust(4, "0")

        return soundex

    def _metaphone(self, name: str) -> str:
        """Generate simplified Metaphone code for a name.

        This is a simplified version focusing on common patterns.
        """
        if not name:
            return ""

        # Convert to uppercase and remove non-letters
        name = "".join(c for c in name.upper() if c.isalpha())
        if not name:
            return ""

        # Apply transformations
        result = name

        # Common beginning patterns
        if result.startswith("KN") or result.startswith("GN") or result.startswith("PN"):
            result = "N" + result[2:]
        elif result.startswith("WR"):
            result = "R" + result[2:]

        # Replace patterns in specific order (longer patterns first)
        replacements = [
            ("DGE", "J"),
            ("TIO", "SH"),
            ("TIA", "SH"),
            ("TCH", "CH"),
            ("CK", "K"),
            ("PH", "F"),
            ("GH", ""),  # Silent GH as in Night
            ("TH", "T"),  # TH often sounds like T
            ("Q", "K"),
            ("V", "F"),
            ("Z", "S"),
            ("X", "KS"),
            ("C", "K"),  # Simplified - C usually sounds like K
            ("H", ""),  # H is often silent
        ]

        for old, new in replacements:
            result = result.replace(old, new)

        # Remove duplicate letters
        simplified = ""
        last_char = ""
        for char in result:
            if char != last_char:
                simplified += char
                last_char = char

        return simplified

    def _disambiguate_with_session(
        self, matches: list[Person], requester_cm_id: int, session_cm_id: int, year: int
    ) -> ResolutionResult:
        """Try to disambiguate using session information"""
        # Get sessions for all matches
        match_cm_ids = [m.cm_id for m in matches]
        sessions_map = self.attendee_repo.bulk_get_sessions_for_persons(match_cm_ids, year)

        # Filter by same session
        same_session_matches = [m for m in matches if sessions_map.get(m.cm_id) == session_cm_id]

        if len(same_session_matches) == 1:
            return ResolutionResult(
                person=same_session_matches[0],
                confidence=self._get_confidence("session_match", DEFAULT_SESSION_MATCH),
                method=self.name,
                metadata={"session_match": "exact"},
            )

        return ResolutionResult(confidence=0.0, method=self.name)

    def _calculate_confidence(
        self,
        person: Person,
        requester_cm_id: int,
        session_cm_id: int | None,
        year: int | None,
        is_soundex: bool = False,
        is_metaphone: bool = False,
        is_nickname: bool = False,
    ) -> float:
        """Calculate confidence based on match type and session verification"""
        # Base confidence by algorithm (from config with fallback to defaults)
        if is_soundex:
            base_confidence = float(self._get_confidence("soundex_base", DEFAULT_SOUNDEX_BASE))
        elif is_metaphone:
            base_confidence = float(self._get_confidence("metaphone_base", DEFAULT_METAPHONE_BASE))
        elif is_nickname:
            base_confidence = float(self._get_confidence("nickname_base", DEFAULT_NICKNAME_BASE))
        else:
            base_confidence = float(self._get_confidence("default_base", DEFAULT_CONFIDENCE))

        # Verify session if possible
        if year and session_cm_id:
            sessions_map = self.attendee_repo.bulk_get_sessions_for_persons([person.cm_id], year)
            person_session = sessions_map.get(person.cm_id)
            return self._apply_session_adjustment_simple(base_confidence, person_session, session_cm_id)

        # No session info - apply slight penalty
        penalty = float(self._get_confidence("not_enrolled_penalty", DEFAULT_NOT_ENROLLED_PENALTY))
        return base_confidence + penalty

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
        parsed = parse_name(name)
        if not parsed.first:
            return ResolutionResult(confidence=0.0, method=self.name, metadata={"reason": "empty_name"})

        # Use all_persons for phonetic matching when candidates is empty (single-name targets)
        # This avoids the expensive fallback to resolve() which re-fetches all persons
        phonetic_pool = candidates if candidates else all_persons

        # If we still have no pool to search, we can't do phonetic matching
        if not phonetic_pool:
            return ResolutionResult(confidence=0.0, method=self.name, metadata={"reason": "no_candidates"})

        # Try phonetic matching with pre-loaded data
        if parsed.is_complete:
            # Convert to list for helper methods
            name_parts = [parsed.first, parsed.last]
            # Try Soundex matching
            result = self._try_soundex_match_with_context(
                name_parts, requester_cm_id, session_cm_id, year, phonetic_pool, attendee_info
            )
            if result.is_resolved or result.is_ambiguous:
                return result

            # Try Metaphone matching as fallback
            result = self._try_metaphone_match_with_context(
                name_parts, requester_cm_id, session_cm_id, year, phonetic_pool, attendee_info
            )
            if result.is_resolved or result.is_ambiguous:
                return result

            # Try parent surname phonetic matching
            result = self._try_parent_surname_phonetic_match_with_context(
                name_parts, requester_cm_id, session_cm_id, year, phonetic_pool, attendee_info
            )
            if result.is_resolved or result.is_ambiguous:
                return result

        # No phonetic match found
        return ResolutionResult(confidence=0.0, method=self.name, metadata={"reason": "no_phonetic_match"})

    def _try_soundex_match_with_context(
        self,
        name_parts: list[str],
        requester_cm_id: int,
        session_cm_id: int | None,
        year: int | None,
        candidates: list[Person],
        attendee_info: dict[int, dict[str, Any]] | None,
    ) -> ResolutionResult:
        """Try matching using Soundex algorithm with pre-loaded candidates"""
        first_name = name_parts[0]
        last_name = name_parts[-1]

        # Generate Soundex codes
        first_soundex = self._soundex(first_name)
        last_soundex = self._soundex(last_name)

        # Filter candidates by Soundex match
        matches = []
        for person in candidates:
            # Check if Soundex codes match
            if self._soundex(person.first_name) == first_soundex and self._soundex(person.last_name) == last_soundex:
                matches.append(person)

        # Filter out self-references
        matches = self._filter_self_references(matches, requester_cm_id)

        if not matches:
            return ResolutionResult(confidence=0.0, method=self.name)

        if len(matches) == 1:
            confidence = self._calculate_confidence_with_context(
                matches[0], requester_cm_id, session_cm_id, year, attendee_info, is_soundex=True
            )
            return ResolutionResult(
                person=matches[0],
                confidence=confidence,
                method=self.name,
                metadata={"match_type": "soundex", "algorithm": "soundex"},
            )

        # Multiple matches - try to disambiguate with session
        if year and session_cm_id and attendee_info:
            result = self._disambiguate_with_session_context(
                matches, requester_cm_id, session_cm_id, year, attendee_info
            )
            if result.is_resolved:
                if result.metadata is not None:
                    result.metadata["match_type"] = "soundex_with_session"
                    result.metadata["algorithm"] = "soundex"
                return result

        return ResolutionResult(
            candidates=matches,
            confidence=0.4,
            method=self.name,
            metadata={
                "ambiguity_reason": "multiple_soundex_matches",
                "match_count": len(matches),
                "algorithm": "soundex",
            },
        )

    def _try_metaphone_match_with_context(
        self,
        name_parts: list[str],
        requester_cm_id: int,
        session_cm_id: int | None,
        year: int | None,
        candidates: list[Person],
        attendee_info: dict[int, dict[str, Any]] | None,
    ) -> ResolutionResult:
        """Try matching using Metaphone algorithm with pre-loaded candidates"""
        first_name = name_parts[0]
        last_name = name_parts[-1]

        # Generate Metaphone codes
        first_metaphone = self._metaphone(first_name)
        last_metaphone = self._metaphone(last_name)

        # Filter candidates by Metaphone match
        matches = []
        for person in candidates:
            # Check if Metaphone codes match
            if (
                self._metaphone(person.first_name) == first_metaphone
                and self._metaphone(person.last_name) == last_metaphone
            ):
                matches.append(person)

        # Filter out self-references
        matches = self._filter_self_references(matches, requester_cm_id)

        if not matches:
            return ResolutionResult(confidence=0.0, method=self.name)

        if len(matches) == 1:
            confidence = self._calculate_confidence_with_context(
                matches[0], requester_cm_id, session_cm_id, year, attendee_info, is_metaphone=True
            )
            return ResolutionResult(
                person=matches[0],
                confidence=confidence,
                method=self.name,
                metadata={"match_type": "metaphone", "algorithm": "metaphone"},
            )

        # Multiple matches - try to disambiguate
        if year and session_cm_id and attendee_info:
            result = self._disambiguate_with_session_context(
                matches, requester_cm_id, session_cm_id, year, attendee_info
            )
            if result.is_resolved:
                if result.metadata is not None:
                    result.metadata["match_type"] = "metaphone_with_session"
                    result.metadata["algorithm"] = "metaphone"
                return result

        return ResolutionResult(
            candidates=matches,
            confidence=0.35,
            method=self.name,
            metadata={
                "ambiguity_reason": "multiple_metaphone_matches",
                "match_count": len(matches),
                "algorithm": "metaphone",
            },
        )

    def _disambiguate_with_session_context(
        self,
        matches: list[Person],
        requester_cm_id: int,
        session_cm_id: int,
        year: int,
        attendee_info: dict[int, dict[str, Any]] | None,
    ) -> ResolutionResult:
        """Try to disambiguate using session information from pre-loaded data"""
        # Filter by same session using pre-loaded attendee info
        same_session_matches = []
        if attendee_info is not None:
            for m in matches:
                if m.cm_id in attendee_info and attendee_info[m.cm_id].get("session_cm_id") == session_cm_id:
                    same_session_matches.append(m)

        if len(same_session_matches) == 1:
            return ResolutionResult(
                person=same_session_matches[0],
                confidence=self._get_confidence("session_match", DEFAULT_SESSION_MATCH),
                method=self.name,
                metadata={"session_match": "exact"},
            )

        return ResolutionResult(confidence=0.0, method=self.name)

    def _calculate_confidence_with_context(
        self,
        person: Person,
        requester_cm_id: int,
        session_cm_id: int | None,
        year: int | None,
        attendee_info: dict[int, dict[str, Any]] | None,
        is_soundex: bool = False,
        is_metaphone: bool = False,
    ) -> float:
        """Calculate confidence based on match type and session verification using pre-loaded data"""
        # Base confidence by algorithm (from config with fallback to defaults)
        if is_soundex:
            base_confidence = float(self._get_confidence("soundex_base", DEFAULT_SOUNDEX_BASE))
        elif is_metaphone:
            base_confidence = float(self._get_confidence("metaphone_base", DEFAULT_METAPHONE_BASE))
        else:
            base_confidence = float(self._get_confidence("default_base", DEFAULT_CONFIDENCE))

        # Verify session if possible using pre-loaded data
        if year and session_cm_id and attendee_info is not None and person.cm_id in attendee_info:
            person_session = attendee_info[person.cm_id].get("session_cm_id")
            return self._apply_session_adjustment_simple(base_confidence, person_session, session_cm_id)

        # No session info - apply slight penalty
        penalty = float(self._get_confidence("not_enrolled_penalty", DEFAULT_NOT_ENROLLED_PENALTY))
        return base_confidence + penalty

    def _try_parent_surname_phonetic_match_with_context(
        self,
        name_parts: list[str],
        requester_cm_id: int,
        session_cm_id: int | None,
        year: int | None,
        candidates: list[Person],
        attendee_info: dict[int, dict[str, Any]] | None,
    ) -> ResolutionResult:
        """Try matching using phonetic comparison of last name against parent surnames.

        Uses pre-loaded candidates for O(1) lookups.

        Example: "Emma Smidt" → matches camper Emma Johnson whose parent is "Smith"
        because "Smidt" sounds like "Smith" (Soundex or Metaphone match).
        """
        first_name = name_parts[0]
        last_name = name_parts[-1]

        # Generate phonetic codes for the search last name
        last_soundex = self._soundex(last_name)
        last_metaphone = self._metaphone(last_name)

        # Get nickname variations for first name
        first_variations = set([first_name.lower()])
        first_variations.update(v.lower() for v in find_nickname_variations(first_name))

        matches = []
        for person in candidates:
            # Check first name matches (including nicknames)
            person_first = person.first_name.lower() if person.first_name else ""
            if person_first not in first_variations:
                # Also check preferred name
                person_pref = (person.preferred_name or "").lower()
                if person_pref not in first_variations:
                    continue

            # Check if any parent surname phonetically matches
            for parent_surname in person.parent_last_names:
                parent_soundex = self._soundex(parent_surname)
                parent_metaphone = self._metaphone(parent_surname)

                if last_soundex == parent_soundex or last_metaphone == parent_metaphone:
                    if person.cm_id != requester_cm_id:
                        matches.append(person)
                    break  # Found a match, no need to check other parent surnames

        if not matches:
            return ResolutionResult(confidence=0.0, method=self.name)

        if len(matches) == 1:
            confidence = self._calculate_confidence_with_context(
                matches[0], requester_cm_id, session_cm_id, year, attendee_info, is_soundex=True
            )
            # Reduce confidence for parent surname phonetic match
            confidence = min(confidence - 0.05, 0.80)
            return ResolutionResult(
                person=matches[0],
                confidence=confidence,
                method=self.name,
                metadata={
                    "match_type": "parent_surname_phonetic",
                    "algorithm": "soundex+metaphone",
                    "search_surname": last_name,
                },
            )

        # Multiple matches - try to disambiguate with session
        if year and session_cm_id and attendee_info:
            result = self._disambiguate_with_session_context(
                matches, requester_cm_id, session_cm_id, year, attendee_info
            )
            if result.is_resolved:
                if result.metadata is not None:
                    result.metadata["match_type"] = "parent_surname_phonetic"
                    result.metadata["algorithm"] = "soundex+metaphone"
                result.confidence = min(result.confidence - 0.05, 0.80)
                return result

        return ResolutionResult(
            candidates=matches,
            confidence=0.40,
            method=self.name,
            metadata={
                "ambiguity_reason": "multiple_parent_surname_phonetic_matches",
                "match_count": len(matches),
                "algorithm": "soundex+metaphone",
            },
        )

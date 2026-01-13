"""Fuzzy match strategy for name resolution.

Implements fuzzy name matching including nicknames, spelling variations,
and preferred name matching.

Confidence values are loaded from PocketBase config to avoid hardcoding."""

from __future__ import annotations

from typing import Any

from ...analysis import RelationshipAnalyzer
from ...core.models import Person
from ...data.repositories import AttendeeRepository, PersonRepository
from ...shared import last_name_matches, parse_name
from ...shared.nickname_groups import SPELLING_VARIATIONS, find_nickname_variations
from ..interfaces import ResolutionResult
from .base_match_strategy import BaseMatchStrategy

# Default fallback values when config is missing
DEFAULT_NICKNAME_BASE = 0.85
DEFAULT_SPELLING_BASE = 0.85
DEFAULT_NORMALIZED_BASE = 0.80
DEFAULT_CONFIDENCE = 0.75
DEFAULT_SESSION_MATCH = 0.85
DEFAULT_SAME_SESSION_BOOST = 0.0  # Fuzzy match maintains base confidence for same session
DEFAULT_DIFFERENT_SESSION_PENALTY = -0.10
DEFAULT_NOT_ENROLLED_PENALTY = -0.05  # Person not in attendee list for this year


class FuzzyMatchStrategy(BaseMatchStrategy):
    """Strategy for fuzzy name matching.

    Inherits shared disambiguation logic from BaseMatchStrategy.
    All methods support optional pre-loaded candidates for batch optimization.
    """

    def __init__(
        self,
        person_repository: PersonRepository,
        attendee_repository: AttendeeRepository,
        relationship_analyzer: RelationshipAnalyzer | None = None,
        config: dict[str, Any] | None = None,
    ):
        """Initialize the fuzzy match strategy.

        Args:
            person_repository: Repository for person data access
            attendee_repository: Repository for attendee data access
            relationship_analyzer: Optional analyzer for relationship-based confidence boosting
            config: Optional config dict with confidence values from PocketBase
        """
        super().__init__(person_repository, attendee_repository, config)
        self._strategy_name = "fuzzy_match"
        self.relationship_analyzer = relationship_analyzer

    def _get_confidence(self, key: str, default: float) -> float:
        """Get confidence value from config with fallback to default."""
        return float(self.config.get(key, default))

    def _apply_session_adjustment_simple(
        self, base_confidence: float, person_session: int | None, requester_session: int | None
    ) -> float:
        """Apply session-based confidence adjustment using session IDs directly."""
        if person_session is None or requester_session is None:
            # No session info - slight penalty
            penalty = float(self._get_confidence("not_enrolled_penalty", DEFAULT_NOT_ENROLLED_PENALTY))
            return base_confidence + penalty
        if person_session == requester_session:
            boost = float(self._get_confidence("same_session_boost", DEFAULT_SAME_SESSION_BOOST))
            return base_confidence + boost
        else:
            penalty = float(self._get_confidence("different_session_penalty", DEFAULT_DIFFERENT_SESSION_PENALTY))
            return base_confidence + penalty

    def resolve(
        self, name: str, requester_cm_id: int, session_cm_id: int | None = None, year: int | None = None
    ) -> ResolutionResult:
        """Attempt fuzzy name resolution (simple API without pre-loaded data)."""
        return self.resolve_with_context(name, requester_cm_id, session_cm_id, year)

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
        """Resolve with optional pre-loaded candidates and attendee info.

        When candidates/attendee_info are provided, uses in-memory filtering
        for batch optimization. Otherwise falls back to database queries.
        """
        parsed = parse_name(name)
        if not parsed.first:
            return ResolutionResult(confidence=0.0, method=self.name, metadata={"reason": "empty_name"})

        # Try different fuzzy matching approaches
        if parsed.is_complete:
            name_parts = [parsed.first, parsed.last]

            # 1. Try nickname variations
            result = self._try_nickname_variations(
                name_parts, requester_cm_id, session_cm_id, year, candidates, attendee_info
            )
            if result.is_resolved or result.is_ambiguous:
                return result

            # 2. Try spelling variations
            result = self._try_spelling_variations(
                name_parts, requester_cm_id, session_cm_id, year, candidates, attendee_info
            )
            if result.is_resolved or result.is_ambiguous:
                return result

        # 3. Try normalized name search
        result = self._try_normalized_search(name, requester_cm_id, session_cm_id, year, candidates, attendee_info)
        if result.is_resolved or result.is_ambiguous:
            return result

        # 4. Try parent surname matching
        if parsed.is_complete:
            result = self._try_parent_surname_match(
                parsed.first.title(),
                parsed.last.title(),
                requester_cm_id,
                session_cm_id,
                year,
                candidates,
                attendee_info,
            )
            if result.is_resolved or result.is_ambiguous:
                return result

        return ResolutionResult(confidence=0.0, method=self.name, metadata={"reason": "no_fuzzy_match"})

    def _try_nickname_variations(
        self,
        name_parts: list[str],
        requester_cm_id: int,
        session_cm_id: int | None,
        year: int | None,
        candidates: list[Person] | None = None,
        attendee_info: dict[int, dict[str, Any]] | None = None,
    ) -> ResolutionResult:
        """Try matching nicknames to full names."""
        first_name = name_parts[0]
        last_name = name_parts[-1]
        variations = find_nickname_variations(first_name)

        for variant in variations:
            # Get matches - either from pre-loaded candidates or DB
            # Treat empty list same as None to fall back to DB queries
            if candidates:
                matches = [
                    c
                    for c in candidates
                    if c.first_name.title() == variant.title() and last_name_matches(last_name, c.last_name)
                ]
            else:
                matches = self.person_repo.find_by_name(variant.title(), last_name.title(), year=year)

            matches = self._filter_self_references(matches, requester_cm_id)

            if matches:
                if len(matches) == 1:
                    confidence = self._calculate_confidence(
                        matches[0], requester_cm_id, session_cm_id, year, attendee_info, is_nickname=True
                    )
                    return ResolutionResult(
                        person=matches[0],
                        confidence=confidence,
                        method=self.name,
                        metadata={"match_type": "nickname", "variant": variant},
                    )
                else:
                    return ResolutionResult(
                        candidates=matches,
                        confidence=0.5,
                        method=self.name,
                        metadata={
                            "ambiguity_reason": "multiple_nickname_matches",
                            "match_count": len(matches),
                            "variant": variant,
                        },
                    )

        return ResolutionResult(confidence=0.0, method=self.name)

    def _try_spelling_variations(
        self,
        name_parts: list[str],
        requester_cm_id: int,
        session_cm_id: int | None,
        year: int | None,
        candidates: list[Person] | None = None,
        attendee_info: dict[int, dict[str, Any]] | None = None,
    ) -> ResolutionResult:
        """Try common spelling variations."""
        first_name = name_parts[0].lower()
        last_name = name_parts[-1]

        if first_name not in SPELLING_VARIATIONS:
            return ResolutionResult(confidence=0.0, method=self.name)

        for variant in SPELLING_VARIATIONS[first_name]:
            if candidates:
                matches = [
                    c
                    for c in candidates
                    if c.first_name.title() == variant.title() and last_name_matches(last_name, c.last_name)
                ]
            else:
                matches = self.person_repo.find_by_name(variant.title(), last_name.title(), year=year)

            matches = self._filter_self_references(matches, requester_cm_id)

            if matches:
                if len(matches) == 1:
                    confidence = self._calculate_confidence(
                        matches[0], requester_cm_id, session_cm_id, year, attendee_info, is_spelling=True
                    )
                    return ResolutionResult(
                        person=matches[0],
                        confidence=confidence,
                        method=self.name,
                        metadata={"match_type": "spelling_variation", "variant": variant},
                    )
                else:
                    return ResolutionResult(
                        candidates=matches,
                        confidence=0.5,
                        method=self.name,
                        metadata={
                            "ambiguity_reason": "multiple_spelling_matches",
                            "match_count": len(matches),
                            "variant": variant,
                        },
                    )

        return ResolutionResult(confidence=0.0, method=self.name)

    def _try_normalized_search(
        self,
        name: str,
        requester_cm_id: int,
        session_cm_id: int | None,
        year: int | None,
        candidates: list[Person] | None = None,
        attendee_info: dict[int, dict[str, Any]] | None = None,
    ) -> ResolutionResult:
        """Try normalized search including preferred names."""
        name_lower = name.lower().strip()
        match_type = "normalized"

        if candidates:
            # In-memory normalized matching - track if match is via preferred_name
            matches = []
            for c in candidates:
                full_name_lower = f"{c.first_name} {c.last_name}".lower()
                if name_lower in full_name_lower:
                    matches.append(c)
                elif hasattr(c, "preferred_name") and c.preferred_name and name_lower in c.preferred_name.lower():
                    matches.append(c)
                    match_type = "preferred_name"
        else:
            matches = self.person_repo.find_by_normalized_name(name, year=year)
            # Check if any match is via preferred_name
            for m in matches:
                if hasattr(m, "preferred_name") and m.preferred_name:
                    pref_lower = m.preferred_name.lower()
                    # Check if the search name matches preferred name but not first name
                    name_parts = name_lower.split()
                    first_search = name_parts[0] if name_parts else ""
                    if first_search and first_search in pref_lower and first_search not in m.first_name.lower():
                        match_type = "preferred_name"
                        break

        matches = self._filter_self_references(matches, requester_cm_id)

        if not matches:
            # Try first name only with nickname variations
            name_parts = name.strip().split()
            if len(name_parts) == 1:
                first_only = name_parts[0]
                variations = find_nickname_variations(first_only)
                for variant in variations:
                    if candidates:
                        var_matches = [c for c in candidates if c.first_name.lower() == variant.lower()]
                    else:
                        var_matches = self.person_repo.find_by_first_name(variant, year=year)
                    var_matches = self._filter_self_references(var_matches, requester_cm_id)
                    if var_matches:
                        matches = var_matches
                        match_type = "first_name_nickname"
                        break

        if not matches:
            return ResolutionResult(confidence=0.0, method=self.name)

        if len(matches) == 1:
            confidence = self._calculate_confidence(
                matches[0], requester_cm_id, session_cm_id, year, attendee_info, is_normalized=True
            )
            return ResolutionResult(
                person=matches[0],
                confidence=confidence,
                method=self.name,
                metadata={"match_type": match_type},
            )
        else:
            # Try session disambiguation
            result = self._disambiguate_with_session(matches, requester_cm_id, session_cm_id, year, attendee_info)
            if result.is_resolved:
                return result

            # Try relationship disambiguation
            if self.relationship_analyzer and session_cm_id:
                result = self._pick_best_by_relationships(matches, requester_cm_id, session_cm_id)
                if result.is_resolved:
                    return result

            return ResolutionResult(
                candidates=matches,
                confidence=0.5,
                method=self.name,
                metadata={
                    "ambiguity_reason": "multiple_normalized_matches",
                    "match_count": len(matches),
                },
            )

    def _try_first_name_fuzzy(
        self,
        first_name: str,
        requester_cm_id: int,
        session_cm_id: int | None,
        year: int | None,
        candidates: list[Person] | None = None,
        attendee_info: dict[int, dict[str, Any]] | None = None,
    ) -> ResolutionResult:
        """Try matching first name only with fuzzy matching."""
        variations = find_nickname_variations(first_name)
        all_candidates: list[Person] = []

        for variant in [first_name] + list(variations):
            if candidates:
                matches = [c for c in candidates if c.first_name.lower() == variant.lower()]
            else:
                matches = self.person_repo.find_by_first_name(variant, year=year)

            matches = self._filter_self_references(matches, requester_cm_id)
            all_candidates.extend(m for m in matches if m not in all_candidates)

        if not all_candidates:
            return ResolutionResult(confidence=0.0, method=self.name)

        if len(all_candidates) == 1:
            confidence = self._calculate_confidence(
                all_candidates[0], requester_cm_id, session_cm_id, year, attendee_info, is_normalized=True
            )
            return ResolutionResult(
                person=all_candidates[0],
                confidence=confidence,
                method=self.name,
                metadata={"match_type": "first_name_only"},
            )

        # Try session disambiguation
        result = self._disambiguate_with_session(all_candidates, requester_cm_id, session_cm_id, year, attendee_info)
        if result.is_resolved:
            return result

        # Try relationship disambiguation
        if self.relationship_analyzer and session_cm_id:
            result = self._pick_best_by_relationships(all_candidates, requester_cm_id, session_cm_id)
            if result.is_resolved:
                return result

        return ResolutionResult(
            candidates=all_candidates,
            confidence=0.4,
            method=self.name,
            metadata={"ambiguity_reason": "multiple_first_name_matches", "match_count": len(all_candidates)},
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
        """Try matching via parent surname (e.g., 'Emma Smith' when Emma's dad is Smith)."""
        variations = [first_name] + list(find_nickname_variations(first_name))
        all_matches: list[Person] = []

        for variant in variations:
            if candidates:
                # Filter pre-loaded candidates by first name, then check parent surnames
                matches = [
                    c
                    for c in candidates
                    if c.first_name.lower() == variant.lower() and self._check_parent_surname(c, last_name)
                ]
            else:
                # Use repository method that handles parent surname lookup efficiently
                matches = self.person_repo.find_by_first_and_parent_surname(variant, last_name, year=year)

            for person in matches:
                if person.cm_id == requester_cm_id:
                    continue
                if person not in all_matches:
                    all_matches.append(person)

        if not all_matches:
            return ResolutionResult(confidence=0.0, method=self.name)

        if len(all_matches) == 1:
            base_conf = self._get_confidence("parent_surname_base", 0.70)
            confidence = self._calculate_confidence(all_matches[0], requester_cm_id, session_cm_id, year, attendee_info)
            # Use parent_surname_base as max since it's lower confidence
            confidence = min(confidence, base_conf)
            return ResolutionResult(
                person=all_matches[0],
                confidence=confidence,
                method=self.name,
                metadata={"match_type": "parent_surname", "inferred_surname": last_name},
            )
        else:
            return ResolutionResult(
                candidates=all_matches,
                confidence=0.45,
                method=self.name,
                metadata={
                    "ambiguity_reason": "multiple_parent_surname_matches",
                    "match_count": len(all_matches),
                },
            )

    def _check_parent_surname(self, person: Person, surname: str) -> bool:
        """Check if person has a parent with the given surname.

        Parses the parent_names JSON field which contains an array of parent info:
        [{"first": "John", "last": "Smith", "relationship": "Father"}, ...]
        """
        import json

        parent_names = getattr(person, "parent_names", None)
        if not parent_names:
            return False

        surname_lower = surname.lower()
        try:
            parents = json.loads(parent_names) if isinstance(parent_names, str) else parent_names
            for parent in parents:
                if isinstance(parent, dict):
                    parent_last = parent.get("last", "")
                    if parent_last and parent_last.lower() == surname_lower:
                        return True
        except (json.JSONDecodeError, TypeError):
            return False

        return False

    def _disambiguate_with_session(
        self,
        candidates: list[Person],
        requester_cm_id: int,
        session_cm_id: int | None,
        year: int | None,
        attendee_info: dict[int, dict[str, Any]] | None = None,
    ) -> ResolutionResult:
        """Try to disambiguate using session information."""
        if not session_cm_id or not year:
            return ResolutionResult(confidence=0.0, method=self.name)

        same_session = []
        for person in candidates:
            if attendee_info is not None:
                # Use pre-loaded attendee info
                person_info = attendee_info.get(person.cm_id, {})
                person_session = person_info.get("session_cm_id")
            else:
                # Query from repo
                sessions_map = self.attendee_repo.bulk_get_sessions_for_persons([person.cm_id], year)
                person_session = sessions_map.get(person.cm_id)

            if person_session == session_cm_id:
                same_session.append(person)

        if len(same_session) == 1:
            confidence = self._get_confidence("session_match", DEFAULT_SESSION_MATCH)
            return ResolutionResult(
                person=same_session[0],
                confidence=confidence,
                method=self.name,
                metadata={"match_type": "session_disambiguated"},
            )

        return ResolutionResult(confidence=0.0, method=self.name)

    def _calculate_confidence(
        self,
        person: Person,
        requester_cm_id: int,
        session_cm_id: int | None,
        year: int | None,
        attendee_info: dict[int, dict[str, Any]] | None = None,
        is_nickname: bool = False,
        is_spelling: bool = False,
        is_normalized: bool = False,
    ) -> float:
        """Calculate confidence based on match type and session verification."""
        # Base confidence by match type (from config)
        if is_nickname or is_spelling:
            base_confidence = float(self._get_confidence("nickname_base", DEFAULT_NICKNAME_BASE))
        elif is_normalized:
            base_confidence = float(self._get_confidence("normalized_base", DEFAULT_NORMALIZED_BASE))
        else:
            base_confidence = float(self._get_confidence("default_base", DEFAULT_CONFIDENCE))

        # Verify session
        if year and session_cm_id:
            if attendee_info is not None:
                # Use pre-loaded attendee info
                person_info = attendee_info.get(person.cm_id, {})
                person_session = person_info.get("session_cm_id")
            else:
                # Query from repo
                sessions_map = self.attendee_repo.bulk_get_sessions_for_persons([person.cm_id], year)
                person_session = sessions_map.get(person.cm_id)

            confidence = self._apply_session_adjustment_simple(base_confidence, person_session, session_cm_id)
        else:
            penalty = float(self._get_confidence("not_enrolled_penalty", DEFAULT_NOT_ENROLLED_PENALTY))
            confidence = base_confidence + penalty

        # Apply relationship boost if analyzer available (skip for context path for performance)
        if self.relationship_analyzer is not None and session_cm_id and attendee_info is None:
            requester = Person(cm_id=requester_cm_id, first_name="", last_name="")
            context = self.relationship_analyzer.analyze_relationships(
                requester=requester, candidates=[person], session_cm_id=session_cm_id
            )
            boost = float(self.relationship_analyzer.get_confidence_boost(context, person.cm_id))
            confidence = min(confidence + boost, 0.95)

        return confidence

    def _pick_best_by_relationships(
        self, candidates: list[Person], requester_cm_id: int, session_cm_id: int
    ) -> ResolutionResult:
        """Try to pick the best candidate based on relationships."""
        if self.relationship_analyzer is None:
            return ResolutionResult(confidence=0.0, method=self.name)

        requester = Person(cm_id=requester_cm_id, first_name="", last_name="")
        context = self.relationship_analyzer.analyze_relationships(
            requester=requester, candidates=candidates, session_cm_id=session_cm_id
        )

        best_score = 0.0
        best_person = None
        second_best_score = 0.0

        for person in candidates:
            boost = float(self.relationship_analyzer.get_confidence_boost(context, person.cm_id))
            if boost > best_score:
                second_best_score = best_score
                best_score = boost
                best_person = person
            elif boost > second_best_score:
                second_best_score = boost

        # Only resolve if there's a clear winner (margin >= 0.1)
        if best_person and (best_score - second_best_score) >= 0.1:
            # Get relationship description for metadata
            relationship_info = self.relationship_analyzer.describe_relationship(context, best_person.cm_id)
            return ResolutionResult(
                person=best_person,
                confidence=0.70 + best_score,  # Base 0.70 + relationship boost
                method=self.name,
                metadata={
                    "match_type": "relationship_disambiguated",
                    "relationship_boost": best_score,
                    "relationship_info": relationship_info,
                },
            )

        return ResolutionResult(confidence=0.0, method=self.name)

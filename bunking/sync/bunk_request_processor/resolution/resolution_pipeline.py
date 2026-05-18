"""Resolution pipeline for orchestrating name resolution strategies.

Manages the flow of resolution attempts through multiple strategies,
handling caching, fallbacks, and ambiguous results."""

from __future__ import annotations

from typing import Any

from bunking.logging_config import get_logger

from ..data.repositories import AttendeeRepository, PersonRepository
from ..name_resolution.filters.spread_filter import SpreadFilter
from .interfaces import ResolutionResult, ResolutionStrategy

logger = get_logger(__name__)


class ResolutionPipeline:
    """Orchestrates multiple resolution strategies"""

    def __init__(self, person_repository: PersonRepository, attendee_repository: AttendeeRepository):
        """Initialize the resolution pipeline.

        Args:
            person_repository: Repository for person data access
            attendee_repository: Repository for attendee data access
        """
        self.person_repo = person_repository
        self.attendee_repo = attendee_repository
        self.strategies: list[ResolutionStrategy] = []
        self.cache = None
        self.minimum_confidence = 0.0
        self.spread_filter: SpreadFilter | None = None
        self._person_sessions: dict[int, list[int]] | None = None

    def add_strategy(self, strategy: ResolutionStrategy) -> None:
        """Add a resolution strategy to the pipeline"""
        self.strategies.append(strategy)

    def set_cache(self, cache: Any) -> None:
        """Set cache implementation for resolution results"""
        self.cache = cache

    def set_minimum_confidence(self, threshold: float) -> None:
        """Set minimum confidence threshold for accepting resolutions"""
        self.minimum_confidence = threshold

    def set_spread_filter(self, spread_filter: SpreadFilter | None) -> None:
        """Set spread filter for age/grade validation"""
        self.spread_filter = spread_filter

    def set_person_sessions(self, person_sessions: dict[int, list[int]]) -> None:
        """Set pre-loaded person-to-session mappings from orchestrator.

        When set, batch_resolve() uses these instead of calling
        bulk_get_sessions_for_persons(), avoiding per-chunk DB round-trips.
        An empty dict is treated as "not set" so the fallback path still runs.
        """
        self._person_sessions = person_sessions

    def batch_resolve(self, requests: list[tuple[str, int, int | None, int | None]]) -> list[ResolutionResult]:
        """Batch resolve multiple names efficiently.

        Args:
            requests: List of tuples (name, requester_cm_id, session_cm_id, year)

        Returns:
            List of ResolutionResult in the same order as the input requests
        """
        if not requests:
            return []

        # Extract unique names and requester info
        unique_names = set()
        requester_cm_ids = set()
        years = set()

        for name, requester_cm_id, session_cm_id, year in requests:
            unique_names.add(name.strip())
            requester_cm_ids.add(requester_cm_id)
            if year:
                years.add(year)

        # Pre-load all potential person matches for all names
        # Use year from the batch to filter persons (typically all requests share same year)
        batch_year = next(iter(years)) if years else None

        # Pre-fetch persons for this year once, for phonetic/fallback matching (avoids 4x fetches per strategy)
        # Note: get_all_for_phonetic_matching filters by year, so this is NOT all persons ever
        all_persons_for_phonetic = self.person_repo.get_all_for_phonetic_matching(year=batch_year)
        logger.debug(f"Pre-loaded {len(all_persons_for_phonetic)} persons (year={batch_year}) for phonetic matching")

        all_candidates = {}
        for name in unique_names:
            # Parse name into first/last
            name_parts = name.strip().split()
            if len(name_parts) >= 2:
                first_name = name_parts[0]
                second_part = name_parts[1]

                # Check for "FirstName Initial" pattern (e.g., "Joe C")
                if len(second_part) == 1:
                    # Single character = last name initial, not full last name
                    initial = second_part.upper()
                    # Get all people with this first name, filtered by year
                    first_name_matches = self.person_repo.find_by_first_name(first_name, year=batch_year)
                    # Filter by last name initial
                    candidates = [p for p in first_name_matches if p.last_name and p.last_name[0].upper() == initial]
                    logger.debug(
                        f"First name + initial pattern '{name}': "
                        f"found {len(first_name_matches)} with first name, "
                        f"filtered to {len(candidates)} with initial '{initial}'"
                    )
                else:
                    # Normal full name lookup - filter by year to avoid historical duplicates
                    last_name = " ".join(name_parts[1:])
                    candidates = self.person_repo.find_by_name(first_name, last_name, year=batch_year)
                all_candidates[name.strip()] = candidates
            else:
                all_candidates[name.strip()] = []

        # Pre-load all attendee info for requesters and candidates
        all_person_ids = list(requester_cm_ids)
        all_persons_by_cm_id = {}  # Track all loaded Person objects

        for candidates in all_candidates.values():
            for person in candidates:
                all_person_ids.append(person.cm_id)
                all_persons_by_cm_id[person.cm_id] = person

        # Load Person objects for requesters (not loaded as candidates)
        for requester_cm_id in requester_cm_ids:
            if requester_cm_id not in all_persons_by_cm_id:
                requester_person = self.person_repo.find_by_cm_id(requester_cm_id)
                if requester_person:
                    all_persons_by_cm_id[requester_cm_id] = requester_person

        # Build attendee_info in the format strategies expect:
        # {cm_id: {'session_cm_id': ..., 'school': ..., 'grade': ..., 'city': ..., 'state': ...}}
        #
        # Strategies use this format for:
        # - Session disambiguation (fuzzy_match.py:703, phonetic_match.py:514)
        # - School disambiguation (school_disambiguation.py:433-437)
        attendee_info: dict[int, dict[str, Any]] = {}

        # Keep backward-compatible tuple-keyed dict for internal use (session context lookup)
        attendee_info_by_person_year = {}

        # Load session data: use pre-loaded orchestrator data if available,
        # otherwise fall back to bulk_get_sessions_for_persons (for tests, CLI tools).
        # Empty dict is falsy, so a failed orchestrator load falls through to the DB path.
        if self._person_sessions:
            # Use pre-loaded session data from orchestrator (handles any scale)
            for person_id in all_person_ids:
                sessions = self._person_sessions.get(person_id)
                if sessions:
                    session_id = sessions[0]  # Primary bunking session
                    for year in years:
                        attendee_info_by_person_year[(person_id, year)] = session_id
                    if person_id not in attendee_info:
                        attendee_info[person_id] = {
                            "session_cm_id": session_id,
                            "session_cm_ids": list(sessions),
                        }
        else:
            # Fallback for non-orchestrator callers (tests, CLI tools).
            # Cache session lookups to avoid duplicate bulk_get_sessions_for_persons calls.
            session_cache: dict[int, dict[int, int]] = {}  # year -> {person_id: session_id}
            for year in years:
                if year not in session_cache:
                    session_cache[year] = self.attendee_repo.bulk_get_sessions_for_persons(all_person_ids, year)

                person_sessions_from_db = session_cache[year]
                for person_id, session_id in person_sessions_from_db.items():
                    attendee_info_by_person_year[(person_id, year)] = session_id
                    if person_id not in attendee_info:
                        attendee_info[person_id] = {
                            "session_cm_id": session_id,
                            "session_cm_ids": [session_id],
                        }

        # Add person details (school, grade, city, state) from loaded Person objects
        for cm_id, person in all_persons_by_cm_id.items():
            if cm_id not in attendee_info:
                attendee_info[cm_id] = {}
            attendee_info[cm_id]["school"] = person.school
            attendee_info[cm_id]["grade"] = person.grade
            attendee_info[cm_id]["city"] = person.city
            attendee_info[cm_id]["state"] = person.state

        # Process each request using pre-loaded data
        results = []
        for name, requester_cm_id, session_cm_id, year in requests:
            # Get session context if not provided
            if session_cm_id is None and year:
                session_cm_id = attendee_info_by_person_year.get((requester_cm_id, year))

            # Check cache first
            if self.cache:
                cached_result = self.cache.get_cached_resolution(name, requester_cm_id, session_cm_id or 0, year or 0)
                if cached_result:
                    results.append(cached_result)
                    continue

            # Get pre-loaded candidates for this name
            candidates = all_candidates.get(name.strip(), [])
            logger.debug(f"Initial candidates for '{name}': {len(candidates)} found")

            # Apply spread filter if configured and we have requester info
            if self.spread_filter and candidates and year:
                # Get requester's info (need grade and age)
                requester_person = self.person_repo.find_by_cm_id(requester_cm_id)
                if requester_person:
                    # Filter candidates by age/grade spread
                    original_count = len(candidates)
                    candidates = self.spread_filter.filter_candidates(requester_person, candidates)
                    logger.debug(f"After spread filter: {len(candidates)} candidates (was {original_count})")

            # Try each strategy with the pre-loaded data
            best_result = ResolutionResult()
            all_results = []  # Track all strategy results for debugging
            # Per-request strategy attempt log for debug trace observability.
            # Each entry: strategy name, derived sub_method, confidence, candidate count,
            # and resolved/ambiguous flags. Attached to best_result.metadata at end.
            strategy_attempts: list[dict[str, Any]] = []

            for strategy in self.strategies:
                try:
                    result = strategy.resolve(
                        name=name,
                        requester_cm_id=requester_cm_id,
                        session_cm_id=session_cm_id,
                        year=year,
                        candidates=candidates,
                        attendee_info=attendee_info,
                        all_persons=all_persons_for_phonetic,
                    )

                    # Log detailed result info
                    logger.debug(
                        f"Strategy {strategy.name} for '{name}': "
                        f"resolved={result.is_resolved}, "
                        f"ambiguous={result.is_ambiguous}, "
                        f"confidence={result.confidence:.2f}, "
                        f"candidates={len(result.candidates) if result.candidates else 0}, "
                        f"person={result.person.cm_id if result.person else None}"
                    )
                    all_results.append((strategy.name, result))

                    # Derive sub_method from strategy metadata. Strategies set sub_method
                    # for resolved paths and ambiguity_reason for ambiguous paths.
                    meta = result.metadata or {}
                    sub_method = meta.get("sub_method") or meta.get("ambiguity_reason")
                    strategy_attempts.append(
                        {
                            "strategy": strategy.name,
                            "sub_method": sub_method,
                            "confidence": result.confidence,
                            "candidate_count": (
                                len(result.candidates) if result.candidates else (1 if result.person else 0)
                            ),
                            "resolved": result.is_resolved,
                            "ambiguous": result.is_ambiguous,
                        }
                    )

                    # If we got a definitive match with high confidence, use it
                    if result.is_resolved and result.confidence >= max(0.8, self.minimum_confidence):
                        best_result = result
                        logger.debug(f"Using high-confidence result from {strategy.name}")
                        break

                    # Track best result so far
                    if result.confidence > best_result.confidence:
                        best_result = result

                    # If we have an ambiguous result, keep it unless we find better
                    if result.is_ambiguous and not best_result.is_ambiguous:
                        best_result = result

                except Exception as e:
                    # Log error but continue with other strategies
                    logger.error(f"Error in {strategy.name} strategy: {e}")
                    strategy_attempts.append(
                        {
                            "strategy": strategy.name,
                            "sub_method": None,
                            "confidence": 0.0,
                            "candidate_count": 0,
                            "resolved": False,
                            "ambiguous": False,
                            "error": str(e),
                        }
                    )
                    continue

            # Attach the per-request attempt log to the winning result so downstream
            # trace recorders can surface it on debug_pipeline_traces.phase2_resolution.
            # Copy the list so per-request mutations can't leak into a shared/cached
            # ResolutionResult if a strategy ever returns one.
            if best_result.metadata is None:
                best_result.metadata = {}
            best_result.metadata["pipeline_strategies_tried"] = list(strategy_attempts)

            # Log final decision
            logger.debug(
                f"Final result for '{name}': "
                f"resolved={best_result.is_resolved}, "
                f"ambiguous={best_result.is_ambiguous}, "
                f"confidence={best_result.confidence:.2f}, "
                f"candidates={len(best_result.candidates) if best_result.candidates else 0}"
            )

            # Apply minimum confidence threshold
            if best_result.is_resolved and best_result.confidence < self.minimum_confidence:
                # Convert to unresolved if below threshold
                best_result.person = None
                if best_result.metadata is None:
                    best_result.metadata = {}
                best_result.metadata["below_threshold"] = True

            # Cache the result
            if self.cache and best_result.confidence > 0:
                self.cache.cache_resolution(name, requester_cm_id, session_cm_id or 0, year or 0, best_result)

            results.append(best_result)

        return results

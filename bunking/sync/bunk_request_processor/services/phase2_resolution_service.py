"""Phase 2 Resolution Service - Handles local name resolution using V2's advanced strategies"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

from ..confidence.confidence_scorer import ConfidenceScorer
from ..core.models import ParsedRequest, ParseResult, Person, RequestType
from ..resolution.interfaces import ResolutionResult
from ..resolution.resolution_pipeline import ResolutionPipeline
from ..shared.constants import LAST_YEAR_BUNKMATES_PLACEHOLDER, SIBLING_PLACEHOLDER
from ..shared.name_utils import normalize_name
from ..shared.nickname_groups import names_match_via_nicknames

logger = logging.getLogger(__name__)


class ResolutionCase:
    """Container for parsed requests that need resolution"""

    def __init__(self, parse_result: ParseResult):
        self.parse_result = parse_result
        self.parsed_requests = parse_result.parsed_requests  # Now a list
        self.resolution_results: list[ResolutionResult | None] = []  # One per request
        self.requests_needing_resolution: list[tuple[int, ParsedRequest]] = []  # (index, request) pairs
        self._identify_requests_needing_resolution()

    def _identify_requests_needing_resolution(self) -> None:
        """Identify which requests in the list need name resolution"""
        for idx, parsed_request in enumerate(self.parsed_requests):
            if self._request_needs_resolution(parsed_request):
                self.requests_needing_resolution.append((idx, parsed_request))

    def _request_needs_resolution(self, parsed_request: ParsedRequest) -> bool:
        """Check if a specific request needs name resolution"""
        # Age preferences don't need name resolution
        if parsed_request.request_type == RequestType.AGE_PREFERENCE:
            return False

        # LAST_YEAR_BUNKMATES placeholder should NOT be resolved - it's expanded elsewhere
        if parsed_request.target_name == LAST_YEAR_BUNKMATES_PLACEHOLDER:
            return False

        # SIBLING placeholder should NOT be resolved - it's expanded elsewhere via household_id
        if parsed_request.target_name == SIBLING_PLACEHOLDER:
            return False

        # Bunk with/not bunk with need resolution if they have a target name
        return bool(parsed_request.target_name)

    @property
    def needs_resolution(self) -> bool:
        """Whether any request in this case needs resolution"""
        return len(self.requests_needing_resolution) > 0


class Phase2ResolutionService:
    """Handles Phase 2: Local resolution with all V2 strategies"""

    def __init__(
        self,
        resolution_pipeline: ResolutionPipeline,
        networkx_analyzer: Any | None = None,
        confidence_scorer: ConfidenceScorer | None = None,
        staff_name_filter: Callable[[str], bool] | None = None,
        attendee_repository: Any | None = None,
        person_repository: Any | None = None,
    ):
        """Initialize the Phase 2 resolution service.

        Args:
            resolution_pipeline: The V2 resolution pipeline with all strategies
            networkx_analyzer: Optional NetworkX analyzer for social graph enhancement
            confidence_scorer: Optional confidence scorer for result scoring
            staff_name_filter: Optional callable that returns True if a name is a detected
                staff/parent name that should be filtered from resolution.
            attendee_repository: Optional repository for prior bunkmate lookups
            person_repository: Optional repository for person data lookup
        """
        self.resolution_pipeline = resolution_pipeline
        self.networkx_analyzer = networkx_analyzer
        self.confidence_scorer = confidence_scorer
        self.staff_name_filter = staff_name_filter
        self.attendee_repository = attendee_repository
        self.person_repository = person_repository

        # Note: ConfidenceScorer uses social graph signals interface
        # which is set up in the orchestrator

        self._stats = {
            "total_processed": 0,
            "high_confidence_resolved": 0,
            "low_confidence_resolved": 0,
            "ambiguous": 0,
            "failed": 0,
            "age_preferences": 0,
            "networkx_enhanced": 0,
            "staff_filtered": 0,
            "prior_bunkmate_resolved": 0,
            "ai_candidate_resolved": 0,
            "ai_validated_resolved": 0,
            "ai_hallucinations_detected": 0,
            "smart_resolved": 0,
        }

    async def batch_resolve(self, parse_results: list[ParseResult]) -> list[tuple[ParseResult, list[ResolutionResult]]]:
        """Resolve names using all local strategies.

        This is Phase 2 of the three-phase approach. We use V2's
        advanced resolution strategies (exact, fuzzy, phonetic, school)
        to resolve names locally without AI.

        Args:
            parse_results: List of parsed requests from Phase 1

        Returns:
            List of tuples (ParseResult, List[ResolutionResult]) - one resolution per parsed request
        """
        if not parse_results:
            return []

        logger.info(f"Phase 2: Starting batch resolution for {len(parse_results)} requests")

        # Create resolution cases
        cases = [ResolutionCase(pr) for pr in parse_results if pr.is_valid]

        # Separate by type
        need_resolution = [c for c in cases if c.needs_resolution]
        no_resolution = [c for c in cases if not c.needs_resolution]

        logger.info(f"Phase 2: {len(need_resolution)} need resolution, {len(no_resolution)} don't need resolution")

        # Process cases needing resolution in batch
        if need_resolution:
            self._resolve_batch(need_resolution)

        # Handle cases that don't need resolution
        self._handle_no_resolution_cases(no_resolution)

        # Enhance ambiguous cases with NetworkX if available
        if self.networkx_analyzer:
            await self._enhance_with_networkx(cases)

        # Build results
        results = self._build_results(parse_results, cases)

        # Update statistics
        self._update_stats(results)

        logger.info(
            f"Phase 2 complete: "
            f"{self._stats['high_confidence_resolved']} high confidence, "
            f"{self._stats['low_confidence_resolved']} low confidence, "
            f"{self._stats['ambiguous']} ambiguous, "
            f"{self._stats['failed']} failed"
        )

        return results

    def _resolve_batch(self, cases: list[ResolutionCase]) -> None:
        """Resolve a batch of cases efficiently using batch resolution"""
        # Build requests for batch resolution
        batch_requests = []
        request_map = []  # Track (case_idx, request_idx) for each batch request
        staff_filtered_map = []  # Track (case_idx, request_idx) for staff names
        prior_bunkmate_resolved: dict[tuple[int, int], ResolutionResult] = {}
        ai_resolved: dict[tuple[int, int], ResolutionResult] = {}

        for case_idx, case in enumerate(cases):
            # Process each request that needs resolution in this case
            for req_idx, parsed in case.requests_needing_resolution:
                parse_result = case.parse_result

                # Skip if no parse_request (shouldn't happen, but be defensive)
                if parse_result.parse_request is None:
                    continue

                # Check if target name is a detected staff name
                if self.staff_name_filter and parsed.target_name and self.staff_name_filter(parsed.target_name):
                    logger.info(f"Filtered out staff name from request: {parsed.target_name}")
                    staff_filtered_map.append((case_idx, req_idx))
                    self._stats["staff_filtered"] += 1
                    continue

                if self._has_last_year_context(parsed) and parsed.target_name:
                    prior_result = self._try_prior_bunkmate_resolution(
                        target_name=parsed.target_name,
                        requester_cm_id=parse_result.parse_request.requester_cm_id,
                        session_cm_id=parse_result.parse_request.session_cm_id,
                        year=parse_result.parse_request.year,
                    )
                    if prior_result and prior_result.is_resolved:
                        prior_bunkmate_resolved[(case_idx, req_idx)] = prior_result
                        self._stats["prior_bunkmate_resolved"] += 1
                        continue  # Skip normal resolution pipeline

                ai_result, hallucination_detected = self._try_ai_id_validation(parsed)
                if hallucination_detected:
                    self._stats["ai_hallucinations_detected"] += 1
                    # Fall through to normal resolution after hallucination detected
                if ai_result and ai_result.is_resolved:
                    ai_resolved[(case_idx, req_idx)] = ai_result
                    self._stats["ai_validated_resolved"] += 1
                    continue  # Skip normal resolution pipeline

                ai_candidate_result, _ = self._try_ai_candidate_resolution(
                    parsed_request=parsed,
                    requester_cm_id=parse_result.parse_request.requester_cm_id,
                    requester_grade=parse_result.parse_request.requester_grade,
                    session_cm_id=parse_result.parse_request.session_cm_id,
                    year=parse_result.parse_request.year,
                )
                if ai_candidate_result and ai_candidate_result.is_resolved:
                    ai_resolved[(case_idx, req_idx)] = ai_candidate_result
                    self._stats["ai_candidate_resolved"] += 1
                    continue  # Skip normal resolution pipeline

                # Only add to batch if we have a target name
                if parsed.target_name:
                    batch_requests.append(
                        (
                            parsed.target_name,
                            parse_result.parse_request.requester_cm_id,
                            parse_result.parse_request.session_cm_id,
                            parse_result.parse_request.year,
                        )
                    )
                    request_map.append((case_idx, req_idx))

        # Initialize resolution_results for all cases with default values
        # Build map of staff-filtered indices per case for quick lookup
        staff_filtered_by_case: dict[int, set[int]] = {}
        for case_idx, req_idx in staff_filtered_map:
            if case_idx not in staff_filtered_by_case:
                staff_filtered_by_case[case_idx] = set()
            staff_filtered_by_case[case_idx].add(req_idx)

        # Build map of prior bunkmate resolutions per case
        prior_bunkmate_by_case: dict[int, dict[int, ResolutionResult]] = {}
        for (case_idx, req_idx), result in prior_bunkmate_resolved.items():
            if case_idx not in prior_bunkmate_by_case:
                prior_bunkmate_by_case[case_idx] = {}
            prior_bunkmate_by_case[case_idx][req_idx] = result

        # Build map of AI-resolved per case
        ai_resolved_by_case: dict[int, dict[int, ResolutionResult]] = {}
        for (case_idx, req_idx), result in ai_resolved.items():
            if case_idx not in ai_resolved_by_case:
                ai_resolved_by_case[case_idx] = {}
            ai_resolved_by_case[case_idx][req_idx] = result

        for case_idx, case in enumerate(cases):
            case.resolution_results = []
            # Get indices of requests that need resolution (excluding staff-filtered, prior-resolved, AI-resolved)
            needs_res_indices = {idx for idx, _ in case.requests_needing_resolution}
            staff_filtered_indices = staff_filtered_by_case.get(case_idx, set())
            prior_resolved = prior_bunkmate_by_case.get(case_idx, {})
            ai_resolved_results = ai_resolved_by_case.get(case_idx, {})

            for idx, parsed_request in enumerate(case.parsed_requests):
                # Check if this request was resolved via AI (ID validation or candidate list)
                if idx in ai_resolved_results:
                    case.resolution_results.append(ai_resolved_results[idx])
                # Check if this request was resolved via prior bunkmate
                elif idx in prior_resolved:
                    case.resolution_results.append(prior_resolved[idx])
                # Check if this request was staff-filtered
                elif idx in staff_filtered_indices:
                    case.resolution_results.append(
                        ResolutionResult(
                            person=None,
                            confidence=0.0,
                            method="staff_filtered",
                            metadata={"filtered_name": parsed_request.target_name},
                        )
                    )
                # Check if this request needs resolution (will be filled from batch)
                elif idx in needs_res_indices and idx not in prior_resolved and idx not in ai_resolved_results:
                    # Will be filled in later from batch_results
                    case.resolution_results.append(None)
                elif parsed_request.request_type == RequestType.AGE_PREFERENCE:
                    # Age preferences get a special resolution result
                    # Handle both enum and string age_preference values
                    age_pref = parsed_request.age_preference
                    if age_pref is None:
                        # Still need to append a result to maintain list alignment
                        case.resolution_results.append(
                            ResolutionResult(
                                person=None,
                                confidence=0.0,
                                method="age_preference_missing",
                                metadata={"error": "age_preference field was None"},
                            )
                        )
                    else:
                        age_pref_value = age_pref.value if hasattr(age_pref, "value") else age_pref
                        case.resolution_results.append(
                            ResolutionResult(
                                person=None,
                                confidence=1.0,
                                method="age_preference",
                                metadata={"age_preference": age_pref_value},
                            )
                        )
                elif parsed_request.target_name == LAST_YEAR_BUNKMATES_PLACEHOLDER:
                    case.resolution_results.append(
                        ResolutionResult(
                            person=None,
                            confidence=1.0,
                            method="placeholder",
                            metadata={"placeholder": LAST_YEAR_BUNKMATES_PLACEHOLDER},
                        )
                    )
                elif parsed_request.target_name == SIBLING_PLACEHOLDER:
                    case.resolution_results.append(
                        ResolutionResult(
                            person=None,
                            confidence=1.0,
                            method="placeholder",
                            metadata={"placeholder": SIBLING_PLACEHOLDER},
                        )
                    )
                else:
                    # Other requests that don't need resolution
                    case.resolution_results.append(ResolutionResult(confidence=0.0, method="no_target_name"))

        # If no batch requests remain after staff filtering, we're done
        if not batch_requests:
            return

        # Batch resolve all names at once
        # Need to rebuild list due to type variance - list is invariant
        batch_requests_typed: list[tuple[str, int, int | None, int | None]] = [
            (name, req_id, sess_id, yr) for name, req_id, sess_id, yr in batch_requests
        ]
        batch_results = self.resolution_pipeline.batch_resolve(batch_requests_typed)

        # Log batch resolution results
        logger.debug(f"Batch resolved {len(batch_results)} names")
        for j, (req, result) in enumerate(zip(batch_requests, batch_results, strict=False)):
            name, requester_id, session_id, year = req
            num_candidates = len(result.candidates) if result.candidates else 0
            logger.debug(
                f"Result for '{name}' (requester={requester_id}): "
                f"resolved={result.is_resolved}, ambiguous={result.is_ambiguous}, "
                f"confidence={result.confidence:.2f}, candidates={num_candidates}"
            )

        for j, result in enumerate(batch_results):
            case_idx, req_idx = request_map[j]
            case = cases[case_idx]
            parsed = case.parsed_requests[req_idx]
            parse_result = case.parse_result

            # Store result at the correct index
            case.resolution_results[req_idx] = result

            # Apply confidence scoring if available and resolved
            if self.confidence_scorer and result.is_resolved and case.parse_result.parse_request:
                # Add year to parsed request metadata for confidence scorer
                if not parsed.metadata:
                    parsed.metadata = {}
                parsed.metadata["year"] = case.parse_result.parse_request.year

                scored_confidence = self.confidence_scorer.score_resolution(
                    parsed_request=parsed,
                    resolution_result=result,
                    requester_cm_id=case.parse_result.parse_request.requester_cm_id,
                    year=case.parse_result.parse_request.year,
                )
                # Update confidence with scored value
                result.confidence = scored_confidence

            # Log resolution details
            if result.is_resolved and result.person:
                logger.debug(
                    f"Resolved '{parsed.target_name}' to {result.person.cm_id} "
                    f"with confidence {result.confidence:.2f} using {result.method}"
                )
            elif result.is_ambiguous:
                num_candidates = len(result.candidates) if result.candidates else 0
                logger.debug(f"Ambiguous resolution for '{parsed.target_name}': {num_candidates} candidates")
            else:
                logger.debug(f"Failed to resolve '{parsed.target_name}'")

    def _handle_no_resolution_cases(self, cases: list[ResolutionCase]) -> None:
        """Handle cases that don't need resolution"""
        for case in cases:
            # Initialize resolution results list
            case.resolution_results = []

            # Process each request in the case
            for parsed_request in case.parsed_requests:
                if parsed_request.request_type == RequestType.AGE_PREFERENCE:
                    # Age preferences get a special resolution result
                    # Handle both enum and string age_preference values
                    age_pref = parsed_request.age_preference
                    if age_pref is None:
                        # Still need to append a result to maintain list alignment
                        case.resolution_results.append(
                            ResolutionResult(
                                person=None,
                                confidence=0.0,
                                method="age_preference",
                                metadata={"age_preference": None, "error": "No age preference specified"},
                            )
                        )
                        continue
                    age_pref_value = age_pref.value if hasattr(age_pref, "value") else age_pref
                    case.resolution_results.append(
                        ResolutionResult(
                            person=None,
                            confidence=1.0,
                            method="age_preference",
                            metadata={"age_preference": age_pref_value},
                        )
                    )
                    self._stats["age_preferences"] += 1
                elif parsed_request.target_name == LAST_YEAR_BUNKMATES_PLACEHOLDER:
                    # This placeholder is expanded to individual requests elsewhere
                    case.resolution_results.append(
                        ResolutionResult(
                            person=None,
                            confidence=1.0,
                            method="placeholder",
                            metadata={"placeholder": LAST_YEAR_BUNKMATES_PLACEHOLDER},
                        )
                    )
                elif parsed_request.target_name == SIBLING_PLACEHOLDER:
                    # SIBLING placeholder is expanded via household_id lookup elsewhere
                    case.resolution_results.append(
                        ResolutionResult(
                            person=None,
                            confidence=1.0,
                            method="placeholder",
                            metadata={"placeholder": SIBLING_PLACEHOLDER},
                        )
                    )
                else:
                    # Shouldn't happen, but handle gracefully
                    case.resolution_results.append(ResolutionResult(confidence=0.0, method="no_resolution_needed"))

    async def _enhance_with_networkx(self, cases: list[ResolutionCase]) -> None:
        """Enhance ambiguous cases with NetworkX social graph analysis.

        to auto-resolve when social signals are strong enough. This matches
        """
        if not self.networkx_analyzer:
            return

        # Find ambiguous resolution results across all cases
        ambiguous_items = []  # List of (case, req_idx, resolution)

        for case in cases:
            if not case.resolution_results:
                continue
            for req_idx, resolution in enumerate(case.resolution_results):
                if resolution and resolution.is_ambiguous:
                    ambiguous_items.append((case, req_idx, resolution))

        if not ambiguous_items:
            return

        logger.info(f"Enhancing {len(ambiguous_items)} ambiguous resolutions with NetworkX")

        # Default smart resolution config (matches ai_config.json defaults)
        smart_config = {
            "enabled": True,
            "significant_connection_threshold": 5,
            "min_connections_for_auto_resolve": 3,
            "min_confidence_for_auto_resolve": 0.85,
            "mutual_request_bonus": 10,
            "common_friends_weight": 1.0,
            "historical_bunking_weight": 0.8,
            "connection_score_weight": 0.7,
        }

        # Enhance each ambiguous resolution
        for case, req_idx, resolution in ambiguous_items:
            if case.parse_result.parse_request is None:
                continue
            try:
                enhanced_result = await self.networkx_analyzer.enhance_resolution(
                    resolution=resolution,
                    requester_cm_id=case.parse_result.parse_request.requester_cm_id,
                    session_cm_id=case.parse_result.parse_request.session_cm_id,
                )
                self._stats["networkx_enhanced"] += 1

                # PARITY FIX: Always use ranked candidates from smart resolution so Phase 3
                # gets TOP 5 by social score, not arbitrary DB order
                if enhanced_result.is_ambiguous and enhanced_result.candidates:
                    parsed_request = case.parsed_requests[req_idx]
                    auto_result, ranked_candidates = self.networkx_analyzer.smart_resolve_candidates(
                        name=parsed_request.target_name or "",
                        candidates=enhanced_result.candidates,
                        requester_cm_id=case.parse_result.parse_request.requester_cm_id,
                        session_cm_id=case.parse_result.parse_request.session_cm_id,
                        config=smart_config,
                        mutual_request_cm_ids=set(),  # TODO: Wire up mutual request detection
                    )

                    if auto_result:
                        # Smart resolution auto-resolved
                        resolved_cm_id, confidence, method = auto_result
                        # Find the resolved person from candidates
                        resolved_person = next(
                            (c for c in enhanced_result.candidates if c.cm_id == resolved_cm_id), None
                        )
                        if resolved_person:
                            # Create resolved result
                            enhanced_result = ResolutionResult(
                                person=resolved_person,
                                confidence=confidence,
                                method=method,
                                candidates=[],  # Clear candidates - no longer ambiguous
                                metadata={
                                    **(enhanced_result.metadata or {}),
                                    "smart_resolved": True,
                                    "smart_resolution_score_diff": True,
                                },
                            )
                            self._stats["smart_resolved"] += 1
                            logger.info(
                                f"Smart resolved '{parsed_request.target_name}' to "
                                f"{resolved_person.first_name} {resolved_person.last_name} "
                                f"(cm_id={resolved_cm_id}, confidence={confidence:.2f})"
                            )
                    elif ranked_candidates:
                        # Couldn't auto-resolve, but use ranked candidates for Phase 3
                        # This ensures [:5] slice takes TOP 5 by social score
                        enhanced_result = ResolutionResult(
                            person=enhanced_result.person,
                            confidence=enhanced_result.confidence,
                            method=enhanced_result.method,
                            candidates=ranked_candidates,  # Use ranked order!
                            metadata={
                                **(enhanced_result.metadata or {}),
                                "candidates_ranked_by_social_score": True,
                            },
                        )

                case.resolution_results[req_idx] = enhanced_result
            except Exception as e:
                logger.error(f"NetworkX enhancement failed: {e}")

    def _build_results(
        self, parse_results: list[ParseResult], cases: list[ResolutionCase]
    ) -> list[tuple[ParseResult, list[ResolutionResult]]]:
        """Build final results by matching parse results with resolution results"""
        # Create a map from parse result id to resolution case
        # Use id() to create hashable keys
        case_map = {id(case.parse_result): case for case in cases}

        results = []
        for parse_result in parse_results:
            case_id = id(parse_result)
            if case_id in case_map:
                case = case_map[case_id]
                if case.resolution_results:
                    # Replace None values with fallback results to preserve list length
                    # IMPORTANT: Length must match parsed_requests for zip(..., strict=True) in
                    # _filter_post_expansion_conflicts to work correctly
                    filtered_results: list[ResolutionResult] = [
                        r if r is not None else ResolutionResult(confidence=0.0, method="resolution_incomplete")
                        for r in case.resolution_results
                    ]
                    results.append((parse_result, filtered_results))
                else:
                    # No resolution results - create empty list with one failed result per request
                    failed_results = []
                    for _ in parse_result.parsed_requests:
                        failed_results.append(ResolutionResult(confidence=0.0, method="no_resolution"))
                    results.append((parse_result, failed_results))
            else:
                # Parse result wasn't valid or wasn't processed
                failed_results = []
                for _ in parse_result.parsed_requests:
                    failed_results.append(ResolutionResult(confidence=0.0, method="invalid_parse"))
                results.append((parse_result, failed_results))

        return results

    def _update_stats(self, results: list[tuple[ParseResult, list[ResolutionResult]]]) -> None:
        """Update resolution statistics"""
        # Count total requests processed, not just parse results
        total_requests = sum(len(resolution_results) for _, resolution_results in results)
        self._stats["total_processed"] += total_requests

        for _parse_result, resolution_results in results:
            for resolution_result in resolution_results:
                if resolution_result.is_resolved:
                    if resolution_result.confidence >= 0.85:
                        self._stats["high_confidence_resolved"] += 1
                    else:
                        self._stats["low_confidence_resolved"] += 1
                elif resolution_result.is_ambiguous:
                    self._stats["ambiguous"] += 1
                elif resolution_result.method == "age_preference":
                    # Already counted
                    pass
                else:
                    self._stats["failed"] += 1
                    logger.warning(
                        f"Resolution failed: is_resolved={resolution_result.is_resolved}, "
                        f"is_ambiguous={resolution_result.is_ambiguous}, "
                        f"confidence={resolution_result.confidence}, "
                        f"method={resolution_result.method}, "
                        f"metadata={resolution_result.metadata}"
                    )

    def get_stats(self) -> dict[str, Any]:
        """Get resolution statistics"""
        return self._stats.copy()

    def reset_stats(self) -> None:
        """Reset statistics"""
        self._stats = {
            "total_processed": 0,
            "high_confidence_resolved": 0,
            "low_confidence_resolved": 0,
            "ambiguous": 0,
            "failed": 0,
            "age_preferences": 0,
            "networkx_enhanced": 0,
            "staff_filtered": 0,
            "prior_bunkmate_resolved": 0,
            "ai_candidate_resolved": 0,
            "ai_validated_resolved": 0,
            "ai_hallucinations_detected": 0,
        }

    def _has_last_year_context(self, parsed_request: ParsedRequest) -> bool:
        """Detect if a request has "last year" context keywords.

        - Check metadata.keywords_found for "last year" variants
        - Check raw_text for "last year" pattern

        Args:
            parsed_request: The parsed request to check

        Returns:
            True if "last year" context detected
        """
        # Check keywords in metadata (from AI parsing)
        keywords = parsed_request.metadata.get("keywords_found", []) if parsed_request.metadata else []
        keyword_patterns = ["from last year", "last year", "from before"]
        has_keyword_context = any(kw in str(keywords).lower() for kw in keyword_patterns)
        if has_keyword_context:
            return True

        # Check raw text (fallback if keywords not parsed)
        raw_text = getattr(parsed_request, "raw_text", "") or ""
        return "last year" in raw_text.lower()

    def _try_prior_bunkmate_resolution(
        self, target_name: str, requester_cm_id: int, session_cm_id: int, year: int
    ) -> ResolutionResult | None:
        """Try to resolve target name from prior year bunkmates.

        - Get prior year bunkmates via find_prior_year_bunkmates()
        - Check if target name matches any bunkmate (full name → 0.95, first name → 0.90)
        - Add metadata: found_in_last_years_bunk, last_year_bunk

        Args:
            target_name: Name to resolve
            requester_cm_id: Person making the request
            session_cm_id: Current session CM ID
            year: Current year

        Returns:
            ResolutionResult if found in prior bunkmates, None otherwise
        """
        if not self.attendee_repository or not self.person_repository:
            return None

        try:
            # Get prior year bunkmates
            prior_data = self.attendee_repository.find_prior_year_bunkmates(requester_cm_id, session_cm_id, year)
            if not prior_data or not prior_data.get("cm_ids"):
                return None

            bunkmate_ids = prior_data["cm_ids"]
            prior_bunk = prior_data.get("prior_bunk", "")
            normalized_target = normalize_name(target_name)

            # Check each bunkmate for name match
            for bunkmate_id in bunkmate_ids:
                person = self.person_repository.find_by_cm_id(bunkmate_id)
                if not person:
                    continue

                # Build normalized full name
                person_full = f"{person.first_name or ''} {person.last_name or ''}".strip()
                person_normalized = normalize_name(person_full)

                # Check full name match (0.95 confidence)
                if normalized_target == person_normalized:
                    logger.info(
                        f"Found exact match in last year's bunk: {target_name} -> {person_full} (ID: {bunkmate_id})"
                    )
                    return ResolutionResult(
                        person=person,
                        confidence=0.95,
                        method="prior_bunkmate_exact",
                        metadata={
                            "found_in_last_years_bunk": True,
                            "last_year_bunk": prior_bunk,
                        },
                    )

                # Check first name match for single-name targets (0.90 confidence)
                if " " not in normalized_target:  # Single name
                    person_first_normalized = normalize_name(person.first_name or "")
                    if normalized_target == person_first_normalized:
                        logger.info(
                            f"Found first name match in last year's bunk: "
                            f"{target_name} -> {person_full} (ID: {bunkmate_id})"
                        )
                        return ResolutionResult(
                            person=person,
                            confidence=0.90,
                            method="prior_bunkmate_first_name",
                            metadata={
                                "found_in_last_years_bunk": True,
                                "last_year_bunk": prior_bunk,
                            },
                        )

            return None

        except Exception as e:
            logger.debug(f"Prior bunkmate resolution failed: {e}")
            return None

    def _try_ai_candidate_resolution(
        self,
        parsed_request: ParsedRequest,
        requester_cm_id: int,
        requester_grade: str | None,
        session_cm_id: int | None = None,
        year: int | None = None,
    ) -> tuple[ResolutionResult | None, bool]:
        """Try to resolve using AI-provided candidate IDs.

        - When metadata contains 'target_person_ids' (list of candidate CM IDs from AI)
        - Score each candidate using session matching, grade proximity, and age fallback
        - Pick best match if score > 0.5
        - Return with moderate confidence (capped at 0.75)

        Scoring factors (matching monolith _score_candidate):
        - Session: +0.3 same session, -0.1 different session
        - Grade: +0.2 same grade, +0.1 for 1 apart, -0.2 for >2 apart
        - Age (fallback when grades unavailable): +0.15 for ≤1 year, -0.15 for >3 years

        Args:
            parsed_request: The parsed request with metadata
            requester_cm_id: The requester's CM ID
            requester_grade: The requester's grade (for scoring)
            session_cm_id: The requester's session CM ID (for session matching)
            year: The year being processed (for attendee lookups)

        Returns:
            Tuple of (ResolutionResult or None, whether hallucination detected)
        """
        if not self.person_repository:
            return None, False

        metadata = parsed_request.metadata or {}
        candidate_ids = metadata.get("target_person_ids")

        if not candidate_ids:
            return None, False

        logger.debug(f"Processing AI-provided candidate IDs: {candidate_ids}")

        clean_candidate_ids = []
        for candidate in candidate_ids:
            if isinstance(candidate, dict):
                # Extract CM ID from dict if AI returned person objects
                cm_id = candidate.get("campminder_id") or candidate.get("id")
                if cm_id:
                    try:
                        clean_candidate_ids.append(int(cm_id))
                    except (ValueError, TypeError):
                        logger.warning(f"Invalid candidate ID in dict: {cm_id}")
            elif isinstance(candidate, (int, str)):
                try:
                    clean_candidate_ids.append(int(candidate))
                except (ValueError, TypeError):
                    logger.warning(f"Invalid candidate ID format: {candidate}")
            else:
                logger.warning(f"Unexpected candidate format: {type(candidate)}")

        if not clean_candidate_ids:
            return None, False

        # Get requester birth date for age fallback (if needed)
        requester_birth_date = None
        if requester_cm_id:
            requester_person = self.person_repository.find_by_cm_id(requester_cm_id)
            if requester_person:
                requester_birth_date = getattr(requester_person, "birth_date", None)

        best_match = None
        best_score = 0.0

        for cm_id in clean_candidate_ids:
            person = self.person_repository.find_by_cm_id(cm_id)
            if not person:
                logger.debug(f"AI candidate {cm_id} not found in person repository")
                continue

            score = 0.5  # Base score for being in cache

            if session_cm_id is not None and self.attendee_repository and year:
                candidate_session = self.attendee_repository.get_session_for_person(cm_id, year)
                if candidate_session is not None:
                    if candidate_session == session_cm_id:
                        score += 0.3  # Same session is strong signal
                    else:
                        score -= 0.1  # Different session is negative signal

            grade_used = False
            if requester_grade is not None and person.grade is not None:
                try:
                    grade_diff = abs(int(requester_grade) - int(person.grade))
                    if grade_diff == 0:
                        score += 0.2
                    elif grade_diff == 1:
                        score += 0.1
                    elif grade_diff > 2:
                        score -= 0.2
                    grade_used = True
                except (ValueError, TypeError):
                    pass

            # Only used when grades not available
            if not grade_used:
                candidate_birth_date = getattr(person, "birth_date", None)
                if requester_birth_date and candidate_birth_date:
                    try:
                        age_diff_days = abs((requester_birth_date - candidate_birth_date).days)
                        age_diff_years = age_diff_days / 365.25
                        if age_diff_years <= 1:
                            score += 0.15
                        elif age_diff_years > 3:
                            score -= 0.15
                    except (ValueError, TypeError, AttributeError) as e:
                        logger.debug(f"Error calculating age difference: {e}")

            # Clamp score to valid range
            score = max(0.0, min(1.0, score))

            if score > best_score:
                best_score = score
                best_match = person

        if best_match and best_score > 0.5:
            confidence = min(0.75, best_score)
            logger.info(
                f"Resolved via AI candidate list: {parsed_request.target_name} -> "
                f"{best_match.first_name} {best_match.last_name} (cm_id={best_match.cm_id}, "
                f"confidence={confidence:.2f})"
            )
            return ResolutionResult(
                person=best_match,
                confidence=confidence,
                method="ai_candidate_disambiguated",
                metadata={
                    "ai_candidate_count": len(clean_candidate_ids),
                    "ai_provided_person_id": True,  # For confidence boost
                },
            ), False
        else:
            # Couldn't disambiguate - will fall through to pipeline
            logger.debug(
                f"AI candidates didn't produce good match for '{parsed_request.target_name}': "
                f"best_score={best_score:.2f}"
            )
            return None, False

    def _try_ai_id_validation(self, parsed_request: ParsedRequest) -> tuple[ResolutionResult | None, bool]:
        """Try to validate and use AI-provided single person ID.

        - When ParsedRequest has target_cm_id (AI provided an exact ID)
        - Validate the ID exists in person cache
        - Validate the name matches using _validate_name_match()
        - If validation fails, log as hallucination and fall through
        - If validation passes, return with high confidence (0.95)

        Args:
            parsed_request: The parsed request with potential target_cm_id

        Returns:
            Tuple of (ResolutionResult or None, whether hallucination detected)
        """
        if not self.person_repository:
            return None, False

        # Check for AI-provided ID
        target_cm_id = getattr(parsed_request, "target_cm_id", None)
        if not target_cm_id:
            # Also check metadata
            metadata = parsed_request.metadata or {}
            target_cm_id = metadata.get("target_person_id")

        if not target_cm_id:
            return None, False

        logger.debug(f"Validating AI-provided ID: {target_cm_id}")

        # Look up the person
        person = self.person_repository.find_by_cm_id(target_cm_id)
        if not person:
            # ID not in cache - log warning and fall through
            logger.warning(f"AI provided person ID {target_cm_id} not found in person cache")
            return None, False

        if self._validate_name_match(parsed_request.target_name, person):
            # AI found the person and name matches - high confidence
            logger.debug(f"Validated AI-provided person ID {target_cm_id} for {parsed_request.target_name}")
            return ResolutionResult(
                person=person,
                confidence=0.95,
                method="ai_id_validated",
                metadata={
                    "ai_provided_person_id": True,  # For confidence boost
                },
            ), False
        else:
            # Check if AI claimed exact match but name doesn't match (hallucination)
            metadata = parsed_request.metadata or {}
            match_certainty = metadata.get("match_certainty", "none")

            # Check if there's ANY name overlap (first name, last name, or partial)
            target_normalized = normalize_name(parsed_request.target_name or "")
            person_name = f"{person.first_name or ''} {person.last_name or ''}".strip()
            person_normalized = normalize_name(person_name)
            person_first = normalize_name(person.first_name or "")
            person_last = normalize_name(person.last_name or "")

            # Check for any overlap - partial match might still be valid
            has_any_overlap = (
                target_normalized in (person_normalized, person_first, person_last)
                or person_first in target_normalized
                or person_last in target_normalized
            )

            if target_normalized == person_normalized:
                # Normalized names match - accept with high confidence
                logger.info(
                    f"AI match validated after normalization: "
                    f"'{parsed_request.target_name}' == '{person_name}' "
                    f"(ID: {target_cm_id})"
                )
                return ResolutionResult(
                    person=person,
                    confidence=0.95,
                    method="ai_id_validated_normalized",
                    metadata={"ai_provided_person_id": True},
                ), False
            elif has_any_overlap and match_certainty == "exact":
                # Some name overlap - might be nickname or partial match
                logger.warning(
                    f"AI validation partial mismatch: '{parsed_request.target_name}' "
                    f"mapped to {person_name} (ID: {target_cm_id}) - proceeding with caution"
                )
                return ResolutionResult(
                    person=person,
                    confidence=0.75,
                    method="ai_id_partial_match",
                    metadata={"ai_provided_person_id": True},
                ), False
            else:
                # Complete mismatch - AI hallucination
                logger.error(
                    f"AI hallucination detected: '{parsed_request.target_name}' "
                    f"mapped to {person_name} (ID: {target_cm_id})"
                )
                # Return None to fall through to regular resolution
                return None, True  # hallucination_detected = True

    def _validate_name_match(self, target_name: str | None, person: Person) -> bool:
        """Validate that a target name matches a person using intelligent matching.

        This handles various name formats including:
        - Names with middle names/initials
        - Hyphenated names
        - Nicknames
        - Partial matches where appropriate

        Args:
            target_name: The name to validate
            person: The Person object to validate against

        Returns:
            True if names match, False otherwise
        """
        if not target_name or not person:
            return False

        target_normalized = normalize_name(target_name)
        if not target_normalized:
            return False

        # Build person's full name
        person_first = (person.first_name or "").strip()
        person_last = (person.last_name or "").strip()
        preferred_name = getattr(person, "preferred_name", None) or ""
        preferred_name = preferred_name.strip()

        if not person_first:
            return False

        # Build normalized full names
        person_full = f"{person_first} {person_last}".strip()
        person_full_lower = person_full.lower()
        target_lower = target_normalized.lower()

        # Also create preferred name variant if available
        preferred_full_lower = f"{preferred_name} {person_last}".strip().lower() if preferred_name else ""

        # Strategy 1: Exact full match (including preferred name variant)
        if person_full_lower == target_lower:
            return True

        if preferred_full_lower and preferred_full_lower == target_lower:
            return True

        # Strategy 2: All target tokens exist in DB name (order-independent)
        target_tokens = set(target_lower.split())
        db_tokens = set(person_full_lower.split())
        if target_tokens.issubset(db_tokens):
            return True

        # Also check against preferred name tokens
        if preferred_full_lower:
            db_preferred_tokens = set(preferred_full_lower.split())
            if target_tokens.issubset(db_preferred_tokens):
                return True

        # Get normalized parts for more complex matching
        target_parts = target_lower.split()
        first_name_lower = person_first.lower()
        last_name_lower = person_last.lower()

        # Strategy 3: Handle names with middle names/initials
        if len(target_parts) >= 2:
            target_last = target_parts[-1]

            # If last names match, be more flexible with first/middle names
            if target_last == last_name_lower:
                # Check if all non-last-name parts appear in the first name
                first_middle_parts = target_parts[:-1]
                first_middle_combined = " ".join(first_middle_parts)

                # Check if the combined first/middle from target matches start of DB first name
                if first_name_lower.startswith(first_middle_combined):
                    return True

                # Check if DB first name is a prefix of target first/middle
                if first_middle_combined.startswith(first_name_lower):
                    return True

                # Check with nicknames for the first name part
                if names_match_via_nicknames(
                    first_middle_parts[0], first_name_lower.split()[0] if first_name_lower else ""
                ):
                    return True

                # Check if preferred name matches when last name matches
                if preferred_name:
                    preferred_lower = preferred_name.lower()
                    # Check if target first/middle matches preferred name
                    if first_middle_combined == preferred_lower:
                        return True
                    # Check if preferred name is part of the target
                    if preferred_lower in first_middle_combined or first_middle_combined in preferred_lower:
                        return True
                    # Check with nicknames
                    if names_match_via_nicknames(
                        first_middle_parts[0], preferred_lower.split()[0] if preferred_lower else ""
                    ):
                        return True

        # Strategy 4: Single name matching (first name only)
        if len(target_parts) == 1:
            target_single = target_parts[0]

            # Check first name only (already done above for exact, but nickname check)
            person_first_lower = person_first.lower()
            if target_single == person_first_lower:
                return True

            # Check last name only (already done above for exact)
            if target_single == last_name_lower:
                return True

            # Check against first name with nicknames
            first_name_first_part = first_name_lower.split()[0] if first_name_lower else ""
            if names_match_via_nicknames(target_single, first_name_first_part):
                return True

            # Check against preferred name with nicknames
            if preferred_name:
                preferred_lower = preferred_name.lower()
                preferred_first_part = preferred_lower.split()[0] if preferred_lower else ""
                if names_match_via_nicknames(target_single, preferred_first_part):
                    return True
                # Also check exact preferred name match
                if target_single == preferred_lower:
                    return True

        return False

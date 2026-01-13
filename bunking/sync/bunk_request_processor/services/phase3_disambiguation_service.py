"""Phase 3 Disambiguation Service - Handles AI-assisted disambiguation with minimal context"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

from ..confidence.confidence_scorer import ConfidenceScorer
from ..core.models import ParsedRequest, ParseResult
from ..integration.ai_service import AIProvider
from ..integration.batch_processor import BatchProcessor
from ..resolution.interfaces import ResolutionResult
from .context_builder import ContextBuilder

logger = logging.getLogger(__name__)


class DisambiguationCase:
    """Container for ambiguous cases that need AI disambiguation"""

    def __init__(self, parse_result: ParseResult, resolution_results: list[ResolutionResult]):
        self.parse_result = parse_result
        self.resolution_results = resolution_results  # List of resolutions, some may be ambiguous
        self.ambiguous_indices: list[int] = []  # Indices of ambiguous resolutions
        self.disambiguated_results: list[ResolutionResult | None] = [None] * len(resolution_results)
        self.disambiguation_metadata: dict[str, Any] = {}

        # Identify which resolutions are ambiguous
        for idx, rr in enumerate(resolution_results):
            if rr.is_ambiguous and rr.candidates:
                self.ambiguous_indices.append(idx)

    @property
    def has_ambiguous(self) -> bool:
        """Whether this case has any ambiguous resolutions"""
        return len(self.ambiguous_indices) > 0


class Phase3DisambiguationService:
    """Handles Phase 3: AI-assisted disambiguation with minimal context"""

    def __init__(
        self,
        ai_provider: AIProvider,
        context_builder: ContextBuilder,
        batch_processor: BatchProcessor | None = None,
        confidence_scorer: ConfidenceScorer | None = None,
        spread_filter: Any | None = None,
        cache_manager: Any | None = None,
    ):
        """Initialize the Phase 3 disambiguation service.

        Args:
            ai_provider: AI provider for disambiguation
            context_builder: Context builder for creating minimal contexts
            batch_processor: Optional batch processor for sophisticated batching
            confidence_scorer: Optional confidence scorer for result scoring
            spread_filter: Optional spread filter for age/grade validation
            cache_manager: Optional cache manager for caching disambiguation results
        """
        self.ai_provider = ai_provider
        self.context_builder = context_builder
        self.confidence_scorer = confidence_scorer
        self.spread_filter = spread_filter
        self.cache_manager = cache_manager

        # Create batch processor if not provided
        if batch_processor is None:
            self.batch_processor = BatchProcessor(ai_provider)
        else:
            self.batch_processor = batch_processor

        self._stats = {
            "total_processed": 0,
            "successfully_disambiguated": 0,
            "still_ambiguous": 0,
            "failed": 0,
            "no_match": 0,
        }

    async def batch_disambiguate(
        self,
        ambiguous_cases: list[tuple[ParseResult, list[ResolutionResult]]],
        progress_callback: Callable[..., None] | None = None,
    ) -> list[tuple[ParseResult, list[ResolutionResult]]]:
        """Disambiguate ambiguous cases using AI with minimal context.

        This is Phase 3 of the three-phase approach. We send ambiguous
        names together (if from same field) with top 5 candidates each
        to the AI for final disambiguation.

        Args:
            ambiguous_cases: List of (ParseResult, List[ResolutionResult]) tuples
                           where some ResolutionResults may be ambiguous
            progress_callback: Optional callback for progress updates

        Returns:
            List of (ParseResult, List[ResolutionResult]) with disambiguation applied
        """
        if not ambiguous_cases:
            return []

        # Create disambiguation cases and filter to those with ambiguous resolutions
        cases = []
        for pr, resolution_list in ambiguous_cases:
            case = DisambiguationCase(pr, resolution_list)
            if case.has_ambiguous:
                cases.append(case)

        if not cases:
            logger.info("Phase 3: No ambiguous cases to disambiguate")
            return ambiguous_cases

        # Count total ambiguous resolutions across all cases
        total_ambiguous = sum(len(case.ambiguous_indices) for case in cases)
        logger.info(
            f"Phase 3: Starting disambiguation for {len(cases)} cases with {total_ambiguous} ambiguous resolutions"
        )

        # Build individual disambiguation requests
        disambiguation_requests, case_mapping = self._prepare_individual_disambiguation_requests(cases)

        if not disambiguation_requests:
            logger.info("Phase 3: No disambiguation requests to process")
            return ambiguous_cases

        # Use batch processor for AI disambiguation
        try:
            disambiguated_results = await self.batch_processor.batch_disambiguate(
                disambiguation_requests=disambiguation_requests, progress_callback=progress_callback
            )

            # Process results back to cases
            self._process_individual_disambiguation_results(cases, disambiguated_results, case_mapping)

        except Exception as e:
            logger.error(f"Phase 3 disambiguation failed: {e}")
            # Mark all as failed
            for case in cases:
                case.disambiguation_metadata["error"] = str(e)

        # Build final results
        results = self._build_final_results(ambiguous_cases, cases)

        # Update statistics
        self._update_stats(cases)

        logger.info(
            f"Phase 3 complete: "
            f"{self._stats['successfully_disambiguated']} disambiguated, "
            f"{self._stats['still_ambiguous']} still ambiguous, "
            f"{self._stats['no_match']} no match, "
            f"{self._stats['failed']} failed"
        )

        return results

    def _prepare_individual_disambiguation_requests(
        self, cases: list[DisambiguationCase]
    ) -> tuple[list[tuple[ParsedRequest, dict[str, Any]]], dict[int, tuple[DisambiguationCase, int]]]:
        """Prepare individual disambiguation requests for each ambiguous name"""
        requests = []
        case_mapping = {}  # Maps request index to (case, ambiguous_index)
        request_idx = 0

        for case in cases:
            # Skip if no parse_request
            if case.parse_result.parse_request is None:
                continue

            for ambiguous_idx in case.ambiguous_indices:
                parsed_req = case.parse_result.parsed_requests[ambiguous_idx]
                resolution = case.resolution_results[ambiguous_idx]

                if not parsed_req.target_name or not resolution.candidates:
                    continue

                # Build disambiguation context for this specific name
                context = self.context_builder.build_disambiguation_context(
                    target_name=parsed_req.target_name,
                    candidates=resolution.candidates[:5],  # Top 5 candidates
                    requester_name=case.parse_result.parse_request.requester_name,
                    requester_cm_id=case.parse_result.parse_request.requester_cm_id,
                    requester_school=case.parse_result.parse_request.row_data.get("school")
                    if case.parse_result.parse_request.row_data
                    else None,
                    session_cm_id=case.parse_result.parse_request.session_cm_id,
                    session_name=case.parse_result.parse_request.session_name,
                    year=case.parse_result.parse_request.year,
                    ambiguity_reason=resolution.metadata.get("ambiguity_reason", "multiple_matches")
                    if resolution.metadata
                    else "multiple_matches",
                    local_confidence=resolution.confidence,
                )

                # Add field context if multiple names from same field
                if len(case.parse_result.parsed_requests) > 1:
                    other_names = [
                        req.target_name
                        for i, req in enumerate(case.parse_result.parsed_requests)
                        if i != ambiguous_idx and req.target_name
                    ]
                    if other_names:
                        context.additional_context["field_context"] = (
                            f"Requested together with: {', '.join(other_names)}"
                        )

                # Add social signals if available
                if hasattr(resolution, "metadata") and resolution.metadata:
                    if "networkx_enhanced" in resolution.metadata:
                        context.additional_context["social_signals_available"] = True

                # Convert AIRequestContext to dict for batch processor
                context_dict = {
                    "requester_name": context.requester_name,
                    "requester_cm_id": context.requester_cm_id,
                    "session_cm_id": context.session_cm_id,
                    "year": context.year,
                    **context.additional_context,  # Includes candidates, target_name, etc.
                }

                requests.append((parsed_req, context_dict))
                case_mapping[request_idx] = (case, ambiguous_idx)
                request_idx += 1

        return requests, case_mapping

    def _process_individual_disambiguation_results(
        self,
        cases: list[DisambiguationCase],
        results: list[Any],
        case_mapping: dict[int, tuple[DisambiguationCase, int]],
    ) -> None:
        """Process individual AI disambiguation results back to cases"""
        for idx, result in enumerate(results):
            if idx not in case_mapping:
                continue

            case, ambiguous_idx = case_mapping[idx]

            if not result:
                if "errors" not in case.disambiguation_metadata:
                    case.disambiguation_metadata["errors"] = {}
                case.disambiguation_metadata["errors"][ambiguous_idx] = "No result from AI"
                continue

            try:
                parsed_req = case.parse_result.parsed_requests[ambiguous_idx]
                resolution = case.resolution_results[ambiguous_idx]

                if hasattr(result, "person_cm_id") and result.person_cm_id:
                    # AI selected a specific person
                    selected_person = None
                    if resolution.candidates:
                        for candidate in resolution.candidates[:5]:  # Top 5 only
                            if candidate.cm_id == result.person_cm_id:
                                selected_person = candidate
                                break

                    if selected_person:
                        # Create disambiguated result
                        confidence = getattr(result, "confidence", 0.8)

                        # Apply confidence scoring if available
                        if self.confidence_scorer and parsed_req and case.parse_result.parse_request:
                            # Create a temporary result for scoring
                            temp_result = ResolutionResult(
                                person=selected_person,
                                confidence=confidence,
                                method="ai_disambiguation",
                                candidates=resolution.candidates[:5] if resolution.candidates else None,
                            )
                            confidence = self.confidence_scorer.score_resolution(
                                parsed_request=parsed_req,
                                resolution_result=temp_result,
                                requester_cm_id=case.parse_result.parse_request.requester_cm_id,
                                year=case.parse_result.parse_request.year,
                            )

                        num_candidates = len(resolution.candidates) if resolution.candidates else 0
                        case.disambiguated_results[ambiguous_idx] = ResolutionResult(
                            person=selected_person,
                            confidence=confidence,
                            method="ai_disambiguation",
                            metadata={
                                "ai_confidence": getattr(result, "confidence", confidence),
                                "disambiguation_reason": getattr(result, "reason", "AI selected"),
                                "original_method": resolution.method,
                                "candidates_considered": num_candidates,
                            },
                        )
                        if "status" not in case.disambiguation_metadata:
                            case.disambiguation_metadata["status"] = {}
                        case.disambiguation_metadata["status"][ambiguous_idx] = "success"
                    else:
                        # AI selected unknown person
                        if "status" not in case.disambiguation_metadata:
                            case.disambiguation_metadata["status"] = {}
                        case.disambiguation_metadata["status"][ambiguous_idx] = "no_match"
                        if "selected_ids" not in case.disambiguation_metadata:
                            case.disambiguation_metadata["selected_ids"] = {}
                        case.disambiguation_metadata["selected_ids"][ambiguous_idx] = result.person_cm_id

                elif hasattr(result, "no_match") and result.no_match:
                    # AI explicitly said no match
                    if "status" not in case.disambiguation_metadata:
                        case.disambiguation_metadata["status"] = {}
                    case.disambiguation_metadata["status"][ambiguous_idx] = "no_match"
                    if "reasons" not in case.disambiguation_metadata:
                        case.disambiguation_metadata["reasons"] = {}
                    case.disambiguation_metadata["reasons"][ambiguous_idx] = getattr(
                        result, "reason", "No suitable match"
                    )

                else:
                    # Still ambiguous
                    if "status" not in case.disambiguation_metadata:
                        case.disambiguation_metadata["status"] = {}
                    case.disambiguation_metadata["status"][ambiguous_idx] = "still_ambiguous"
                    if "reasons" not in case.disambiguation_metadata:
                        case.disambiguation_metadata["reasons"] = {}
                    case.disambiguation_metadata["reasons"][ambiguous_idx] = getattr(
                        result, "reason", "Could not disambiguate"
                    )

            except Exception as e:
                req_info = (
                    f"requester_cm_id={case.parse_result.parse_request.requester_cm_id}"
                    if case.parse_result.parse_request
                    else "unknown"
                )
                logger.error(
                    f"Error processing disambiguation result for case {req_info}, ambiguous_idx {ambiguous_idx}: {e}"
                )
                if "errors" not in case.disambiguation_metadata:
                    case.disambiguation_metadata["errors"] = {}
                case.disambiguation_metadata["errors"][ambiguous_idx] = str(e)

    def _build_final_results(
        self,
        original_cases: list[tuple[ParseResult, list[ResolutionResult]]],
        disambiguation_cases: list[DisambiguationCase],
    ) -> list[tuple[ParseResult, list[ResolutionResult]]]:
        """Build final results combining original and disambiguated cases"""
        # Create a map from parse result to disambiguation case
        disambig_map = {id(case.parse_result): case for case in disambiguation_cases}

        results = []
        for parse_result, resolution_list in original_cases:
            case_id = id(parse_result)
            if case_id in disambig_map:
                # This was disambiguated
                case = disambig_map[case_id]
                # Build new resolution list with disambiguated results
                final_resolutions: list[ResolutionResult] = []
                for idx, original_resolution in enumerate(resolution_list):
                    if idx < len(case.disambiguated_results):
                        disambig_result = case.disambiguated_results[idx]
                    else:
                        disambig_result = None
                    if idx in case.ambiguous_indices and disambig_result is not None:
                        # Use the disambiguated result
                        final_resolutions.append(disambig_result)
                    else:
                        # Keep original (either not ambiguous or disambiguation failed)
                        # But add disambiguation metadata if it was attempted
                        if idx in case.ambiguous_indices:
                            original_resolution.metadata = original_resolution.metadata or {}
                            original_resolution.metadata["disambiguation_attempted"] = True

                            # Get per-index status
                            statuses = case.disambiguation_metadata.get("status", {})
                            if idx in statuses:
                                original_resolution.metadata["disambiguation_status"] = statuses[idx]
                            else:
                                original_resolution.metadata["disambiguation_status"] = "failed"

                            # Get per-index error if any
                            errors = case.disambiguation_metadata.get("errors", {})
                            if idx in errors:
                                original_resolution.metadata["disambiguation_error"] = errors[idx]
                        final_resolutions.append(original_resolution)
                results.append((parse_result, final_resolutions))
            else:
                # Not disambiguated, keep as is
                results.append((parse_result, resolution_list))

        return results

    def _update_stats(self, cases: list[DisambiguationCase]) -> None:
        """Update disambiguation statistics"""
        # Count total ambiguous resolutions processed, not just cases
        total_ambiguous = sum(len(case.ambiguous_indices) for case in cases)
        self._stats["total_processed"] += total_ambiguous

        for case in cases:
            # Count successful disambiguations per resolution
            for idx in case.ambiguous_indices:
                if idx < len(case.disambiguated_results):
                    result = case.disambiguated_results[idx]
                else:
                    result = None
                if result is not None:
                    if result.is_resolved:
                        self._stats["successfully_disambiguated"] += 1
                    elif result.metadata and result.metadata.get("no_match"):
                        self._stats["no_match"] += 1
                    else:
                        self._stats["still_ambiguous"] += 1
                else:
                    self._stats["failed"] += 1

    def get_stats(self) -> dict[str, Any]:
        """Get disambiguation statistics"""
        return self._stats.copy()

    def reset_stats(self) -> None:
        """Reset statistics"""
        self._stats = {
            "total_processed": 0,
            "successfully_disambiguated": 0,
            "still_ambiguous": 0,
            "failed": 0,
            "no_match": 0,
        }

"""Phase 3 Disambiguation Service - Handles AI-assisted disambiguation with minimal context"""

from collections.abc import Callable
from typing import Any

from bunking.logging_config import get_logger

from ..core.models import ParsedRequest, ParseResult, RequestType
from ..integration.ai_service import AIProvider, AIRequestContext
from ..integration.ai_types import ParsedResponse
from ..integration.batch_processor import BatchProcessor
from ..resolution.interfaces import ResolutionResult
from .context_builder import ContextBuilder
from .disambiguation_reranker import rerank_disambiguation_candidates

logger = get_logger(__name__)


class DisambiguationCase:
    """Container for ambiguous cases that need AI disambiguation"""

    def __init__(self, parse_result: ParseResult, resolution_results: list[ResolutionResult]):
        self.parse_result = parse_result
        self.resolution_results = resolution_results  # List of resolutions, some may be ambiguous
        self.disambiguation_indices: list[int] = []  # Indices of ambiguous resolutions
        self.disambiguated_results: list[ResolutionResult | None] = [None] * len(resolution_results)
        self.disambiguation_metadata: dict[str, Any] = {}

        # Identify which resolutions need disambiguation:
        # any unresolved result with at least one candidate (includes single-candidate cases)
        for idx, rr in enumerate(resolution_results):
            if not rr.is_resolved and rr.candidates:
                self.disambiguation_indices.append(idx)

    @property
    def has_disambiguation_candidates(self) -> bool:
        """Whether this case has any ambiguous resolutions"""
        return len(self.disambiguation_indices) > 0


class Phase3DisambiguationService:
    """Handles Phase 3: AI-assisted disambiguation with minimal context"""

    def __init__(
        self,
        ai_provider: AIProvider,
        context_builder: ContextBuilder,
        batch_processor: BatchProcessor | None = None,
        spread_filter: Any | None = None,
        cache_manager: Any | None = None,
    ):
        """Initialize the Phase 3 disambiguation service.

        Args:
            ai_provider: AI provider for disambiguation
            context_builder: Context builder for creating minimal contexts
            batch_processor: Optional batch processor for sophisticated batching
            spread_filter: Optional spread filter for age/grade validation
            cache_manager: Optional cache manager for caching disambiguation results
        """
        self.ai_provider = ai_provider
        self.context_builder = context_builder
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
            "invalid_ai_output": 0,
        }

    async def batch_disambiguate(
        self,
        ambiguous_cases: list[tuple[ParseResult, list[ResolutionResult]]],
        progress_callback: Callable[..., None] | None = None,
    ) -> list[tuple[ParseResult, list[ResolutionResult]]]:
        """Disambiguate ambiguous cases using AI with minimal context.

        This is Phase 3 of the three-phase approach. We send ambiguous
        names together (if from same field) with top 10 candidates each
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
            if case.has_disambiguation_candidates:
                cases.append(case)

        if not cases:
            logger.info("Phase 3: No ambiguous cases to disambiguate")
            # Still count every incoming intent — the orchestrator trace has
            # ran=True for these (no-candidate ParseResults).
            self._update_stats(ambiguous_cases, cases)
            return ambiguous_cases

        # Count total ambiguous resolutions across all cases
        total_ambiguous = sum(len(case.disambiguation_indices) for case in cases)
        logger.info(
            f"Phase 3: Starting disambiguation for {len(cases)} cases with {total_ambiguous} ambiguous resolutions"
        )

        # Build individual disambiguation requests
        disambiguation_requests, case_mapping = self._prepare_individual_disambiguation_requests(cases)

        if not disambiguation_requests:
            logger.info("Phase 3: No disambiguation requests to process")
            self._update_stats(ambiguous_cases, cases)
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
            for case in cases:
                errors = self._set_meta(case, "errors", dict[int, str]())
                for idx in case.disambiguation_indices:
                    errors[idx] = str(e)

        # Build final results
        # Ordering invariant: _build_final_results MUST run before _update_stats.
        # _build_final_results writes metadata["disambiguation_status"] = "failed"
        # on exception-path intents that have no per-index status; _update_stats
        # then reads that status. Swapping these would misclassify exception-path
        # intents from "failed" to "still_ambiguous".
        results = self._build_final_results(ambiguous_cases, cases)

        # Update statistics
        self._update_stats(ambiguous_cases, cases)

        logger.info(
            f"Phase 3 complete: "
            f"{self._stats['successfully_disambiguated']} disambiguated, "
            f"{self._stats['still_ambiguous']} still ambiguous, "
            f"{self._stats['no_match']} no match, "
            f"{self._stats['invalid_ai_output']} invalid AI output, "
            f"{self._stats['failed']} failed"
        )

        return results

    def _set_meta[T](self, case: DisambiguationCase, key: str, default: T) -> T:
        """Return case.disambiguation_metadata[key], inserting *default* if absent."""
        value: T = case.disambiguation_metadata.setdefault(key, default)
        return value

    def _prepare_individual_disambiguation_requests(
        self, cases: list[DisambiguationCase]
    ) -> tuple[list[tuple[ParsedRequest, AIRequestContext]], dict[int, tuple[DisambiguationCase, int]]]:
        """Prepare individual disambiguation requests for each ambiguous name"""
        requests = []
        case_mapping = {}  # Maps request index to (case, ambiguous_index)
        request_idx = 0

        for case in cases:
            # Skip if no parse_request
            if case.parse_result.parse_request is None:
                continue

            for ambiguous_idx in case.disambiguation_indices:
                parsed_req = case.parse_result.parsed_requests[ambiguous_idx]
                resolution = case.resolution_results[ambiguous_idx]

                if not parsed_req.target_name or not resolution.candidates:
                    continue

                # Build disambiguation context for this specific name
                context = self.context_builder.build_disambiguation_context(
                    target_name=parsed_req.target_name,
                    candidates=resolution.candidates[:10],  # Top 10 candidates
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

                requests.append((parsed_req, context))
                case_mapping[request_idx] = (case, ambiguous_idx)
                request_idx += 1

        return requests, case_mapping

    def _process_individual_disambiguation_results(
        self,
        cases: list[DisambiguationCase],
        results: list[Any],
        case_mapping: dict[int, tuple[DisambiguationCase, int]],
    ) -> None:
        """Process individual AI disambiguation results back to cases.

        Orchestrates per-result handling. Each iteration:
          1. Validates non-empty result (else records "No result from AI")
          2. Tries the JW re-ranker path for ParsedResponse metadata signals
             (ranked_selections or no_match); short-circuits if handled
          3. Otherwise records invalid_ai_output status
        """
        for idx, result in enumerate(results):
            if idx not in case_mapping:
                continue

            case, ambiguous_idx = case_mapping[idx]

            if not result:
                self._set_meta(case, "errors", dict[int, str]())[ambiguous_idx] = "No result from AI"
                continue

            try:
                resolution = case.resolution_results[ambiguous_idx]

                if self._try_reranker_path(case, ambiguous_idx, resolution, result):
                    continue

                # AI returned no ranked_selections and no no_match signal — unparseable output.
                self._record_invalid_ai_output(case, ambiguous_idx, resolution, result)

            except Exception as e:
                req_info = (
                    f"requester_cm_id={case.parse_result.parse_request.requester_cm_id}"
                    if case.parse_result.parse_request
                    else "unknown"
                )
                logger.error(
                    f"Error processing disambiguation result for case {req_info}, ambiguous_idx {ambiguous_idx}: {e}"
                )
                self._set_meta(case, "errors", dict[int, str]())[ambiguous_idx] = str(e)

    def _try_reranker_path(
        self,
        case: DisambiguationCase,
        ambiguous_idx: int,
        resolution: ResolutionResult,
        result: Any,
    ) -> bool:
        """Handle ParsedResponse metadata signals (ranked_selections / no_match).

        Returns True iff the result was fully handled (success or no_match recorded)
        and the caller should skip the invalid_ai_output fallback.
        """
        if not isinstance(result, ParsedResponse) or not result.requests:
            return False

        req_metadata = result.requests[0].metadata or {}
        ranked_selections = req_metadata.get("ranked_selections")

        if ranked_selections:
            ai_no_match = req_metadata.get("no_match", False)
            ai_ranked = [
                (sel["person_id"], sel["confidence"])
                for sel in ranked_selections
                if "person_id" in sel and "confidence" in sel
            ]
            reranked = rerank_disambiguation_candidates(
                ai_ranked=ai_ranked,
                target_name=resolution.target_name or "",
                candidate_persons=resolution.candidates[:10] if resolution.candidates else [],
                ai_no_match=ai_no_match,
            )
            if reranked:
                num_candidates = len(resolution.candidates or [])
                result_metadata: dict[str, Any] = {
                    "ai_confidence": reranked.ai_confidence,
                    "disambiguation_reason": reranked.reasoning,
                    "original_method": resolution.method,
                    "candidates_considered": num_candidates,
                    "reranked": True,
                    "jw_score": reranked.jw_score,
                    "ranked_selections": ranked_selections,
                }
                case.disambiguated_results[ambiguous_idx] = ResolutionResult(
                    person=reranked.person,
                    confidence=reranked.confidence,
                    method="ai_disambiguation",
                    candidates=(resolution.candidates or [])[:10],
                    metadata=result_metadata,
                )
                self._set_meta(case, "status", dict[int, str]())[ambiguous_idx] = "success"
                logger.debug(
                    f"Phase 3 re-ranked '{resolution.target_name}' → "
                    f"{reranked.person.first_name} {reranked.person.last_name} "
                    f"(cm_id={reranked.person.cm_id}, confidence={reranked.confidence:.2f}, "
                    f"jw={reranked.jw_score})"
                )
                return True

            # Re-ranker rejected all candidates
            self._set_meta(case, "status", dict[int, str]())[ambiguous_idx] = "no_match"
            self._set_meta(case, "reasons", dict[int, str]())[ambiguous_idx] = "JW re-ranker rejected all candidates"
            logger.debug(f"Phase 3 re-ranker rejected all candidates for '{resolution.target_name}'")
            return True

        if req_metadata.get("no_match", False):
            # AI explicitly said no candidate matches — propagate from metadata
            self._set_meta(case, "status", dict[int, str]())[ambiguous_idx] = "no_match"
            self._set_meta(case, "reasons", dict[int, str]())[ambiguous_idx] = (
                req_metadata.get("no_match_reason") or "AI determined no candidate matches"
            )
            logger.debug(f"Phase 3 AI no_match for '{resolution.target_name}'")
            return True

        return False

    def _record_invalid_ai_output(
        self,
        case: DisambiguationCase,
        ambiguous_idx: int,
        resolution: ResolutionResult,
        result: Any,
    ) -> None:
        """Record invalid_ai_output status when AI returns no actionable signal.

        Reached when `_try_reranker_path` returned False — i.e. the AI produced
        neither `ranked_selections` nor `no_match`. Treat as unparseable output.
        """
        self._set_meta(case, "status", dict[int, str]())[ambiguous_idx] = "invalid_ai_output"
        self._set_meta(case, "reasons", dict[int, str]())[ambiguous_idx] = "No suitable match"
        logger.debug(
            f"Phase 3 invalid AI output for '{resolution.target_name}' — "
            f"AI returned no ranked_selections or no_match (result type: {type(result).__name__})"
        )

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
                    if idx in case.disambiguation_indices and disambig_result is not None:
                        # Use the disambiguated result
                        final_resolutions.append(disambig_result)
                    else:
                        # Keep original (either not ambiguous or disambiguation failed)
                        # But add disambiguation metadata if it was attempted
                        if idx in case.disambiguation_indices:
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

    def _update_stats(
        self,
        ambiguous_cases: list[tuple[ParseResult, list[ResolutionResult]]],
        cases: list[DisambiguationCase],
    ) -> None:
        """Update disambiguation statistics.

        Mirrors ``debug_pipeline_traces.phase3_disambiguation[].result`` so the
        ``Phase 3 complete`` log line matches the trace (issue #942).

        The orchestrator records a Phase 3 trace row per intent with ``ran=True``
        for every intent in a ParseResult that had any unresolved intent — this
        includes Phase-2-resolved intents that rode along on the ParseResult
        **and** ParseResults whose unresolved intents have zero candidates
        (which the service skips from ``cases`` but the trace still records).
        Stats therefore count **every** intent across every ``ambiguous_cases``
        entry, even ones we filtered out of ``cases``.

        Per-intent outcome mirrors the trace's ``result`` field:
          - ``rr.is_resolved``                          -> ``successfully_disambiguated``
          - ``disambiguation_status == "no_match"``     -> ``no_match``
          - ``disambiguation_status == "invalid_ai_output"`` -> ``invalid_ai_output``
          - ``disambiguation_status == "failed"``       -> ``failed``
          - anything else                                -> ``still_ambiguous``

        No-candidate intents (unresolved, method != AGE_PREFERENCE, no candidates)
        are classified as ``no_match`` — there was nothing to match against.
        """
        # total_processed == count of trace rows with ran=True (every intent in
        # every ParseResult that entered Phase 3, including no-candidate ones
        # that were filtered out of `cases`).
        total_ran = sum(len(resolution_list) for _pr, resolution_list in ambiguous_cases)
        self._stats["total_processed"] += total_ran

        # Index cases by the id() of the ParseResult so we can match a case back
        # to its original ambiguous_cases entry. ParseResult is a @dataclass so
        # identity comparison is stable here (the service holds the same
        # objects end-to-end).
        case_by_parse_result_id = {id(case.parse_result): case for case in cases}

        for parse_result, resolution_list in ambiguous_cases:
            case = case_by_parse_result_id.get(id(parse_result))
            if case is None:
                # No-candidate ParseResult: DisambiguationCase filtered every
                # unresolved intent out of disambiguation_indices (truthy
                # candidates check). Classify per intent: resolved (Phase 2
                # win) stays successfully_disambiguated; unresolved with no
                # candidates is no_match; anything else (should be rare —
                # e.g. age_preference) is still_ambiguous.
                for rr in resolution_list:
                    if rr.is_resolved:
                        self._stats["successfully_disambiguated"] += 1
                    elif not rr.candidates and rr.method != RequestType.AGE_PREFERENCE.value:
                        self._stats["no_match"] += 1
                    else:
                        self._stats["still_ambiguous"] += 1
                continue

            self._classify_case(case)

    def _classify_case(self, case: DisambiguationCase) -> None:
        """Classify every intent in a DisambiguationCase into the stats buckets."""
        statuses = case.disambiguation_metadata.get("status", {})
        for idx, original_rr in enumerate(case.resolution_results):
            # Prefer the disambiguated result when Phase 3 produced one; fall
            # back to the original resolution (Phase 2 win or not-needed slot).
            disambig_rr = case.disambiguated_results[idx] if idx < len(case.disambiguated_results) else None
            final_rr = disambig_rr if disambig_rr is not None else original_rr

            if final_rr is not None and final_rr.is_resolved:
                self._stats["successfully_disambiguated"] += 1
                continue

            # Not resolved. Classify by disambiguation_status, mirroring the
            # trace's fallback: rr_meta.get("disambiguation_status", "still_ambiguous").
            status = statuses.get(idx, "")
            if not status and final_rr is not None and final_rr.metadata:
                status = final_rr.metadata.get("disambiguation_status", "")

            if status == "no_match":
                self._stats["no_match"] += 1
            elif status == "invalid_ai_output":
                self._stats["invalid_ai_output"] += 1
            elif status == "failed":
                self._stats["failed"] += 1
            else:
                self._stats["still_ambiguous"] += 1

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
            "invalid_ai_output": 0,
        }

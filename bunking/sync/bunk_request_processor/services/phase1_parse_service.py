"""Phase 1 Parse Service - Handles batch AI parsing without ID resolution"""

import asyncio
from collections.abc import Callable
from dataclasses import replace
from typing import Any

from bunking.logging_config import get_logger

from ..core.models import ParseRequest, ParseResult
from ..integration.ai_service import AIProvider, AIRequestContext
from ..integration.batch_processor import MAX_PHASE_RETRY_ROUNDS, PHASE_RETRY_DELAYS_SECONDS, BatchProcessor
from ..integration.openai_provider import is_transient_error_string
from ..security import RiskLevel, SecureSanitizer, create_secure_sanitizer
from .context_builder import ContextBuilder

logger = get_logger(__name__)


class Phase1ParseService:
    """Handles Phase 1: AI Parse-Only batch processing"""

    def __init__(
        self,
        ai_service: AIProvider,
        context_builder: ContextBuilder,
        batch_processor: BatchProcessor | None = None,
        cache_manager: Any | None = None,
        sanitizer: SecureSanitizer | None = None,
    ):
        """Initialize the Phase 1 parsing service.

        Args:
            ai_service: The AI service for parsing requests
            context_builder: Service for building appropriate contexts
            batch_processor: Optional batch processor for sophisticated batching
            cache_manager: Optional cache manager for caching parse results
            sanitizer: Optional input sanitizer for prompt injection detection
        """
        self.ai_service = ai_service
        self.context_builder = context_builder
        self.cache_manager = cache_manager

        # Create batch processor if not provided
        if batch_processor is None:
            self.batch_processor = BatchProcessor(ai_service)
        else:
            self.batch_processor = batch_processor

        # Create sanitizer if not provided (security: protect AI inputs)
        self.sanitizer = sanitizer or create_secure_sanitizer()

        self._stats: dict[str, int] = {
            "total_parsed": 0,
            "successful_parses": 0,
            "failed_parses": 0,
            "needs_historical": 0,
            "suspicious_inputs": 0,
            "high_risk_inputs": 0,
            "phase_retry_rounds": 0,
            "recovered_in_retry": 0,
            "permanently_failed": 0,
        }
        self._first_failure_reason: str | None = None

    async def batch_parse(
        self, requests: list[ParseRequest], progress_callback: Callable[..., None] | None = None
    ) -> list[ParseResult]:
        """Parse requests in batch with phase-level retry rounds.

        Phase 1 must be as complete as possible before Phase 2 starts.
        After the initial batch completes, transient failures are collected,
        and up to MAX_PHASE_RETRY_ROUNDS retry rounds are attempted with
        increasing delays.
        """
        if not requests:
            return []

        logger.info(f"Phase 1: Starting batch parse of {len(requests)} requests")

        # Sanitize inputs before AI processing
        requests, _security_metadata = self._sanitize_requests(requests)

        # Build parse-only contexts for all requests
        contexts = self._build_contexts(requests)

        # Initial batch parse
        results = await self._run_batch(requests, contexts, progress_callback)

        # Phase-level retry rounds for transient failures
        for round_num in range(MAX_PHASE_RETRY_ROUNDS):
            failed_indices = [i for i, r in enumerate(results) if self._is_transient_failure(r)]

            if not failed_indices:
                break

            delay = PHASE_RETRY_DELAYS_SECONDS[round_num]
            logger.warning(
                f"Phase 1 retry round {round_num + 1}/{MAX_PHASE_RETRY_ROUNDS}: "
                f"{len(failed_indices)} failed items, waiting {delay}s"
            )
            self._stats["phase_retry_rounds"] += 1
            await asyncio.sleep(delay)

            # Re-submit only failed items
            failed_requests = [requests[i] for i in failed_indices]
            failed_contexts = [contexts[i] for i in failed_indices]
            retry_results = await self._run_batch(failed_requests, failed_contexts, progress_callback)

            # Merge successful retries back
            for idx, retry_result in zip(failed_indices, retry_results, strict=True):
                if not self._is_transient_failure(retry_result):
                    results[idx] = retry_result
                    if retry_result.is_valid:
                        self._stats["recovered_in_retry"] += 1

        # Count all failures (transient and permanent) after retries
        all_failed = [r for r in results if not r.is_valid]
        self._stats["permanently_failed"] = len(all_failed)

        # Log reconciliation
        self._log_reconciliation(requests, results, all_failed)

        # Update statistics
        self._update_stats(results)

        logger.info(
            f"Phase 1 complete: {self._stats['successful_parses']} successful, "
            f"{self._stats['failed_parses']} failed, "
            f"{self._stats['needs_historical']} need historical context"
        )

        return results

    async def _run_batch(
        self,
        requests: list[ParseRequest],
        contexts: list[AIRequestContext],
        progress_callback: Callable[..., None] | None,
    ) -> list[ParseResult]:
        """Run a single batch through BatchProcessor."""
        try:
            results = await self.batch_processor.batch_parse_requests(
                requests=requests, contexts=contexts, progress_callback=progress_callback
            )
            batch_stats = self.batch_processor.get_statistics()
            logger.info(
                f"Batch stats: {batch_stats.get('successful_batches', 0)} successful, "
                f"{batch_stats.get('failed_batches', 0)} failed, "
                f"{batch_stats.get('total_retries', 0)} retries"
            )
            return results
        except Exception as e:
            logger.error(f"Phase 1 batch processing failed: {e}")
            return [self._create_failed_result(req, str(e)) for req in requests]

    @staticmethod
    def _is_transient_failure(result: ParseResult) -> bool:
        """Check if a ParseResult represents a transient failure that should be retried."""
        if result.is_valid:
            return False
        failure_reason = result.metadata.get("failure_reason", "")
        return result.metadata.get("transient_error", False) or is_transient_error_string(failure_reason)

    def _log_reconciliation(
        self,
        requests: list[ParseRequest],
        results: list[ParseResult],
        all_failed: list[ParseResult],
    ) -> None:
        """Log end-of-phase reconciliation summary."""
        total = len(requests)
        succeeded = total - len(all_failed)

        if not all_failed:
            logger.info(f"Phase 1 reconciliation: {total}/{total} parsed successfully")
            return

        transient_count = 0
        for r in all_failed:
            if self._is_transient_failure(r):
                transient_count += 1
        permanent_count = len(all_failed) - transient_count

        logger.warning(
            f"Phase 1 reconciliation: {succeeded}/{total} parsed successfully, "
            f"{len(all_failed)} failed ({transient_count} transient, {permanent_count} permanent)"
        )
        for result in all_failed[:10]:  # Cap at 10 to avoid log spam
            req = result.parse_request
            req_text = req.request_text[:60] if req else "unknown"
            req_info = f"cm_id={req.requester_cm_id}" if req else "unknown"
            reason = result.metadata.get("failure_reason", "unknown")
            kind = "transient" if result.metadata.get("transient_error") else "permanent"
            logger.warning(f'  Failed ({kind}): "{req_text}" ({req_info}) — {reason}')

        if len(all_failed) > 10:
            logger.warning(f"  ... and {len(all_failed) - 10} more")

    def _sanitize_requests(self, requests: list[ParseRequest]) -> tuple[list[ParseRequest], dict[int, dict[str, Any]]]:
        """Sanitize all request texts before AI processing.

        Detects and handles potential prompt injection attempts.
        Returns sanitized requests and metadata about security findings.

        Args:
            requests: List of parse requests to sanitize

        Returns:
            Tuple of (sanitized requests, security metadata by requester_cm_id)
        """
        security_metadata: dict[int, dict[str, Any]] = {}
        sanitized_requests = []

        for req in requests:
            # Process the request text through sanitizer
            result = self.sanitizer.process(req.request_text)

            # Track suspicious inputs
            if result.is_suspicious:
                self._stats["suspicious_inputs"] += 1

                if result.risk_level in (RiskLevel.HIGH, RiskLevel.CRITICAL):
                    self._stats["high_risk_inputs"] += 1
                    logger.warning(
                        f"HIGH RISK input from {req.requester_name} (cm_id={req.requester_cm_id}): "
                        f"patterns={result.detected_patterns}, risk={result.risk_level.value}"
                    )
                else:
                    logger.info(
                        f"Suspicious input from {req.requester_name}: "
                        f"patterns={result.detected_patterns}, risk={result.risk_level.value}"
                    )

                # Store security metadata for potential confidence penalty later
                security_metadata[req.requester_cm_id] = {
                    "confidence_penalty": result.confidence_penalty,
                    "risk_level": result.risk_level.value,
                    "detected_patterns": result.detected_patterns,
                    "was_truncated": result.was_truncated,
                }

            # Create new request with sanitized text
            sanitized_req = replace(req, request_text=result.sanitized_text)
            sanitized_requests.append(sanitized_req)

        if self._stats["suspicious_inputs"] > 0:
            logger.info(
                f"Sanitization complete: {self._stats['suspicious_inputs']} suspicious inputs, "
                f"{self._stats['high_risk_inputs']} high risk"
            )

        return sanitized_requests, security_metadata

    def _build_contexts(self, requests: list[ParseRequest]) -> list[AIRequestContext]:
        """Build parse-only contexts for all requests"""
        contexts = []

        for req in requests:
            additional_data: dict[str, Any] = {
                "row_data": req.row_data,  # Include full row data
            }
            # Include staff_metadata if present (for bunking_notes fields)
            if req.staff_metadata:
                additional_data["staff_metadata"] = req.staff_metadata

            # Include school/congregation/city for group reference detection
            row = req.row_data or {}
            if row.get("school"):
                additional_data["requester_school"] = row["school"]
            if row.get("normalized_congregation"):
                additional_data["requester_congregation"] = row["normalized_congregation"]
            if row.get("city") or row.get("address_city"):
                additional_data["requester_city"] = row.get("city") or row.get("address_city")

            context = self.context_builder.build_parse_only_context(
                requester_name=req.requester_name,
                requester_cm_id=req.requester_cm_id,
                requester_grade=req.requester_grade,
                session_cm_id=req.session_cm_id,
                session_name=req.session_name,
                year=req.year,
                field_name=req.field_name,
                additional_data=additional_data,
            )
            contexts.append(context)

        return contexts

    # Note: _process_responses method removed as batch processor handles this internally

    def _create_failed_result(self, req: ParseRequest, reason: str = "Unknown error") -> ParseResult:
        """Create a failed parse result"""
        return ParseResult(
            parsed_requests=[],  # Empty list for failed results
            needs_historical_context=False,
            is_valid=False,
            parse_request=req,
            metadata={"failure_reason": reason},
        )

    def _update_stats(self, results: list[ParseResult]) -> None:
        """Update parsing statistics"""
        self._stats["total_parsed"] += len(results)

        for result in results:
            if result.is_valid:
                self._stats["successful_parses"] += 1
                if result.needs_historical_context:
                    self._stats["needs_historical"] += 1
            else:
                self._stats["failed_parses"] += 1
                # Log failure reason for debugging
                failure_reason = result.metadata.get("failure_reason", "Unknown reason")
                if self._first_failure_reason is None:
                    self._first_failure_reason = failure_reason
                requester_info = ""
                if result.parse_request:
                    requester_info = f" (requester: {result.parse_request.requester_name})"
                logger.warning(f"Parse failed{requester_info}: {failure_reason}")

    def get_stats(self) -> dict[str, Any]:
        """Get parsing statistics, including first_failure_reason."""
        stats: dict[str, Any] = dict(self._stats)
        stats["first_failure_reason"] = self._first_failure_reason
        return stats

    def reset_stats(self) -> None:
        """Reset statistics"""
        self._stats = {
            "total_parsed": 0,
            "successful_parses": 0,
            "failed_parses": 0,
            "needs_historical": 0,
            "suspicious_inputs": 0,
            "high_risk_inputs": 0,
            "phase_retry_rounds": 0,
            "recovered_in_retry": 0,
            "permanently_failed": 0,
        }
        self._first_failure_reason = None

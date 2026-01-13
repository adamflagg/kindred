"""Phase 1 Parse Service - Handles batch AI parsing without ID resolution"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import replace
from typing import Any

from ..core.models import ParseRequest, ParseResult
from ..integration.ai_service import AIProvider, AIRequestContext
from ..integration.batch_processor import BatchProcessor
from ..security import RiskLevel, SecureSanitizer, create_secure_sanitizer
from .context_builder import ContextBuilder

logger = logging.getLogger(__name__)


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

        self._stats = {
            "total_parsed": 0,
            "successful_parses": 0,
            "failed_parses": 0,
            "needs_historical": 0,
            "suspicious_inputs": 0,
            "high_risk_inputs": 0,
        }

    async def batch_parse(
        self, requests: list[ParseRequest], progress_callback: Callable[..., None] | None = None
    ) -> list[ParseResult]:
        """Parse requests in batch without ID resolution.

        This is Phase 1 of the three-phase approach. The AI extracts
        request structure without attempting to match names to person IDs.
        Uses V1's sophisticated batch processing with rate limiting and retries.

        Args:
            requests: List of parse requests to process
            progress_callback: Optional callback for progress updates

        Returns:
            List of parse results
        """
        if not requests:
            return []

        logger.info(f"Phase 1: Starting batch parse of {len(requests)} requests")

        # Sanitize inputs before AI processing (security: prompt injection protection)
        requests, security_metadata = self._sanitize_requests(requests)

        # Build parse-only contexts for all requests
        contexts = self._build_contexts(requests)

        # Use batch processor for sophisticated batching
        try:
            results = await self.batch_processor.batch_parse_requests(
                requests=requests, contexts=contexts, progress_callback=progress_callback
            )

            # Get batch processing statistics
            batch_stats = self.batch_processor.get_statistics()
            logger.info(
                f"Batch processing stats: {batch_stats.get('successful_batches', 0)} successful, "
                f"{batch_stats.get('failed_batches', 0)} failed, "
                f"{batch_stats.get('total_retries', 0)} retries"
            )

        except Exception as e:
            logger.error(f"Phase 1 batch processing failed: {e}")
            # Return failed results for all requests
            results = [self._create_failed_result(req, str(e)) for req in requests]

        # Update statistics
        self._update_stats(results)

        logger.info(
            f"Phase 1 complete: {self._stats['successful_parses']} successful, "
            f"{self._stats['failed_parses']} failed, "
            f"{self._stats['needs_historical']} need historical context"
        )

        return results

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
                requester_info = ""
                if result.parse_request:
                    requester_info = f" (requester: {result.parse_request.requester_name})"
                logger.warning(f"Parse failed{requester_info}: {failure_reason}")

    def get_stats(self) -> dict[str, Any]:
        """Get parsing statistics"""
        return self._stats.copy()

    def reset_stats(self) -> None:
        """Reset statistics"""
        self._stats = {
            "total_parsed": 0,
            "successful_parses": 0,
            "failed_parses": 0,
            "needs_historical": 0,
            "suspicious_inputs": 0,
            "high_risk_inputs": 0,
        }

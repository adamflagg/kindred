"""Native V2 Batch Processor - Direct implementation for V2 architecture

Provides sophisticated batch processing with:
- Dynamic batch sizing based on token estimation
- Rate limit handling with exponential backoff
- Concurrent processing with semaphore control
- Progress callbacks for monitoring
- Comprehensive statistics tracking

Technical parameters are hardcoded as they are infrastructure settings
that don't affect bunking outcomes and shouldn't be exposed to staff."""

from __future__ import annotations

import asyncio
import inspect
import json
import logging
import random
import time
from collections.abc import Callable
from dataclasses import dataclass
from enum import Enum
from typing import Any

from ..core.models import ParsedRequest, ParseRequest, ParseResult
from .ai_service import AIProvider, AIRequestContext, ParsedResponse

logger = logging.getLogger(__name__)

# ============================================================================
# HARDCODED TECHNICAL CONSTANTS
# These are infrastructure settings optimized for API rate limits and cost.
# They don't affect bunking quality and shouldn't be exposed to bunking staff.
# ============================================================================

# Batch sizing
BATCH_SIZE = 30
MAX_CONCURRENT_BATCHES = 3
FALLBACK_TO_INDIVIDUAL = True

# Dynamic batch sizing
DYNAMIC_BATCH_SIZING_ENABLED = True
MAX_TOKENS_PER_BATCH = 8000
MIN_BATCH_SIZE = 5
MAX_BATCH_SIZE = 50

# Rate limit retry with exponential backoff
RATE_LIMIT_MAX_RETRIES = 5
RATE_LIMIT_INITIAL_DELAY_MS = 1000
RATE_LIMIT_MAX_DELAY_MS = 60000
RATE_LIMIT_EXPONENTIAL_BASE = 2

# ============================================================================
# NAME VALIDATION
# Filter non-name targets that AI may incorrectly parse as person names
# ============================================================================

# Known non-name patterns that AI sometimes extracts as target_name
_NON_NAME_PATTERNS = {
    # Bunk preferences
    "upper bunk",
    "lower bunk",
    "bottom bunk",
    "top bunk",
    "near window",
    "near door",
    "by window",
    "by door",
    # Descriptive phrases (word combinations)
    "friendly",
    "quiet",
    "nice",
    "good",
    "fun",
    "boys",
    "girls",
    "kids",
    "campers",
    "children",
    "friends",
    # Sensitivity descriptions
    "sensitive",
    "light sensitive",
    "noise sensitive",
    "sound sensitive",
    "sleepers",
    # Family words (should use SIBLING placeholder instead)
    "twins",
    "twin",
    "siblings",
    "sister",
    "brother",
    "my sister",
    "my brother",
    "my twin",
    "the twins",
}

# Special placeholders that should be accepted as valid
_VALID_PLACEHOLDERS = {
    "last_year_bunkmates",
    "sibling",  # Family member placeholder - resolved via household_id
    "older",
    "younger",
    "unclear",
}


def is_likely_person_name(value: str) -> bool:
    """Check if a value is likely a person's name vs a description/preference.

    This filter rejects obviously non-name targets that AI may incorrectly parse:
    - Bunk preferences: "upper bunk", "bottom bunk", "near window"
    - Descriptive phrases: "friendly boys", "quiet kids", "nice girls"
    - Sensitivity descriptions: "noise sensitive kids", "light sensitive"

    Args:
        value: The target_name string to validate

    Returns:
        True if the value appears to be a person's name, False otherwise
    """
    if not value or not value.strip():
        return False

    normalized = value.strip().lower()

    # Accept special placeholders
    if normalized in _VALID_PLACEHOLDERS:
        return True

    # Reject exact matches to non-name patterns
    if normalized in _NON_NAME_PATTERNS:
        return False

    # Check for phrases containing multiple non-name words
    words = normalized.split()

    # Count how many words are non-name indicators
    non_name_word_count = sum(1 for word in words if word in _NON_NAME_PATTERNS)

    # If majority of words are non-name indicators, reject it
    # e.g., "friendly boys" = 2 non-name words out of 2 = reject
    # e.g., "noise sensitive kids" = 3 non-name words out of 3 = reject
    # Otherwise, assume it's a valid name (single word or name-like pattern)
    return not (len(words) > 1 and non_name_word_count >= len(words) - 1)


async def _call_callback(callback: Callable[..., Any] | None, *args: Any) -> None:
    """Call a callback, handling both sync and async callbacks."""
    if callback is None:
        return
    result = callback(*args)
    # If it's a coroutine, await it
    if inspect.iscoroutine(result):
        await result


class BatchStatus(Enum):
    """Status of a batch request"""

    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    RATE_LIMITED = "rate_limited"


@dataclass
class BatchResult:
    """Result of a batch processing operation"""

    batch_id: int
    status: BatchStatus
    results: list[Any] | None = None
    error: str | None = None
    retry_count: int = 0
    processing_time: float = 0.0


class BatchProcessor:
    """Native V2 implementation of batch processing

    Technical parameters (batch size, concurrency, retry logic) are hardcoded
    as module-level constants since they are infrastructure settings that:
    - Don't affect bunking quality or decisions
    - Are optimized for API rate limits and cost
    - Shouldn't be exposed to bunking staff
    """

    def __init__(self, ai_provider: AIProvider, config: dict[str, Any] | None = None):
        """Initialize the V2 batch processor.

        Args:
            ai_provider: The AI provider to use for processing
            config: Optional configuration (only 'enabled' is read from config)
        """
        self.ai_provider = ai_provider

        # Only read 'enabled' from config - all other settings are hardcoded
        self.config = config or {}
        batch_config = self.config.get("batch_processing", {})
        self.enabled = batch_config.get("enabled", True)

        # Rate limit tracking
        self.rate_limit_reset_time = 0.0
        self.requests_this_minute = 0
        self.last_request_time = 0.0

        # Statistics
        self.stats = {
            "total_batches": 0,
            "successful_batches": 0,
            "failed_batches": 0,
            "rate_limited_batches": 0,
            "total_items": 0,
            "total_retries": 0,
            "total_time": 0.0,
        }

    async def batch_parse_requests(
        self,
        requests: list[ParseRequest],
        contexts: list[AIRequestContext],
        progress_callback: Callable[..., Any] | None = None,
    ) -> list[ParseResult]:
        """Process parse requests in batches.

        Args:
            requests: List of parse requests
            contexts: List of contexts (one per request)
            progress_callback: Optional callback for progress updates

        Returns:
            List of parse results
        """
        if not requests:
            return []

        # Create items for batching
        items = list(zip(requests, contexts, strict=False))

        # Process in batches
        batch_results = await self._process_all_batches(items, progress_callback)

        # Convert batch results to parse results
        parse_results = []
        item_index = 0

        for batch_result in batch_results:
            if batch_result.status == BatchStatus.COMPLETED and batch_result.results:
                # Process successful batch results
                for parsed_response in batch_result.results:
                    if item_index < len(requests):
                        parse_result = self._convert_to_parse_result(requests[item_index], parsed_response)
                        parse_results.append(parse_result)
                        item_index += 1
            else:
                # Handle failed batches
                batch_size = self._estimate_batch_size(batch_result.batch_id, len(items))
                for _ in range(batch_size):
                    if item_index < len(requests):
                        parse_results.append(
                            self._create_failed_result(requests[item_index], f"Batch failed: {batch_result.error}")
                        )
                        item_index += 1

        # Log statistics
        self._log_statistics()

        return parse_results

    async def batch_disambiguate(
        self,
        disambiguation_requests: list[tuple[ParsedRequest, dict[str, Any]]],
        progress_callback: Callable[..., Any] | None = None,
    ) -> list[ParsedResponse]:
        """Process disambiguation requests in batches.

        Args:
            disambiguation_requests: List of (parsed_request, context) tuples
            progress_callback: Optional progress callback

        Returns:
            List of disambiguation results
        """
        if not disambiguation_requests:
            return []

        # Process disambiguations in batches
        batch_results = await self._process_all_batches(
            disambiguation_requests, progress_callback, is_disambiguation=True
        )

        # Extract results
        results = []
        for batch_result in batch_results:
            if batch_result.status == BatchStatus.COMPLETED and batch_result.results:
                results.extend(batch_result.results)
            else:
                # Add None for failed items
                batch_size = len(disambiguation_requests) // max(1, len(batch_results))
                results.extend([None] * batch_size)

        return results

    async def _process_all_batches(
        self, items: list[Any], progress_callback: Callable[..., Any] | None, is_disambiguation: bool = False
    ) -> list[BatchResult]:
        """Process all items in batches concurrently.

        Args:
            items: List of items to process
            progress_callback: Optional callback for progress updates
            is_disambiguation: Whether this is disambiguation processing

        Returns:
            List of BatchResult objects
        """
        # Create batches
        batches = self._create_batches(items)
        logger.info(f"Created {len(batches)} batches from {len(items)} items")

        # Process batches concurrently (hardcoded limit)
        semaphore = asyncio.Semaphore(MAX_CONCURRENT_BATCHES)

        tasks = []
        for batch_id, batch in enumerate(batches):
            task = self._process_batch_with_semaphore(batch_id, batch, semaphore, progress_callback, is_disambiguation)
            tasks.append(task)

        # Wait for all batches to complete
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Handle any exceptions
        final_results: list[BatchResult] = []
        for i, result in enumerate(results):
            if isinstance(result, BaseException):
                logger.error(f"Batch {i} failed with exception: {result}")
                final_results.append(BatchResult(batch_id=i, status=BatchStatus.FAILED, error=str(result)))
            elif isinstance(result, BatchResult):
                final_results.append(result)
            else:
                final_results.append(BatchResult(batch_id=i, status=BatchStatus.FAILED, error="Unknown result type"))

        return final_results

    def _create_batches(self, items: list[Any]) -> list[list[Any]]:
        """Create batches with dynamic sizing (hardcoded enabled)"""
        if DYNAMIC_BATCH_SIZING_ENABLED:
            return self._create_dynamic_batches(items)
        else:
            # Fixed size batching (fallback)
            return [items[i : i + BATCH_SIZE] for i in range(0, len(items), BATCH_SIZE)]

    def _create_dynamic_batches(self, items: list[Any]) -> list[list[Any]]:
        """Create batches based on estimated token count (using hardcoded limits)"""
        max_tokens = MAX_TOKENS_PER_BATCH
        min_size = MIN_BATCH_SIZE
        max_size = MAX_BATCH_SIZE

        batches: list[list[Any]] = []
        current_batch: list[Any] = []
        current_tokens = 0

        for item in items:
            # Estimate tokens
            item_tokens = self._estimate_tokens(item)

            # Check if adding this item would exceed limits
            if current_batch and (len(current_batch) >= max_size or current_tokens + item_tokens > max_tokens):
                # Start new batch
                batches.append(current_batch)
                current_batch = []
                current_tokens = 0

            current_batch.append(item)
            current_tokens += item_tokens

            # Ensure minimum batch size unless it's the last batch
            if len(current_batch) >= min_size and current_tokens >= max_tokens * 0.8:
                batches.append(current_batch)
                current_batch = []
                current_tokens = 0

        # Add remaining items
        if current_batch:
            batches.append(current_batch)

        return batches

    def _estimate_tokens(self, item: Any) -> int:
        """Estimate token count for an item"""
        # Extract text content
        if isinstance(item, tuple) and len(item) >= 2:
            # For (ParseRequest, AIRequestContext) or similar tuples
            text_parts = []

            # First element (ParseRequest or ParsedRequest)
            if hasattr(item[0], "request_text"):
                text_parts.append(item[0].request_text)
            elif hasattr(item[0], "raw_text"):
                text_parts.append(item[0].raw_text)
            elif hasattr(item[0], "target_name"):
                text_parts.append(item[0].target_name or "")

            # Second element (context)
            if isinstance(item[1], dict):
                text_parts.append(json.dumps(item[1]))
            elif hasattr(item[1], "requester_name"):
                text_parts.append(item[1].requester_name)

            text = " ".join(text_parts)
        else:
            # Fallback to JSON serialization
            text = json.dumps(item, default=str)

        # Simple estimation: ~4 characters per token
        return len(text) // 4

    async def _process_batch_with_semaphore(
        self,
        batch_id: int,
        batch: list[Any],
        semaphore: asyncio.Semaphore,
        progress_callback: Callable[..., Any] | None,
        is_disambiguation: bool,
    ) -> BatchResult:
        """Process a batch with semaphore control"""
        async with semaphore:
            return await self._process_batch_with_retry(batch_id, batch, progress_callback, is_disambiguation)

    async def _process_batch_with_retry(
        self, batch_id: int, batch: list[Any], progress_callback: Callable[..., Any] | None, is_disambiguation: bool
    ) -> BatchResult:
        """Process a batch with retry logic (using hardcoded retry settings)"""
        retry_count = 0
        max_retries = RATE_LIMIT_MAX_RETRIES

        while retry_count <= max_retries:
            try:
                # Check rate limits
                await self._check_rate_limits()

                # Process batch
                start_time = time.time()

                if is_disambiguation:
                    # Process disambiguation batch
                    results = []
                    for parsed_request, context in batch:
                        result = await self.ai_provider.parse_request(context.request_text, context)
                        results.append(result)
                else:
                    # Process parse batch
                    batch_items = [(req.request_text, ctx) for req, ctx in batch]
                    results = await self.ai_provider.batch_parse_requests(batch_items)

                processing_time = time.time() - start_time

                # Update stats
                self.stats["total_batches"] += 1
                self.stats["successful_batches"] += 1
                self.stats["total_items"] += len(batch)
                self.stats["total_time"] += processing_time

                # Report progress
                await _call_callback(progress_callback, batch_id, len(batch), "completed")

                return BatchResult(
                    batch_id=batch_id,
                    status=BatchStatus.COMPLETED,
                    results=results,
                    retry_count=retry_count,
                    processing_time=processing_time,
                )

            except Exception as e:
                error_str = str(e)

                # Check if rate limited
                if "rate_limit" in error_str.lower() or "429" in error_str:
                    retry_count += 1
                    self.stats["rate_limited_batches"] += 1

                    if retry_count <= max_retries:
                        # Calculate delay with exponential backoff
                        delay = self._calculate_retry_delay(retry_count)
                        logger.warning(
                            f"Batch {batch_id} rate limited, retrying in {delay:.1f}s "
                            f"(attempt {retry_count}/{max_retries})"
                        )

                        await _call_callback(progress_callback, batch_id, len(batch), "rate_limited")

                        await asyncio.sleep(delay)
                        self.stats["total_retries"] += 1
                        continue

                # Other error or max retries exceeded
                logger.error(f"Batch {batch_id} failed after {retry_count} retries: {error_str}")
                self.stats["failed_batches"] += 1

                await _call_callback(progress_callback, batch_id, len(batch), "failed")

                return BatchResult(
                    batch_id=batch_id, status=BatchStatus.FAILED, error=error_str, retry_count=retry_count
                )

        # Should never reach here, but satisfy mypy
        return BatchResult(
            batch_id=batch_id, status=BatchStatus.FAILED, error="Max retries exceeded", retry_count=retry_count
        )

    def _calculate_retry_delay(self, retry_count: int) -> float:
        """Calculate retry delay with exponential backoff and jitter (hardcoded settings)"""
        initial_delay = RATE_LIMIT_INITIAL_DELAY_MS / 1000
        max_delay = RATE_LIMIT_MAX_DELAY_MS / 1000
        base = RATE_LIMIT_EXPONENTIAL_BASE

        # Exponential backoff
        delay = initial_delay * (base ** (retry_count - 1))

        # Cap at max delay
        delay = min(delay, max_delay)

        # Add jitter (±10%)
        jitter = delay * 0.1
        delay += random.uniform(-jitter, jitter)

        final_delay: float = delay
        return final_delay

    async def _check_rate_limits(self) -> None:
        """Simple rate limit tracking"""
        current_time = time.time()

        # Reset counter if minute has passed
        if current_time - self.last_request_time > 60:
            self.requests_this_minute = 0

        self.requests_this_minute += 1
        self.last_request_time = current_time

        # If we're hitting limits too fast, add a small delay
        if self.requests_this_minute > 50:  # Conservative limit
            await asyncio.sleep(0.1)

    def _convert_to_parse_result(self, parse_request: ParseRequest, parsed_response: ParsedResponse) -> ParseResult:
        """Convert AI response to ParseResult"""
        if parsed_response.requests:
            # Process ALL requests, not just the first one
            parsed_requests = []

            for parsed in parsed_response.requests:
                # Ensure source field is set for each request
                parsed.source_field = parse_request.field_name
                parsed_requests.append(parsed)

            return ParseResult(
                parsed_requests=parsed_requests,
                needs_historical_context=parsed_response.metadata.get("needs_historical_context", False),
                is_valid=True,
                parse_request=parse_request,
                metadata={
                    "ai_provider": parsed_response.metadata.get("provider", "unknown"),
                    "ai_model": parsed_response.metadata.get("model", "unknown"),
                    "historical_reason": parsed_response.metadata.get("historical_context_reason"),
                    "parse_confidence": parsed_requests[0].confidence if parsed_requests else 0.0,
                    "request_count": len(parsed_requests),
                },
            )
        else:
            # No valid response - check for error details in metadata
            error = parsed_response.metadata.get("error")
            error_type = parsed_response.metadata.get("error_type")
            reason = f"AI parse failed ({error_type}): {error}" if error else "AI returned no valid parsed requests"

            return self._create_failed_result(parse_request, reason)

    def _create_failed_result(self, parse_request: ParseRequest, reason: str) -> ParseResult:
        """Create a failed parse result"""
        return ParseResult(
            parsed_requests=[],  # Empty list for failed results
            needs_historical_context=False,
            is_valid=False,
            parse_request=parse_request,
            metadata={"failure_reason": reason},
        )

    def _estimate_batch_size(self, batch_id: int, total_items: int) -> int:
        """Estimate the size of a batch based on batch ID (using hardcoded settings)"""
        if DYNAMIC_BATCH_SIZING_ENABLED:
            # Dynamic sizing - estimate based on min/max average
            avg_batch_size = (MIN_BATCH_SIZE + MAX_BATCH_SIZE) // 2
            return min(avg_batch_size, total_items - (batch_id * avg_batch_size))
        else:
            # Fixed size batching
            return min(BATCH_SIZE, total_items - (batch_id * BATCH_SIZE))

    def _log_statistics(self) -> None:
        """Log processing statistics"""
        if self.stats["total_batches"] == 0:
            return

        avg_time = self.stats["total_time"] / self.stats["total_batches"]
        success_rate = self.stats["successful_batches"] / self.stats["total_batches"] * 100

        logger.info(f"""Batch Processing Statistics:
- Total batches: {self.stats["total_batches"]}
- Successful: {self.stats["successful_batches"]} ({success_rate:.1f}%)
- Failed: {self.stats["failed_batches"]}
- Rate limited: {self.stats["rate_limited_batches"]}
- Total items processed: {self.stats["total_items"]}
- Total retries: {self.stats["total_retries"]}
- Average time per batch: {avg_time:.2f}s
- Total processing time: {self.stats["total_time"]:.1f}s""")

    def get_statistics(self) -> dict[str, Any]:
        """Get batch processing statistics"""
        return self.stats.copy()

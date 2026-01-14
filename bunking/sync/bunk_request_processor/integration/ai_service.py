"""AI Service Wrapper - Abstract interface for AI/LLM providers

Provides a clean abstraction for parsing bunk requests using various AI providers."""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from collections.abc import Callable

# Import types from ai_types to avoid circular imports
from .ai_types import (
    AIProvider,
    AIRequestContext,
    AIServiceConfig,
    ParsedResponse,
    ProviderType,
    TokenUsage,
)

# Re-export for backwards compatibility
__all__ = [
    "AIProvider",
    "AIRequestContext",
    "AIService",
    "AIServiceConfig",
    "ParsedResponse",
    "ProviderType",
    "TokenUsage",
]

logger = logging.getLogger(__name__)


class AIService:
    """Main AI service that delegates to providers"""

    def __init__(self, config: AIServiceConfig):
        """Initialize AI service.

        Args:
            config: Service configuration
        """
        self.config = config
        self._provider: AIProvider | None = None
        self._cache: dict[str, ParsedResponse] = {}
        self._semaphore = asyncio.Semaphore(config.max_concurrent_requests)

        # Initialize provider (will be done via factory in real implementation)
        self._initialize_provider()

    def _initialize_provider(self) -> None:
        """Initialize the appropriate provider"""
        from .provider_factory import create_provider

        self._provider = create_provider(self.config)

    def _get_cache_key(self, request_text: str, context: AIRequestContext) -> str:
        """Generate cache key for request"""
        key_data = {
            "text": request_text.strip(),
            "requester": context.requester_cm_id,
            "session": context.session_cm_id,
            "year": context.year,
        }
        key_str = json.dumps(key_data, sort_keys=True)
        return hashlib.md5(key_str.encode()).hexdigest()

    def _sanitize_request(self, request_text: str) -> str:
        """Sanitize request text"""
        # Remove extra whitespace
        text = " ".join(request_text.split())
        # Remove leading/trailing whitespace
        text = text.strip()
        return text

    async def parse_request(self, request_text: str, context: AIRequestContext) -> ParsedResponse:
        """Parse a single request.

        Args:
            request_text: The request text to parse
            context: Context for parsing

        Returns:
            Parsed response
        """
        # Handle empty requests
        if not request_text or not request_text.strip():
            return ParsedResponse(requests=[], confidence=0.0)

        # Sanitize request
        clean_text = self._sanitize_request(request_text)

        # Check cache if enabled
        if self.config.cache_responses:
            cache_key = self._get_cache_key(clean_text, context)
            if cache_key in self._cache:
                logger.debug(f"Cache hit for request: {clean_text[:50]}...")
                return self._cache[cache_key]

        # Parse with retry logic
        last_error: Exception | None = None
        for attempt in range(self.config.max_retries):
            try:
                if self._provider is None:
                    raise RuntimeError("AI provider not initialized")
                async with self._semaphore:
                    response = await self._provider.parse_request(clean_text, context)

                # Cache successful response
                if self.config.cache_responses:
                    self._cache[cache_key] = response

                return response

            except Exception as e:
                last_error = e
                if attempt < self.config.max_retries - 1:
                    wait_time = 2**attempt  # Exponential backoff
                    logger.warning(f"Parse attempt {attempt + 1} failed: {e}. Retrying in {wait_time}s...")
                    await asyncio.sleep(wait_time)
                else:
                    logger.error(f"All parse attempts failed: {e}")

        # If all retries failed, raise the last error
        if last_error is not None:
            raise last_error
        raise RuntimeError("All parse attempts failed with no error captured")

    async def batch_parse_requests(
        self,
        requests: list[tuple[str, AIRequestContext]],
        progress_callback: Callable[[int, int, str], None] | None = None,
    ) -> list[ParsedResponse]:
        """Parse multiple requests in batches.

        Args:
            requests: List of (request_text, context) tuples
            progress_callback: Optional callback for progress updates

        Returns:
            List of parsed responses
        """
        if not requests:
            return []

        results: list[ParsedResponse | None] = [None] * len(requests)
        completed = 0

        # Process in batches
        for i in range(0, len(requests), self.config.batch_size):
            batch = requests[i : i + self.config.batch_size]
            batch_indices = list(range(i, min(i + self.config.batch_size, len(requests))))

            # Check cache for batch items
            uncached_batch = []
            uncached_indices = []

            for idx, (text, context) in enumerate(batch):
                actual_idx = batch_indices[idx]

                # Handle empty requests
                if not text or not text.strip():
                    results[actual_idx] = ParsedResponse(requests=[], confidence=0.0)
                    completed += 1
                    continue

                # Check cache
                clean_text = self._sanitize_request(text)
                if self.config.cache_responses:
                    cache_key = self._get_cache_key(clean_text, context)
                    if cache_key in self._cache:
                        results[actual_idx] = self._cache[cache_key]
                        completed += 1
                        continue

                uncached_batch.append((clean_text, context))
                uncached_indices.append(actual_idx)

            # Process uncached items
            if uncached_batch:
                if self._provider is None:
                    raise RuntimeError("AI provider not initialized")
                batch_results = await self._provider.batch_parse_requests(uncached_batch)

                # Store results and update cache
                for idx, response in enumerate(batch_results):
                    actual_idx = uncached_indices[idx]
                    results[actual_idx] = response
                    completed += 1

                    # Cache successful responses
                    if self.config.cache_responses:
                        text, context = uncached_batch[idx]
                        cache_key = self._get_cache_key(text, context)
                        self._cache[cache_key] = response

            # Report progress
            if progress_callback:
                progress_callback(completed, len(requests), f"Processed {completed}/{len(requests)} requests")

        # Filter out None values and return
        final_results: list[ParsedResponse] = [r for r in results if r is not None]
        return final_results

    def get_token_usage(self) -> TokenUsage:
        """Get current token usage statistics"""
        if not self._provider:
            return TokenUsage(prompt_tokens=0, completion_tokens=0, total_cost=0.0)
        return self._provider.get_token_usage()

    async def check_health(self) -> bool:
        """Check if the AI service is healthy"""
        if not self._provider:
            return False
        try:
            return await self._provider.health_check()
        except Exception as e:
            logger.error(f"Health check failed: {e}")
            return False

"""Provider Factory - Creates AI provider instances based on configuration.

Supports OpenAI (with SDK structured outputs) and Mock providers."""

from __future__ import annotations

import logging
import os
import re

from ..core.models import (
    ParsedRequest,
    RequestSource,
    RequestType,
)
from .ai_types import (
    AIProvider,
    AIRequestContext,
    AIServiceConfig,
    ParsedResponse,
    TokenUsage,
)

logger = logging.getLogger(__name__)


class MockProvider(AIProvider):
    """Mock provider for testing"""

    def __init__(self, config: AIServiceConfig):
        self.config = config
        self._token_count = 0

    @property
    def name(self) -> str:
        return "mock"

    async def parse_request(self, request_text: str, context: AIRequestContext) -> ParsedResponse:
        """Mock parse that extracts names and keywords"""
        if not request_text.strip():
            return ParsedResponse(requests=[], confidence=0.0)

        requests = []
        text_lower = request_text.lower()
        position = 1

        # First extract positive requests (bunk with)
        bunk_pattern = r"(?:bunk\s+)?with\s+(\w+(?:\s+\w+)*(?:\s+and\s+\w+(?:\s+\w+)*)*)"
        for match in re.finditer(bunk_pattern, text_lower):
            # Skip if preceded by negative
            start = match.start()
            preceding = text_lower[max(0, start - 15) : start]
            if "not" in preceding or "don't" in preceding or "do not" in preceding:
                continue

            name_part = match.group(1).strip()
            # Split on "and" or commas
            names = re.split(r"\s+and\s+|,\s*", name_part)

            for name in names:
                name = name.strip()
                if name and name not in ["me", "us", "them"]:
                    # Capitalize properly
                    name_parts = name.split()
                    proper_name = " ".join(part.capitalize() for part in name_parts)

                    requests.append(
                        ParsedRequest(
                            raw_text=request_text,
                            request_type=RequestType.BUNK_WITH,
                            target_name=proper_name,
                            age_preference=None,
                            source_field="mock",
                            source=RequestSource.FAMILY,
                            confidence=0.85,
                            csv_position=position,
                            metadata={"provider": "mock"},
                            notes=None,
                        )
                    )
                    position += 1

        # Then extract negative requests (not bunk with)
        not_pattern = r"(?:not|don't|do not)\s+(?:put me |bunk )?with\s+(\w+(?:\s+\w+)*)"
        for match in re.finditer(not_pattern, text_lower):
            name_part = match.group(1).strip()
            # Split on "and" or commas
            names = re.split(r"\s+and\s+|,\s*", name_part)

            for name in names:
                name = name.strip()
                if name and name not in ["me", "us", "them"]:
                    # Capitalize properly
                    name_parts = name.split()
                    proper_name = " ".join(part.capitalize() for part in name_parts)

                    requests.append(
                        ParsedRequest(
                            raw_text=request_text,
                            request_type=RequestType.NOT_BUNK_WITH,
                            target_name=proper_name,
                            age_preference=None,
                            source_field="mock",
                            source=RequestSource.FAMILY,
                            confidence=0.85,
                            csv_position=position,
                            metadata={"provider": "mock"},
                            notes=None,
                        )
                    )
                    position += 1

        # Update token count
        self._token_count += len(request_text.split())

        return ParsedResponse(requests=requests, confidence=0.85 if requests else 0.0, metadata={"mock": True})

    async def batch_parse_requests(self, requests: list[tuple[str, AIRequestContext]]) -> list[ParsedResponse]:
        """Parse multiple requests"""
        responses = []
        for text, context in requests:
            response = await self.parse_request(text, context)
            responses.append(response)
        return responses

    def get_token_usage(self) -> TokenUsage:
        """Get token usage"""
        return TokenUsage(prompt_tokens=self._token_count, completion_tokens=0, total_cost=0.0)

    async def health_check(self) -> bool:
        """Always healthy"""
        return True


class ProviderFactory:
    """Factory for creating AI providers"""

    def __init__(self) -> None:
        self.providers: dict[str, type[AIProvider]] = {
            "mock": MockProvider,
        }

    def register_provider(self, name: str, provider_class: type[AIProvider]) -> None:
        """Register a custom provider"""
        self.providers[name] = provider_class
        logger.info(f"Registered provider: {name}")

    def create(self, config: AIServiceConfig) -> AIProvider:
        """Create a provider instance.

        Args:
            config: Service configuration with provider type, model, and API key

        Returns:
            Configured AI provider instance

        Raises:
            ValueError: If provider type is not supported
        """
        provider_type = config.provider.lower()

        # Use OpenAI SDK provider with Pydantic structured outputs
        if provider_type == "openai":
            from .openai_provider import OpenAIProvider

            if not config.api_key:
                raise ValueError("API key is required for OpenAI provider")
            return OpenAIProvider(
                api_key=config.api_key,
                model=config.model,
                base_url=config.base_url,
                timeout=float(config.timeout),
            )

        # Use mock provider for testing
        if provider_type == "mock":
            return MockProvider(config)

        raise ValueError(f"Unsupported provider: {provider_type}. Available: openai, mock")

    def create_from_env(self) -> AIProvider:
        """Create provider from environment variables"""
        provider_type = os.getenv("AI_PROVIDER", "mock")
        model = os.getenv("AI_MODEL", "")
        api_key = os.getenv("AI_API_KEY", "")

        config = AIServiceConfig(provider=provider_type, model=model, api_key=api_key)

        return self.create(config)


# Convenience function
def create_provider(config: AIServiceConfig) -> AIProvider:
    """Create a provider using the default factory"""
    factory = ProviderFactory()
    return factory.create(config)

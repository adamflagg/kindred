"""AI Service Types - Base classes and types for AI providers.

This module contains the foundational types used by the AI service layer.
Separated to avoid circular imports between ai_service, provider_factory, and providers.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from ..core.models import ParsedRequest


class ProviderType(Enum):
    """Supported AI provider types.

    Currently supports OpenAI (with SDK structured outputs) and Mock for testing.
    """

    OPENAI = "openai"
    MOCK = "mock"  # For testing


@dataclass
class AIServiceConfig:
    """Configuration for AI service"""

    provider: str
    model: str
    max_retries: int = 3
    timeout: int = 30
    cache_responses: bool = True
    batch_size: int = 10
    max_concurrent_requests: int = 5
    api_key: str | None = None
    base_url: str | None = None  # For custom API endpoints
    debug: bool = False  # Enable verbose AI parse logging

    def __post_init__(self) -> None:
        """Validate configuration"""
        if self.max_retries < 0:
            raise ValueError("max_retries must be non-negative")
        if self.timeout <= 0:
            raise ValueError("timeout must be positive")
        if self.batch_size <= 0:
            raise ValueError("batch_size must be positive")
        if self.max_concurrent_requests <= 0:
            raise ValueError("max_concurrent_requests must be positive")


@dataclass
class AIRequestContext:
    """Context information for parsing a request"""

    requester_name: str
    requester_cm_id: int
    session_cm_id: int
    year: int
    additional_context: dict[str, Any] = field(default_factory=dict)

    @property
    def parse_only(self) -> bool:
        """Check if this is a parse-only request"""
        result: bool = self.additional_context.get("parse_only", False)
        return result

    @property
    def field_type(self) -> str | None:
        """Get the field type being processed"""
        return self.additional_context.get("field_type")

    @property
    def csv_source_field(self) -> str | None:
        """Get the CSV source field name"""
        return self.additional_context.get("csv_source_field")


@dataclass
class ParsedResponse:
    """Response from AI parsing"""

    requests: list[ParsedRequest]
    confidence: float
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class TokenUsage:
    """Token usage tracking"""

    prompt_tokens: int
    completion_tokens: int
    total_cost: float


class AIProvider(ABC):
    """Abstract base class for AI providers"""

    @property
    @abstractmethod
    def name(self) -> str:
        """Provider name"""
        pass

    @abstractmethod
    async def parse_request(self, request_text: str, context: AIRequestContext) -> ParsedResponse:
        """Parse a single request"""
        pass

    @abstractmethod
    async def batch_parse_requests(self, requests: list[tuple[str, AIRequestContext]]) -> list[ParsedResponse]:
        """Parse multiple requests efficiently"""
        pass

    @abstractmethod
    def get_token_usage(self) -> TokenUsage:
        """Get current token usage statistics"""
        pass

    @abstractmethod
    async def health_check(self) -> bool:
        """Check if provider is healthy"""
        pass

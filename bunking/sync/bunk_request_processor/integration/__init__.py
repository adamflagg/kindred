"""Integration layer for external services.

Provides clean interfaces for AI services and provider management."""

from __future__ import annotations

from .ai_service import (
    AIProvider,
    AIRequestContext,
    AIService,
    AIServiceConfig,
    ParsedResponse,
    ProviderType,
    TokenUsage,
)
from .provider_factory import (
    MockProvider,
    ProviderFactory,
    create_provider,
)

__all__ = [
    # AI Service
    "AIProvider",
    "AIRequestContext",
    "AIService",
    "AIServiceConfig",
    "ParsedResponse",
    "ProviderType",
    "TokenUsage",
    # Provider Factory
    "MockProvider",
    "ProviderFactory",
    "create_provider",
]

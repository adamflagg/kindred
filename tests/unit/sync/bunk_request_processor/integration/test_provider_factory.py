"""Test-Driven Development for Provider Factory

Tests the AI provider factory for creating different AI providers."""

import os
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

# Add the parent directory to the path
test_dir = Path(__file__).resolve().parent
project_root = test_dir.parent.parent.parent.parent
sys.path.insert(0, str(project_root))

from bunking.sync.bunk_request_processor.integration.ai_service import (
    AIProvider,
    AIRequestContext,
    AIServiceConfig,
    ParsedResponse,
)
from bunking.sync.bunk_request_processor.integration.provider_factory import (
    MockProvider,
    ProviderFactory,
    create_provider,
)


class TestProviderFactory:
    """Test the Provider Factory"""

    def test_create_mock_provider(self):
        """Test creating a mock provider"""
        config = AIServiceConfig(provider="mock", model="test-model")

        provider = create_provider(config)

        assert isinstance(provider, MockProvider)
        assert provider.name == "mock"

    def test_create_openai_provider(self):
        """Test creating OpenAI provider routes to OpenAIProvider"""
        from bunking.sync.bunk_request_processor.integration.openai_provider import OpenAIProvider

        config = AIServiceConfig(provider="openai", model="gpt-4o-mini", api_key="test-key")

        provider = create_provider(config)

        assert isinstance(provider, OpenAIProvider)

    def test_create_anthropic_provider_not_supported(self):
        """Test that Anthropic provider is no longer supported (OpenAI SDK only)."""
        config = AIServiceConfig(provider="anthropic", model="claude-3-sonnet", api_key="test-key")

        with pytest.raises(ValueError, match="Unsupported provider"):
            create_provider(config)

    def test_unsupported_provider_ollama(self):
        """Test that ollama is no longer supported"""
        config = AIServiceConfig(provider="ollama", model="llama2")

        with pytest.raises(ValueError, match="Unsupported provider"):
            create_provider(config)

    def test_invalid_provider_type(self):
        """Test error on invalid provider type"""
        config = AIServiceConfig(provider="invalid", model="test")

        with pytest.raises(ValueError, match="Unsupported provider"):
            create_provider(config)

    def test_missing_api_key(self):
        """Test OpenAIProvider factory raises error for missing API key"""
        # Factory now requires API key - raises ValueError on missing key
        config = AIServiceConfig(
            provider="openai",
            model="gpt-4",
            api_key="",  # Empty key
        )

        with pytest.raises(ValueError, match="API key is required"):
            create_provider(config)

    def test_provider_from_environment(self):
        """Test loading provider config from environment"""
        with patch.dict(
            os.environ,
            {
                "AI_PROVIDER": "mock",
                "AI_MODEL": "test-model",
            },
        ):
            factory = ProviderFactory()
            provider = factory.create_from_env()

            assert isinstance(provider, MockProvider)
            assert provider.name == "mock"

    def test_provider_factory_registry(self):
        """Test provider factory registry"""
        factory = ProviderFactory()

        # Only mock is in the providers dict (openai/anthropic route to OpenAIProvider)
        assert "mock" in factory.providers

        # Register custom provider
        class CustomProvider(AIProvider):
            @property
            def name(self) -> str:
                return "custom"

            async def parse_request(self, request_text: str, context: AIRequestContext) -> ParsedResponse:  # type: ignore[empty-body]
                ...

            async def batch_parse_requests(self, requests):
                pass

            def get_token_usage(self):
                pass

            async def health_check(self):
                pass

        factory.register_provider("custom", CustomProvider)
        assert "custom" in factory.providers

    def test_provider_config_validation(self):
        """Test provider-specific config validation"""
        # Test with mock provider - empty model should work
        config = AIServiceConfig(
            provider="mock",
            model="",
        )
        provider = create_provider(config)
        assert isinstance(provider, MockProvider)


class TestMockProvider:
    """Test the Mock Provider implementation"""

    @pytest.fixture
    def provider(self):
        """Create a mock provider"""
        config = AIServiceConfig(provider="mock", model="test")
        return MockProvider(config)

    @pytest.mark.asyncio
    async def test_parse_request_bunk_with(self, provider):
        """Test parsing bunk_with request"""
        context = AIRequestContext(requester_name="John Smith", requester_cm_id=100, session_cm_id=1000002, year=2024)

        response = await provider.parse_request("I want to bunk with Mike Johnson", context)

        assert len(response.requests) == 1
        assert response.requests[0].request_type.value == "bunk_with"
        assert response.requests[0].target_name == "Mike Johnson"
        assert response.confidence >= 0.8

    @pytest.mark.asyncio
    async def test_parse_request_not_bunk_with(self, provider):
        """Test parsing not_bunk_with request"""
        context = AIRequestContext(requester_name="Jane Doe", requester_cm_id=101, session_cm_id=1000002, year=2024)

        response = await provider.parse_request("Please don't put me with Tom Smith", context)

        assert len(response.requests) == 1
        assert response.requests[0].request_type.value == "not_bunk_with"
        assert response.requests[0].target_name == "Tom Smith"

    @pytest.mark.asyncio
    async def test_parse_request_multiple(self, provider):
        """Test parsing multiple requests"""
        context = AIRequestContext(requester_name="Alice Brown", requester_cm_id=102, session_cm_id=1000002, year=2024)

        response = await provider.parse_request("I want to bunk with Sarah and Emma but not with Jessica", context)

        assert len(response.requests) == 3
        # Should have 2 bunk_with and 1 not_bunk_with
        bunk_with_count = sum(1 for r in response.requests if r.request_type.value == "bunk_with")
        not_bunk_with_count = sum(1 for r in response.requests if r.request_type.value == "not_bunk_with")
        assert bunk_with_count == 2
        assert not_bunk_with_count == 1

    @pytest.mark.asyncio
    async def test_parse_empty_request(self, provider):
        """Test parsing empty request"""
        context = AIRequestContext(requester_name="Test User", requester_cm_id=103, session_cm_id=1000002, year=2024)

        response = await provider.parse_request("", context)

        assert len(response.requests) == 0
        assert response.confidence == 0.0

    @pytest.mark.asyncio
    async def test_batch_parse(self, provider):
        """Test batch parsing"""
        requests = [
            ("Bunk with Mike", AIRequestContext("John", 100, 1000002, 2024)),
            ("Not with Tom", AIRequestContext("Jane", 101, 1000002, 2024)),
            ("", AIRequestContext("Empty", 102, 1000002, 2024)),
        ]

        responses = await provider.batch_parse_requests(requests)

        assert len(responses) == 3
        assert len(responses[0].requests) == 1
        assert len(responses[1].requests) == 1
        assert len(responses[2].requests) == 0

    def test_token_usage(self, provider):
        """Test token usage tracking"""
        usage = provider.get_token_usage()

        assert usage.prompt_tokens == 0
        assert usage.completion_tokens == 0
        assert usage.total_cost == 0.0

    @pytest.mark.asyncio
    async def test_health_check(self, provider):
        """Test health check"""
        is_healthy = await provider.health_check()
        assert is_healthy is True


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

"""Test-Driven Development for AI Service Wrapper

Tests the AI service abstraction for request parsing."""

import asyncio
import sys
from pathlib import Path
from unittest.mock import AsyncMock, Mock

import pytest

# Add the parent directory to the path
test_dir = Path(__file__).resolve().parent
project_root = test_dir.parent.parent.parent.parent
sys.path.insert(0, str(project_root))

from bunking.sync.bunk_request_processor.core.models import (
    ParsedRequest,
    RequestSource,
    RequestType,
)
from bunking.sync.bunk_request_processor.integration.ai_service import (
    AIProvider,
    AIRequestContext,
    AIService,
    AIServiceConfig,
    ParsedResponse,
    TokenUsage,
)


class TestAIService:
    """Test the AI Service wrapper"""

    @pytest.fixture
    def mock_provider(self):
        """Create a mock AI provider"""
        provider = Mock(spec=AIProvider)
        provider.name = "mock_provider"
        provider.parse_request = AsyncMock()
        provider.batch_parse_requests = AsyncMock()
        provider.get_token_usage = Mock(
            return_value=TokenUsage(prompt_tokens=100, completion_tokens=50, total_cost=0.01)
        )
        return provider

    @pytest.fixture
    def config(self):
        """Create AI service config"""
        return AIServiceConfig(
            provider="mock",
            model="test-model",
            max_retries=3,
            timeout=30,
            cache_responses=True,
            batch_size=10,
            max_concurrent_requests=5,
        )

    @pytest.fixture
    def ai_service(self, mock_provider, config):
        """Create AI service with mock provider"""
        service = AIService(config)
        service._provider = mock_provider
        return service

    @pytest.mark.asyncio
    async def test_parse_single_request(self, ai_service, mock_provider):
        """Test parsing a single request"""
        # Setup mock response
        mock_response = ParsedResponse(
            requests=[
                ParsedRequest(
                    raw_text="I want to bunk with Mike",
                    request_type=RequestType.BUNK_WITH,
                    target_name="Mike Johnson",
                    age_preference=None,
                    source_field="parent",
                    source=RequestSource.FAMILY,
                    confidence=0.95,
                    csv_position=0,
                    metadata={},
                    notes=None,
                )
            ],
            confidence=0.95,
            metadata={"parser_version": "1.0"},
        )
        mock_provider.parse_request.return_value = mock_response

        # Create context
        context = AIRequestContext(requester_name="John Smith", requester_cm_id=100, session_cm_id=1000002, year=2024)

        # Parse request
        result = await ai_service.parse_request(request_text="I want to bunk with Mike", context=context)

        # Verify
        assert result == mock_response
        mock_provider.parse_request.assert_called_once_with("I want to bunk with Mike", context)

    @pytest.mark.asyncio
    async def test_parse_request_with_retry(self, ai_service, mock_provider):
        """Test retry logic on transient failures"""
        # First two calls fail, third succeeds
        mock_provider.parse_request.side_effect = [
            Exception("Temporary failure"),
            Exception("Another temporary failure"),
            ParsedResponse(requests=[], confidence=0.0),
        ]

        context = AIRequestContext(requester_name="Test User", requester_cm_id=100, session_cm_id=1000002, year=2024)

        # Should succeed after retries
        result = await ai_service.parse_request("test", context)

        assert result.requests == []
        assert mock_provider.parse_request.call_count == 3

    @pytest.mark.asyncio
    async def test_parse_request_cache(self, ai_service, mock_provider):
        """Test response caching"""
        mock_response = ParsedResponse(
            requests=[
                ParsedRequest(
                    raw_text="bunk with Friend",
                    request_type=RequestType.BUNK_WITH,
                    target_name="Friend",
                    age_preference=None,
                    source_field="parent",
                    source=RequestSource.FAMILY,
                    confidence=0.9,
                    csv_position=0,
                    metadata={},
                )
            ],
            confidence=0.9,
        )
        mock_provider.parse_request.return_value = mock_response

        context = AIRequestContext(requester_name="Test", requester_cm_id=100, session_cm_id=1000002, year=2024)

        # Parse same request twice
        result1 = await ai_service.parse_request("bunk with Friend", context)
        result2 = await ai_service.parse_request("bunk with Friend", context)

        # Should only call provider once due to caching
        assert mock_provider.parse_request.call_count == 1
        assert result1 == result2

    @pytest.mark.asyncio
    async def test_batch_parse_requests(self, ai_service, mock_provider):
        """Test batch request parsing"""
        # Create batch of requests
        requests = [
            ("I want to bunk with Mike", AIRequestContext("John", 100, 1000002, 2024)),
            ("No bunking with Tom", AIRequestContext("Jane", 101, 1000002, 2024)),
            ("Put me with Sarah and Emma", AIRequestContext("Alice", 102, 1000002, 2024)),
        ]

        # Mock batch response
        mock_provider.batch_parse_requests.return_value = [
            ParsedResponse(
                requests=[
                    ParsedRequest(
                        raw_text="I want to bunk with Mike",
                        request_type=RequestType.BUNK_WITH,
                        target_name="Mike Johnson",
                        age_preference=None,
                        source_field="parent",
                        source=RequestSource.FAMILY,
                        confidence=0.95,
                        csv_position=0,
                        metadata={},
                    )
                ],
                confidence=0.95,
            ),
            ParsedResponse(
                requests=[
                    ParsedRequest(
                        raw_text="No bunking with Tom",
                        request_type=RequestType.NOT_BUNK_WITH,
                        target_name="Tom Smith",
                        age_preference=None,
                        source_field="parent",
                        source=RequestSource.FAMILY,
                        confidence=0.90,
                        csv_position=0,
                        metadata={},
                    )
                ],
                confidence=0.90,
            ),
            ParsedResponse(
                requests=[
                    ParsedRequest(
                        raw_text="Put me with Sarah and Emma",
                        request_type=RequestType.BUNK_WITH,
                        target_name="Sarah Wilson",
                        age_preference=None,
                        source_field="parent",
                        source=RequestSource.FAMILY,
                        confidence=0.85,
                        csv_position=0,
                        metadata={},
                    ),
                    ParsedRequest(
                        raw_text="Put me with Sarah and Emma",
                        request_type=RequestType.BUNK_WITH,
                        target_name="Emma Davis",
                        age_preference=None,
                        source_field="parent",
                        source=RequestSource.FAMILY,
                        confidence=0.85,
                        csv_position=1,
                        metadata={},
                    ),
                ],
                confidence=0.85,
            ),
        ]

        # Process batch
        results = await ai_service.batch_parse_requests(requests)

        assert len(results) == 3
        assert results[0].requests[0].target_name == "Mike Johnson"
        assert results[1].requests[0].request_type == RequestType.NOT_BUNK_WITH
        assert len(results[2].requests) == 2  # Two separate requests for Sarah and Emma

    @pytest.mark.asyncio
    async def test_batch_with_progress_callback(self, ai_service, mock_provider):
        """Test batch processing with progress tracking"""
        progress_updates = []

        def progress_callback(completed: int, total: int, message: str) -> None:
            progress_updates.append((completed, total, message))

        # Setup requests
        requests = [
            ("Request 1", AIRequestContext("User1", 100, 1000002, 2024)),
            ("Request 2", AIRequestContext("User2", 101, 1000002, 2024)),
        ]

        mock_provider.batch_parse_requests.return_value = [
            ParsedResponse(requests=[], confidence=0.9),
            ParsedResponse(requests=[], confidence=0.9),
        ]

        # Process with callback
        await ai_service.batch_parse_requests(requests, progress_callback=progress_callback)

        # Should have progress updates
        assert len(progress_updates) > 0
        assert progress_updates[-1][0] == 2  # Completed count
        assert progress_updates[-1][1] == 2  # Total count

    @pytest.mark.asyncio
    async def test_concurrent_batch_processing(self, ai_service, mock_provider, config):
        """Test concurrent request limiting"""
        # Create more requests than max concurrent
        requests = [(f"Request {i}", AIRequestContext(f"User{i}", 100 + i, 1000002, 2024)) for i in range(20)]

        # Track concurrent calls
        concurrent_calls = []
        call_count = 0

        async def mock_batch_parse(batch):
            nonlocal call_count
            call_count += 1
            concurrent_calls.append(call_count)
            await asyncio.sleep(0.1)  # Simulate processing time
            return [ParsedResponse(requests=[], confidence=0.9) for _ in batch]

        mock_provider.batch_parse_requests.side_effect = mock_batch_parse

        # Process
        results = await ai_service.batch_parse_requests(requests)

        assert len(results) == 20
        # Should respect batch size and concurrency limits
        assert mock_provider.batch_parse_requests.call_count <= 5  # Max concurrent

    def test_get_token_usage(self, ai_service, mock_provider):
        """Test token usage tracking"""
        usage = ai_service.get_token_usage()

        assert usage.prompt_tokens == 100
        assert usage.completion_tokens == 50
        assert usage.total_cost == 0.01

    @pytest.mark.asyncio
    async def test_empty_request_handling(self, ai_service, mock_provider):
        """Test handling of empty requests"""
        context = AIRequestContext("User", 100, 1000002, 2024)

        # Empty request should return empty result
        result = await ai_service.parse_request("", context)

        assert result.requests == []
        assert result.confidence == 0.0
        # Should not call provider for empty requests
        mock_provider.parse_request.assert_not_called()

    @pytest.mark.asyncio
    async def test_request_sanitization(self, ai_service, mock_provider):
        """Test that requests are sanitized before processing"""
        mock_provider.parse_request.return_value = ParsedResponse(requests=[], confidence=0.9)

        context = AIRequestContext("User", 100, 1000002, 2024)

        # Request with extra whitespace and special characters
        await ai_service.parse_request("  I want to bunk\nwith Mike!!!  ", context)

        # Should sanitize before calling provider
        call_args = mock_provider.parse_request.call_args[0][0]
        assert call_args == "I want to bunk with Mike!!!"

    def test_config_validation(self):
        """Test configuration validation"""
        # Invalid config should raise error
        with pytest.raises(ValueError):
            AIServiceConfig(
                provider="invalid",
                model="test",
                max_retries=-1,  # Invalid
                timeout=30,
            )

        # Valid config should work
        config = AIServiceConfig(provider="openai", model="gpt-4", max_retries=3, timeout=60)
        assert config.provider == "openai"

    @pytest.mark.asyncio
    async def test_provider_health_check(self, ai_service, mock_provider):
        """Test provider health checking"""
        mock_provider.health_check = AsyncMock(return_value=True)

        is_healthy = await ai_service.check_health()

        assert is_healthy is True
        mock_provider.health_check.assert_called_once()


class TestAIProvider:
    """Test the abstract AI provider interface"""

    def test_provider_interface(self):
        """Test that provider interface is properly defined"""

        # Create a minimal concrete implementation
        class TestProvider(AIProvider):
            @property
            def name(self) -> str:
                return "test"

            async def parse_request(self, request_text: str, context: AIRequestContext) -> ParsedResponse:
                raise NotImplementedError

            async def batch_parse_requests(self, requests: list[tuple[str, AIRequestContext]]) -> list[ParsedResponse]:
                raise NotImplementedError

            def get_token_usage(self) -> TokenUsage:
                raise NotImplementedError

            async def health_check(self) -> bool:
                raise NotImplementedError

        provider = TestProvider()

        # Should have required methods
        assert hasattr(provider, "parse_request")
        assert hasattr(provider, "batch_parse_requests")
        assert hasattr(provider, "get_token_usage")
        assert hasattr(provider, "health_check")
        assert hasattr(provider, "name")

        # Abstract methods should raise NotImplementedError
        with pytest.raises(NotImplementedError):
            asyncio.run(provider.parse_request("test", Mock()))


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

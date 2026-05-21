"""Tests for AI prompt/response logging levels — content must be at TRACE, not DEBUG.

Verifies fix for #815: AI prompt and response text floods DEBUG logs (~50k lines per run).
After the fix, full AI content is at TRACE (level 5), with summaries at DEBUG.

Affected module: openai_provider.py
"""

import logging
from unittest.mock import AsyncMock, patch

import pytest

from bunking.logging_config import TRACE
from bunking.sync.bunk_request_processor.integration.ai_schemas import (
    AIBunkRequestItem,
    AIParseResponse,
)
from bunking.sync.bunk_request_processor.integration.ai_types import AIRequestContext
from bunking.sync.bunk_request_processor.integration.openai_provider import OpenAIProvider


def _make_context() -> AIRequestContext:
    """Create a minimal AIRequestContext for testing."""
    return AIRequestContext(
        requester_name="Liam Garcia",
        requester_cm_id=1001,
        session_cm_id=5001,
        year=2025,
        additional_context={"field_type": "bunking_notes"},
    )


class TestTraceLevel:
    """Verify TRACE level is properly registered and below DEBUG."""

    def test_trace_level_value(self):
        """TRACE level should be 5."""
        assert TRACE == 5

    def test_trace_level_name(self):
        """TRACE level name should be registered."""
        assert logging.getLevelName(TRACE) == "TRACE"

    def test_trace_below_debug(self):
        """TRACE (5) should be below DEBUG (10)."""
        assert TRACE < logging.DEBUG


class TestAIPromptLogging:
    """AI prompt text must appear at TRACE, not DEBUG or INFO."""

    @pytest.mark.asyncio
    async def test_prompt_logged_at_trace_not_debug(self, caplog):
        """AI prompt content should appear at TRACE level only."""
        provider = OpenAIProvider(api_key="test-key", model="gpt-test")

        ai_response = AIParseResponse(
            requests=[
                AIBunkRequestItem(
                    request_type="bunk_with",
                    target_name="Emma Johnson",
                    source_field="bunking_notes",
                )
            ]
        )

        with (
            patch.object(
                provider,
                "_call_with_structured_output",
                new_callable=AsyncMock,
                return_value=(ai_response, None),
            ),
            caplog.at_level(TRACE),
        ):
            await provider.parse_request("bunk with Emma Johnson", _make_context())

        # TRACE should contain the prompt text
        trace_messages = [r.message for r in caplog.records if r.levelno == TRACE]
        assert any("AI prompt" in msg for msg in trace_messages), (
            f"Expected 'AI prompt' in TRACE messages, got: {trace_messages}"
        )

        # DEBUG should NOT contain prompt text
        debug_messages = [r.message for r in caplog.records if r.levelno == logging.DEBUG]
        assert not any("AI prompt" in msg for msg in debug_messages), (
            f"'AI prompt' should NOT appear in DEBUG, got: {debug_messages}"
        )


class TestAIResponseLogging:
    """AI response text must appear at TRACE, with summary at DEBUG."""

    @pytest.mark.asyncio
    async def test_response_logged_at_trace_not_info(self, caplog):
        """Full AI response should appear at TRACE, not INFO."""
        provider = OpenAIProvider(api_key="test-key", model="gpt-test")

        ai_response = AIParseResponse(
            requests=[
                AIBunkRequestItem(
                    request_type="bunk_with",
                    target_name="Olivia Chen",
                    source_field="bunking_notes",
                ),
                AIBunkRequestItem(
                    request_type="not_bunk_with",
                    target_name="Noah Williams",
                    source_field="bunking_notes",
                ),
            ]
        )

        with (
            patch.object(
                provider,
                "_call_with_structured_output",
                new_callable=AsyncMock,
                return_value=(ai_response, None),
            ),
            caplog.at_level(TRACE),
        ):
            await provider.parse_request("bunk with Olivia not Noah", _make_context())

        trace_messages = [r.message for r in caplog.records if r.levelno == TRACE]
        info_messages = [r.message for r in caplog.records if r.levelno == logging.INFO]

        # TRACE should contain full response
        assert any("AI response" in msg for msg in trace_messages), (
            f"Expected 'AI response' in TRACE messages, got: {trace_messages}"
        )

        # INFO should NOT contain response dump
        assert not any("AI response" in msg for msg in info_messages), (
            f"'AI response' should NOT appear in INFO, got: {info_messages}"
        )

    @pytest.mark.asyncio
    async def test_debug_summary_with_target_count(self, caplog):
        """DEBUG should contain a summary with target count."""
        provider = OpenAIProvider(api_key="test-key", model="gpt-test")

        ai_response = AIParseResponse(
            requests=[
                AIBunkRequestItem(
                    request_type="bunk_with",
                    target_name="Olivia Chen",
                    source_field="bunking_notes",
                ),
                AIBunkRequestItem(
                    request_type="not_bunk_with",
                    target_name="Noah Williams",
                    source_field="bunking_notes",
                ),
            ]
        )

        with (
            patch.object(
                provider,
                "_call_with_structured_output",
                new_callable=AsyncMock,
                return_value=(ai_response, None),
            ),
            caplog.at_level(TRACE),
        ):
            await provider.parse_request("bunk with Olivia not Noah", _make_context())

        debug_messages = [r.message for r in caplog.records if r.levelno == logging.DEBUG]

        # DEBUG should have a summary with the count of parsed targets
        assert any("2" in msg and "target" in msg for msg in debug_messages), (
            f"Expected summary with '2' targets in DEBUG, got: {debug_messages}"
        )

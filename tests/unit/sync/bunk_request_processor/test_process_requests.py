"""Tests for process_requests.py entry point

Tests cover:
1. Configuration loading from environment
2. Main processing function behavior
3. Dry run mode
4. Error handling
"""

from __future__ import annotations

import os
from unittest.mock import AsyncMock, Mock, patch

import pytest


class TestLoadConfiguration:
    """Tests for load_configuration()"""

    def test_load_configuration_with_valid_env_vars(self):
        """Should load all config values from environment"""
        from bunking.sync.bunk_request_processor.process_requests import (
            load_configuration,
        )

        env_vars = {
            "POCKETBASE_URL": "http://test:8090",
            "POCKETBASE_ADMIN_EMAIL": "admin@test.com",
            "POCKETBASE_ADMIN_PASSWORD": "testpass",
            "AI_PROVIDER": "anthropic",
            "AI_API_KEY": "test-key",
            "AI_MODEL": "claude-3",
            "CURRENT_YEAR": "2026",
        }

        with patch.dict(os.environ, env_vars, clear=True):
            config = load_configuration()

        assert config["pb_url"] == "http://test:8090"
        assert config["pb_email"] == "admin@test.com"
        assert config["pb_password"] == "testpass"
        assert config["ai_provider"] == "anthropic"
        assert config["ai_api_key"] == "test-key"
        assert config["ai_model"] == "claude-3"
        assert config["year"] == 2026

    def test_load_configuration_missing_required_vars_raises(self):
        """Should raise ValueError when required env vars are missing"""
        from bunking.sync.bunk_request_processor.process_requests import (
            load_configuration,
        )

        # Clear all PocketBase env vars
        env_vars = {
            "POCKETBASE_ADMIN_EMAIL": "",
            "POCKETBASE_ADMIN_PASSWORD": "",
        }

        with patch.dict(os.environ, env_vars, clear=True), pytest.raises(ValueError) as exc_info:
            load_configuration()

        assert "Missing required PocketBase credentials" in str(exc_info.value)

    def test_load_configuration_optional_vars_have_defaults(self):
        """Should use defaults for optional environment variables"""
        from bunking.sync.bunk_request_processor.process_requests import (
            load_configuration,
        )

        # Only required vars set
        env_vars = {
            "POCKETBASE_ADMIN_EMAIL": "admin@test.com",
            "POCKETBASE_ADMIN_PASSWORD": "testpass",
        }

        with patch.dict(os.environ, env_vars, clear=True):
            config = load_configuration()

        # Check defaults
        assert config["pb_url"] == "http://127.0.0.1:8090"
        assert config["ai_provider"] == "openai"
        assert config["ai_model"] == "gpt-4o-mini"
        assert config["year"] == 2025

    def test_load_configuration_missing_ai_key_logs_warning(self):
        """Should log warning when AI_API_KEY is not set"""
        from bunking.sync.bunk_request_processor.process_requests import (
            load_configuration,
        )

        env_vars = {
            "POCKETBASE_ADMIN_EMAIL": "admin@test.com",
            "POCKETBASE_ADMIN_PASSWORD": "testpass",
            "AI_API_KEY": "",
        }

        with patch.dict(os.environ, env_vars, clear=True):
            with patch("bunking.sync.bunk_request_processor.process_requests.logger") as mock_logger:
                config = load_configuration()

        mock_logger.warning.assert_called_once()
        assert "AI_API_KEY not set" in mock_logger.warning.call_args[0][0]
        assert config["ai_api_key"] is None or config["ai_api_key"] == ""


class TestProcessBunkRequests:
    """Tests for process_bunk_requests() async function"""

    @pytest.mark.asyncio
    async def test_process_bunk_requests_dry_run_does_not_mark_processed(self):
        """Dry run should not mark original_bunk_requests as processed"""
        from bunking.sync.bunk_request_processor.process_requests import (
            process_bunk_requests,
        )

        # Mock DataAccessContext
        mock_pb = Mock()
        mock_context = Mock()
        mock_context.pb_client = mock_pb

        mock_orchestrator = Mock()
        mock_orchestrator.process_requests = AsyncMock(return_value={"success": True, "statistics": {}})
        mock_orchestrator.close = AsyncMock()
        mock_orchestrator.ai_config = {"api_key": "test-key-12345678", "provider": "openai", "model": "gpt-4"}

        with (
            patch(
                "bunking.sync.bunk_request_processor.process_requests.DataAccessContext",
                return_value=mock_context,
            ),
            patch(
                "bunking.sync.bunk_request_processor.process_requests.RequestOrchestrator",
                return_value=mock_orchestrator,
            ),
            patch(
                "bunking.sync.bunk_request_processor.process_requests.load_from_database",
                new_callable=AsyncMock,
                return_value=[],
            ),
        ):
            result = await process_bunk_requests(
                data_source="database",
                year=2025,
                session_cm_ids=[1234567],
                dry_run=True,
            )

        assert result.get("dry_run") is True

    @pytest.mark.asyncio
    async def test_process_bunk_requests_returns_statistics(self):
        """Should return processing statistics from orchestrator"""
        from bunking.sync.bunk_request_processor.process_requests import (
            process_bunk_requests,
        )

        expected_stats = {
            "phase1_parsed": 10,
            "phase2_resolved": 8,
            "phase3_disambiguated": 2,
            "requests_created": 10,
        }

        mock_pb = Mock()
        mock_context = Mock()
        mock_context.pb_client = mock_pb

        mock_orchestrator = Mock()
        mock_orchestrator.process_requests = AsyncMock(return_value={"success": True, "statistics": expected_stats})
        mock_orchestrator.close = AsyncMock()
        mock_orchestrator.ai_config = {"api_key": "test-key-12345678", "provider": "openai", "model": "gpt-4"}

        with (
            patch(
                "bunking.sync.bunk_request_processor.process_requests.DataAccessContext",
                return_value=mock_context,
            ),
            patch(
                "bunking.sync.bunk_request_processor.process_requests.RequestOrchestrator",
                return_value=mock_orchestrator,
            ),
            patch(
                "bunking.sync.bunk_request_processor.process_requests.load_from_database",
                new_callable=AsyncMock,
                return_value=[],
            ),
        ):
            result = await process_bunk_requests(
                data_source="database",
                year=2025,
                session_cm_ids=[1234567],
            )

        assert result["success"] is True
        assert result["statistics"] == expected_stats

    @pytest.mark.asyncio
    async def test_process_bunk_requests_closes_orchestrator_on_success(self):
        """Should close orchestrator resources on successful completion"""
        from bunking.sync.bunk_request_processor.process_requests import (
            process_bunk_requests,
        )

        mock_pb = Mock()
        mock_context = Mock()
        mock_context.pb_client = mock_pb

        mock_orchestrator = Mock()
        mock_orchestrator.process_requests = AsyncMock(return_value={"success": True, "statistics": {}})
        mock_orchestrator.close = AsyncMock()
        mock_orchestrator.ai_config = {"api_key": "test-key-12345678", "provider": "openai", "model": "gpt-4"}

        with (
            patch(
                "bunking.sync.bunk_request_processor.process_requests.DataAccessContext",
                return_value=mock_context,
            ),
            patch(
                "bunking.sync.bunk_request_processor.process_requests.RequestOrchestrator",
                return_value=mock_orchestrator,
            ),
            patch(
                "bunking.sync.bunk_request_processor.process_requests.load_from_database",
                new_callable=AsyncMock,
                return_value=[],
            ),
        ):
            await process_bunk_requests(
                data_source="database",
                year=2025,
                session_cm_ids=[1234567],
            )

        mock_orchestrator.close.assert_called_once()

    @pytest.mark.asyncio
    async def test_process_bunk_requests_closes_orchestrator_on_error(self):
        """Should close orchestrator resources even when processing fails"""
        from bunking.sync.bunk_request_processor.process_requests import (
            process_bunk_requests,
        )

        mock_pb = Mock()
        mock_context = Mock()
        mock_context.pb_client = mock_pb

        mock_orchestrator = Mock()
        mock_orchestrator.process_requests = AsyncMock(side_effect=RuntimeError("Processing failed"))
        mock_orchestrator.close = AsyncMock()
        mock_orchestrator.ai_config = {"api_key": "test-key-12345678", "provider": "openai", "model": "gpt-4"}

        with (
            patch(
                "bunking.sync.bunk_request_processor.process_requests.DataAccessContext",
                return_value=mock_context,
            ),
            patch(
                "bunking.sync.bunk_request_processor.process_requests.RequestOrchestrator",
                return_value=mock_orchestrator,
            ),
            patch(
                "bunking.sync.bunk_request_processor.process_requests.load_from_database",
                new_callable=AsyncMock,
                return_value=[{"test": "data"}],
            ),
            pytest.raises(RuntimeError, match="Processing failed"),
        ):
            await process_bunk_requests(
                data_source="database",
                year=2025,
                session_cm_ids=[1234567],
            )

        # Orchestrator should still be closed despite the error
        mock_orchestrator.close.assert_called_once()


class TestLoadFromDatabase:
    """Tests for load_from_database() async function"""

    @pytest.mark.asyncio
    async def test_load_from_database_returns_empty_when_no_requests(self):
        """Should return empty list when no requests need processing"""
        from bunking.sync.bunk_request_processor.process_requests import (
            load_from_database,
        )

        mock_pb = Mock()
        mock_loader = Mock()
        mock_loader.load_persons_cache = Mock()
        mock_loader.count_already_processed = Mock(return_value=0)
        mock_loader.fetch_requests_needing_processing = Mock(return_value=[])

        with patch(
            "bunking.sync.bunk_request_processor.integration.original_requests_loader.OriginalRequestsLoader",
            return_value=mock_loader,
        ):
            result = await load_from_database(pb=mock_pb, year=2025, session_cm_ids=[1234567], limit=None)

        assert result == []
        mock_loader.load_persons_cache.assert_called_once()
        mock_loader.fetch_requests_needing_processing.assert_called_once()

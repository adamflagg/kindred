"""Tests for orchestrator DataAccessContext integration.

These tests verify that the orchestrator can be initialized with the new
DataAccessContext pattern while maintaining backward compatibility with
direct PocketBase client usage.
"""

from __future__ import annotations

import warnings
from unittest.mock import MagicMock, patch


class TestOrchestratorDataContextIntegration:
    """Test orchestrator accepts DataAccessContext."""

    def test_init_with_data_context_no_deprecation_warning(self):
        """Orchestrator should accept data_context without deprecation warning."""
        from bunking.sync.bunk_request_processor.data.data_access_context import (
            DataAccessContext,
        )
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        # Create mock context
        mock_context = MagicMock(spec=DataAccessContext)
        mock_context.pb_client = MagicMock()
        mock_context.year = 2025
        mock_context.persons = MagicMock()
        mock_context.attendees = MagicMock()
        mock_context.requests = MagicMock()
        mock_context.sessions = MagicMock()

        # Mock the initialization to avoid actual DB calls
        with patch.object(RequestOrchestrator, "_initialize_components"):
            with warnings.catch_warnings(record=True) as w:
                warnings.simplefilter("always")

                _orchestrator = RequestOrchestrator(
                    year=2025,
                    data_context=mock_context,
                )

                # Should not emit deprecation warning for data_context usage
                assert _orchestrator is not None  # Verify instantiation
                deprecation_warnings = [
                    warning
                    for warning in w
                    if issubclass(warning.category, DeprecationWarning) and "pb" in str(warning.message).lower()
                ]
                assert len(deprecation_warnings) == 0

    def test_init_with_pb_emits_deprecation_warning(self):
        """Using pb parameter should emit deprecation warning."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        mock_pb = MagicMock()

        # Mock the initialization to avoid actual DB calls
        with patch.object(RequestOrchestrator, "_initialize_components"):
            with warnings.catch_warnings(record=True) as w:
                warnings.simplefilter("always")

                _orchestrator = RequestOrchestrator(
                    pb=mock_pb,
                    year=2025,
                )

                # Should emit deprecation warning for pb usage
                assert _orchestrator is not None  # Verify instantiation
                deprecation_warnings = [
                    warning
                    for warning in w
                    if issubclass(warning.category, DeprecationWarning) and "pb" in str(warning.message).lower()
                ]
                assert len(deprecation_warnings) == 1
                assert "data_context" in str(deprecation_warnings[0].message).lower()

    def test_data_context_provides_repositories(self):
        """DataAccessContext should provide repository access."""
        from bunking.sync.bunk_request_processor.data.data_access_context import (
            DataAccessContext,
        )
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        mock_context = MagicMock(spec=DataAccessContext)
        mock_context.pb_client = MagicMock()
        mock_context.year = 2025
        mock_person_repo = MagicMock()
        mock_attendee_repo = MagicMock()
        mock_context.persons = mock_person_repo
        mock_context.attendees = mock_attendee_repo
        mock_context.requests = MagicMock()
        mock_context.sessions = MagicMock()

        with patch.object(RequestOrchestrator, "_initialize_components"):
            orchestrator = RequestOrchestrator(
                year=2025,
                data_context=mock_context,
            )

            # Verify context is stored
            assert orchestrator._data_context is mock_context

    def test_backwards_compatible_with_pb_only(self):
        """Should still work with just pb parameter (backwards compat)."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        mock_pb = MagicMock()

        with patch.object(RequestOrchestrator, "_initialize_components"), warnings.catch_warnings():
            warnings.simplefilter("ignore", DeprecationWarning)

            orchestrator = RequestOrchestrator(
                pb=mock_pb,
                year=2025,
            )

            # Should have pb stored for backwards compat
            assert orchestrator.pb is mock_pb


class TestOrchestratorConfigLoader:
    """Test orchestrator uses ConfigLoader."""

    def test_uses_config_loader_when_no_ai_config_provided(self):
        """Should use ConfigLoader when ai_config not provided."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        mock_pb = MagicMock()

        with (
            patch.object(RequestOrchestrator, "_initialize_components"),
            patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.ConfigLoader") as MockConfigLoader,
        ):
            mock_loader = MagicMock()
            mock_loader.get_ai_config.return_value = {
                "provider": "openai",
                "model": "gpt-4o-mini",
                "confidence_thresholds": {"valid": 0.85},
            }
            MockConfigLoader.get_instance.return_value = mock_loader

            with warnings.catch_warnings():
                warnings.simplefilter("ignore", DeprecationWarning)

                _orchestrator = RequestOrchestrator(
                    pb=mock_pb,
                    year=2025,
                )

                assert _orchestrator is not None  # Verify instantiation
                # Verify ConfigLoader was used
                MockConfigLoader.get_instance.assert_called()

    def test_uses_provided_ai_config_over_config_loader(self):
        """Should use provided ai_config instead of ConfigLoader."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        mock_pb = MagicMock()
        custom_config = {"provider": "anthropic", "model": "claude-3-haiku", "api_key": "test-key"}

        with patch.object(RequestOrchestrator, "_initialize_components"), warnings.catch_warnings():
            warnings.simplefilter("ignore", DeprecationWarning)

            orchestrator = RequestOrchestrator(
                pb=mock_pb,
                year=2025,
                ai_config=custom_config,
            )

            # Should use the provided config
            assert orchestrator.ai_config["provider"] == "anthropic"
            assert orchestrator.ai_config["model"] == "claude-3-haiku"

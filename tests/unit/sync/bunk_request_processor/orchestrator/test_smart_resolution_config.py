"""Tests for smart resolution config flag behavior.

Verifies that the orchestrator respects the smart_local_resolution.enabled
config setting, matching monolith behavior."""

from __future__ import annotations

from typing import Any


class TestSmartResolutionEnabled:
    """Test _is_smart_resolution_enabled config check."""

    def test_enabled_when_config_true(self):
        """When smart_local_resolution.enabled is true, returns True."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        config = {"smart_local_resolution": {"enabled": True}}
        # Test the helper method directly
        result = RequestOrchestrator._is_smart_resolution_enabled(config)
        assert result is True

    def test_disabled_when_config_false(self):
        """When smart_local_resolution.enabled is false, returns False."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        config = {"smart_local_resolution": {"enabled": False}}
        result = RequestOrchestrator._is_smart_resolution_enabled(config)
        assert result is False

    def test_enabled_by_default_when_missing(self):
        """When smart_local_resolution config is missing, defaults to True."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        config: dict[str, Any] = {}
        result = RequestOrchestrator._is_smart_resolution_enabled(config)
        assert result is True

    def test_enabled_by_default_when_enabled_key_missing(self):
        """When enabled key is missing but section exists, defaults to True."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        config = {"smart_local_resolution": {"other_setting": 5}}
        result = RequestOrchestrator._is_smart_resolution_enabled(config)
        assert result is True

    def test_handles_none_config(self):
        """When config is None, defaults to True."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        result = RequestOrchestrator._is_smart_resolution_enabled(None)
        assert result is True

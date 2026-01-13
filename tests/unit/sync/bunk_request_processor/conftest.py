"""Shared fixtures for orchestrator tests.

Auto-mocks ProviderFactory and ConfigLoader to avoid external dependencies in unit tests.
"""

from __future__ import annotations

from unittest.mock import Mock, patch

import pytest


@pytest.fixture(autouse=True)
def mock_provider_factory():
    """Auto-mock ProviderFactory to avoid API key requirement in unit tests.

    The orchestrator tries to create an AI provider on init, which fails
    without an API key. This fixture mocks the factory so tests can focus
    on orchestrator logic without real AI dependencies.
    """
    with patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.ProviderFactory") as factory:
        mock_provider = Mock()
        factory.return_value.create.return_value = mock_provider
        yield factory


@pytest.fixture(autouse=True)
def mock_config_loader():
    """Auto-mock ConfigLoader to provide default config values without PocketBase.

    The orchestrator creates ConfigLoader() directly in _init_spread_filter
    (line 637) which tries to connect to PocketBase. We mock the source module
    to intercept this. Default values match migration 1500000014.
    """
    mock_loader = Mock()
    # Default values matching migrations
    mock_loader.get_int.side_effect = lambda key, default=None: {
        "spread.max_grade": 2,
        "spread.max_age_months": 24,
    }.get(key, default if default is not None else 0)
    mock_loader.get_bool.side_effect = lambda key, default=None: {
        "spread_validation.enabled": True,
    }.get(key, default if default is not None else False)

    # Patch at the source module level - used by `from bunking.config.loader import ConfigLoader`
    with patch("bunking.config.loader.ConfigLoader", return_value=mock_loader):
        yield mock_loader

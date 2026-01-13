"""
Root test configuration and fixtures for the bunking project.

This conftest.py provides common fixtures for all test categories:
- unit/: Fast, isolated unit tests
- integration/: Tests requiring external services
- e2e/: End-to-end tests
- performance/: Load and performance tests

Note: sys.path manipulation is handled here to ensure imports work correctly.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from unittest.mock import Mock, patch

import pytest

# Add project root to path to allow imports
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))


def create_mock_pocketbase():
    """Create a comprehensive mock PocketBase instance."""
    mock_pb = Mock()

    # Collection mock with chaining support
    mock_collection = Mock()

    # Collection auth (for _superusers collection)
    mock_collection.auth_with_password = Mock(return_value=True)

    # Mock list response
    mock_list_response = Mock()
    mock_list_response.items = []
    mock_list_response.total_items = 0
    mock_list_response.total_pages = 1
    mock_list_response.page = 1
    mock_list_response.per_page = 30

    # Collection methods
    mock_collection.get_full_list = Mock(return_value=[])
    mock_collection.get_list = Mock(return_value=mock_list_response)
    mock_collection.get_one = Mock()

    # Make get_first_list_item return a mock record
    mock_record = Mock()
    mock_record.id = "mock-config-id"
    mock_record.config_value = "100"
    mock_record.category = "test"
    mock_record.config_key = "test"

    mock_collection.get_first_list_item = Mock(return_value=mock_record)
    mock_collection.create = Mock(return_value=Mock(id="mock-id"))
    mock_collection.update = Mock()
    mock_collection.delete = Mock()

    # Make collection callable to return itself for chaining
    mock_pb.collection = Mock(return_value=mock_collection)

    # Auth store
    mock_pb.auth_store = Mock()
    mock_pb.auth_store.base_token = "mock-token"
    mock_pb.auth_store.base_model = Mock()

    return mock_pb


@pytest.fixture
def mock_pocketbase():
    """Create a mock PocketBase instance for tests that need it."""
    return create_mock_pocketbase()


@pytest.fixture(autouse=True)
def mock_all_external_services():
    """Automatically mock all external services to prevent real connections.

    This fixture is applied to all tests to ensure isolation from external
    services like PocketBase, unless explicitly disabled.
    """
    # Skip mocking for integration tests that explicitly need real connections
    if os.environ.get("SKIP_MOCKING") == "true":
        yield {}
        return

    mock_pb = create_mock_pocketbase()

    with patch("pocketbase.PocketBase") as mock_pb_class, patch("pocketbase.Client") as mock_client_class:
        # All return the same mock instance
        mock_pb_class.return_value = mock_pb
        mock_client_class.return_value = mock_pb

        # Try to patch config service if it exists
        try:
            with patch("scripts.services.config_service.PocketBase") as mock_config_pb:
                mock_config_pb.return_value = mock_pb
                yield {"pocketbase": mock_pb}
        except (ImportError, ModuleNotFoundError, AttributeError):
            yield {"pocketbase": mock_pb}


@pytest.fixture
def mock_auth_middleware():
    """Mock the auth middleware to bypass authentication in tests."""
    with patch("bunking.auth_middleware_asgi.OIDCAuthMiddleware") as mock_middleware_class:
        mock_middleware_class.side_effect = lambda app, **kwargs: app
        yield mock_middleware_class


@pytest.fixture
def sample_camper_data():
    """Sample camper data for solver tests."""
    return {
        "id": "test-camper-1",
        "cm_id": 12345,
        "name": "Test Camper",
        "preferred_name": "Testy",
        "gender": "M",
        "grade": 5,
        "age_months": 132,  # 11 years
    }


@pytest.fixture
def sample_bunk_data():
    """Sample bunk data for solver tests."""
    return {
        "id": "test-bunk-1",
        "cm_id": 1001,
        "name": "B-1",
        "gender": "M",
        "capacity": 12,
    }


@pytest.fixture
def sample_session_data():
    """Sample session data for tests."""
    return {
        "id": "test-session-1",
        "cm_id": 2001,
        "name": "Session 1",
        "session_type": "main",
        "year": 2025,
    }


# =============================================================================
# Configuration Fixtures
# =============================================================================

# Default test configuration values matching database schema
TEST_CONFIG = {
    # Spread validation
    "spread.max_grade": 2,
    "spread.max_age_months": 24,
    # Solver constraints
    "constraint.grade_ratio.max_percentage": 67,
    "constraint.grade_ratio.penalty": 1000,
    "constraint.age_spread.penalty": 1500,
    "constraint.must_satisfy_one.enabled": 1,
    "constraint.must_satisfy_one.fallback_to_age": 1,
    "constraint.must_satisfy_one.ignore_impossible_requests": 1,
    "constraint.level_progression.no_regression": 1,
    "constraint.level_progression.no_regression_penalty": 800,
    "constraint.cabin_capacity.max": 14,
    "constraint.cabin_capacity.standard": 12,
    "constraint.cabin_capacity.mode": "hard",
    "constraint.cabin_capacity.penalty": 3000,
    "constraint.age_grade_flow.weight": 10,
    "constraint.grade_cohesion.weight": 5,
    "constraint.grade_spread.mode": "soft",
    "constraint.grade_spread.penalty": 3000,
    # Objective function weights
    "objective.source_multipliers.share_bunk_with": 1.5,
    "objective.source_multipliers.do_not_share_with": 1.5,
    "objective.source_multipliers.bunking_notes": 1.0,
    "objective.source_multipliers.internal_notes": 0.8,
    "objective.source_multipliers.socialize_preference": 0.6,
    "objective.enable_diminishing_returns": 1,
    "objective.first_request_multiplier": 10,
    "objective.second_request_multiplier": 5,
    "objective.third_plus_request_multiplier": 1,
    # Solver settings
    "solver.auto_apply_enabled": 1,
    "solver.auto_apply_timeout": 0,
    "solver.time_limit.seconds": 30,
    # Smart local resolution
    "smart_local_resolution.enabled": 1,
    "smart_local_resolution.significant_connection_threshold": 5,
    "smart_local_resolution.min_connections_for_auto_resolve": 3,
    "smart_local_resolution.connection_score_weight": 0.7,
    "smart_local_resolution.min_confidence_for_auto_resolve": 0.85,
    "smart_local_resolution.mutual_request_bonus": 10,
    "smart_local_resolution.common_friends_weight": 1.0,
    "smart_local_resolution.historical_bunking_weight": 0.8,
}


class MockConfigLoader:
    """Mock ConfigLoader for testing without database access."""

    def __init__(self, config: dict[str, object] | None = None):
        self._config = config or TEST_CONFIG

    def get(self, key: str) -> object:
        return self._config.get(key)

    def get_int(self, key: str, default: int = 0) -> int:
        value = self._config.get(key)
        if value is not None and isinstance(value, (int, float, str)):
            return int(value)
        return default

    def get_float(self, key: str, default: float = 0.0) -> float:
        value = self._config.get(key)
        if value is not None and isinstance(value, (int, float, str)):
            return float(value)
        return default

    def get_bool(self, key: str, default: bool = False) -> bool:
        value = self._config.get(key)
        if value is None:
            return default
        if isinstance(value, bool):
            return value
        return str(value).lower() in ("true", "1", "yes", "on")

    def get_str(self, key: str, default: str = "") -> str:
        value = self._config.get(key)
        return str(value) if value is not None else default

    def get_priority(self, priority_type: str, subtype: str = "default") -> int:
        return self.get_int(f"priority.{priority_type}.{subtype}", default=5)

    def get_constraint(self, constraint_type: str, param: str) -> int:
        return self.get_int(f"constraint.{constraint_type}.{param}", default=10)

    def get_solver_param(self, param_type: str, subtype: str) -> int:
        return self.get_int(f"solver.{param_type}.{subtype}", default=30)

    def get_soft_constraint_weight(self, constraint_name: str, default: int = 100) -> int:
        weight_mappings = {
            # level_progression removed - uses no_regression_penalty, not progression_weight
            "age_grade_flow": "constraint.age_grade_flow.weight",
            "grade_cohesion": "constraint.grade_cohesion.weight",
            "grade_spread": "constraint.grade_spread.penalty",
            "age_spread": "constraint.age_spread.penalty",
        }
        key = weight_mappings.get(constraint_name, f"constraint.{constraint_name}.weight")
        return self.get_int(key, default)

    def get_ai_config(self) -> dict[str, object]:
        return {
            "provider": "openai",
            "model": "gpt-4o-mini",
            "api_key": "test-key",
            "temperature": 0.1,
            "max_tokens": 2000,
            "batch_processing": {"enabled": True, "batch_size": 10},
        }

    def clear_cache(self) -> None:
        pass

    def reload(self) -> None:
        pass


@pytest.fixture
def mock_config():
    """
    Provide a mock ConfigLoader for tests that don't need database access.

    Usage:
        def test_something(mock_config):
            # mock_config is already active via context manager
            from bunking.config import ConfigLoader
            config = ConfigLoader.get_instance()
            assert config.get_int("solver.time_limit.seconds") == 30
    """
    from bunking.config import ConfigLoader

    mock_loader = MockConfigLoader()
    with ConfigLoader.use(mock_loader):  # type: ignore[arg-type]
        yield mock_loader


@pytest.fixture(autouse=True)
def reset_config_singleton():
    """Reset ConfigLoader singleton between tests."""
    yield
    # Reset after each test to prevent state leakage
    try:
        from bunking.config import ConfigLoader

        ConfigLoader.reset()
    except ImportError:
        pass

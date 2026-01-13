# mypy: ignore-errors
# NOTE: This test file validates imports and may reference modules that
# don't exist in all environments (solver_service_v2, scripts.sync.base_sync).
"""Test that all critical modules can be imported successfully"""

import importlib
import sys
from pathlib import Path
from unittest.mock import Mock, patch

import pytest


class TestModuleImports:
    """Test that all critical modules can be imported successfully"""

    @pytest.fixture(autouse=True)
    def setup_path(self):
        """Ensure project root is in path"""
        project_root = Path(__file__).resolve().parent.parent.parent
        if str(project_root) not in sys.path:
            sys.path.insert(0, str(project_root))

    @pytest.fixture
    def mock_external_deps(self):
        """Mock external dependencies that might not be available in test env"""
        with (
            patch("pocketbase.Client", Mock),
            patch("campminder.client.CampMinderClient", Mock),
            patch("campminder.client.load_config_from_file", Mock(return_value=Mock())),
        ):
            yield

    def test_import_sync_base_modules(self, mock_external_deps):
        """Test base sync modules can be imported"""
        base_modules = [
            "scripts.sync.sync_logging",
            "scripts.sync.base_sync",
        ]

        for module_name in base_modules:
            try:
                # Clear from cache to force reimport
                if module_name in sys.modules:
                    del sys.modules[module_name]
                importlib.import_module(module_name)
            except ImportError as e:
                pytest.fail(f"Failed to import {module_name}: {e}")

    def test_import_sync_layer_modules(self, mock_external_deps):
        """Test all sync layer modules can be imported"""
        sync_modules = [
            "scripts.sync.sync_01_camp_sessions",
            "scripts.sync.sync_01_persons",
            "scripts.sync.sync_01_divisions",
            "scripts.sync.sync_02_bunks",
            "scripts.sync.sync_03_attendees",
            "scripts.sync.sync_03_bunk_plans",
            "scripts.sync.sync_04_bunk_assignments",
            "scripts.sync.sync_bunk_requests",
            "scripts.sync.sync_all_layers",
        ]

        for module_name in sync_modules:
            try:
                # Clear from cache to force reimport
                if module_name in sys.modules:
                    del sys.modules[module_name]
                importlib.import_module(module_name)
            except ImportError as e:
                pytest.fail(f"Failed to import {module_name}: {e}")

    def test_import_bunking_modules(self):
        """Test all bunking modules can be imported"""
        bunking_modules = [
            "bunking.models",
            "bunking.models_v2",
            "bunking.direct_solver",
            "bunking.bunking_validator",
            "bunking.jwt_auth",
            "bunking.pb_auth",
        ]

        for module_name in bunking_modules:
            try:
                # Clear from cache to force reimport
                if module_name in sys.modules:
                    del sys.modules[module_name]
                importlib.import_module(module_name)
            except ImportError as e:
                pytest.fail(f"Failed to import {module_name}: {e}")

    def test_import_service_modules(self, mock_external_deps):
        """Test service modules can be imported"""
        service_modules = [
            "scripts.services.config_service",
            "scripts.services.enhanced_request_parser",
        ]

        for module_name in service_modules:
            try:
                # Clear from cache to force reimport
                if module_name in sys.modules:
                    del sys.modules[module_name]
                importlib.import_module(module_name)
            except ImportError as e:
                pytest.fail(f"Failed to import {module_name}: {e}")

    def test_import_check_scripts(self, mock_external_deps):
        """Test check/diagnostic scripts can be imported"""
        check_modules = [
            "scripts.check.validate_year_integrity",
            "scripts.check.check_sync_results",
            "scripts.check.inspect_db",
        ]

        for module_name in check_modules:
            try:
                # Clear from cache to force reimport
                if module_name in sys.modules:
                    del sys.modules[module_name]
                importlib.import_module(module_name)
            except ImportError as e:
                pytest.fail(f"Failed to import {module_name}: {e}")

    @pytest.mark.skip(reason="FastAPI app has complex initialization")
    def test_import_solver_service(self, mock_external_deps):
        """Test solver service can be imported"""
        # Solver service requires more complex mocking
        with patch("solver_service_v2.pb", Mock()), patch("solver_service_v2.logger", Mock()):
            try:
                import solver_service_v2

                # Verify the module was imported
                assert solver_service_v2 is not None
            except ImportError as e:
                pytest.fail(f"Failed to import solver_service_v2: {e}")


class TestImportDependencies:
    """Test that import dependencies are correct"""

    def test_no_pocketbase_in_models(self):
        """Ensure models don't directly import PocketBase"""
        import bunking.models

        # Check that pocketbase isn't in the module's namespace
        assert not hasattr(bunking.models, "PocketBase")
        assert not hasattr(bunking.models, "Client")

    def test_base_sync_has_required_imports(self):
        """Test base_sync has all required imports"""
        with (
            patch("pocketbase.Client", Mock),
            patch("campminder.client.CampMinderClient", Mock),
            patch("campminder.client.load_config_from_file", Mock()),
        ):
            import scripts.sync.base_sync as base_sync

            # Should have these classes available
            assert hasattr(base_sync, "BaseSyncService")
            assert hasattr(base_sync, "PocketBase")
            assert hasattr(base_sync, "CampMinderClient")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

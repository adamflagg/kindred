#!/usr/bin/env python3
"""
Minimal smoke tests for CI - ensures core functionality works.
These tests verify that critical components can be imported and instantiated.
They provide basic confidence that the system isn't completely broken.
"""

import os
import sys

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))


class TestCoreImports:
    """Test that core modules can be imported without errors"""

    def test_solver_imports(self):
        """Ensure solver modules can be imported"""
        from bunking.direct_solver import DirectBunkingSolver
        from bunking.models_v2 import DirectSolverInput

        assert DirectBunkingSolver is not None
        assert DirectSolverInput is not None

    def test_sync_imports(self):
        """Ensure sync modules can be imported"""
        from bunking.sync.base_sync import BaseSyncService

        assert BaseSyncService is not None

    def test_bunk_request_processor_imports(self):
        """Ensure bunk request processor modules can be imported"""
        from bunking.sync.bunk_request_processor.confidence.confidence_scorer import ConfidenceScorer
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import RequestOrchestrator

        assert RequestOrchestrator is not None
        assert ConfidenceScorer is not None

    def test_config_imports(self):
        """Ensure configuration system can be imported"""
        from bunking.config import ConfigLoader

        assert ConfigLoader is not None


class TestBasicInstantiation:
    """Test that core objects can be created"""

    def test_create_config_loader(self):
        """Ensure ConfigLoader can be instantiated"""
        from bunking.config import ConfigLoader

        config = ConfigLoader.get_instance()
        assert config is not None
        # Test basic config access
        assert hasattr(config, "get_int")
        assert hasattr(config, "get_constraint")

    def test_create_models(self):
        """Ensure data models can be created"""
        from bunking.models_v2 import DirectBunk, DirectPerson

        person = DirectPerson(
            campminder_person_id=1,
            first_name="Test",
            last_name="User",
            birthdate="2010-01-01T00:00:00Z",
            gender="M",
            grade=5,
            session_cm_id=1,
        )
        assert person.campminder_person_id == 1
        assert person.grade == 5

        bunk = DirectBunk(id="test_bunk", campminder_id=100, name="Test Bunk", capacity=12, gender="M", session_cm_id=1)
        assert bunk.capacity == 12

    def test_create_confidence_scorer(self):
        """Ensure ConfidenceScorer can be created"""
        from bunking.sync.bunk_request_processor.confidence.confidence_scorer import ConfidenceScorer

        scorer = ConfidenceScorer()
        assert scorer is not None
        # Test basic methods exist
        assert hasattr(scorer, "score_parsed_request")
        assert hasattr(scorer, "score_resolution")


class TestCriticalPaths:
    """Test critical paths work at a basic level"""

    def test_solver_creation_with_empty_data(self):
        """Ensure solver can be created with minimal data"""
        from unittest.mock import Mock

        from bunking.direct_solver import DirectBunkingSolver
        from bunking.models_v2 import DirectSolverInput

        # Create minimal input
        solver_input = DirectSolverInput(persons=[], requests=[], bunks=[], existing_assignments=[])

        # Mock config loader
        mock_config = Mock()
        mock_config.get_constraint.return_value = 10
        mock_config.get_soft_constraint_weight.return_value = 100
        mock_config.get_int.return_value = 1
        mock_config.get_str.return_value = "hard"
        mock_config.get_float.return_value = 1.0
        mock_config.get_bool.return_value = True

        # Should not crash
        solver = DirectBunkingSolver(solver_input, mock_config)
        assert solver is not None

    def test_bunk_request_processor_import(self):
        """Ensure modular bunk request processor can be imported"""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import RequestOrchestrator

        # Should be able to import the class
        assert RequestOrchestrator is not None


class TestFileSystem:
    """Test that required directories and files exist"""

    def test_config_directory_exists(self):
        """Ensure config directory exists"""
        import os

        # Navigate from tests/unit/sync/ up to project root
        project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
        config_dir = os.path.join(project_root, "config")
        assert os.path.exists(config_dir), f"Config directory not found at {config_dir}"

    def test_dependency_files_exist(self):
        """Ensure dependency management files exist (uv)"""
        import os

        # Navigate from tests/unit/sync/ up to project root
        project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
        pyproject = os.path.join(project_root, "pyproject.toml")
        uv_lock = os.path.join(project_root, "uv.lock")
        assert os.path.exists(pyproject), f"pyproject.toml not found at {pyproject}"
        assert os.path.exists(uv_lock), f"uv.lock not found at {uv_lock}"


# Note: Run with pytest, not as a standalone script

"""Tests for configurable staff list feature

The staff list should be loaded from config/staff_list.json and used
to dynamically generate detection patterns, replacing the hardcoded
SHOSHIE_PATTERNS.

Format of config/staff_list.json:
{
    "staff": [
        {"first_name": "Jordan", "last_name": "Rivers"},
        {"first_name": "Jane", "last_name": "Doe"}
    ]
}"""

from __future__ import annotations

import json
import tempfile
from pathlib import Path


class TestStaffListLoading:
    """Test loading staff list from config file"""

    def test_loads_staff_list_from_config_file(self):
        """Staff list should be loaded from config/staff_list.json"""
        from bunking.sync.bunk_request_processor.services.staff_name_detector import (
            StaffNameDetector,
        )

        # Create a temp config file
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            json.dump(
                {
                    "staff": [
                        {"first_name": "Jordan", "last_name": "Rivers"},
                        {"first_name": "Jane", "last_name": "Doe"},
                    ]
                },
                f,
            )
            temp_path = Path(f.name)

        try:
            detector = StaffNameDetector(staff_list_path=temp_path)
            assert detector.staff_list is not None
            assert len(detector.staff_list) == 2
            assert {"first_name": "Jordan", "last_name": "Rivers"} in detector.staff_list
            assert {"first_name": "Jane", "last_name": "Doe"} in detector.staff_list
        finally:
            temp_path.unlink()

    def test_uses_default_path_when_not_specified(self):
        """Should use config/staff_list.json when no path specified"""
        from bunking.sync.bunk_request_processor.services.staff_name_detector import (
            StaffNameDetector,
        )

        detector = StaffNameDetector()
        # Should have loaded from default path or have empty list if file doesn't exist
        assert hasattr(detector, "staff_list")

    def test_handles_missing_config_file_gracefully(self):
        """Should not crash if config file doesn't exist"""
        from bunking.sync.bunk_request_processor.services.staff_name_detector import (
            StaffNameDetector,
        )

        non_existent_path = Path("/tmp/definitely_does_not_exist_12345.json")
        detector = StaffNameDetector(staff_list_path=non_existent_path)
        assert detector.staff_list == []


class TestDynamicPatternGeneration:
    """Test generating detection patterns from staff list"""

    def test_generates_patterns_for_each_staff_member(self):
        """Should generate 'Name should/will call' patterns for each staff first name"""
        from bunking.sync.bunk_request_processor.services.staff_name_detector import (
            StaffNameDetector,
        )

        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            json.dump(
                {
                    "staff": [
                        {"first_name": "Jordan", "last_name": "Rivers"},
                        {"first_name": "Jane", "last_name": "Doe"},
                    ]
                },
                f,
            )
            temp_path = Path(f.name)

        try:
            detector = StaffNameDetector(staff_list_path=temp_path)

            # Should detect "Jordan" from patterns
            result = detector.extract_staff_names("Jordan should call about this")
            assert "Jordan" in result

            # Should detect "Jane" from patterns
            result = detector.extract_staff_names("Jane will call tomorrow")
            assert "Jane" in result

            # Should detect from "call/discuss with" patterns
            result = detector.extract_staff_names("Need to discuss with Jordan")
            assert "Jordan" in result

            result = detector.extract_staff_names("Call Jane about bunking")
            assert "Jane" in result
        finally:
            temp_path.unlink()

    def test_detects_full_name_from_staff_list(self):
        """Should detect full names (first + last) from staff list"""
        from bunking.sync.bunk_request_processor.services.staff_name_detector import (
            StaffNameDetector,
        )

        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            json.dump({"staff": [{"first_name": "Jordan", "last_name": "Rivers"}]}, f)
            temp_path = Path(f.name)

        try:
            detector = StaffNameDetector(staff_list_path=temp_path)

            # Should detect full name
            result = detector.extract_staff_names("Per Jordan Rivers, this is okay")
            assert "Jordan Rivers" in result or "Jordan" in result
        finally:
            temp_path.unlink()


class TestStaffListIntegration:
    """Integration tests for staff list with detection flow"""

    def test_staff_from_config_detected_in_notes(self):
        """Staff names from config should be detected in bunking notes"""
        from bunking.sync.bunk_request_processor.services.staff_name_detector import (
            StaffNameDetector,
        )

        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            json.dump(
                {
                    "staff": [
                        {"first_name": "Jordan", "last_name": "Rivers"},
                        {"first_name": "Marcus", "last_name": "Smith"},
                    ]
                },
                f,
            )
            temp_path = Path(f.name)

        try:
            detector = StaffNameDetector(staff_list_path=temp_path)

            notes_texts: list[str | None] = [
                "Jordan should call about this",
                "Marcus will discuss with family",
                "Regular note with no staff",
            ]

            detected = detector.build_global_set(notes_texts)
            detector.detected_staff_names = detected

            assert "Jordan" in detected
            assert "Marcus" in detected
            assert detector.is_staff_name("Jordan") is True
            assert detector.is_staff_name("Marcus") is True
        finally:
            temp_path.unlink()

    def test_empty_staff_list_uses_only_general_patterns(self):
        """With empty staff list, should still use general patterns"""
        from bunking.sync.bunk_request_processor.services.staff_name_detector import (
            StaffNameDetector,
        )

        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            json.dump({"staff": []}, f)
            temp_path = Path(f.name)

        try:
            detector = StaffNameDetector(staff_list_path=temp_path)

            # General patterns should still work
            result = detector.extract_staff_names("Mom called about bunking")
            assert "Mom" in result

            result = detector.extract_staff_names("Per Dad, this is okay")
            assert "Dad" in result
        finally:
            temp_path.unlink()

"""Tests for StaffNameDetector service

These tests verify:
1. Extraction of staff/parent names from conversational notes patterns
2. All 8 regex patterns from monolith are supported
3. Stop words are properly filtered
4. Name validation (starts with capital letter)
5. Known staff name patterns (e.g., Jordan)
6. Build of global detected_staff_names set from multiple requests"""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

import pytest


@pytest.fixture
def staff_list_with_shoshie():
    """Create a temporary staff list JSON file with Jordan for testing."""
    staff_data = {"staff": [{"first_name": "Jordan", "last_name": "Test", "role": "Director"}]}

    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
        json.dump(staff_data, f)
        temp_path = Path(f.name)

    yield temp_path

    # Cleanup
    if temp_path.exists():
        temp_path.unlink()


class TestStaffNameDetectorExtraction:
    """"""

    def test_extracts_name_from_called_pattern(self):
        """Pattern: '(name) called/spoke/discussed/mentioned'"""
        from bunking.sync.bunk_request_processor.services.staff_name_detector import (
            StaffNameDetector,
        )

        detector = StaffNameDetector()

        result = detector.extract_staff_names("Mom called to discuss bunking")
        assert "Mom" in result

        result = detector.extract_staff_names("Sarah Smith spoke with us yesterday")
        assert "Sarah Smith" in result

    def test_extracts_name_from_call_to_pattern(self):
        """Pattern: 'call/speak to/discuss with/talked to (name)'"""
        from bunking.sync.bunk_request_processor.services.staff_name_detector import (
            StaffNameDetector,
        )

        detector = StaffNameDetector()

        result = detector.extract_staff_names("Need to call Janet")
        assert "Janet" in result

        result = detector.extract_staff_names("Will speak to John Smith")
        assert "John Smith" in result

        result = detector.extract_staff_names("Should discuss with Lisa")
        assert "Lisa" in result

        result = detector.extract_staff_names("I talked to Mary")
        assert "Mary" in result

    def test_extracts_name_from_action_pattern(self):
        """Pattern: '(name) forgot to/wanted to/asked to/requested'"""
        from bunking.sync.bunk_request_processor.services.staff_name_detector import (
            StaffNameDetector,
        )

        detector = StaffNameDetector()

        result = detector.extract_staff_names("Dad forgot to mention")
        assert "Dad" in result

        result = detector.extract_staff_names("Karen wanted to discuss")
        assert "Karen" in result

        result = detector.extract_staff_names("Mike asked to call")
        assert "Mike" in result

    def test_extracts_name_from_plan_to_call_pattern(self):
        """Pattern: 'plan to call/should call/will call (name)'"""
        from bunking.sync.bunk_request_processor.services.staff_name_detector import (
            StaffNameDetector,
        )

        detector = StaffNameDetector()

        result = detector.extract_staff_names("Plan to call Susan")
        assert "Susan" in result

        result = detector.extract_staff_names("Should call David")
        assert "David" in result

        result = detector.extract_staff_names("Will call Nancy Smith")
        assert "Nancy Smith" in result

    def test_extracts_name_from_per_pattern(self):
        """Pattern: 'per (name)'"""
        from bunking.sync.bunk_request_processor.services.staff_name_detector import (
            StaffNameDetector,
        )

        detector = StaffNameDetector()

        result = detector.extract_staff_names("Per Jordan, they should bunk together")
        assert "Jordan" in result

        result = detector.extract_staff_names("Per Nancy Jones, this is okay")
        assert "Nancy Jones" in result

    def test_extracts_name_from_according_to_pattern(self):
        """Pattern: 'according to (name)'"""
        from bunking.sync.bunk_request_processor.services.staff_name_detector import (
            StaffNameDetector,
        )

        detector = StaffNameDetector()

        result = detector.extract_staff_names("According to Rachel, this is fine")
        assert "Rachel" in result

    def test_extracts_name_from_says_pattern(self):
        """Pattern: '(name) says/said/notes/noted'"""
        from bunking.sync.bunk_request_processor.services.staff_name_detector import (
            StaffNameDetector,
        )

        detector = StaffNameDetector()

        result = detector.extract_staff_names("Director says it's okay")
        assert "Director" in result

        result = detector.extract_staff_names("Kim said to put them together")
        assert "Kim" in result

        result = detector.extract_staff_names("Tom notes this preference")
        assert "Tom" in result

    def test_extracts_name_from_ensure_pattern(self):
        """Pattern: 'ensure we have/get ... call/discuss ... (name)'"""
        from bunking.sync.bunk_request_processor.services.staff_name_detector import (
            StaffNameDetector,
        )

        detector = StaffNameDetector()

        result = detector.extract_staff_names("Ensure we have time to call Barbara")
        assert "Barbara" in result

    def test_filters_stop_words(self):
        """"""
        from bunking.sync.bunk_request_processor.services.staff_name_detector import (
            StaffNameDetector,
        )

        detector = StaffNameDetector()

        stop_words = [
            "the",
            "they",
            "them",
            "their",
            "this",
            "that",
            "these",
            "those",
            "all",
            "info",
            "bunking",
            "session",
            "camp",
            "counselor",
            "counselors",
            "staff",
            "parent",
            "parents",
        ]

        for word in stop_words:
            text = f"{word.capitalize()} called about bunking"
            result = detector.extract_staff_names(text)
            assert word.capitalize() not in result, f"Stop word '{word}' should be filtered"

    def test_requires_capital_letter(self):
        """"""
        from bunking.sync.bunk_request_processor.services.staff_name_detector import (
            StaffNameDetector,
        )

        detector = StaffNameDetector()

        result = detector.extract_staff_names("per shoshie this is okay")
        assert "shoshie" not in result

    def test_filters_short_names(self):
        """"""
        from bunking.sync.bunk_request_processor.services.staff_name_detector import (
            StaffNameDetector,
        )

        detector = StaffNameDetector()

        result = detector.extract_staff_names("Jo called")
        assert "Jo" not in result

        result = detector.extract_staff_names("Joe called")
        assert "Joe" in result

    def test_known_shoshie_patterns(self, staff_list_with_shoshie):
        """Test detection of known staff names loaded from config file."""
        from bunking.sync.bunk_request_processor.services.staff_name_detector import (
            StaffNameDetector,
        )

        # Use the temp staff list with Jordan
        detector = StaffNameDetector(staff_list_path=staff_list_with_shoshie)

        result = detector.extract_staff_names("Jordan should plan to call about this")
        assert "Jordan" in result

        result = detector.extract_staff_names("Jordan will call tomorrow")
        assert "Jordan" in result

        result = detector.extract_staff_names("Need to discuss with Jordan")
        assert "Jordan" in result

    def test_returns_empty_set_for_no_matches(self):
        """Returns empty set when no staff names detected"""
        from bunking.sync.bunk_request_processor.services.staff_name_detector import (
            StaffNameDetector,
        )

        detector = StaffNameDetector()

        result = detector.extract_staff_names("Put with Sarah and Emily together")
        assert result == set()

        result = detector.extract_staff_names("")
        assert result == set()

    def test_extracts_multiple_names_from_text(self):
        """Can extract multiple staff names from same text"""
        from bunking.sync.bunk_request_processor.services.staff_name_detector import (
            StaffNameDetector,
        )

        detector = StaffNameDetector()

        result = detector.extract_staff_names("Mom called. Per Jordan, put with Sarah. Dad mentioned this too.")
        assert "Mom" in result
        assert "Jordan" in result
        assert "Dad" in result


class TestStaffNameDetectorBuildGlobalSet:
    """"""

    def test_builds_set_from_multiple_texts(self):
        """Builds combined set from multiple notes texts"""
        from bunking.sync.bunk_request_processor.services.staff_name_detector import (
            StaffNameDetector,
        )

        detector = StaffNameDetector()

        notes_texts: list[str | None] = [
            "Mom called about bunking",
            "Per Jordan, this is okay",
            "Dad mentioned preference",
            "According to Karen, put together",
        ]

        result = detector.build_global_set(notes_texts)

        assert "Mom" in result
        assert "Jordan" in result
        assert "Dad" in result
        assert "Karen" in result

    def test_deduplicates_names(self):
        """Same name appearing in multiple texts is only included once"""
        from bunking.sync.bunk_request_processor.services.staff_name_detector import (
            StaffNameDetector,
        )

        detector = StaffNameDetector()

        notes_texts: list[str | None] = [
            "Per Jordan, put with Sarah",
            "Jordan said this is okay",
            "Jordan will call",
        ]

        result = detector.build_global_set(notes_texts)

        assert "Jordan" in result
        assert len([n for n in result if n == "Jordan"]) == 1

    def test_returns_empty_for_no_notes(self):
        """Returns empty set for empty input"""
        from bunking.sync.bunk_request_processor.services.staff_name_detector import (
            StaffNameDetector,
        )

        detector = StaffNameDetector()

        result = detector.build_global_set([])
        assert result == set()

        result = detector.build_global_set(["", "   "])
        assert result == set()


class TestStaffNameDetectorIsStaffName:
    """Test checking if a name is a detected staff name"""

    def test_returns_true_for_detected_name(self):
        """Returns True if name is in detected set"""
        from bunking.sync.bunk_request_processor.services.staff_name_detector import (
            StaffNameDetector,
        )

        detector = StaffNameDetector()
        detector.detected_staff_names = {"Mom", "Jordan", "Dad"}

        assert detector.is_staff_name("Mom") is True
        assert detector.is_staff_name("Jordan") is True
        assert detector.is_staff_name("Dad") is True

    def test_returns_false_for_non_staff_name(self):
        """Returns False if name is not in detected set"""
        from bunking.sync.bunk_request_processor.services.staff_name_detector import (
            StaffNameDetector,
        )

        detector = StaffNameDetector()
        detector.detected_staff_names = {"Mom", "Jordan", "Dad"}

        assert detector.is_staff_name("Sarah") is False
        assert detector.is_staff_name("Emily") is False
        assert detector.is_staff_name("") is False

    def test_handles_none_input(self):
        """Handles None input gracefully"""
        from bunking.sync.bunk_request_processor.services.staff_name_detector import (
            StaffNameDetector,
        )

        detector = StaffNameDetector()
        detector.detected_staff_names = {"Mom", "Jordan"}

        assert detector.is_staff_name(None) is False

    def test_case_sensitive_matching(self):
        """Matching should be case-sensitive like monolith"""
        from bunking.sync.bunk_request_processor.services.staff_name_detector import (
            StaffNameDetector,
        )

        detector = StaffNameDetector()
        detector.detected_staff_names = {"Mom", "Jordan"}

        assert detector.is_staff_name("Mom") is True
        assert detector.is_staff_name("mom") is False
        assert detector.is_staff_name("MOM") is False


class TestStaffNameDetectorIntegration:
    """Integration tests for staff name detection flow"""

    def test_full_flow_matching_monolith(self):
        """"""
        from bunking.sync.bunk_request_processor.services.staff_name_detector import (
            StaffNameDetector,
        )

        detector = StaffNameDetector()

        original_requests = [
            {"bunking_notes": "Mom called", "internal_notes": "Per Jordan, okay"},
            {"bunking_notes": "", "internal_notes": "Dad mentioned this"},
            {"bunking_notes": "According to Lisa, put together", "internal_notes": ""},
        ]

        notes_texts: list[str | None] = []
        for req in original_requests:
            bunking = req.get("bunking_notes", "").strip()
            internal = req.get("internal_notes", "").strip()
            combined = f"{bunking} {internal}".strip()
            if combined:
                notes_texts.append(combined)

        detected = detector.build_global_set(notes_texts)
        detector.detected_staff_names = detected

        assert "Mom" in detected
        assert "Jordan" in detected
        assert "Dad" in detected
        assert "Lisa" in detected

        assert detector.is_staff_name("Mom") is True
        assert detector.is_staff_name("Sarah") is False

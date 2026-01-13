"""Tests for PhaseContext dataclass

Tests cover:
1. Immutability (frozen dataclass)
2. Required fields validation
3. Convenience methods for data access
4. Factory method creation
"""

from __future__ import annotations

import pytest

from bunking.sync.bunk_request_processor.core.phase_context import PhaseContext

# ============================================================================
# Test: Initialization
# ============================================================================


class TestPhaseContextInit:
    """Tests for PhaseContext initialization"""

    def test_init_with_required_fields(self) -> None:
        """Should initialize with required fields"""
        context = PhaseContext(
            year=2025,
            session_cm_ids=[1000002, 1000003],
            person_sessions={11111: [1000002], 22222: [1000003]},
            session_attendees={1000002: {11111, 33333}, 1000003: {22222}},
            ai_config={"confidence_threshold": 0.85},
        )
        assert context.year == 2025
        assert context.session_cm_ids == [1000002, 1000003]
        assert context.person_sessions[11111] == [1000002]
        assert context.ai_config["confidence_threshold"] == 0.85

    def test_default_empty_collections(self) -> None:
        """Should have sensible defaults for optional fields"""
        context = PhaseContext(year=2025)
        assert context.session_cm_ids == []
        assert context.person_sessions == {}
        assert context.session_attendees == {}
        assert context.ai_config == {}


# ============================================================================
# Test: Immutability
# ============================================================================


class TestImmutability:
    """Tests for frozen dataclass behavior"""

    def test_cannot_modify_year(self) -> None:
        """Should not allow modifying year"""
        context = PhaseContext(year=2025)
        with pytest.raises((AttributeError, TypeError)):
            context.year = 2024  # type: ignore

    def test_cannot_modify_session_cm_ids(self) -> None:
        """Should not allow modifying session_cm_ids"""
        context = PhaseContext(year=2025, session_cm_ids=[1000002])
        with pytest.raises((AttributeError, TypeError)):
            context.session_cm_ids = [1000003]  # type: ignore


# ============================================================================
# Test: Convenience methods
# ============================================================================


class TestConvenienceMethods:
    """Tests for helper methods"""

    def test_get_person_session(self) -> None:
        """Should return session for person"""
        context = PhaseContext(
            year=2025,
            person_sessions={11111: [1000002], 22222: [1000002, 1000003]},
        )
        assert context.get_person_sessions(11111) == [1000002]
        assert context.get_person_sessions(22222) == [1000002, 1000003]
        assert context.get_person_sessions(99999) == []

    def test_is_person_in_session(self) -> None:
        """Should check if person is in specific session"""
        context = PhaseContext(
            year=2025,
            person_sessions={11111: [1000002]},
        )
        assert context.is_person_in_session(11111, 1000002) is True
        assert context.is_person_in_session(11111, 1000003) is False
        assert context.is_person_in_session(99999, 1000002) is False

    def test_get_session_attendees(self) -> None:
        """Should return attendees for session"""
        context = PhaseContext(
            year=2025,
            session_attendees={1000002: {11111, 22222}},
        )
        attendees = context.get_session_attendees(1000002)
        assert attendees == {11111, 22222}
        assert context.get_session_attendees(9999) == set()

    def test_get_ai_config_value(self) -> None:
        """Should get config value with default"""
        context = PhaseContext(
            year=2025,
            ai_config={"confidence_threshold": 0.85, "enabled": True},
        )
        assert context.get_config("confidence_threshold", 0.80) == 0.85
        assert context.get_config("enabled", False) is True
        assert context.get_config("missing_key", "default") == "default"

    def test_same_session(self) -> None:
        """Should check if two people are in the same session"""
        context = PhaseContext(
            year=2025,
            person_sessions={
                11111: [1000002],
                22222: [1000002],
                33333: [1000003],
            },
        )
        assert context.are_in_same_session(11111, 22222) is True
        assert context.are_in_same_session(11111, 33333) is False
        assert context.are_in_same_session(11111, 99999) is False


# ============================================================================
# Test: Factory creation
# ============================================================================


class TestFactoryCreation:
    """Tests for factory methods"""

    def test_create_empty(self) -> None:
        """Should create minimal context"""
        context = PhaseContext.create_minimal(year=2025)
        assert context.year == 2025
        assert context.session_cm_ids == []
        assert context.person_sessions == {}

    def test_create_for_session(self) -> None:
        """Should create context for specific session"""
        context = PhaseContext.create_for_session(
            year=2025,
            session_cm_id=1000002,
            attendee_cm_ids={11111, 22222},
        )
        assert context.year == 2025
        assert context.session_cm_ids == [1000002]
        assert context.session_attendees[1000002] == {11111, 22222}

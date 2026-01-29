"""
TDD tests for session metrics utility module.

Tests for:
- DISPLAY_SESSION_TYPES constant for UI display (excludes quest)
- SUMMER_PROGRAM_SESSION_TYPES constant for calculations (includes quest)
- compute_summer_metrics() correctly filters by session type
- Quest sessions ARE included in summer metrics calculations
- Quest sessions are EXCLUDED from session breakdown charts
- Family camp, training, tli, etc. ARE excluded from both

These tests are written FIRST before implementation (TDD).
"""

from __future__ import annotations

from unittest.mock import Mock

# ============================================================================
# Test Data Factories
# ============================================================================


def create_mock_session(
    cm_id: int,
    name: str,
    year: int,
    session_type: str = "main",
    start_date: str = "2026-06-15",
    end_date: str = "2026-07-05",
    parent_id: int | None = None,
) -> Mock:
    """Create a mock session record."""
    session = Mock()
    session.cm_id = cm_id
    session.name = name
    session.year = year
    session.session_type = session_type
    session.start_date = start_date
    session.end_date = end_date
    session.parent_id = parent_id
    return session


def create_mock_attendee(
    person_id: int,
    session: Mock,
    year: int,
    status: str = "enrolled",
    status_id: int = 2,
    is_active: bool = True,
) -> Mock:
    """Create a mock attendee record with session expand."""
    attendee = Mock()
    attendee.person_id = person_id
    attendee.session_cm_id = session.cm_id
    attendee.year = year
    attendee.status = status
    attendee.status_id = status_id
    attendee.is_active = is_active
    # Add expand for session relation (mimics PocketBase expansion)
    attendee.expand = {"session": session}
    return attendee


# ============================================================================
# SUMMER_PROGRAM_SESSION_TYPES Constant Tests
# ============================================================================


class TestDisplaySessionTypesConstant:
    """Tests for DISPLAY_SESSION_TYPES constant (used for UI display)."""

    def test_display_types_includes_main_sessions(self) -> None:
        """Main sessions should be included in display types."""
        from api.utils.session_metrics import DISPLAY_SESSION_TYPES

        assert "main" in DISPLAY_SESSION_TYPES

    def test_display_types_includes_embedded_sessions(self) -> None:
        """Embedded sessions (2a, 2b, etc.) should be included in display."""
        from api.utils.session_metrics import DISPLAY_SESSION_TYPES

        assert "embedded" in DISPLAY_SESSION_TYPES

    def test_display_types_includes_ag_sessions(self) -> None:
        """All-gender sessions should be included in display."""
        from api.utils.session_metrics import DISPLAY_SESSION_TYPES

        assert "ag" in DISPLAY_SESSION_TYPES

    def test_display_types_excludes_quest_sessions(self) -> None:
        """Quest sessions should NOT be shown in session breakdown charts.

        Quest sessions count toward summer years calculations but are not
        shown in session dropdowns or breakdown charts.
        """
        from api.utils.session_metrics import DISPLAY_SESSION_TYPES

        assert "quest" not in DISPLAY_SESSION_TYPES

    def test_display_types_excludes_family_sessions(self) -> None:
        """Family camp sessions should NOT be in display types."""
        from api.utils.session_metrics import DISPLAY_SESSION_TYPES

        assert "family" not in DISPLAY_SESSION_TYPES

    def test_display_types_excludes_training_sessions(self) -> None:
        """Training sessions should NOT be in display types."""
        from api.utils.session_metrics import DISPLAY_SESSION_TYPES

        assert "training" not in DISPLAY_SESSION_TYPES

    def test_display_types_is_tuple(self) -> None:
        """Display types should be a tuple for efficient 'in' checks."""
        from api.utils.session_metrics import DISPLAY_SESSION_TYPES

        assert isinstance(DISPLAY_SESSION_TYPES, tuple)


class TestSummerProgramSessionTypesConstant:
    """Tests for SUMMER_PROGRAM_SESSION_TYPES constant (used for calculations)."""

    def test_constant_includes_main_sessions(self) -> None:
        """Main sessions should be included in summer program types."""
        from api.utils.session_metrics import SUMMER_PROGRAM_SESSION_TYPES

        assert "main" in SUMMER_PROGRAM_SESSION_TYPES

    def test_constant_includes_embedded_sessions(self) -> None:
        """Embedded sessions (2a, 2b, etc.) should be included."""
        from api.utils.session_metrics import SUMMER_PROGRAM_SESSION_TYPES

        assert "embedded" in SUMMER_PROGRAM_SESSION_TYPES

    def test_constant_includes_ag_sessions(self) -> None:
        """All-gender sessions should be included."""
        from api.utils.session_metrics import SUMMER_PROGRAM_SESSION_TYPES

        assert "ag" in SUMMER_PROGRAM_SESSION_TYPES

    def test_constant_includes_quest_sessions(self) -> None:
        """Quest sessions should be included in summer program types.

        Quest sessions are child-oriented summer programs that CampMinder
        counts toward 'years at camp'. They count for calculations but
        are not shown in session breakdown UI.
        """
        from api.utils.session_metrics import SUMMER_PROGRAM_SESSION_TYPES

        assert "quest" in SUMMER_PROGRAM_SESSION_TYPES

    def test_constant_excludes_family_sessions(self) -> None:
        """Family camp sessions should NOT be included."""
        from api.utils.session_metrics import SUMMER_PROGRAM_SESSION_TYPES

        assert "family" not in SUMMER_PROGRAM_SESSION_TYPES

    def test_constant_excludes_training_sessions(self) -> None:
        """Training sessions (staff training, etc.) should NOT be included."""
        from api.utils.session_metrics import SUMMER_PROGRAM_SESSION_TYPES

        assert "training" not in SUMMER_PROGRAM_SESSION_TYPES

    def test_constant_excludes_tli_sessions(self) -> None:
        """TLI (Teen Leadership Initiative) sessions should NOT be included."""
        from api.utils.session_metrics import SUMMER_PROGRAM_SESSION_TYPES

        assert "tli" not in SUMMER_PROGRAM_SESSION_TYPES

    def test_constant_is_tuple_for_in_operator(self) -> None:
        """Constant should be a tuple for efficient 'in' checks."""
        from api.utils.session_metrics import SUMMER_PROGRAM_SESSION_TYPES

        assert isinstance(SUMMER_PROGRAM_SESSION_TYPES, tuple)


class TestConstantRelationship:
    """Tests verifying the relationship between the two constants."""

    def test_display_types_is_subset_of_summer_types(self) -> None:
        """DISPLAY_SESSION_TYPES should be a subset of SUMMER_PROGRAM_SESSION_TYPES.

        Everything displayed should also count toward summer metrics.
        """
        from api.utils.session_metrics import DISPLAY_SESSION_TYPES, SUMMER_PROGRAM_SESSION_TYPES

        assert set(DISPLAY_SESSION_TYPES).issubset(set(SUMMER_PROGRAM_SESSION_TYPES))

    def test_quest_is_the_difference(self) -> None:
        """Quest should be the only difference between the two constants.

        SUMMER_PROGRAM_SESSION_TYPES - DISPLAY_SESSION_TYPES = {'quest'}
        """
        from api.utils.session_metrics import DISPLAY_SESSION_TYPES, SUMMER_PROGRAM_SESSION_TYPES

        difference = set(SUMMER_PROGRAM_SESSION_TYPES) - set(DISPLAY_SESSION_TYPES)
        assert difference == {"quest"}


# ============================================================================
# compute_summer_metrics() Tests
# ============================================================================


class TestComputeSummerMetrics:
    """Tests for compute_summer_metrics() function."""

    def test_quest_sessions_included_in_summer_metrics(self) -> None:
        """Quest sessions should be counted in summer years.

        A camper who only attended quest sessions should have those
        counted as summers at camp.
        """
        from api.utils.session_metrics import compute_summer_metrics

        # Create quest session
        quest_session = create_mock_session(1001, "Quest Adventure Week", 2025, "quest", "2025-08-01", "2025-08-07")
        main_session = create_mock_session(2001, "Session 2", 2026, "main", "2026-06-15", "2026-07-05")

        # Person 101: Quest in 2025, Main in 2026 = 2 summers
        enrollment_history = [
            create_mock_attendee(101, quest_session, 2025),
            create_mock_attendee(101, main_session, 2026),
        ]

        person_ids = {101}
        summer_years, first_year = compute_summer_metrics(enrollment_history, person_ids)

        # Should count both quest and main as summers
        assert summer_years[101] == 2
        assert first_year[101] == 2025

    def test_quest_only_camper_has_summer_years(self) -> None:
        """A camper who only attended quest should still have summer years counted.

        This verifies quest-only attendees appear in summer metrics.
        """
        from api.utils.session_metrics import compute_summer_metrics

        # Camper only attended quest, no traditional summer camp
        quest_2024 = create_mock_session(901, "Quest 2024", 2024, "quest")
        quest_2025 = create_mock_session(902, "Quest 2025", 2025, "quest")

        enrollment_history = [
            create_mock_attendee(102, quest_2024, 2024),
            create_mock_attendee(102, quest_2025, 2025),
        ]

        person_ids = {102}
        summer_years, first_year = compute_summer_metrics(enrollment_history, person_ids)

        # Quest-only camper should have 2 summers
        assert summer_years[102] == 2
        assert first_year[102] == 2024

    def test_family_camp_excluded_from_summer_metrics(self) -> None:
        """Family camp sessions should NOT be counted in summer years.

        A camper at family camp + summer session should only count
        the summer session.
        """
        from api.utils.session_metrics import compute_summer_metrics

        family_session = create_mock_session(5001, "Family Camp", 2025, "family", "2025-05-15", "2025-05-18")
        main_session = create_mock_session(2001, "Session 2", 2026, "main", "2026-06-15", "2026-07-05")

        # Person 103: Family camp in 2025 (shouldn't count), Main in 2026
        enrollment_history = [
            create_mock_attendee(103, family_session, 2025),
            create_mock_attendee(103, main_session, 2026),
        ]

        person_ids = {103}
        summer_years, first_year = compute_summer_metrics(enrollment_history, person_ids)

        # Should only count main session, not family camp
        assert summer_years[103] == 1
        assert first_year[103] == 2026

    def test_training_sessions_excluded(self) -> None:
        """Training sessions should NOT be counted in summer years."""
        from api.utils.session_metrics import compute_summer_metrics

        training = create_mock_session(6001, "Staff Training", 2025, "training")
        main_session = create_mock_session(2001, "Session 2", 2026, "main")

        enrollment_history = [
            create_mock_attendee(104, training, 2025),
            create_mock_attendee(104, main_session, 2026),
        ]

        person_ids = {104}
        summer_years, first_year = compute_summer_metrics(enrollment_history, person_ids)

        # Should only count main session
        assert summer_years[104] == 1
        assert first_year[104] == 2026

    def test_all_summer_types_counted(self) -> None:
        """All four summer types (main, embedded, ag, quest) should be counted."""
        from api.utils.session_metrics import compute_summer_metrics

        main_session = create_mock_session(1001, "Session 2", 2023, "main")
        embedded_session = create_mock_session(1002, "Taste of Camp", 2024, "embedded")
        ag_session = create_mock_session(1003, "AG Session", 2025, "ag")
        quest_session = create_mock_session(1004, "Quest Week", 2026, "quest")

        # Person attended one of each type in different years
        enrollment_history = [
            create_mock_attendee(105, main_session, 2023),
            create_mock_attendee(105, embedded_session, 2024),
            create_mock_attendee(105, ag_session, 2025),
            create_mock_attendee(105, quest_session, 2026),
        ]

        person_ids = {105}
        summer_years, first_year = compute_summer_metrics(enrollment_history, person_ids)

        # All four should count as separate summers
        assert summer_years[105] == 4
        assert first_year[105] == 2023

    def test_same_year_multiple_sessions_count_as_one(self) -> None:
        """Multiple sessions in the same year should count as one summer."""
        from api.utils.session_metrics import compute_summer_metrics

        session_2 = create_mock_session(2001, "Session 2", 2026, "main")
        session_3 = create_mock_session(2002, "Session 3", 2026, "main")
        quest = create_mock_session(2003, "Quest", 2026, "quest")

        # Person attended 3 sessions in 2026, should count as 1 summer
        enrollment_history = [
            create_mock_attendee(106, session_2, 2026),
            create_mock_attendee(106, session_3, 2026),
            create_mock_attendee(106, quest, 2026),
        ]

        person_ids = {106}
        summer_years, first_year = compute_summer_metrics(enrollment_history, person_ids)

        # Should be 1 summer (2026), not 3
        assert summer_years[106] == 1
        assert first_year[106] == 2026

    def test_empty_enrollment_history(self) -> None:
        """Empty enrollment history should return empty dicts."""
        from api.utils.session_metrics import compute_summer_metrics

        enrollment_history: list[Mock] = []
        person_ids = {107, 108}

        summer_years, first_year = compute_summer_metrics(enrollment_history, person_ids)

        # Should return empty dicts for persons not in history
        assert summer_years == {}
        assert first_year == {}

    def test_person_not_in_person_ids_excluded(self) -> None:
        """Records for persons not in person_ids should be excluded."""
        from api.utils.session_metrics import compute_summer_metrics

        session = create_mock_session(2001, "Session 2", 2026, "main")

        enrollment_history = [
            create_mock_attendee(109, session, 2026),  # Person 109
            create_mock_attendee(110, session, 2026),  # Person 110
        ]

        # Only include person 109 in the set
        person_ids = {109}

        summer_years, first_year = compute_summer_metrics(enrollment_history, person_ids)

        # Should only have person 109
        assert 109 in summer_years
        assert 110 not in summer_years
        assert summer_years[109] == 1
        assert first_year[109] == 2026

    def test_first_year_is_minimum_year(self) -> None:
        """First year should be the minimum year from enrollment history."""
        from api.utils.session_metrics import compute_summer_metrics

        # Create sessions in reverse chronological order
        session_2026 = create_mock_session(3001, "Session 2026", 2026, "main")
        session_2024 = create_mock_session(3002, "Session 2024", 2024, "main")
        session_2025 = create_mock_session(3003, "Session 2025", 2025, "quest")

        # Person attended out of order (by fixture order)
        enrollment_history = [
            create_mock_attendee(111, session_2026, 2026),
            create_mock_attendee(111, session_2024, 2024),  # Earliest
            create_mock_attendee(111, session_2025, 2025),
        ]

        person_ids = {111}
        summer_years, first_year = compute_summer_metrics(enrollment_history, person_ids)

        assert summer_years[111] == 3
        assert first_year[111] == 2024  # Minimum year

    def test_handles_missing_session_expand(self) -> None:
        """Records without session expand should be skipped gracefully."""
        from api.utils.session_metrics import compute_summer_metrics

        session = create_mock_session(2001, "Session 2", 2026, "main")
        good_attendee = create_mock_attendee(112, session, 2026)

        # Create attendee with missing expand
        bad_attendee = Mock()
        bad_attendee.person_id = 112
        bad_attendee.year = 2025
        bad_attendee.expand = {}  # Missing session

        enrollment_history = [bad_attendee, good_attendee]

        person_ids = {112}
        summer_years, first_year = compute_summer_metrics(enrollment_history, person_ids)

        # Should only count the good record
        assert summer_years[112] == 1
        assert first_year[112] == 2026


# ============================================================================
# Session Breakdown Display Tests (Uses DISPLAY_SESSION_TYPES)
# ============================================================================


class TestSessionBreakdownUsesDisplayTypes:
    """Tests verifying session breakdowns use DISPLAY_SESSION_TYPES.

    Session breakdown charts should NOT include quest sessions - they should
    use DISPLAY_SESSION_TYPES which excludes quest.
    """

    def test_display_types_excludes_quest_for_session_breakdown(self) -> None:
        """Session breakdown should use DISPLAY_SESSION_TYPES which excludes quest.

        The _merge_ag_into_parent_sessions method in registration_service and
        _build_session_breakdown in retention_service should filter to
        DISPLAY_SESSION_TYPES, not SUMMER_PROGRAM_SESSION_TYPES.
        """
        from api.utils.session_metrics import DISPLAY_SESSION_TYPES

        # Quest should NOT be in the constant used for session breakdown display
        assert "quest" not in DISPLAY_SESSION_TYPES

    def test_main_and_embedded_in_display_types(self) -> None:
        """Main and embedded sessions should appear in session breakdown."""
        from api.utils.session_metrics import DISPLAY_SESSION_TYPES

        assert "main" in DISPLAY_SESSION_TYPES
        assert "embedded" in DISPLAY_SESSION_TYPES


# ============================================================================
# Summer Metrics Calculation Tests (Uses SUMMER_PROGRAM_SESSION_TYPES)
# ============================================================================


class TestSummerMetricsUsesAllTypes:
    """Tests verifying summer metrics calculations include quest.

    'Summers at Camp' and 'First Summer Year' calculations should include
    quest sessions using SUMMER_PROGRAM_SESSION_TYPES.
    """

    def test_summer_types_includes_quest_for_calculations(self) -> None:
        """Summer metrics calculations should include quest sessions.

        The compute_summer_metrics function and _compute_summer_metrics in
        retention_service should use SUMMER_PROGRAM_SESSION_TYPES.
        """
        from api.utils.session_metrics import SUMMER_PROGRAM_SESSION_TYPES

        # Quest SHOULD be in the constant used for summer calculations
        assert "quest" in SUMMER_PROGRAM_SESSION_TYPES

    def test_all_summer_types_in_calculation_constant(self) -> None:
        """All four summer types should be counted in summer metrics."""
        from api.utils.session_metrics import SUMMER_PROGRAM_SESSION_TYPES

        assert "main" in SUMMER_PROGRAM_SESSION_TYPES
        assert "embedded" in SUMMER_PROGRAM_SESSION_TYPES
        assert "ag" in SUMMER_PROGRAM_SESSION_TYPES
        assert "quest" in SUMMER_PROGRAM_SESSION_TYPES

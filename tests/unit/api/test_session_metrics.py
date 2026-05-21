"""
TDD tests for session metrics utility module.

Tests for:
- DISPLAY_SESSION_TYPES constant for UI display (includes quest)
- SUMMER_PROGRAM_SESSION_TYPES constant for calculations (includes quest)
- compute_summer_metrics() correctly filters by session type
- Quest sessions ARE included in summer metrics calculations
- Quest sessions ARE included in session breakdown charts
- Family camp, training, tli, etc. ARE excluded from both

These tests are written FIRST before implementation (TDD).
"""

from unittest.mock import MagicMock, Mock

from tests.unit.api.conftest import create_mock_attendee, create_mock_session

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

    def test_display_types_includes_quest_sessions(self) -> None:
        """Quest sessions should be shown in session dropdowns and breakdown charts.

        Quest sessions are child-oriented summer programs that appear alongside
        main, embedded, and ag sessions in all metrics views.
        """
        from api.utils.session_metrics import DISPLAY_SESSION_TYPES

        assert "quest" in DISPLAY_SESSION_TYPES

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

    def test_constants_are_equal(self) -> None:
        """Both constants should now contain the same session types.

        DISPLAY_SESSION_TYPES and SUMMER_PROGRAM_SESSION_TYPES are equal
        since quest sessions are now included in display views.
        """
        from api.utils.session_metrics import DISPLAY_SESSION_TYPES, SUMMER_PROGRAM_SESSION_TYPES

        assert set(SUMMER_PROGRAM_SESSION_TYPES) == set(DISPLAY_SESSION_TYPES)


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
            create_mock_attendee(101, session_cm_id=quest_session.cm_id, session=quest_session, year=2025),
            create_mock_attendee(101, session_cm_id=main_session.cm_id, session=main_session, year=2026),
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
            create_mock_attendee(102, session_cm_id=quest_2024.cm_id, session=quest_2024, year=2024),
            create_mock_attendee(102, session_cm_id=quest_2025.cm_id, session=quest_2025, year=2025),
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
            create_mock_attendee(103, session_cm_id=family_session.cm_id, session=family_session, year=2025),
            create_mock_attendee(103, session_cm_id=main_session.cm_id, session=main_session, year=2026),
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
            create_mock_attendee(104, session_cm_id=training.cm_id, session=training, year=2025),
            create_mock_attendee(104, session_cm_id=main_session.cm_id, session=main_session, year=2026),
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
            create_mock_attendee(105, session_cm_id=main_session.cm_id, session=main_session, year=2023),
            create_mock_attendee(105, session_cm_id=embedded_session.cm_id, session=embedded_session, year=2024),
            create_mock_attendee(105, session_cm_id=ag_session.cm_id, session=ag_session, year=2025),
            create_mock_attendee(105, session_cm_id=quest_session.cm_id, session=quest_session, year=2026),
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
            create_mock_attendee(106, session_cm_id=session_2.cm_id, session=session_2, year=2026),
            create_mock_attendee(106, session_cm_id=session_3.cm_id, session=session_3, year=2026),
            create_mock_attendee(106, session_cm_id=quest.cm_id, session=quest, year=2026),
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
            create_mock_attendee(109, session_cm_id=session.cm_id, session=session, year=2026),  # Person 109
            create_mock_attendee(110, session_cm_id=session.cm_id, session=session, year=2026),  # Person 110
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
            create_mock_attendee(111, session_cm_id=session_2026.cm_id, session=session_2026, year=2026),
            create_mock_attendee(111, session_cm_id=session_2024.cm_id, session=session_2024, year=2024),  # Earliest
            create_mock_attendee(111, session_cm_id=session_2025.cm_id, session=session_2025, year=2025),
        ]

        person_ids = {111}
        summer_years, first_year = compute_summer_metrics(enrollment_history, person_ids)

        assert summer_years[111] == 3
        assert first_year[111] == 2024  # Minimum year

    def test_handles_missing_session_expand(self) -> None:
        """Records without session expand should be skipped gracefully."""
        from api.utils.session_metrics import compute_summer_metrics

        session = create_mock_session(2001, "Session 2", 2026, "main")
        good_attendee = create_mock_attendee(112, session_cm_id=session.cm_id, session=session, year=2026)

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

    Session breakdown charts should include quest sessions since they are
    now part of DISPLAY_SESSION_TYPES.
    """

    def test_display_types_includes_quest_for_session_breakdown(self) -> None:
        """Session breakdown should use DISPLAY_SESSION_TYPES which includes quest.

        Quest sessions appear in session dropdowns and breakdown charts
        alongside main and embedded sessions.
        """
        from api.utils.session_metrics import DISPLAY_SESSION_TYPES

        # Quest SHOULD be in the constant used for session breakdown display
        assert "quest" in DISPLAY_SESSION_TYPES

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


# ============================================================================
# BUNK_SESSION_TYPES Constant Tests
# ============================================================================


class TestBunkSessionTypesConstant:
    """Tests for BUNK_SESSION_TYPES constant (used for bunk heatmap filtering).

    This constant defines which session types have cabin/bunk assignments
    relevant to the heatmap. Quest sessions don't have traditional bunking,
    and family/training/tli are separate programs.
    """

    def test_bunk_types_includes_main(self) -> None:
        """Main sessions have cabin assignments."""
        from api.utils.session_metrics import BUNK_SESSION_TYPES

        assert "main" in BUNK_SESSION_TYPES

    def test_bunk_types_includes_embedded(self) -> None:
        """Embedded sessions (2a, 2b, etc.) have cabin assignments."""
        from api.utils.session_metrics import BUNK_SESSION_TYPES

        assert "embedded" in BUNK_SESSION_TYPES

    def test_bunk_types_includes_ag(self) -> None:
        """AG sessions have cabin assignments (AG-* bunks)."""
        from api.utils.session_metrics import BUNK_SESSION_TYPES

        assert "ag" in BUNK_SESSION_TYPES

    def test_bunk_types_excludes_quest(self) -> None:
        """Quest is an adventure program without traditional cabin bunking."""
        from api.utils.session_metrics import BUNK_SESSION_TYPES

        assert "quest" not in BUNK_SESSION_TYPES

    def test_bunk_types_excludes_family(self) -> None:
        """Family camp should not appear in the bunk heatmap."""
        from api.utils.session_metrics import BUNK_SESSION_TYPES

        assert "family" not in BUNK_SESSION_TYPES

    def test_bunk_types_excludes_training(self) -> None:
        """Training sessions should not appear in the bunk heatmap."""
        from api.utils.session_metrics import BUNK_SESSION_TYPES

        assert "training" not in BUNK_SESSION_TYPES

    def test_bunk_types_excludes_tli(self) -> None:
        """TLI sessions should not appear in the bunk heatmap."""
        from api.utils.session_metrics import BUNK_SESSION_TYPES

        assert "tli" not in BUNK_SESSION_TYPES


# ============================================================================
# Shared Utility Function Tests (Phase 2 extraction)
# ============================================================================


class TestGetSessionFromExpand:
    """Tests for get_session_from_expand() utility function."""

    def test_extracts_session_from_dict_expand(self) -> None:
        """Should extract session from a dict-style expand."""
        from api.utils.session_metrics import get_session_from_expand

        session = Mock(cm_id=1001, session_type="main")
        record = Mock(expand={"session": session})
        assert get_session_from_expand(record) is session

    def test_extracts_session_from_object_expand(self) -> None:
        """Should extract session from an object-style expand."""
        from api.utils.session_metrics import get_session_from_expand

        session = Mock(cm_id=1001, session_type="main")
        expand = Mock(session=session)
        # Make expand not behave as a dict
        expand.__contains__ = Mock(side_effect=TypeError)
        record = Mock(expand=expand)
        result = get_session_from_expand(record)
        assert result is session

    def test_returns_none_for_empty_expand(self) -> None:
        """Should return None when expand is empty dict."""
        from api.utils.session_metrics import get_session_from_expand

        record = Mock(expand={})
        assert get_session_from_expand(record) is None

    def test_returns_none_for_none_expand(self) -> None:
        """Should return None when expand is None."""
        from api.utils.session_metrics import get_session_from_expand

        record = Mock(expand=None)
        assert get_session_from_expand(record) is None

    def test_returns_none_for_missing_expand(self) -> None:
        """Should return None when record has no expand attribute."""
        from api.utils.session_metrics import get_session_from_expand

        record = Mock(spec=[])  # No attributes
        assert get_session_from_expand(record) is None


class TestGetBunkFromExpand:
    """Tests for get_bunk_from_expand() — symmetric helper to get_person_from_expand
    so #1171's aggregate.py + social_graph_builder.py can resolve the bunk relation
    consistently (handles both dict-style and object-style PB SDK expand payloads).
    """

    def test_extracts_bunk_from_dict_expand(self) -> None:
        from api.utils.session_metrics import get_bunk_from_expand

        bunk = Mock(cm_id=42)
        record = Mock(expand={"bunk": bunk})
        assert get_bunk_from_expand(record) is bunk

    def test_extracts_bunk_from_object_expand(self) -> None:
        from api.utils.session_metrics import get_bunk_from_expand

        bunk = Mock(cm_id=42)
        expand = Mock(bunk=bunk)
        expand.__contains__ = Mock(side_effect=TypeError)
        record = Mock(expand=expand)
        assert get_bunk_from_expand(record) is bunk

    def test_returns_none_for_empty_expand(self) -> None:
        from api.utils.session_metrics import get_bunk_from_expand

        record = Mock(expand={})
        assert get_bunk_from_expand(record) is None

    def test_returns_none_for_none_expand(self) -> None:
        from api.utils.session_metrics import get_bunk_from_expand

        record = Mock(expand=None)
        assert get_bunk_from_expand(record) is None

    def test_returns_none_for_missing_expand(self) -> None:
        from api.utils.session_metrics import get_bunk_from_expand

        record = Mock(spec=[])
        assert get_bunk_from_expand(record) is None


class TestBuildAgParentMap:
    """Tests for build_ag_parent_map() utility function."""

    def test_builds_map_from_ag_sessions(self) -> None:
        """Should map AG session IDs to their parent IDs."""
        from api.utils.session_metrics import build_ag_parent_map

        sessions = {
            1001: Mock(session_type="main", parent_id=None),
            1002: Mock(session_type="ag", parent_id=1001),
            1003: Mock(session_type="embedded", parent_id=None),
        }
        result = build_ag_parent_map(sessions)
        assert result == {1002: 1001}

    def test_empty_sessions(self) -> None:
        """Should return empty dict for no sessions."""
        from api.utils.session_metrics import build_ag_parent_map

        assert build_ag_parent_map({}) == {}

    def test_no_ag_sessions(self) -> None:
        """Should return empty dict when no AG sessions exist."""
        from api.utils.session_metrics import build_ag_parent_map

        sessions = {
            1001: Mock(session_type="main", parent_id=None),
            1002: Mock(session_type="embedded", parent_id=None),
        }
        assert build_ag_parent_map(sessions) == {}

    def test_multiple_ag_sessions(self) -> None:
        """Should map all AG sessions to their parents."""
        from api.utils.session_metrics import build_ag_parent_map

        sessions = {
            1001: Mock(session_type="main", parent_id=None),
            1002: Mock(session_type="main", parent_id=None),
            2001: Mock(session_type="ag", parent_id=1001),
            2002: Mock(session_type="ag", parent_id=1002),
        }
        result = build_ag_parent_map(sessions)
        assert result == {2001: 1001, 2002: 1002}

    def test_ag_without_parent_id_skipped(self) -> None:
        """AG sessions without parent_id should be skipped."""
        from api.utils.session_metrics import build_ag_parent_map

        sessions = {
            1001: Mock(session_type="ag", parent_id=None),
        }
        assert build_ag_parent_map(sessions) == {}


class TestFindAgSessionsForParent:
    """Tests for find_ag_sessions_for_parent() utility function."""

    def test_finds_ag_sessions_for_parent(self) -> None:
        """Should find AG session IDs matching a parent."""
        from api.utils.session_metrics import find_ag_sessions_for_parent

        sessions = {
            1001: Mock(session_type="main", parent_id=None),
            2001: Mock(session_type="ag", parent_id=1001),
            2002: Mock(session_type="ag", parent_id=1001),
            2003: Mock(session_type="ag", parent_id=9999),
        }
        result = find_ag_sessions_for_parent(sessions, 1001)
        assert result == {2001, 2002}

    def test_returns_empty_for_none_session_cm_id(self) -> None:
        """Should return empty set when session_cm_id is None."""
        from api.utils.session_metrics import find_ag_sessions_for_parent

        sessions = {2001: Mock(session_type="ag", parent_id=1001)}
        result = find_ag_sessions_for_parent(sessions, None)
        assert result == set()

    def test_returns_empty_when_no_ag_children(self) -> None:
        """Should return empty set when no AG sessions match."""
        from api.utils.session_metrics import find_ag_sessions_for_parent

        sessions = {1001: Mock(session_type="main", parent_id=None)}
        result = find_ag_sessions_for_parent(sessions, 1001)
        assert result == set()


class TestFilterAttendeesBySession:
    """Tests for filter_attendees_by_session() utility function."""

    def _make_attendee(self, session_type: str, session_cm_id: int) -> Mock:
        """Helper to create an attendee with session expand."""
        session = Mock(session_type=session_type, cm_id=session_cm_id)
        return Mock(expand={"session": session})

    def test_filters_by_session_type(self) -> None:
        """Should filter attendees to matching session types."""
        from api.utils.session_metrics import filter_attendees_by_session

        attendees = [
            self._make_attendee("main", 1001),
            self._make_attendee("ag", 2001),
            self._make_attendee("family", 3001),
        ]
        result = filter_attendees_by_session(attendees, ["main", "ag"])
        assert len(result) == 2

    def test_no_session_type_filter_returns_all(self) -> None:
        """Should return all attendees when session_types is None."""
        from api.utils.session_metrics import filter_attendees_by_session

        attendees = [
            self._make_attendee("main", 1001),
            self._make_attendee("family", 3001),
        ]
        result = filter_attendees_by_session(attendees, None)
        assert len(result) == 2

    def test_filters_by_session_cm_id(self) -> None:
        """Should filter to specific session cm_id."""
        from api.utils.session_metrics import filter_attendees_by_session

        attendees = [
            self._make_attendee("main", 1001),
            self._make_attendee("main", 1002),
        ]
        result = filter_attendees_by_session(attendees, None, session_cm_id=1001)
        assert len(result) == 1

    def test_includes_ag_session_ids(self) -> None:
        """Should include attendees in AG sessions matching parent."""
        from api.utils.session_metrics import filter_attendees_by_session

        attendees = [
            self._make_attendee("main", 1001),
            self._make_attendee("ag", 2001),
            self._make_attendee("main", 1002),
        ]
        result = filter_attendees_by_session(attendees, None, session_cm_id=1001, ag_session_ids={2001})
        assert len(result) == 2  # 1001 + AG 2001

    def test_skips_attendees_without_session_expand(self) -> None:
        """Should skip attendees with missing session expand."""
        from api.utils.session_metrics import filter_attendees_by_session

        attendees = [
            self._make_attendee("main", 1001),
            Mock(expand={}),  # No session
            Mock(expand=None),  # None expand
        ]
        result = filter_attendees_by_session(attendees, ["main"])
        assert len(result) == 1


class TestGetSessionLengthCategory:
    """Tests for get_session_length_category in session_metrics (shared location)."""

    def test_function_exists_in_shared_module(self) -> None:
        """get_session_length_category should be importable from session_metrics."""
        from api.utils.session_metrics import get_session_length_category

        assert callable(get_session_length_category)

    def test_one_week_category(self) -> None:
        """4-day session should be 1-week."""
        from api.utils.session_metrics import get_session_length_category

        assert get_session_length_category("2025-06-01", "2025-06-04") == "1-week"

    def test_two_week_category(self) -> None:
        """14-day session should be 2-week."""
        from api.utils.session_metrics import get_session_length_category

        assert get_session_length_category("2025-06-01", "2025-06-14") == "2-week"

    def test_three_week_category(self) -> None:
        """21-day session should be 3-week."""
        from api.utils.session_metrics import get_session_length_category

        assert get_session_length_category("2025-06-01", "2025-06-21") == "3-week"

    def test_four_week_plus_category(self) -> None:
        """28-day session should be 4-week+."""
        from api.utils.session_metrics import get_session_length_category

        assert get_session_length_category("2025-06-01", "2025-06-28") == "4-week+"

    def test_unknown_for_empty_dates(self) -> None:
        """Empty dates should return unknown."""
        from api.utils.session_metrics import get_session_length_category

        assert get_session_length_category("", "") == "unknown"

    def test_uses_parse_date_only_for_date_stripping(self) -> None:
        """get_session_length_category should delegate to parse_date_only, not inline date-stripping."""
        from unittest.mock import patch

        from api.utils.session_metrics import get_session_length_category

        with patch(
            "api.services.reconstruction.parse_date_only", side_effect=lambda v: v.split("T")[0].split(" ")[0]
        ) as mock_parse:
            result = get_session_length_category("2025-06-01T00:00:00Z", "2025-06-14T23:59:59Z")
            assert result == "2-week"
            assert mock_parse.call_count == 2
            mock_parse.assert_any_call("2025-06-01T00:00:00Z")
            mock_parse.assert_any_call("2025-06-14T23:59:59Z")

    def test_handles_datetime_with_space_via_parse_date_only(self) -> None:
        """Datetime strings with spaces (e.g. '2025-06-01 00:00:00') should work via parse_date_only."""
        from api.utils.session_metrics import get_session_length_category

        assert get_session_length_category("2025-06-01 00:00:00", "2025-06-07 23:59:59") == "1-week"


# ============================================================================
# resolve_duration_sessions() Tests
# ============================================================================


def _make_session(cm_id: int, start_date: str | None, end_date: str | None, session_type: str = "main") -> MagicMock:
    """Create a mock session object for testing."""
    session = MagicMock()
    session.cm_id = cm_id
    session.start_date = start_date
    session.end_date = end_date
    session.session_type = session_type
    return session


class TestResolveDurationSessions:
    def test_resolves_1_week_sessions(self) -> None:
        from api.utils.session_metrics import resolve_duration_sessions

        sessions = {
            101: _make_session(101, "2026-06-01", "2026-06-07"),  # 7 days = 1-week
            201: _make_session(201, "2026-06-15", "2026-06-28"),  # 14 days = 2-week
        }
        result = resolve_duration_sessions(sessions, "1-week")
        assert result == {101}

    def test_resolves_2_week_sessions(self) -> None:
        from api.utils.session_metrics import resolve_duration_sessions

        sessions = {
            101: _make_session(101, "2026-06-01", "2026-06-07"),
            201: _make_session(201, "2026-06-15", "2026-06-28"),
            202: _make_session(202, "2026-07-01", "2026-07-14"),
        }
        result = resolve_duration_sessions(sessions, "2-week")
        assert result == {201, 202}

    def test_returns_empty_set_for_no_matches(self) -> None:
        from api.utils.session_metrics import resolve_duration_sessions

        sessions = {
            101: _make_session(101, "2026-06-01", "2026-06-07"),
        }
        result = resolve_duration_sessions(sessions, "3-week")
        assert result == set()

    def test_returns_empty_set_for_empty_sessions(self) -> None:
        from api.utils.session_metrics import resolve_duration_sessions

        result = resolve_duration_sessions({}, "1-week")
        assert result == set()

    def test_returns_empty_set_for_none_duration(self) -> None:
        from api.utils.session_metrics import resolve_duration_sessions

        sessions = {101: _make_session(101, "2026-06-01", "2026-06-07")}
        result = resolve_duration_sessions(sessions, None)
        assert result == set()

    def test_handles_sessions_with_missing_dates(self) -> None:
        from api.utils.session_metrics import resolve_duration_sessions

        sessions = {
            101: _make_session(101, "2026-06-01", "2026-06-07"),
            102: _make_session(102, None, None),
        }
        result = resolve_duration_sessions(sessions, "1-week")
        assert result == {101}


# ============================================================================
# filter_attendees_by_session session_cm_ids Tests
# ============================================================================


class TestFilterAttendeesBySessionCmIds:
    """Tests for the session_cm_ids parameter of filter_attendees_by_session."""

    def _make_attendee(self, session_cm_id: int, session_type: str = "main") -> MagicMock:
        attendee = MagicMock()
        session = MagicMock()
        session.cm_id = session_cm_id
        session.session_type = session_type
        attendee.expand = {"session": session}
        return attendee

    def test_filters_to_specific_session_cm_ids(self) -> None:
        from api.utils.session_metrics import filter_attendees_by_session

        attendees = [
            self._make_attendee(101),
            self._make_attendee(102),
            self._make_attendee(201),
        ]
        result = filter_attendees_by_session(attendees, None, session_cm_ids={101, 102})
        assert len(result) == 2

    def test_session_cm_ids_none_returns_all(self) -> None:
        from api.utils.session_metrics import filter_attendees_by_session

        attendees = [
            self._make_attendee(101),
            self._make_attendee(201),
        ]
        result = filter_attendees_by_session(attendees, None, session_cm_ids=None)
        assert len(result) == 2

    def test_session_cm_ids_combined_with_session_types(self) -> None:
        from api.utils.session_metrics import filter_attendees_by_session

        attendees = [
            self._make_attendee(101, "main"),
            self._make_attendee(102, "quest"),
            self._make_attendee(201, "main"),
        ]
        # Filter by both type=main AND cm_ids={101, 201}
        result = filter_attendees_by_session(attendees, ["main"], session_cm_ids={101, 201})
        assert len(result) == 2  # 101 and 201 (both main)

    def test_session_cm_ids_empty_set_returns_none(self) -> None:
        from api.utils.session_metrics import filter_attendees_by_session

        attendees = [self._make_attendee(101)]
        result = filter_attendees_by_session(attendees, None, session_cm_ids=set())
        assert len(result) == 0

    def test_session_cm_ids_and_session_cm_id_are_mutually_exclusive(self) -> None:
        """In practice, callers set one or the other (never both).
        If both are set, both filters apply (AND logic)."""
        from api.utils.session_metrics import filter_attendees_by_session

        attendees = [
            self._make_attendee(101, "main"),
            self._make_attendee(102, "main"),
        ]
        # session_cm_id=101 AND session_cm_ids={102} -> nothing passes both
        result = filter_attendees_by_session(attendees, None, session_cm_id=101, session_cm_ids={102})
        assert len(result) == 0

    def test_session_cm_ids_includes_ag_sessions_via_passthrough(self) -> None:
        """AG sessions should pass through the session_cm_ids filter via ag_session_ids,
        just like they do for the session_cm_id (singular) filter."""
        from api.utils.session_metrics import filter_attendees_by_session

        # Attendee is in AG session 301 (child of main session 101)
        ag_attendee = self._make_attendee(301, "main")
        main_attendee = self._make_attendee(101, "main")

        result = filter_attendees_by_session(
            [ag_attendee, main_attendee],
            None,
            session_cm_ids={101, 102},
            ag_session_ids={301},
        )
        # Both should pass: 101 is in the set, 301 is an AG child
        assert len(result) == 2

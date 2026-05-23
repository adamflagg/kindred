"""Tests for MetricsSQLRepository — direct SQLite replacement for PocketBase HTTP.

Written FIRST (TDD). These tests define the expected behavior for the SQL
repository. Implementation must conform to these tests.

Test data uses fictional names per CLAUDE.md conventions:
- Emma Johnson (cm_id=1001, F, grade 5, Riverside Elementary, San Francisco)
- Liam Garcia (cm_id=1002, M, grade 6, Oak Valley Middle, Oakland)
- Olivia Chen (cm_id=1003, F, grade 7, Hillcrest High, San Francisco)
"""

from __future__ import annotations

import sqlite3
from typing import TYPE_CHECKING

import pytest

if TYPE_CHECKING:
    from api.services.metrics_sql_repository import MetricsSQLRepository

# ============================================================================
# Helper to import the repository (deferred so tests fail cleanly if missing)
# ============================================================================


def _make_repo(conn: sqlite3.Connection) -> MetricsSQLRepository:
    """Create a MetricsSQLRepository with a test connection."""
    from api.services.metrics_sql_repository import MetricsSQLRepository

    return MetricsSQLRepository(conn=conn)


# ============================================================================
# Test: fetch_attendees
# ============================================================================


class TestFetchAttendees:
    """Test fetching attendees with session expansion."""

    @pytest.mark.asyncio
    async def test_default_enrolled_filter(self, sql_db: sqlite3.Connection) -> None:
        """Default (no status_filter) returns only active enrolled (status_id=2)."""
        repo = _make_repo(sql_db)
        result = await repo.fetch_attendees(2025)
        # att_1 (Emma/S1), att_2 (Liam/S1), att_3 (Olivia/S2) are enrolled
        # att_4 (Emma/S2 waitlisted) and att_5 (Liam/S2 cancelled) excluded
        assert len(result) == 3
        person_ids = {a.person_id for a in result}
        assert person_ids == {1001, 1002, 1003}

    @pytest.mark.asyncio
    async def test_single_status_filter(self, sql_db: sqlite3.Connection) -> None:
        """Single status string returns only that status."""
        repo = _make_repo(sql_db)
        result = await repo.fetch_attendees(2025, status_filter="waitlisted")
        assert len(result) == 1
        assert result[0].person_id == 1001

    @pytest.mark.asyncio
    async def test_list_status_filter(self, sql_db: sqlite3.Connection) -> None:
        """List of statuses returns attendees matching any."""
        repo = _make_repo(sql_db)
        result = await repo.fetch_attendees(2025, status_filter=["waitlisted", "cancelled"])
        assert len(result) == 2
        statuses = {a.status for a in result}
        assert statuses == {"waitlisted", "cancelled"}

    @pytest.mark.asyncio
    async def test_expand_session_shape(self, sql_db: sqlite3.Connection) -> None:
        """Each attendee has expand dict with session object containing expected attributes."""
        repo = _make_repo(sql_db)
        result = await repo.fetch_attendees(2025)
        for a in result:
            expand = a.expand
            assert isinstance(expand, dict)
            session = expand["session"]
            # Verify session has all expected attributes
            assert session.cm_id is not None
            assert session.name is not None
            assert session.session_type is not None
            assert hasattr(session, "parent_id")
            assert hasattr(session, "start_date")
            assert hasattr(session, "end_date")

    @pytest.mark.asyncio
    async def test_empty_year_returns_empty(self, sql_db: sqlite3.Connection) -> None:
        """Year with no data returns empty list."""
        repo = _make_repo(sql_db)
        result = await repo.fetch_attendees(2030)
        assert result == []

    @pytest.mark.asyncio
    async def test_enrolled_string_uses_strict_filter(self, sql_db: sqlite3.Connection) -> None:
        """status_filter='enrolled' uses status_id=2, same as default."""
        repo = _make_repo(sql_db)
        result = await repo.fetch_attendees(2025, status_filter="enrolled")
        assert len(result) == 3


# ============================================================================
# Test: fetch_persons
# ============================================================================


class TestFetchPersons:
    """Test fetching persons as dict keyed by cm_id."""

    @pytest.mark.asyncio
    async def test_returns_dict_by_cm_id(self, sql_db: sqlite3.Connection) -> None:
        """Returns dict[int, Any] keyed by cm_id."""
        repo = _make_repo(sql_db)
        result = await repo.fetch_persons(2025)
        assert isinstance(result, dict)
        assert 1001 in result
        assert 1002 in result
        assert 1003 in result
        assert len(result) == 3

    @pytest.mark.asyncio
    async def test_int_keys(self, sql_db: sqlite3.Connection) -> None:
        """Keys are int, not str or float."""
        repo = _make_repo(sql_db)
        result = await repo.fetch_persons(2025)
        for key in result:
            assert isinstance(key, int)

    @pytest.mark.asyncio
    async def test_person_fields(self, sql_db: sqlite3.Connection) -> None:
        """Person objects have all expected attributes."""
        repo = _make_repo(sql_db)
        result = await repo.fetch_persons(2025)
        emma = result[1001]
        assert emma.first_name == "Emma"
        assert emma.last_name == "Johnson"
        assert emma.gender == "F"
        assert emma.grade == 5
        assert emma.school == "Riverside Elementary"
        assert emma.normalized_school == "Riverside Elementary"
        assert emma.address_city == "San Francisco"
        assert emma.normalized_city == "San Francisco"
        assert emma.normalized_congregation == "Temple Beth El"
        assert emma.years_at_camp == 3
        assert emma.household_id == 2001


# ============================================================================
# Test: fetch_sessions
# ============================================================================


class TestFetchSessions:
    """Test fetching sessions as dict keyed by cm_id."""

    @pytest.mark.asyncio
    async def test_returns_dict_by_cm_id(self, sql_db: sqlite3.Connection) -> None:
        """Returns dict[int, Any] keyed by cm_id."""
        repo = _make_repo(sql_db)
        result = await repo.fetch_sessions(2025)
        assert isinstance(result, dict)
        assert 1000001 in result
        assert 1000002 in result
        assert 1000003 in result
        assert 1000004 in result

    @pytest.mark.asyncio
    async def test_type_filtering(self, sql_db: sqlite3.Connection) -> None:
        """Session type filtering returns only matching types."""
        repo = _make_repo(sql_db)
        result = await repo.fetch_sessions(2025, session_types=["main"])
        assert len(result) == 2
        for s in result.values():
            assert s.session_type == "main"

    @pytest.mark.asyncio
    async def test_includes_pb_id(self, sql_db: sqlite3.Connection) -> None:
        """Session objects include PocketBase 'id' field for capacity calculation."""
        repo = _make_repo(sql_db)
        result = await repo.fetch_sessions(2025)
        s1 = result[1000001]
        assert s1.id == "ses_s1"

    @pytest.mark.asyncio
    async def test_int_keys(self, sql_db: sqlite3.Connection) -> None:
        """Keys are int."""
        repo = _make_repo(sql_db)
        result = await repo.fetch_sessions(2025)
        for key in result:
            assert isinstance(key, int)


# ============================================================================
# Test: fetch_bunk_assignments
# ============================================================================


class TestFetchBunkAssignments:
    """Test fetching bunk assignments with triple expand."""

    @pytest.mark.asyncio
    async def test_triple_expand_shape(self, sql_db: sqlite3.Connection) -> None:
        """Each record has expand dict with person, session, bunk objects."""
        repo = _make_repo(sql_db)
        result = await repo.fetch_bunk_assignments(2025)
        assert len(result) == 2
        for ba in result:
            expand = ba.expand
            assert isinstance(expand, dict)
            assert "person" in expand
            assert "session" in expand
            assert "bunk" in expand

    @pytest.mark.asyncio
    async def test_person_expand_attributes(self, sql_db: sqlite3.Connection) -> None:
        """Person in expand has cm_id."""
        repo = _make_repo(sql_db)
        result = await repo.fetch_bunk_assignments(2025)
        person_cm_ids = {ba.expand["person"].cm_id for ba in result}
        assert person_cm_ids == {1001, 1002}

    @pytest.mark.asyncio
    async def test_session_expand_attributes(self, sql_db: sqlite3.Connection) -> None:
        """Session in expand has cm_id, name, session_type, parent_id."""
        repo = _make_repo(sql_db)
        result = await repo.fetch_bunk_assignments(2025)
        for ba in result:
            session = ba.expand["session"]
            assert session.cm_id == 1000001  # Both in S1
            assert session.name == "Session 1"
            assert session.session_type == "main"

    @pytest.mark.asyncio
    async def test_bunk_expand_attributes(self, sql_db: sqlite3.Connection) -> None:
        """Bunk in expand has name and gender."""
        repo = _make_repo(sql_db)
        result = await repo.fetch_bunk_assignments(2025)
        bunk_names = {ba.expand["bunk"].name for ba in result}
        assert bunk_names == {"B-1", "G-1"}


# ============================================================================
# Test: fetch_summer_enrollment_history
# ============================================================================


class TestFetchSummerEnrollmentHistory:
    """Test fetching enrollment history across years."""

    @pytest.mark.asyncio
    async def test_returns_cross_year_history(self, sql_db: sqlite3.Connection) -> None:
        """Returns attendee records from multiple years with session expand."""
        repo = _make_repo(sql_db)
        result = await repo.fetch_summer_enrollment_history({1001, 1002}, max_year=2025)
        # Emma: 2024 S1 + 2025 S1 = 2 records (enrolled only)
        # Liam: 2024 S2 + 2025 S1 = 2 records (enrolled only, cancelled excluded)
        person_ids = {r.person_id for r in result}
        assert person_ids == {1001, 1002}
        assert len(result) == 4  # 2 per person

    @pytest.mark.asyncio
    async def test_max_year_filter(self, sql_db: sqlite3.Connection) -> None:
        """max_year excludes future years."""
        repo = _make_repo(sql_db)
        result = await repo.fetch_summer_enrollment_history({1001}, max_year=2024)
        assert len(result) == 1  # Only 2024 record

    @pytest.mark.asyncio
    async def test_empty_person_ids(self, sql_db: sqlite3.Connection) -> None:
        """Empty person_ids returns empty list."""
        repo = _make_repo(sql_db)
        result = await repo.fetch_summer_enrollment_history(set(), max_year=2025)
        assert result == []

    @pytest.mark.asyncio
    async def test_expand_session_present(self, sql_db: sqlite3.Connection) -> None:
        """Each record has session expand with session_type for summer filtering."""
        repo = _make_repo(sql_db)
        result = await repo.fetch_summer_enrollment_history({1001}, max_year=2025)
        for r in result:
            expand = r.expand
            session = expand["session"]
            assert session.session_type is not None
            assert session.start_date is not None


# ============================================================================
# Test: fetch_bunk_plans
# ============================================================================


class TestFetchBunkPlans:
    """Test fetching bunk plans with bunk expansion."""

    @pytest.mark.asyncio
    async def test_returns_plans_with_bunk_expand(self, sql_db: sqlite3.Connection) -> None:
        """Returns bunk_plan records with bunk in expand."""
        repo = _make_repo(sql_db)
        result = await repo.fetch_bunk_plans(2025)
        assert len(result) == 3  # B-1/S1, G-1/S1, AG-1/AG-S1
        for bp in result:
            expand = bp.expand
            assert "bunk" in expand
            bunk = expand["bunk"]
            assert hasattr(bunk, "name")
            assert hasattr(bunk, "gender")

    @pytest.mark.asyncio
    async def test_preserves_session_pb_id(self, sql_db: sqlite3.Connection) -> None:
        """The session field is the PocketBase ID string."""
        repo = _make_repo(sql_db)
        result = await repo.fetch_bunk_plans(2025)
        session_ids = {bp.session for bp in result}
        assert "ses_s1" in session_ids
        assert "ses_ag1" in session_ids

    @pytest.mark.asyncio
    async def test_session_filter(self, sql_db: sqlite3.Connection) -> None:
        """Filter by session PB IDs."""
        repo = _make_repo(sql_db)
        result = await repo.fetch_bunk_plans(2025, session_pb_ids=["ses_s1"])
        assert len(result) == 2  # B-1 and G-1 for Session 1


# ============================================================================
# Test: fetch_capacity_config
# ============================================================================


class TestFetchCapacityConfig:
    """Test fetching default cabin capacity."""

    @pytest.mark.asyncio
    async def test_returns_configured_value(self, sql_db: sqlite3.Connection) -> None:
        """Returns the integer capacity from config table."""
        repo = _make_repo(sql_db)
        result = await repo.fetch_capacity_config()
        assert result == 12
        assert isinstance(result, int)

    @pytest.mark.asyncio
    async def test_default_when_missing(self, sql_db: sqlite3.Connection) -> None:
        """Returns 12 when config row is missing."""
        sql_db.execute("DELETE FROM config WHERE config_key = 'default'")
        sql_db.commit()
        repo = _make_repo(sql_db)
        result = await repo.fetch_capacity_config()
        assert result == 12


# ============================================================================
# Test: fetch_status_transitions
# ============================================================================


class TestFetchStatusTransitions:
    """Test fetching status transitions filtered by new_status."""

    @pytest.mark.asyncio
    async def test_filter_by_new_status(self, sql_db: sqlite3.Connection) -> None:
        """Returns only transitions matching to_statuses."""
        repo = _make_repo(sql_db)
        result = await repo.fetch_status_transitions(2025, to_statuses=["enrolled"])
        assert len(result) == 1
        assert result[0].new_status == "enrolled"
        assert result[0].person_id == 1001

    @pytest.mark.asyncio
    async def test_session_expand(self, sql_db: sqlite3.Connection) -> None:
        """Expand includes session."""
        repo = _make_repo(sql_db)
        result = await repo.fetch_status_transitions(2025, to_statuses=["cancelled"])
        assert len(result) == 1
        expand = result[0].expand
        session = expand["session"]
        assert session.cm_id == 1000001

    @pytest.mark.asyncio
    async def test_person_expand(self, sql_db: sqlite3.Connection) -> None:
        """When expand_person=True, person is in expand."""
        repo = _make_repo(sql_db)
        result = await repo.fetch_status_transitions(2025, to_statuses=["enrolled"], expand_person=True)
        assert len(result) == 1
        expand = result[0].expand
        assert "person" in expand
        person = expand["person"]
        assert person.gender is not None

    @pytest.mark.asyncio
    async def test_no_person_expand_by_default(self, sql_db: sqlite3.Connection) -> None:
        """When expand_person=False, person is not in expand."""
        repo = _make_repo(sql_db)
        result = await repo.fetch_status_transitions(2025, to_statuses=["enrolled"], expand_person=False)
        expand = result[0].expand
        assert "person" not in expand


# ============================================================================
# Test: fetch_attendees_with_persons
# ============================================================================


class TestFetchAttendeesWithPersons:
    """Test fetching attendees with both person and session expansion."""

    @pytest.mark.asyncio
    async def test_double_expand(self, sql_db: sqlite3.Connection) -> None:
        """Each record has both person and session in expand."""
        repo = _make_repo(sql_db)
        result = await repo.fetch_attendees_with_persons(2025)
        assert len(result) == 3  # Default: enrolled
        for a in result:
            expand = a.expand
            assert "person" in expand
            assert "session" in expand

    @pytest.mark.asyncio
    async def test_person_fields_in_expand(self, sql_db: sqlite3.Connection) -> None:
        """Person in expand has demographic fields."""
        repo = _make_repo(sql_db)
        result = await repo.fetch_attendees_with_persons(2025)
        emma_records = [a for a in result if a.person_id == 1001]
        assert len(emma_records) == 1
        person = emma_records[0].expand["person"]
        assert person.first_name == "Emma"
        assert person.gender == "F"
        assert person.school == "Riverside Elementary"

    @pytest.mark.asyncio
    async def test_status_filter(self, sql_db: sqlite3.Connection) -> None:
        """Status filter works with double expand."""
        repo = _make_repo(sql_db)
        result = await repo.fetch_attendees_with_persons(2025, status_filter="waitlisted")
        assert len(result) == 1
        assert result[0].person_id == 1001


# ============================================================================
# Test: fetch_status_history
# ============================================================================


class TestFetchStatusHistory:
    """Test fetching status history with session/person expansion."""

    @pytest.mark.asyncio
    async def test_all_history_for_year(self, sql_db: sqlite3.Connection) -> None:
        """Without filters, returns all status history for the year."""
        repo = _make_repo(sql_db)
        result = await repo.fetch_status_history(2025)
        assert len(result) == 2

    @pytest.mark.asyncio
    async def test_filter_by_old_status(self, sql_db: sqlite3.Connection) -> None:
        """old_status filter narrows results."""
        repo = _make_repo(sql_db)
        result = await repo.fetch_status_history(2025, old_status="waitlisted")
        assert len(result) == 1
        assert result[0].new_status == "enrolled"

    @pytest.mark.asyncio
    async def test_filter_by_new_statuses(self, sql_db: sqlite3.Connection) -> None:
        """new_statuses list filter narrows results."""
        repo = _make_repo(sql_db)
        result = await repo.fetch_status_history(2025, new_statuses=["cancelled"])
        assert len(result) == 1
        assert result[0].person_id == 1002

    @pytest.mark.asyncio
    async def test_expand_shape(self, sql_db: sqlite3.Connection) -> None:
        """Records have session and person in expand."""
        repo = _make_repo(sql_db)
        result = await repo.fetch_status_history(2025)
        for r in result:
            expand = r.expand
            assert "session" in expand
            assert "person" in expand
            person = expand["person"]
            assert hasattr(person, "first_name")
            assert hasattr(person, "last_name")


# ============================================================================
# Test: fetch_enrollment_snapshots
# ============================================================================


class TestFetchEnrollmentSnapshots:
    """Test fetching enrollment snapshot time series."""

    @pytest.mark.asyncio
    async def test_all_snapshots_for_year(self, sql_db: sqlite3.Connection) -> None:
        """Returns all snapshots for a year, sorted by date."""
        repo = _make_repo(sql_db)
        result = await repo.fetch_enrollment_snapshots(2025)
        assert len(result) == 3
        dates = [r.snapshot_datetime for r in result]
        assert dates == sorted(dates)

    @pytest.mark.asyncio
    async def test_session_filter(self, sql_db: sqlite3.Connection) -> None:
        """session_cm_id filter narrows to specific session."""
        repo = _make_repo(sql_db)
        result = await repo.fetch_enrollment_snapshots(2025, session_cm_id=1000002)
        assert len(result) == 1
        assert result[0].session_cm_id == 1000002

    @pytest.mark.asyncio
    async def test_gender_count_fields(self, sql_db: sqlite3.Connection) -> None:
        """Snapshot objects include all gender-split count fields."""
        repo = _make_repo(sql_db)
        result = await repo.fetch_enrollment_snapshots(2025)
        snap = result[0]
        assert hasattr(snap, "enrolled_count")
        assert hasattr(snap, "waitlisted_count")
        assert hasattr(snap, "cancelled_count")
        assert hasattr(snap, "enrolled_male_count")
        assert hasattr(snap, "enrolled_female_count")
        assert hasattr(snap, "waitlisted_male_count")
        assert hasattr(snap, "waitlisted_female_count")
        assert hasattr(snap, "cancelled_male_count")
        assert hasattr(snap, "cancelled_female_count")


# ============================================================================
# Test: fetch_attendees_with_dates
# ============================================================================


class TestFetchAttendeesWithDates:
    """Test fetching attendees with enrollment dates for velocity."""

    @pytest.mark.asyncio
    async def test_only_returns_dated_records(self, sql_db: sqlite3.Connection) -> None:
        """Only returns attendees with non-empty enrollment_date or effective_date."""
        repo = _make_repo(sql_db)
        result = await repo.fetch_attendees_with_dates(2025)
        for a in result:
            assert a.enrollment_date or a.effective_date  # At least one date set

    @pytest.mark.asyncio
    async def test_session_expand(self, sql_db: sqlite3.Connection) -> None:
        """Has session in expand."""
        repo = _make_repo(sql_db)
        result = await repo.fetch_attendees_with_dates(2025)
        for a in result:
            expand = a.expand
            assert "session" in expand

    @pytest.mark.asyncio
    async def test_person_expand_optional(self, sql_db: sqlite3.Connection) -> None:
        """expand_person=True adds person to expand."""
        repo = _make_repo(sql_db)
        result_without = await repo.fetch_attendees_with_dates(2025, expand_person=False)
        result_with = await repo.fetch_attendees_with_dates(2025, expand_person=True)
        for a in result_without:
            assert "person" not in a.expand
        for a in result_with:
            assert "person" in a.expand


# ============================================================================
# Test: fetch_budget_config
# ============================================================================


class TestFetchBudgetConfig:
    """Test fetching budget configuration."""

    @pytest.mark.asyncio
    async def test_returns_dict_by_session_cm_id(self, sql_db: sqlite3.Connection) -> None:
        """Returns dict[int, dict] keyed by session cm_id."""
        repo = _make_repo(sql_db)
        result = await repo.fetch_budget_config(2025)
        assert isinstance(result, dict)
        assert 1000001 in result
        assert 1000002 in result

    @pytest.mark.asyncio
    async def test_config_values_parsed(self, sql_db: sqlite3.Connection) -> None:
        """Config values are parsed from JSON."""
        repo = _make_repo(sql_db)
        result = await repo.fetch_budget_config(2025)
        s1_config = result[1000001]
        assert isinstance(s1_config, dict)
        assert s1_config["participant_goal"] == 150
        assert s1_config["session_fee"] == 5000

    @pytest.mark.asyncio
    async def test_empty_year(self, sql_db: sqlite3.Connection) -> None:
        """Year with no budget config returns empty dict."""
        repo = _make_repo(sql_db)
        result = await repo.fetch_budget_config(2030)
        assert result == {}


# ============================================================================
# Test: fetch_registration_dates
# ============================================================================


class TestFetchRegistrationDates:
    """Test fetching registration phase dates."""

    @pytest.mark.asyncio
    async def test_returns_dict_by_key(self, sql_db: sqlite3.Connection) -> None:
        """Returns dict[str, str] keyed by config_key."""
        repo = _make_repo(sql_db)
        result = await repo.fetch_registration_dates(2025)
        assert result["priority_reg_date"] == "2025-01-01"
        assert result["early_reg_date"] == "2025-01-15"
        assert result["open_reg_date"] == "2025-02-01"

    @pytest.mark.asyncio
    async def test_empty_year(self, sql_db: sqlite3.Connection) -> None:
        """Year with no registration dates returns empty dict."""
        repo = _make_repo(sql_db)
        result = await repo.fetch_registration_dates(2030)
        assert result == {}


# ============================================================================
# Test: Object Compatibility with Service Extractors
# ============================================================================


class TestObjectCompatibility:
    """Critical: verify SQL-produced objects work with actual service extractors.

    These tests import the real extractor functions and run them against objects
    produced by the SQL repository, proving end-to-end compatibility.
    """

    @pytest.mark.asyncio
    async def test_extract_gender(self, sql_db: sqlite3.Connection) -> None:
        """extract_gender works on SQL-produced person objects."""
        from api.services.extractors import extract_gender

        repo = _make_repo(sql_db)
        persons = await repo.fetch_persons(2025)
        assert extract_gender(persons[1001]) == "F"
        assert extract_gender(persons[1002]) == "M"

    @pytest.mark.asyncio
    async def test_extract_grade(self, sql_db: sqlite3.Connection) -> None:
        """extract_grade works on SQL-produced person objects."""
        from api.services.extractors import extract_grade

        repo = _make_repo(sql_db)
        persons = await repo.fetch_persons(2025)
        assert extract_grade(persons[1001]) == 5
        assert extract_grade(persons[1002]) == 6

    @pytest.mark.asyncio
    async def test_extract_school(self, sql_db: sqlite3.Connection) -> None:
        """extract_school works on SQL-produced person objects."""
        from api.services.extractors import extract_school

        repo = _make_repo(sql_db)
        persons = await repo.fetch_persons(2025)
        assert extract_school(persons[1001]) == "Riverside Elementary"

    @pytest.mark.asyncio
    async def test_extract_city(self, sql_db: sqlite3.Connection) -> None:
        """extract_city works on SQL-produced person objects."""
        from api.services.extractors import extract_city

        repo = _make_repo(sql_db)
        persons = await repo.fetch_persons(2025)
        assert extract_city(persons[1001]) == "San Francisco"

    @pytest.mark.asyncio
    async def test_extract_synagogue(self, sql_db: sqlite3.Connection) -> None:
        """extract_synagogue works on SQL-produced person objects."""
        from api.services.extractors import extract_synagogue

        repo = _make_repo(sql_db)
        persons = await repo.fetch_persons(2025)
        assert extract_synagogue(persons[1001]) == "Temple Beth El"

    @pytest.mark.asyncio
    async def test_extract_years_at_camp(self, sql_db: sqlite3.Connection) -> None:
        """extract_years_at_camp works on SQL-produced person objects."""
        from api.services.extractors import extract_years_at_camp

        repo = _make_repo(sql_db)
        persons = await repo.fetch_persons(2025)
        assert extract_years_at_camp(persons[1001]) == 3

    @pytest.mark.asyncio
    async def test_get_session_from_expand(self, sql_db: sqlite3.Connection) -> None:
        """get_session_from_expand works on SQL-produced attendee objects."""
        from api.utils.session_metrics import get_session_from_expand

        repo = _make_repo(sql_db)
        attendees = await repo.fetch_attendees(2025)
        for a in attendees:
            session = get_session_from_expand(a)
            assert session is not None
            assert session.cm_id is not None

    @pytest.mark.asyncio
    async def test_compute_summer_metrics(self, sql_db: sqlite3.Connection) -> None:
        """compute_summer_metrics works on SQL-produced enrollment history."""
        from api.utils.session_metrics import compute_summer_metrics

        repo = _make_repo(sql_db)
        history = await repo.fetch_summer_enrollment_history({1001}, max_year=2025)
        summer_years, first_year = compute_summer_metrics(history, {1001})
        assert summer_years[1001] == 2  # 2024 + 2025
        assert first_year[1001] == 2024

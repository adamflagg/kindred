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
from typing import TYPE_CHECKING, Any

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

    @pytest.mark.asyncio
    async def test_drilldown_display_fields(self, sql_db: sqlite3.Connection) -> None:
        """fetch_persons carries preferred_name, age and address_state.

        The drill-down list and its CSV read all three off these person objects.
        Without the columns every drill-down showed legal first names, a blank
        Age and a mostly blank State. A mocked repository can't catch this, so
        it is pinned here against the real query.
        """
        sql_db.execute("UPDATE persons SET age = 11.5 WHERE id = 'per_emma'")
        repo = _make_repo(sql_db)
        result = await repo.fetch_persons(2025)
        emma = result[1001]
        assert emma.preferred_name == "Emmy"
        assert emma.age == 11.5
        assert emma.address_state == "CA"

    @pytest.mark.asyncio
    async def test_blank_display_fields_read_as_none(self, sql_db: sqlite3.Connection) -> None:
        """A stored blank string reads as None, so the drill-down's `??` fallbacks
        (preferred name → first name) take effect instead of showing nothing."""
        sql_db.execute("UPDATE persons SET address_state = '' WHERE id = 'per_liam'")
        repo = _make_repo(sql_db)
        result = await repo.fetch_persons(2025)
        liam = result[1002]
        assert liam.preferred_name is None
        assert liam.address_state is None
        assert liam.age is None

    @pytest.mark.asyncio
    async def test_gender_identity_fields(self, sql_db: sqlite3.Connection) -> None:
        """fetch_persons carries Gender Identity and its write-in, which every Analytics gender split reads (#2898).
        A mocked repository can't catch a dropped column, so it is pinned against the real query."""
        from api.services.extractors import extract_gender_identity

        sql_db.execute("UPDATE persons SET gender_identity_name = 'Non-binary' WHERE id = 'per_emma'")
        sql_db.execute("UPDATE persons SET gender_identity_write_in = 'their own words' WHERE id = 'per_liam'")
        repo = _make_repo(sql_db)
        result = await repo.fetch_persons(2025)
        assert result[1001].gender_identity_name == "Non-binary"
        assert result[1002].gender_identity_write_in == "their own words"
        assert extract_gender_identity(result[1001]) == "Non-binary"
        assert extract_gender_identity(result[1002]) == "self-described"
        # No identity answer: ruling 58 counts the binary field (F) as Girl/woman.
        assert extract_gender_identity(result[1003]) == "Girl/woman"


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

    @pytest.mark.asyncio
    async def test_preferred_name_present_in_expand(self, sql_db: sqlite3.Connection) -> None:
        """Person expand carries preferred_name (cache-gap audit row 2).

        The SQL repository previously omitted this column entirely, so it
        silently read as None for every camper (0 of 55 set, versus 55 of 55
        over the PocketBase HTTP path). Session availability's waitlist
        tooltip reads this field directly off the expanded person.
        """
        repo = _make_repo(sql_db)
        result = await repo.fetch_attendees_with_persons(2025, status_filter=["enrolled", "waitlisted"])
        by_person = {a.person_id: a.expand["person"] for a in result}
        assert by_person[1001].preferred_name == "Emmy"
        assert by_person[1003].preferred_name == "Liv"

    @pytest.mark.asyncio
    async def test_preferred_name_blank_when_unset(self, sql_db: sqlite3.Connection) -> None:
        """A camper with no preferred_name set reads as the stored blank string, not a crash."""
        repo = _make_repo(sql_db)
        result = await repo.fetch_attendees_with_persons(2025, status_filter=["enrolled", "waitlisted"])
        by_person = {a.person_id: a.expand["person"] for a in result}
        assert by_person[1002].preferred_name == ""

    @pytest.mark.asyncio
    async def test_age_present_in_expand(self, sql_db: sqlite3.Connection) -> None:
        """Person expand carries age, matching the PocketBase HTTP path.

        The waitlist drilldown (/api/metrics/drilldown) builds
        DrilldownAttendee.age from this expand; without the column it read
        None on every row over SQL while HTTP returned the stored value.
        """
        sql_db.execute("UPDATE persons SET age = 11.5 WHERE id = 'per_emma'")
        repo = _make_repo(sql_db)
        result = await repo.fetch_attendees_with_persons(2025, status_filter=["enrolled", "waitlisted"])
        by_person = {a.person_id: a.expand["person"] for a in result}
        assert by_person[1001].age == 11.5

    @pytest.mark.asyncio
    async def test_effective_date_present(self, sql_db: sqlite3.Connection) -> None:
        """effective_date must round-trip — found live on the dev DB while proving
        session-availability's SQL/HTTP outputs identical: this method silently
        dropped the column, so every waitlist tie-break sorted on enrollment_date
        alone and reordered relative to the HTTP path (and to /api/metrics/drilldown,
        which already reads this repository and sorts waitlist position on this
        same field).
        """
        repo = _make_repo(sql_db)
        result = await repo.fetch_attendees_with_persons(2025, status_filter=["enrolled", "waitlisted"])
        by_person_id = {a.person_id: a for a in result}
        # Emma's waitlisted record (att_4) has effective_date 2025-02-15, distinct
        # from her enrolled record (att_1)'s 2025-01-15 — proves the real column
        # value round-trips per row, not just a non-empty default.
        waitlisted = next(a for a in result if a.person_id == 1001 and a.status == "waitlisted")
        assert waitlisted.effective_date == "2025-02-15"
        assert by_person_id[1003].effective_date == "2025-02-01"


# ============================================================================
# Test: fetch_availability_config
# ============================================================================


class TestFetchAvailabilityConfig:
    """Test fetching session_availability config records (moved off the router's

    direct ``repository.pb.collection(...)`` reach-through per the cache-gap
    audit — the SQL repository has no ``.pb`` attribute at all).
    """

    @pytest.mark.asyncio
    async def test_returns_records_for_year(self, sql_db: sqlite3.Connection) -> None:
        """Returns config rows scoped to category=session_availability, subcategory=year."""
        repo = _make_repo(sql_db)
        result = await repo.fetch_availability_config(2025)
        keys = {r.config_key for r in result}
        assert keys == {"1000001", "limited_threshold"}

    @pytest.mark.asyncio
    async def test_per_session_value_parsed_as_dict(self, sql_db: sqlite3.Connection) -> None:
        """Per-session config values parse from JSON into a dict."""
        repo = _make_repo(sql_db)
        result = await repo.fetch_availability_config(2025)
        session_cfg = next(r for r in result if r.config_key == "1000001")
        assert session_cfg.value == {"min_grade": 3, "max_grade": 6, "capacity_override": None}

    @pytest.mark.asyncio
    async def test_threshold_value_parsed_as_int(self, sql_db: sqlite3.Connection) -> None:
        """limited_threshold comes back as a plain int, not a string.

        The fixture's config.value is JSON-typed like PocketBase's, so the bare
        number is stored as a native SQLite integer — this exercises the
        non-string passthrough branch production actually takes.
        """
        repo = _make_repo(sql_db)
        result = await repo.fetch_availability_config(2025)
        threshold_cfg = next(r for r in result if r.config_key == "limited_threshold")
        assert threshold_cfg.value == 90
        assert isinstance(threshold_cfg.value, int)

    @pytest.mark.asyncio
    async def test_empty_year_returns_empty(self, sql_db: sqlite3.Connection) -> None:
        """A year with no session_availability config returns an empty list."""
        repo = _make_repo(sql_db)
        result = await repo.fetch_availability_config(2030)
        assert result == []


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


class TestFetchStatusHistoryStart:
    """The earliest status-history row of any year (the cancellation coverage start)."""

    @pytest.mark.asyncio
    async def test_returns_earliest_detected_at_across_years(self, sql_db: sqlite3.Connection) -> None:
        sql_db.execute(
            "INSERT INTO attendee_status_history VALUES (?,?,?,?,?,?,?,?)",
            ("ash_old", 1003, 2024, "enrolled", "cancelled", "2024-11-09", "ses_s1", "per_emma"),
        )
        repo = _make_repo(sql_db)
        assert await repo.fetch_status_history_start() == "2024-11-09"

    @pytest.mark.asyncio
    async def test_none_when_no_history(self, sql_db: sqlite3.Connection) -> None:
        sql_db.execute("DELETE FROM attendee_status_history")
        repo = _make_repo(sql_db)
        assert await repo.fetch_status_history_start() is None


class TestFetchSnapshotsStart:
    """The first nightly snapshot of any year: before it, every Velocity point is rebuilt (K13)."""

    @pytest.mark.asyncio
    async def test_returns_earliest_snapshot_date_across_years(self, sql_db: sqlite3.Connection) -> None:
        sql_db.execute(
            "INSERT INTO enrollment_snapshots VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            ("snap_old", 2024, 1000001, "2024-03-02 00:00:00.000Z", 1, 0, 0, 1, 0, 0, 0, 0, 0),
        )
        repo = _make_repo(sql_db)
        assert await repo.fetch_snapshots_start() == "2024-03-02"

    @pytest.mark.asyncio
    async def test_none_when_no_snapshots(self, sql_db: sqlite3.Connection) -> None:
        sql_db.execute("DELETE FROM enrollment_snapshots")
        repo = _make_repo(sql_db)
        assert await repo.fetch_snapshots_start() is None


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

    @pytest.mark.asyncio
    async def test_person_expand_carries_gender_identity(self, sql_db: sqlite3.Connection) -> None:
        """Velocity's gender identity split reads identity off the expanded person (#2898 answer #78). A mocked
        repository can't catch a dropped column, so it is pinned against the real query."""
        sql_db.execute("UPDATE persons SET gender_identity_name = 'Non-binary', gender_identity_write_in = 'x'")
        repo = _make_repo(sql_db)
        result = await repo.fetch_attendees_with_dates(2025, expand_person=True)
        assert result
        for a in result:
            assert a.expand["person"].gender_identity_name == "Non-binary"
            assert a.expand["person"].gender_identity_write_in == "x"
        transitions = await repo.fetch_status_transitions(2025, to_statuses=["enrolled"], expand_person=True)
        assert transitions
        for t in transitions:
            assert t.expand["person"].gender_identity_name == "Non-binary"
            assert t.expand["person"].gender_identity_write_in == "x"


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
    async def test_compute_first_summer_years(self, sql_db: sqlite3.Connection) -> None:
        """compute_first_summer_years works on SQL-produced enrollment history."""
        from api.utils.session_metrics import compute_first_summer_years

        repo = _make_repo(sql_db)
        history = await repo.fetch_summer_enrollment_history({1001}, max_year=2025)
        assert compute_first_summer_years(history, {1001}) == {1001: 2024}


# ============================================================================
# Test: the drill-down list on this repository (epic #3207 PR 6 hotfix)
# ============================================================================


class TestDropInParity:
    """The router serves metrics from this repository by default (METRICS_SQL_ENABLED), so every
    method the services call on MetricsRepository must exist here too. #3249 added
    fetch_household_postal_codes to MetricsRepository only, and every drill-down list 500ed."""

    def test_every_public_method_of_metrics_repository_exists_here(self) -> None:
        import inspect

        from api.services.metrics_repository import MetricsRepository
        from api.services.metrics_sql_repository import MetricsSQLRepository

        def public(cls: type) -> set[str]:
            return {n for n, _ in inspect.getmembers(cls, inspect.isfunction) if not n.startswith("_")}

        assert public(MetricsRepository) - public(MetricsSQLRepository) == set()


class TestDrilldownPersonFields:
    """fetch_persons carries what the drill-down reads for Age, Zip and Caregivers.

    A mocked PocketBase repository can't catch a column this query never selects.
    """

    @pytest.mark.asyncio
    async def test_birthdate_household_and_caregivers(self, sql_db: sqlite3.Connection) -> None:
        sql_db.execute(
            "UPDATE persons SET birthdate = '2014-03-02', primary_childhood_household = 'hh_2001',"
            " parent_names = ? WHERE id = 'per_emma'",
            ('[{"first": "Sarah", "last": "Johnson", "relationship": "Mother"}]',),
        )
        repo = _make_repo(sql_db)
        emma = (await repo.fetch_persons(2025))[1001]
        assert emma.birthdate == "2014-03-02"
        assert emma.primary_childhood_household == "hh_2001"
        assert emma.parent_names == [{"first": "Sarah", "last": "Johnson", "relationship": "Mother"}]

    @pytest.mark.asyncio
    async def test_blank_fields_read_as_none(self, sql_db: sqlite3.Connection) -> None:
        sql_db.execute("UPDATE persons SET parent_names = 'null' WHERE id = 'per_liam'")
        repo = _make_repo(sql_db)
        persons = await repo.fetch_persons(2025)
        for person in (persons[1002], persons[1003]):
            assert person.birthdate is None
            assert person.primary_childhood_household is None
            assert person.parent_names is None


class TestFetchDrilldownHouseholds:
    """PR 6b: each household's CampMinder id (the list's group key and Household ID) and postal code."""

    @pytest.mark.asyncio
    async def test_this_seasons_households_keyed_by_pocketbase_id(self, sql_db: sqlite3.Connection) -> None:
        from api.services.metrics_repository import DrilldownHousehold

        sql_db.execute("UPDATE households SET billing_postal_code = '94110' WHERE id = 'hh_2001'")
        sql_db.execute(
            "INSERT INTO households (id, cm_id, year, billing_postal_code) VALUES ('hh_old', 2002, 2024, '94612')"
        )
        repo = _make_repo(sql_db)
        assert await repo.fetch_drilldown_households(2025) == {
            "hh_2001": DrilldownHousehold(cm_id=2001, postal_code="94110"),
            "hh_2002": DrilldownHousehold(cm_id=2002, postal_code=None),
            "hh_2003": DrilldownHousehold(cm_id=2003, postal_code=None),
        }


class TestDrilldownServiceOnSQL:
    """The drill-down list runs end to end on this repository, as the router builds it."""

    @pytest.mark.asyncio
    async def test_enrolled_list_carries_age_zip_and_caregivers(self, sql_db: sqlite3.Connection) -> None:
        from api.services.drilldown_service import DrilldownService

        sql_db.execute("UPDATE households SET billing_postal_code = '94110' WHERE id = 'hh_2001'")
        sql_db.execute(
            "UPDATE persons SET birthdate = '2014-03-02', primary_childhood_household = 'hh_2001',"
            " parent_names = ? WHERE id = 'per_emma'",
            ('[{"first": "Sarah", "last": "Johnson"}]',),
        )
        repo: Any = _make_repo(sql_db)  # as the router passes it (_create_repository)
        service = DrilldownService(repo)
        rows = await service.get_attendees_for_breakdown(2025, "status", "enrolled", status_filter=["enrolled"])
        emma = next(r for r in rows if r.person_id == 1001)
        assert (emma.age, emma.zip, emma.caregivers) == (11, "94110", ["Sarah Johnson"])
        assert emma.household_cm_id == 2001  # PR 6b: the group key and the CSV's Household ID


class TestRegistrationAgeOnSQL:
    """Registration › Overview's age chart (#3251) and its prior-year comparison, on this repository.

    The age band is the season year minus the birth year. fetch_persons never selected
    birthdate, so on this repository every camper read "none".
    """

    @pytest.mark.asyncio
    async def test_age_bands_read_birthdates_in_the_season_and_the_prior_season(
        self, sql_db: sqlite3.Connection
    ) -> None:
        from api.services.registration_service import RegistrationService

        for pid in ("per_emma", "per_emma_24"):
            sql_db.execute("UPDATE persons SET birthdate = '2014-03-02' WHERE id = ?", (pid,))
        for pid in ("per_liam", "per_liam_24"):
            sql_db.execute("UPDATE persons SET birthdate = '2016-05-05' WHERE id = ?", (pid,))
        repo: Any = _make_repo(sql_db)
        service = RegistrationService(repo)

        season = await service.calculate_registration(2025)
        prior = await service.calculate_registration(2024)

        # 2025: Emma 11, Liam 9, Olivia no birthdate. 2024: Emma 10, Liam 8.
        assert {b.band: b.count for b in season.by_age if b.count} == {"11-13": 1, "8-10": 1, "none": 1}
        assert {b.band: b.count for b in prior.by_age if b.count} == {"8-10": 2}


class TestFetchPersonsContract:
    """Both repositories read persons through one field list, so a field one path reads can't be
    missing on the other. #3249 (drill-down Age, Zip, Caregivers) and #3251 (the age chart) both
    shipped reading fields only the PocketBase repository returned."""

    @pytest.mark.asyncio
    async def test_sql_repository_returns_exactly_the_shared_fields(self, sql_db: sqlite3.Connection) -> None:
        from api.services.metrics_repository import PERSON_FIELDS

        repo = _make_repo(sql_db)
        for person in (await repo.fetch_persons(2025)).values():
            assert set(vars(person)) == set(PERSON_FIELDS)

    @pytest.mark.asyncio
    async def test_pocketbase_repository_asks_for_exactly_the_shared_fields(self) -> None:
        from unittest.mock import MagicMock

        from api.services.metrics_repository import PERSON_FIELDS, MetricsRepository

        pb = MagicMock()
        pb.collection.return_value.get_full_list.return_value = []
        await MetricsRepository(pb).fetch_persons(2025)

        params = pb.collection.return_value.get_full_list.call_args.kwargs["query_params"]
        assert params["fields"].split(",") == list(PERSON_FIELDS)

    def test_the_fields_the_drilldown_and_age_chart_read_are_shared(self) -> None:
        from api.services.metrics_repository import PERSON_FIELDS

        assert {"birthdate", "primary_childhood_household", "parent_names"} <= set(PERSON_FIELDS)

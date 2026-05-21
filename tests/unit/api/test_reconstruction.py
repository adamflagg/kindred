"""
Unit tests for the shared reconstruction module.

Tests verify the daily-aggregation logic that reconstructs enrollment counts
from attendee records at a given day offset from season start. This shared
module is used by both velocity and forecast services.
"""

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from api.services.reconstruction import reconstruct_enrollment_at_offset, reconstruct_enrollment_with_gender

# ============================================================================
# Constants
# ============================================================================

SEASON_START = datetime(2025, 10, 15)

# ============================================================================
# Test Data Factory
# ============================================================================


def _make_attendee(
    person_id: int,
    session_cm_id: int,
    status_id: int,
    enrollment_date: str,
    effective_date: str = "",
    *,
    session_name: str = "Session 1",
    session_type: str = "main",
    parent_id: int | None = None,
    start_date: str = "2025-06-15",
    end_date: str = "2025-07-15",
    year: int = 2025,
    status: str = "enrolled",
) -> SimpleNamespace:
    """Create a SimpleNamespace matching the shape from fetch_attendees_with_dates."""
    return SimpleNamespace(
        person_id=person_id,
        year=year,
        status=status,
        status_id=status_id,
        enrollment_date=enrollment_date,
        effective_date=effective_date,
        expand={
            "session": SimpleNamespace(
                cm_id=session_cm_id,
                name=session_name,
                session_type=session_type,
                parent_id=parent_id,
                start_date=start_date,
                end_date=end_date,
            )
        },
    )


def _mock_repo(attendees: list[SimpleNamespace]) -> AsyncMock:
    """Create a mock repository that returns the given attendees."""
    repo = AsyncMock()
    repo.fetch_attendees_with_dates.return_value = attendees
    return repo


# ============================================================================
# Tests
# ============================================================================


class TestReconstructEnrollmentAtOffset:
    """Tests for reconstruct_enrollment_at_offset."""

    @pytest.mark.asyncio
    async def test_empty_attendees_returns_empty(self) -> None:
        """Empty attendee list returns empty dict."""
        repo = _mock_repo([])
        sessions = {1000: SimpleNamespace(cm_id=1000, name="S1")}
        result = await reconstruct_enrollment_at_offset(
            repository=repo,
            year=2025,
            sessions=sessions,
            day_offset=30,
            season_start=SEASON_START,
        )
        assert result == {}

    @pytest.mark.asyncio
    async def test_single_enrollment_within_offset(self) -> None:
        """One enrolled attendee within day_offset is counted."""
        att = _make_attendee(
            person_id=1,
            session_cm_id=1000,
            status_id=2,
            enrollment_date="2025-10-20",
            effective_date="2025-10-20",
        )
        repo = _mock_repo([att])
        sessions = {1000: SimpleNamespace(cm_id=1000, name="S1")}

        result = await reconstruct_enrollment_at_offset(
            repository=repo,
            year=2025,
            sessions=sessions,
            day_offset=10,  # covers Oct 15-25
            season_start=SEASON_START,
        )
        assert result == {1000: 1}

    @pytest.mark.asyncio
    async def test_enrollment_after_offset_not_counted(self) -> None:
        """Enrolled after day_offset is not counted."""
        att = _make_attendee(
            person_id=1,
            session_cm_id=1000,
            status_id=2,
            enrollment_date="2025-11-01",
            effective_date="2025-11-01",
        )
        repo = _mock_repo([att])
        sessions = {1000: SimpleNamespace(cm_id=1000, name="S1")}

        result = await reconstruct_enrollment_at_offset(
            repository=repo,
            year=2025,
            sessions=sessions,
            day_offset=5,  # covers Oct 15-20 only
            season_start=SEASON_START,
        )
        # Session may not appear at all, or appear with 0
        assert result.get(1000, 0) == 0

    @pytest.mark.asyncio
    async def test_cancellation_subtracts_from_net(self) -> None:
        """Person enrolled then cancelled within offset: net decreases."""
        att = _make_attendee(
            person_id=1,
            session_cm_id=1000,
            status_id=32,  # cancelled
            enrollment_date="2025-10-22",  # cancel date (PostDate)
            effective_date="2025-10-18",  # original registration date
            status="cancelled",
        )
        repo = _mock_repo([att])
        sessions = {1000: SimpleNamespace(cm_id=1000, name="S1")}

        result = await reconstruct_enrollment_at_offset(
            repository=repo,
            year=2025,
            sessions=sessions,
            day_offset=10,  # covers Oct 15-25, includes both dates
            season_start=SEASON_START,
        )
        # Enrolled +1, cancelled -1 = net 0
        assert result.get(1000, 0) == 0

    @pytest.mark.asyncio
    async def test_cancellation_after_offset_not_subtracted(self) -> None:
        """Enrolled within offset, cancelled after offset: still counted."""
        att = _make_attendee(
            person_id=1,
            session_cm_id=1000,
            status_id=32,  # cancelled
            enrollment_date="2025-11-20",  # cancel date is after offset
            effective_date="2025-10-18",  # registration within offset
            status="cancelled",
        )
        repo = _mock_repo([att])
        sessions = {1000: SimpleNamespace(cm_id=1000, name="S1")}

        result = await reconstruct_enrollment_at_offset(
            repository=repo,
            year=2025,
            sessions=sessions,
            day_offset=10,  # covers Oct 15-25
            season_start=SEASON_START,
        )
        # Enrolled within offset, cancellation outside offset → net 1
        assert result == {1000: 1}

    @pytest.mark.asyncio
    async def test_multiple_sessions(self) -> None:
        """Attendees across sessions yield correct per-session counts."""
        att1 = _make_attendee(
            person_id=1,
            session_cm_id=1000,
            status_id=2,
            enrollment_date="2025-10-16",
            effective_date="2025-10-16",
        )
        att2 = _make_attendee(
            person_id=2,
            session_cm_id=1000,
            status_id=2,
            enrollment_date="2025-10-17",
            effective_date="2025-10-17",
        )
        att3 = _make_attendee(
            person_id=3,
            session_cm_id=2000,
            status_id=2,
            enrollment_date="2025-10-18",
            effective_date="2025-10-18",
            session_name="Session 2",
        )
        repo = _mock_repo([att1, att2, att3])
        sessions = {
            1000: SimpleNamespace(cm_id=1000, name="S1"),
            2000: SimpleNamespace(cm_id=2000, name="S2"),
        }

        result = await reconstruct_enrollment_at_offset(
            repository=repo,
            year=2025,
            sessions=sessions,
            day_offset=10,
            season_start=SEASON_START,
        )
        assert result == {1000: 2, 2000: 1}

    @pytest.mark.asyncio
    async def test_ag_parent_map_merges_children(self) -> None:
        """With ag_parent_map, AG child session merges into parent."""
        # Child session 2001 maps to parent 2000
        att = _make_attendee(
            person_id=1,
            session_cm_id=2001,
            status_id=2,
            enrollment_date="2025-10-18",
            effective_date="2025-10-18",
            session_name="AG Child",
        )
        repo = _mock_repo([att])
        sessions = {
            2000: SimpleNamespace(cm_id=2000, name="AG Parent"),
        }
        ag_parent_map = {2001: 2000}

        result = await reconstruct_enrollment_at_offset(
            repository=repo,
            year=2025,
            sessions=sessions,
            day_offset=10,
            season_start=SEASON_START,
            ag_parent_map=ag_parent_map,
        )
        # Merged into parent session 2000
        assert result == {2000: 1}

    @pytest.mark.asyncio
    async def test_no_ag_merge_when_map_is_none(self) -> None:
        """Without ag_parent_map, each session stays separate."""
        att = _make_attendee(
            person_id=1,
            session_cm_id=2001,
            status_id=2,
            enrollment_date="2025-10-18",
            effective_date="2025-10-18",
            session_name="AG Child",
        )
        repo = _mock_repo([att])
        sessions = {
            2001: SimpleNamespace(cm_id=2001, name="AG Child"),
        }

        result = await reconstruct_enrollment_at_offset(
            repository=repo,
            year=2025,
            sessions=sessions,
            day_offset=10,
            season_start=SEASON_START,
            ag_parent_map=None,
        )
        # No merging, kept as 2001
        assert result == {2001: 1}

    @pytest.mark.asyncio
    async def test_sessions_filter_excludes_unknown(self) -> None:
        """Attendee in unknown session (not in sessions dict) is not counted."""
        att = _make_attendee(
            person_id=1,
            session_cm_id=9999,
            status_id=2,
            enrollment_date="2025-10-18",
            effective_date="2025-10-18",
            session_name="Unknown Session",
        )
        repo = _mock_repo([att])
        sessions = {
            1000: SimpleNamespace(cm_id=1000, name="S1"),
        }

        result = await reconstruct_enrollment_at_offset(
            repository=repo,
            year=2025,
            sessions=sessions,
            day_offset=10,
            season_start=SEASON_START,
        )
        assert result == {}

    @pytest.mark.asyncio
    async def test_uses_enrollment_date_when_no_effective_date(self) -> None:
        """Falls back from effective_date to enrollment_date."""
        att = _make_attendee(
            person_id=1,
            session_cm_id=1000,
            status_id=2,
            enrollment_date="2025-10-20",
            effective_date="",  # no effective_date
        )
        repo = _mock_repo([att])
        sessions = {1000: SimpleNamespace(cm_id=1000, name="S1")}

        result = await reconstruct_enrollment_at_offset(
            repository=repo,
            year=2025,
            sessions=sessions,
            day_offset=10,
            season_start=SEASON_START,
        )
        assert result == {1000: 1}

    @pytest.mark.asyncio
    async def test_day_offset_zero_counts_only_season_start(self) -> None:
        """day_offset=0 counts only events on the season start day itself."""
        att_on_start = _make_attendee(
            person_id=1,
            session_cm_id=1000,
            status_id=2,
            enrollment_date="2025-10-15",
            effective_date="2025-10-15",
        )
        att_after = _make_attendee(
            person_id=2,
            session_cm_id=1000,
            status_id=2,
            enrollment_date="2025-10-16",
            effective_date="2025-10-16",
        )
        repo = _mock_repo([att_on_start, att_after])
        sessions = {1000: SimpleNamespace(cm_id=1000, name="S1")}

        result = await reconstruct_enrollment_at_offset(
            repository=repo,
            year=2025,
            sessions=sessions,
            day_offset=0,
            season_start=SEASON_START,
        )
        # Only the person enrolled on Oct 15 should be counted
        assert result == {1000: 1}

    @pytest.mark.asyncio
    async def test_withdrawn_status_counts_as_enrollment_and_cancellation(self) -> None:
        """Status 256 (withdrawn) counts as both enrollment and cancellation."""
        att = _make_attendee(
            person_id=1,
            session_cm_id=1000,
            status_id=256,  # withdrawn
            enrollment_date="2025-10-22",  # withdrawal date (PostDate)
            effective_date="2025-10-18",  # original registration
            status="withdrawn",
        )
        repo = _mock_repo([att])
        sessions = {1000: SimpleNamespace(cm_id=1000, name="S1")}

        result = await reconstruct_enrollment_at_offset(
            repository=repo,
            year=2025,
            sessions=sessions,
            day_offset=10,  # covers both dates
            season_start=SEASON_START,
        )
        # Enrolled +1, withdrawn -1 = net 0
        assert result.get(1000, 0) == 0


# ============================================================================
# Gender-Aware Reconstruction Tests
# ============================================================================


def _make_attendee_with_person(
    status_id: int,
    enrollment_date: str,
    effective_date: str,
    gender: str,
    session_cm_id: int = 1001,
    person_cm_id: int = 1000,
    *,
    status: str = "enrolled",
) -> SimpleNamespace:
    """Create a mock attendee with expanded person for gender."""
    person = SimpleNamespace(gender=gender, cm_id=person_cm_id)
    return SimpleNamespace(
        person_id=person_cm_id,
        year=2025,
        status=status,
        status_id=status_id,
        enrollment_date=enrollment_date,
        effective_date=effective_date,
        expand={
            "session": SimpleNamespace(
                cm_id=session_cm_id,
                name="Session 1",
                session_type="main",
                parent_id=None,
                start_date="2025-06-15",
                end_date="2025-07-15",
            ),
            "person": person,
        },
    )


def _mock_repo_with_person(attendees: list[SimpleNamespace]) -> AsyncMock:
    """Create a mock repository that returns attendees with person expand."""
    repo = AsyncMock()
    repo.fetch_attendees_with_dates.return_value = attendees
    return repo


class TestReconstructionWithGender:
    """Tests for reconstruct_enrollment_with_gender."""

    @pytest.mark.asyncio
    async def test_gender_counts_from_person_expand(self) -> None:
        """Gender breakdown comes from person expand data."""
        attendees = [
            _make_attendee_with_person(2, "2025-10-16", "2025-10-16", "M", person_cm_id=1),
            _make_attendee_with_person(2, "2025-10-17", "2025-10-17", "M", person_cm_id=2),
            _make_attendee_with_person(2, "2025-10-18", "2025-10-18", "F", person_cm_id=3),
        ]
        repo = _mock_repo_with_person(attendees)
        sessions = {1001: SimpleNamespace(cm_id=1001, name="S1")}

        result = await reconstruct_enrollment_with_gender(repo, 2025, sessions, 7, SEASON_START)

        assert result[1001]["enrolled"] == 3
        assert result[1001]["enrolled_boys"] == 2
        assert result[1001]["enrolled_girls"] == 1

    @pytest.mark.asyncio
    async def test_cancellation_decrements_gender_count(self) -> None:
        """Cancelled attendee with known gender decrements their gender count."""
        attendees = [
            _make_attendee_with_person(2, "2025-10-16", "2025-10-16", "M", person_cm_id=1),
            _make_attendee_with_person(2, "2025-10-17", "2025-10-17", "F", person_cm_id=2),
            _make_attendee_with_person(
                32,
                "2025-10-20",
                "2025-10-16",
                "M",
                person_cm_id=3,
                status="cancelled",
            ),
        ]
        repo = _mock_repo_with_person(attendees)
        sessions = {1001: SimpleNamespace(cm_id=1001, name="S1")}

        result = await reconstruct_enrollment_with_gender(repo, 2025, sessions, 10, SEASON_START)

        # 3 enrolled (person 1 M, person 2 F, person 3 M enrolled)
        # 1 cancelled (person 3 M cancelled within offset)
        # Net: 2 enrolled, 1 boy (2 enrolled - 1 cancelled), 1 girl
        assert result[1001]["enrolled"] == 2
        assert result[1001]["enrolled_boys"] == 1
        assert result[1001]["enrolled_girls"] == 1

    @pytest.mark.asyncio
    async def test_gender_none_without_person_expand(self) -> None:
        """When person expand is missing, gender counts are None."""
        att = SimpleNamespace(
            person_id=1,
            year=2025,
            status="enrolled",
            status_id=2,
            enrollment_date="2025-10-16",
            effective_date="2025-10-16",
            expand={
                "session": SimpleNamespace(
                    cm_id=1001,
                    name="S1",
                    session_type="main",
                    parent_id=None,
                    start_date="2025-06-15",
                    end_date="2025-07-15",
                ),
            },
        )
        repo = _mock_repo_with_person([att])
        sessions = {1001: SimpleNamespace(cm_id=1001, name="S1")}

        result = await reconstruct_enrollment_with_gender(repo, 2025, sessions, 7, SEASON_START)

        assert result[1001]["enrolled"] == 1
        assert result[1001]["enrolled_boys"] is None
        assert result[1001]["enrolled_girls"] is None

    @pytest.mark.asyncio
    async def test_multiple_sessions_gender_split(self) -> None:
        """Gender counts are tracked per session."""
        attendees = [
            _make_attendee_with_person(2, "2025-10-16", "2025-10-16", "M", session_cm_id=1001, person_cm_id=1),
            _make_attendee_with_person(2, "2025-10-17", "2025-10-17", "F", session_cm_id=1001, person_cm_id=2),
            _make_attendee_with_person(2, "2025-10-16", "2025-10-16", "F", session_cm_id=2001, person_cm_id=3),
            _make_attendee_with_person(2, "2025-10-17", "2025-10-17", "F", session_cm_id=2001, person_cm_id=4),
        ]
        repo = _mock_repo_with_person(attendees)
        sessions = {
            1001: SimpleNamespace(cm_id=1001, name="S1"),
            2001: SimpleNamespace(cm_id=2001, name="S2"),
        }

        result = await reconstruct_enrollment_with_gender(repo, 2025, sessions, 7, SEASON_START)

        assert result[1001]["enrolled_boys"] == 1
        assert result[1001]["enrolled_girls"] == 1
        assert result[2001]["enrolled_boys"] == 0
        assert result[2001]["enrolled_girls"] == 2


# ============================================================================
# parse_date_only Tests
# ============================================================================


class TestParseDateOnly:
    """Tests for the public parse_date_only utility."""

    def test_iso_datetime_with_utc(self):
        from api.services.reconstruction import parse_date_only

        assert parse_date_only("2026-03-13T14:30:00Z") == "2026-03-13"

    def test_space_separated_datetime(self):
        from api.services.reconstruction import parse_date_only

        assert parse_date_only("2026-03-13 14:30:00") == "2026-03-13"

    def test_date_only_string(self):
        from api.services.reconstruction import parse_date_only

        assert parse_date_only("2026-03-13") == "2026-03-13"

    def test_iso_with_timezone_offset(self):
        from api.services.reconstruction import parse_date_only

        assert parse_date_only("2026-03-13T14:30:00+05:00") == "2026-03-13"


# ============================================================================
# Pre-Anchor Enrollment Tests (Week 0)
# ============================================================================


class TestPreAnchorEnrollments:
    """Tests for enrollments before the season start (Week 0)."""

    @pytest.mark.asyncio
    async def test_pre_anchor_enrollment_counted(self) -> None:
        """Attendee enrolled before season_start should be counted."""
        att = _make_attendee(
            person_id=1,
            session_cm_id=1000,
            status_id=2,
            enrollment_date="2025-10-10",
            effective_date="2025-10-10",
        )
        repo = _mock_repo([att])
        sessions = {1000: SimpleNamespace(cm_id=1000, name="S1")}

        result = await reconstruct_enrollment_at_offset(
            repository=repo,
            year=2025,
            sessions=sessions,
            day_offset=10,  # covers Oct 15-25 (but enrollment is Oct 10, before anchor)
            season_start=SEASON_START,  # Oct 15
        )
        assert result == {1000: 1}

    @pytest.mark.asyncio
    async def test_pre_anchor_enrollment_with_gender(self) -> None:
        """Pre-anchor attendee with gender data should populate gender counts."""
        att = _make_attendee(
            person_id=1,
            session_cm_id=1000,
            status_id=2,
            enrollment_date="2025-10-10",
            effective_date="2025-10-10",
        )
        # Add gender via person expand
        att.expand["person"] = SimpleNamespace(gender="F")

        repo = _mock_repo([att])
        sessions = {1000: SimpleNamespace(cm_id=1000, name="S1")}

        result = await reconstruct_enrollment_with_gender(
            repository=repo,
            year=2025,
            sessions=sessions,
            day_offset=10,
            season_start=SEASON_START,
        )
        assert result[1000]["enrolled"] == 1
        assert result[1000]["enrolled_girls"] == 1
        assert result[1000]["enrolled_boys"] == 0

    @pytest.mark.asyncio
    async def test_pre_anchor_far_back_still_counted(self) -> None:
        """Enrollment 30 days before anchor is still counted in results."""
        att = _make_attendee(
            person_id=1,
            session_cm_id=1000,
            status_id=2,
            enrollment_date="2025-09-15",
            effective_date="2025-09-15",
        )
        repo = _mock_repo([att])
        sessions = {1000: SimpleNamespace(cm_id=1000, name="S1")}

        result = await reconstruct_enrollment_at_offset(
            repository=repo,
            year=2025,
            sessions=sessions,
            day_offset=30,
            season_start=SEASON_START,
        )
        assert result == {1000: 1}

    @pytest.mark.asyncio
    async def test_pre_anchor_cancellation_before_cutoff_subtracted(self) -> None:
        """Pre-anchor enroll + pre-anchor cancel = net 0."""
        att = _make_attendee(
            person_id=1,
            session_cm_id=1000,
            status_id=32,
            enrollment_date="2025-10-12",  # cancel date before anchor
            effective_date="2025-10-08",  # enrollment date before anchor
            status="cancelled",
        )
        repo = _mock_repo([att])
        sessions = {1000: SimpleNamespace(cm_id=1000, name="S1")}

        result = await reconstruct_enrollment_at_offset(
            repository=repo,
            year=2025,
            sessions=sessions,
            day_offset=10,
            season_start=SEASON_START,
        )
        assert result.get(1000, 0) == 0

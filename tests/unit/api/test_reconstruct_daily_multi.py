"""Tests for reconstruct_daily_multi — single-pass daily reconstruction."""

from datetime import date
from types import SimpleNamespace

from api.services.reconstruction import reconstruct_daily_multi

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_attendee(
    *,
    session_cm_id: int,
    status_id: int = 2,
    effective_date: str = "",
    enrollment_date: str = "",
    gender: str | None = None,
) -> SimpleNamespace:
    """Create a fake attendee with expand.session and expand.person."""
    session = SimpleNamespace(cm_id=session_cm_id)
    person = SimpleNamespace(gender=gender) if gender is not None else SimpleNamespace(gender=None)
    return SimpleNamespace(
        status_id=status_id,
        effective_date=effective_date,
        enrollment_date=enrollment_date,
        expand={"session": session, "person": person},
    )


def _make_sessions(*cm_ids: int) -> dict[int, SimpleNamespace]:
    return {sid: SimpleNamespace(cm_id=sid, name=f"Session {sid}") for sid in cm_ids}


SEASON_START = date(2025, 11, 1)
END_DATE = date(2025, 11, 5)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestReconstructDailyMulti:
    """Tests for reconstruct_daily_multi."""

    def test_returns_tuple(self):
        """Returns (combined, per_session) tuple."""
        sessions = _make_sessions(100, 200)
        result = reconstruct_daily_multi(
            attendees=[],
            season_start=SEASON_START,
            sessions=sessions,
            end_date=END_DATE,
        )
        assert isinstance(result, tuple)
        assert len(result) == 2

    def test_empty_attendees(self):
        """Empty attendees returns empty daily lists."""
        sessions = _make_sessions(100)
        combined, per_session = reconstruct_daily_multi(
            attendees=[],
            season_start=SEASON_START,
            sessions=sessions,
            end_date=END_DATE,
        )
        # Combined still has day entries (one per day) even with no events
        assert len(combined) == 5  # Nov 1-5
        assert all(dp.enrolled == 0 for dp in combined)
        assert per_session == {}

    def test_single_enrollment_daily_fields(self):
        """Single enrollment produces correct daily_new, enrolled, day_offset, data_source."""
        attendees = [_make_attendee(session_cm_id=100, effective_date="2025-11-01")]
        sessions = _make_sessions(100)

        combined, _ = reconstruct_daily_multi(
            attendees=attendees,
            season_start=SEASON_START,
            sessions=sessions,
            end_date=END_DATE,
        )

        assert len(combined) == 5  # Nov 1-5
        assert combined[0].date == "2025-11-01"
        assert combined[0].day_offset == 0
        assert combined[0].daily_new == 1
        assert combined[0].enrolled == 1
        assert combined[0].gross_enrolled == 1
        assert combined[0].data_source == "reconstructed"
        # Day 2: no new, cumulative carries
        assert combined[1].daily_new == 0
        assert combined[1].enrolled == 1

    def test_effective_date_fallback_to_enrollment_date(self):
        """When effective_date is missing, falls back to enrollment_date truncated."""
        attendees = [
            _make_attendee(
                session_cm_id=100,
                effective_date="",
                enrollment_date="2025-11-02 16:00:00.000Z",
            ),
        ]
        sessions = _make_sessions(100)

        combined, _ = reconstruct_daily_multi(
            attendees=attendees,
            season_start=SEASON_START,
            sessions=sessions,
            end_date=END_DATE,
        )

        # Should bucket on Nov 2 (truncated from enrollment_date)
        assert combined[0].daily_new == 0  # Nov 1: nothing
        assert combined[1].daily_new == 1  # Nov 2: fallback enrollment
        assert combined[1].enrolled == 1

    def test_per_session_buckets_correctly(self):
        """Per-session output correctly buckets by session."""
        attendees = [
            _make_attendee(session_cm_id=100, effective_date="2025-11-01"),
            _make_attendee(session_cm_id=200, effective_date="2025-11-02"),
            _make_attendee(session_cm_id=100, effective_date="2025-11-03"),
        ]
        sessions = _make_sessions(100, 200)

        _, per_session = reconstruct_daily_multi(
            attendees=attendees,
            season_start=SEASON_START,
            sessions=sessions,
            end_date=END_DATE,
            session_ids=[100, 200],
        )

        assert 100 in per_session
        assert 200 in per_session

        # Session 100: enrollments on Nov 1 and Nov 3
        s100 = per_session[100]
        assert s100[0].daily_new == 1  # Nov 1
        assert s100[1].daily_new == 0  # Nov 2
        assert s100[2].daily_new == 1  # Nov 3
        assert s100[2].enrolled == 2

        # Session 200: enrollment on Nov 2 only
        s200 = per_session[200]
        assert s200[0].daily_new == 0  # Nov 1
        assert s200[1].daily_new == 1  # Nov 2
        assert s200[1].enrolled == 1

    def test_session_ids_filter(self):
        """Only requested session_ids appear in per_session output."""
        attendees = [
            _make_attendee(session_cm_id=100, effective_date="2025-11-01"),
            _make_attendee(session_cm_id=200, effective_date="2025-11-02"),
            _make_attendee(session_cm_id=300, effective_date="2025-11-03"),
        ]
        sessions = _make_sessions(100, 200, 300)

        _, per_session = reconstruct_daily_multi(
            attendees=attendees,
            season_start=SEASON_START,
            sessions=sessions,
            end_date=END_DATE,
            session_ids=[100, 300],
        )

        assert set(per_session.keys()) == {100, 300}
        assert 200 not in per_session

    def test_session_ids_none_returns_all(self):
        """When session_ids is None, all sessions with data appear in per_session."""
        attendees = [
            _make_attendee(session_cm_id=100, effective_date="2025-11-01"),
            _make_attendee(session_cm_id=200, effective_date="2025-11-02"),
        ]
        sessions = _make_sessions(100, 200)

        _, per_session = reconstruct_daily_multi(
            attendees=attendees,
            season_start=SEASON_START,
            sessions=sessions,
            end_date=END_DATE,
            session_ids=None,
        )

        assert set(per_session.keys()) == {100, 200}

    def test_cancellation_events(self):
        """Cancellations are tracked in both combined and per-session."""
        attendees = [
            _make_attendee(
                session_cm_id=100,
                status_id=32,  # cancelled
                effective_date="2025-11-01",
                enrollment_date="2025-11-03",
            ),
        ]
        sessions = _make_sessions(100)

        combined, per_session = reconstruct_daily_multi(
            attendees=attendees,
            season_start=SEASON_START,
            sessions=sessions,
            end_date=END_DATE,
            session_ids=[100],
        )

        # Day 3 (Nov 3) should show the cancellation
        assert combined[2].daily_cancelled == 1  # index 2 = Nov 3
        assert combined[2].cancelled == 1
        assert per_session[100][2].daily_cancelled == 1

    def test_ag_parent_mapping(self):
        """AG parent mapping merges child sessions into parent."""
        attendees = [
            _make_attendee(session_cm_id=101, effective_date="2025-11-01"),  # AG child
            _make_attendee(session_cm_id=100, effective_date="2025-11-02"),  # parent
        ]
        sessions = _make_sessions(100)
        ag_parent_map = {101: 100}

        combined, per_session = reconstruct_daily_multi(
            attendees=attendees,
            season_start=SEASON_START,
            sessions=sessions,
            end_date=END_DATE,
            ag_parent_map=ag_parent_map,
            session_ids=[100],
        )

        # Both attendees should be merged into session 100
        assert combined[1].enrolled == 2  # by Nov 2, both enrolled
        assert per_session[100][1].enrolled == 2

    def test_session_cm_id_filter_combined(self):
        """session_cm_id filters the combined output to a single session."""
        attendees = [
            _make_attendee(session_cm_id=100, effective_date="2025-11-01"),
            _make_attendee(session_cm_id=200, effective_date="2025-11-02"),
        ]
        sessions = _make_sessions(100, 200)

        combined, _ = reconstruct_daily_multi(
            attendees=attendees,
            season_start=SEASON_START,
            sessions=sessions,
            end_date=END_DATE,
            session_cm_id=100,
        )

        # Combined should only include session 100
        assert combined[0].daily_new == 1  # Nov 1: session 100 enrolls
        assert combined[1].daily_new == 0  # Nov 2: session 200 enrolls, filtered out
        assert combined[4].enrolled == 1  # Only 1 enrollment total

    def test_empty_session_ids_returns_empty_per_session(self):
        """session_ids=[] produces combined data with all attendees but empty per_session."""
        attendees = [
            _make_attendee(session_cm_id=100, effective_date="2025-11-01"),
            _make_attendee(session_cm_id=200, effective_date="2025-11-01"),
        ]
        sessions = _make_sessions(100, 200)

        combined, per_session = reconstruct_daily_multi(
            attendees=attendees,
            season_start=SEASON_START,
            sessions=sessions,
            end_date=date(2025, 11, 1),
            session_ids=[],
        )

        # Combined still includes all attendees
        assert combined[0].gross_enrolled == 2
        # Per-session is empty (no sessions requested)
        assert per_session == {}

    def test_gender_data_propagated(self):
        """Gender data is propagated to both combined and per-session outputs."""
        attendees = [
            _make_attendee(session_cm_id=100, effective_date="2025-11-01", gender="M"),
            _make_attendee(session_cm_id=100, effective_date="2025-11-02", gender="F"),
        ]
        sessions = _make_sessions(100)

        combined, per_session = reconstruct_daily_multi(
            attendees=attendees,
            season_start=SEASON_START,
            sessions=sessions,
            end_date=END_DATE,
            session_ids=[100],
        )

        assert combined[0].daily_new_boys == 1
        assert combined[1].daily_new_girls == 1
        assert per_session[100][0].daily_new_boys == 1
        assert per_session[100][1].daily_new_girls == 1

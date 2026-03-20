"""Tests for reconstruct_daily_multi — single-pass daily reconstruction."""

from __future__ import annotations

from datetime import date
from types import SimpleNamespace

from api.services.reconstruction import reconstruct_daily, reconstruct_daily_multi

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

    def test_combined_matches_reconstruct_daily(self):
        """Combined output matches calling reconstruct_daily with no session filter."""
        attendees = [
            _make_attendee(session_cm_id=100, effective_date="2025-11-01"),
            _make_attendee(session_cm_id=200, effective_date="2025-11-02"),
            _make_attendee(session_cm_id=100, effective_date="2025-11-03"),
        ]
        sessions = _make_sessions(100, 200)

        expected = reconstruct_daily(
            attendees=attendees,
            season_start=SEASON_START,
            sessions=sessions,
            end_date=END_DATE,
        )

        combined, _ = reconstruct_daily_multi(
            attendees=attendees,
            season_start=SEASON_START,
            sessions=sessions,
            end_date=END_DATE,
        )

        assert len(combined) == len(expected)
        for c, e in zip(combined, expected, strict=True):
            assert c.date == e.date
            assert c.enrolled == e.enrolled
            assert c.gross_enrolled == e.gross_enrolled
            assert c.cancelled == e.cancelled
            assert c.daily_new == e.daily_new
            assert c.daily_cancelled == e.daily_cancelled

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

        # Verify per-session matches calling reconstruct_daily with session filter
        for sid in [100, 200]:
            expected = reconstruct_daily(
                attendees=attendees,
                season_start=SEASON_START,
                sessions=sessions,
                end_date=END_DATE,
                session_cm_id=sid,
            )
            actual = per_session[sid]
            assert len(actual) == len(expected)
            for a, e in zip(actual, expected, strict=True):
                assert a.date == e.date
                assert a.enrolled == e.enrolled
                assert a.daily_new == e.daily_new

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

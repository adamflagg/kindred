"""Tests for daily reconstruction from attendee records."""

from typing import Any

from datetime import date

from api.services.reconstruction import reconstruct_daily


def _make_attendee(
    *,
    session_cm_id: int = 1001,
    status_id: int = 2,
    effective_date: str = "2025-11-12 00:00:00.000Z",
    enrollment_date: str = "2025-11-12 16:00:00.000Z",
    gender: str | None = None,
    person_id: str = "P1",
) -> Any:
    """Build a mock attendee record matching PocketBase expand dict shape.

    IMPORTANT: Real PocketBase records use a dict-based `expand` with nested
    objects. Session cm_id is accessed via expand["session"].cm_id, NOT
    via att.session_cm_id directly. This mock mirrors that contract.
    """
    session = type("Session", (), {"cm_id": session_cm_id})()
    att = type("Att", (), {})()
    att.status_id = status_id
    att.effective_date = effective_date
    att.enrollment_date = enrollment_date
    att.person_id = person_id
    # Build expand dict matching PocketBase expand pattern
    expand: dict[str, Any] = {"session": session}
    if gender is not None:
        person = type("Person", (), {"gender": gender})()
        expand["person"] = person
    att.expand = expand
    return att


def test_reconstruct_daily_single_enrollment():
    """One enrollment on day 1 should produce a daily point with enrolled=1."""
    attendees = [_make_attendee(effective_date="2025-11-12 00:00:00.000Z")]
    season_start = date(2025, 11, 12)
    sessions = {1001: type("S", (), {"cm_id": 1001, "session_type": "main"})()}

    result = reconstruct_daily(
        attendees=attendees,
        season_start=season_start,
        sessions=sessions,
        end_date=date(2025, 11, 14),
    )

    assert len(result) == 3  # Nov 12, 13, 14
    assert result[0].date == "2025-11-12"
    assert result[0].day_offset == 0
    assert result[0].daily_new == 1
    assert result[0].enrolled == 1
    assert result[0].gross_enrolled == 1
    assert result[0].data_source == "reconstructed"
    # Day 2: no new, cumulative carries
    assert result[1].daily_new == 0
    assert result[1].enrolled == 1


def test_reconstruct_daily_enrollment_then_cancellation():
    """Enrollment on day 1, cancellation on day 3."""
    attendees = [
        _make_attendee(
            status_id=32,  # cancelled
            effective_date="2025-11-12 00:00:00.000Z",
            enrollment_date="2025-11-14 10:00:00.000Z",  # cancellation date
        ),
    ]
    season_start = date(2025, 11, 12)
    sessions = {1001: type("S", (), {"cm_id": 1001, "session_type": "main"})()}

    result = reconstruct_daily(
        attendees=attendees,
        season_start=season_start,
        sessions=sessions,
        end_date=date(2025, 11, 15),
    )

    # Day 1 (Nov 12): enrolled via effective_date
    assert result[0].daily_new == 1
    assert result[0].enrolled == 1
    assert result[0].gross_enrolled == 1
    # Day 3 (Nov 14): cancelled via enrollment_date
    assert result[2].daily_cancelled == 1
    assert result[2].enrolled == 0  # net = gross - cancelled
    assert result[2].gross_enrolled == 1  # gross never decreases


def test_reconstruct_daily_multiple_sessions_combined():
    """Multiple sessions are summed in combined output."""
    attendees = [
        _make_attendee(session_cm_id=1001, effective_date="2025-11-12 00:00:00.000Z"),
        _make_attendee(session_cm_id=1002, effective_date="2025-11-12 00:00:00.000Z", person_id="P2"),
        _make_attendee(session_cm_id=1002, effective_date="2025-11-13 00:00:00.000Z", person_id="P3"),
    ]
    season_start = date(2025, 11, 12)
    sessions = {
        1001: type("S", (), {"cm_id": 1001, "session_type": "main"})(),
        1002: type("S", (), {"cm_id": 1002, "session_type": "main"})(),
    }

    result = reconstruct_daily(
        attendees=attendees,
        season_start=season_start,
        sessions=sessions,
        end_date=date(2025, 11, 13),
    )

    assert result[0].daily_new == 2  # 2 enrollments on Nov 12
    assert result[0].enrolled == 2
    assert result[1].daily_new == 1  # 1 enrollment on Nov 13
    assert result[1].enrolled == 3


def test_reconstruct_daily_gender_split():
    """Gender data produces non-null boys/girls counts."""
    attendees = [
        _make_attendee(effective_date="2025-11-12 00:00:00.000Z", gender="M", person_id="P1"),
        _make_attendee(effective_date="2025-11-12 00:00:00.000Z", gender="F", person_id="P2"),
        _make_attendee(effective_date="2025-11-12 00:00:00.000Z", gender="M", person_id="P3"),
    ]
    season_start = date(2025, 11, 12)
    sessions = {1001: type("S", (), {"cm_id": 1001, "session_type": "main"})()}

    result = reconstruct_daily(
        attendees=attendees,
        season_start=season_start,
        sessions=sessions,
        end_date=date(2025, 11, 12),
    )

    assert result[0].enrolled_boys == 2
    assert result[0].enrolled_girls == 1
    assert result[0].gross_enrolled_boys == 2
    assert result[0].gross_enrolled_girls == 1


def test_reconstruct_daily_effective_date_fallback():
    """When effective_date is missing, fall back to enrollment_date truncated."""
    attendees = [
        _make_attendee(
            effective_date="",
            enrollment_date="2025-11-12 16:00:00.000Z",
        ),
    ]
    season_start = date(2025, 11, 12)
    sessions = {1001: type("S", (), {"cm_id": 1001, "session_type": "main"})()}

    result = reconstruct_daily(
        attendees=attendees,
        season_start=season_start,
        sessions=sessions,
        end_date=date(2025, 11, 12),
    )

    assert result[0].daily_new == 1
    assert result[0].enrolled == 1


def test_reconstruct_daily_ag_parent_mapping():
    """AG children get mapped to parent session."""
    attendees = [
        _make_attendee(session_cm_id=2001, effective_date="2025-11-12 00:00:00.000Z"),  # AG child
    ]
    season_start = date(2025, 11, 12)
    sessions = {
        1001: type("S", (), {"cm_id": 1001, "session_type": "main"})(),
        2001: type("S", (), {"cm_id": 2001, "session_type": "ag"})(),
    }
    ag_parent_map = {2001: 1001}

    result = reconstruct_daily(
        attendees=attendees,
        season_start=season_start,
        sessions=sessions,
        end_date=date(2025, 11, 12),
        ag_parent_map=ag_parent_map,
    )

    # AG child counts toward the combined total
    assert result[0].daily_new == 1
    assert result[0].enrolled == 1

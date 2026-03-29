"""Tests for EnrollmentInfo model — enrollment status classification."""

from bunking.sync.bunk_request_processor.core.models import EnrollmentInfo


class TestEnrollmentInfo:
    """Test EnrollmentInfo status classification properties."""

    def test_enrolled_is_active(self):
        info = EnrollmentInfo(session_cm_id=1000010, status_id=2)
        assert info.is_active is True
        assert info.is_pending_enrollment is False
        assert info.is_inactive is False

    def test_waitlisted_is_pending(self):
        info = EnrollmentInfo(session_cm_id=1000010, status_id=8)
        assert info.is_active is False
        assert info.is_pending_enrollment is True
        assert info.is_inactive is False

    def test_applied_is_pending(self):
        info = EnrollmentInfo(session_cm_id=1000010, status_id=4)
        assert info.is_pending_enrollment is True
        assert info.is_inactive is False

    def test_inquiry_is_pending(self):
        info = EnrollmentInfo(session_cm_id=1000010, status_id=128)
        assert info.is_pending_enrollment is True

    def test_cancelled_is_inactive(self):
        info = EnrollmentInfo(session_cm_id=1000010, status_id=32)
        assert info.is_active is False
        assert info.is_pending_enrollment is False
        assert info.is_inactive is True

    def test_dismissed_is_inactive(self):
        info = EnrollmentInfo(session_cm_id=1000010, status_id=64)
        assert info.is_inactive is True

    def test_withdrawn_is_inactive(self):
        info = EnrollmentInfo(session_cm_id=1000010, status_id=256)
        assert info.is_inactive is True

    def test_incomplete_is_inactive(self):
        info = EnrollmentInfo(session_cm_id=1000010, status_id=512)
        assert info.is_inactive is True

    def test_left_early_is_inactive(self):
        info = EnrollmentInfo(session_cm_id=1000010, status_id=16)
        assert info.is_inactive is True

    def test_none_status_is_inactive(self):
        info = EnrollmentInfo(session_cm_id=1000010, status_id=1)
        assert info.is_inactive is True

    def test_unknown_status_is_none_of_the_groups(self):
        """A status_id not in any group (e.g., 9999) should be False for all."""
        info = EnrollmentInfo(session_cm_id=1000010, status_id=9999)
        assert info.is_active is False
        assert info.is_pending_enrollment is False
        assert info.is_inactive is False

    def test_stores_session_and_status(self):
        info = EnrollmentInfo(session_cm_id=1235406, status_id=32)
        assert info.session_cm_id == 1235406
        assert info.status_id == 32

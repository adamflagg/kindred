"""Tests for session resolution — cm_id based, no friendly name parsing.

resolve_session_cm_ids accepts "all" or a cm_id string. The friendly name system
(_extract_friendly_name, get_valid_session_names, resolve_session_name) was removed
because it caused name collisions (e.g., Taste of Camp 1 and 2 both mapping to "1")
and cross-year AG ghost sessions.
"""

from unittest.mock import MagicMock, Mock

import pytest

from bunking.sync.bunk_request_processor.data.repositories.session_repository import (
    SessionRepository,
)


class TestResolveSessionCmIds:
    """Tests for the simplified resolve_session_cm_ids method."""

    def test_all_returns_valid_bunking_session_ids(self):
        """'all' delegates to get_valid_bunking_session_ids — no name parsing."""
        repo = SessionRepository(MagicMock())
        repo.get_valid_bunking_session_ids = Mock(return_value={1000001, 1000002, 1000003})  # type: ignore[method-assign]

        result = repo.resolve_session_cm_ids("all", 2026)

        repo.get_valid_bunking_session_ids.assert_called_once_with(2026)
        assert set(result) == {1000001, 1000002, 1000003}

    def test_all_includes_toc_sessions(self):
        """'all' includes Taste of Camp sessions — the bug that triggered this rewrite."""
        repo = SessionRepository(MagicMock())
        # Simulate: ToC 1 (main), ToC 2 (embedded), Session 2 (main), AG session
        repo.get_valid_bunking_session_ids = Mock(  # type: ignore[method-assign]
            return_value={1000001, 1000002, 1000003, 1000011}
        )

        result = repo.resolve_session_cm_ids("all", 2026)

        assert 1000001 in result  # Taste of Camp 1 — was missing before
        assert 1000002 in result  # Taste of Camp 2
        assert 1000003 in result  # Session 2
        assert 1000011 in result  # AG session

    def test_zero_is_alias_for_all(self):
        """'0' is a legacy alias for 'all' (backward compat for documented commands)."""
        repo = SessionRepository(MagicMock())
        repo.get_valid_bunking_session_ids = Mock(return_value={1000001, 1000002})  # type: ignore[method-assign]

        result = repo.resolve_session_cm_ids("0", 2026)

        repo.get_valid_bunking_session_ids.assert_called_once_with(2026)
        assert set(result) == {1000001, 1000002}

    def test_all_does_not_include_cross_year_sessions(self):
        """'all' only returns sessions for the requested year — no stale AG expansion."""
        repo = SessionRepository(MagicMock())
        # get_valid_bunking_session_ids already filters by year
        repo.get_valid_bunking_session_ids = Mock(return_value={100, 200})  # type: ignore[method-assign]

        result = repo.resolve_session_cm_ids("all", 2026)

        # Should only have the 2 IDs, not expanded cross-year AG sessions
        assert len(result) == 2

    def test_cm_id_string_expands_ag_children(self):
        """A numeric cm_id expands to include AG children via get_related_session_ids."""
        repo = SessionRepository(MagicMock())
        repo.get_related_session_ids = Mock(return_value=[1000003, 1000011])  # type: ignore[method-assign]

        result = repo.resolve_session_cm_ids("1000003", 2026)

        repo.get_related_session_ids.assert_called_once_with(1000003)
        assert set(result) == {1000003, 1000011}

    def test_cm_id_string_large_number(self):
        """CampMinder IDs can be 7+ digits."""
        repo = SessionRepository(MagicMock())
        repo.get_related_session_ids = Mock(return_value=[1000001])  # type: ignore[method-assign]

        result = repo.resolve_session_cm_ids("1000001", 2026)

        assert result == [1000001]

    def test_invalid_string_raises_error(self):
        """Non-numeric, non-'all' string raises ValueError."""
        repo = SessionRepository(MagicMock())

        with pytest.raises(ValueError, match="Invalid session"):
            repo.resolve_session_cm_ids("toc", 2026)

    def test_empty_string_raises_error(self):
        """Empty string raises ValueError."""
        repo = SessionRepository(MagicMock())

        with pytest.raises(ValueError, match="Invalid session"):
            repo.resolve_session_cm_ids("", 2026)

    def test_friendly_names_no_longer_accepted(self):
        """Old friendly names like '2a', 'toc' are no longer valid (not cm_ids)."""
        repo = SessionRepository(MagicMock())

        # "2a" is not numeric — should raise
        with pytest.raises(ValueError, match="Invalid session"):
            repo.resolve_session_cm_ids("2a", 2026)


class TestFriendlyNameMethodsRemoved:
    """Verify the old name-parsing methods no longer exist."""

    def test_no_extract_friendly_name(self):
        repo = SessionRepository(pb_client=None)
        assert not hasattr(repo, "_extract_friendly_name")

    def test_no_get_valid_session_names(self):
        repo = SessionRepository(pb_client=None)
        assert not hasattr(repo, "get_valid_session_names")

    def test_no_resolve_session_name(self):
        repo = SessionRepository(pb_client=None)
        assert not hasattr(repo, "resolve_session_name")

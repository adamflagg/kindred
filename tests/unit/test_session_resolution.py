"""Tests for dynamic session name resolution.

These tests verify that session friendly names (e.g., "2", "2a", "toc") are correctly
resolved to CampMinder IDs by querying the database for the given year.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from unittest.mock import Mock

import pytest

if TYPE_CHECKING:
    from bunking.sync.bunk_request_processor.data.repositories.session_repository import (
        SessionRepository,
    )

# Import will work after implementation
# from bunking.sync.bunk_request_processor.data.repositories.session_repository import (
#     SessionRepository,
# )


class TestExtractFriendlyName:
    """Tests for _extract_friendly_name method."""

    def test_extracts_main_session_number(self):
        """Session 2 → '2'"""
        repo = self._create_repo()
        assert repo._extract_friendly_name("Session 2") == "2"

    def test_extracts_session_with_suffix(self):
        """Session 2a → '2a'"""
        repo = self._create_repo()
        assert repo._extract_friendly_name("Session 2a") == "2a"

    def test_extracts_session_with_uppercase_suffix(self):
        """Session 3A → '3a' (lowercased)"""
        repo = self._create_repo()
        assert repo._extract_friendly_name("Session 3A") == "3a"

    def test_extracts_taste_of_camp_as_1(self):
        """Taste of Camp → '1'"""
        repo = self._create_repo()
        assert repo._extract_friendly_name("Taste of Camp") == "1"

    def test_taste_of_camp_case_insensitive(self):
        """TASTE OF CAMP → '1'"""
        repo = self._create_repo()
        assert repo._extract_friendly_name("TASTE OF CAMP") == "1"

    def test_returns_none_for_ag_session(self):
        """All-Gender sessions should not be extracted."""
        repo = self._create_repo()
        assert repo._extract_friendly_name("All-Gender Cabin-Session 2 (9th & 10th)") is None

    def test_returns_none_for_unrecognized(self):
        """Unrecognized session names return None."""
        repo = self._create_repo()
        assert repo._extract_friendly_name("Family Camp Week 1") is None

    def test_handles_extra_whitespace(self):
        """Session  3 (extra space) → '3'"""
        repo = self._create_repo()
        # The regex handles \s+ so multiple spaces work
        assert repo._extract_friendly_name("Session  3") == "3"

    def _create_repo(self):
        """Create a SessionRepository with mock client."""
        from bunking.sync.bunk_request_processor.data.repositories.session_repository import (
            SessionRepository,
        )

        return SessionRepository(pb_client=None)


class TestGetValidSessionNames:
    """Tests for get_valid_session_names method."""

    def test_returns_empty_dict_without_client(self):
        """Without PocketBase client, returns empty dict."""
        from bunking.sync.bunk_request_processor.data.repositories.session_repository import (
            SessionRepository,
        )

        repo = SessionRepository(pb_client=None)
        result = repo.get_valid_session_names(2025)
        assert result == {}

    def test_filters_to_main_and_embedded_only(self):
        """Only main and embedded session types are included."""
        repo, mock_pb = self._create_repo_with_sessions(
            [
                {"cm_id": 1001, "name": "Session 2", "session_type": "main"},
                {"cm_id": 1002, "name": "Session 2a", "session_type": "embedded"},
                {"cm_id": 1003, "name": "All-Gender Session 2", "session_type": "ag"},
                {"cm_id": 1004, "name": "Family Camp", "session_type": "family"},
            ]
        )
        result = repo.get_valid_session_names(2025)

        # Only main and embedded should be included
        assert "2" in result
        assert "2a" in result
        # AG and family should be excluded
        assert len(result) == 2

    def test_includes_toc_alias(self):
        """When session 1 exists, 'toc' alias is added."""
        repo, _ = self._create_repo_with_sessions(
            [
                {"cm_id": 1001, "name": "Taste of Camp", "session_type": "main"},
            ]
        )
        result = repo.get_valid_session_names(2025)

        assert "1" in result
        assert "toc" in result
        assert result["1"] == result["toc"]

    def test_returns_is_main_flag_correctly(self):
        """Main sessions return True, embedded return False for is_main flag."""
        repo, _ = self._create_repo_with_sessions(
            [
                {"cm_id": 1001, "name": "Session 2", "session_type": "main"},
                {"cm_id": 1002, "name": "Session 2a", "session_type": "embedded"},
            ]
        )
        result = repo.get_valid_session_names(2025)

        cm_id, is_main = result["2"]
        assert cm_id == 1001
        assert is_main is True

        cm_id, is_main = result["2a"]
        assert cm_id == 1002
        assert is_main is False

    def _create_repo_with_sessions(self, sessions: list[dict[str, Any]]) -> tuple[SessionRepository, Mock]:
        """Create repo with mocked session data."""
        from bunking.sync.bunk_request_processor.data.repositories.session_repository import (
            SessionRepository,
        )

        mock_pb = Mock()
        repo = SessionRepository(pb_client=mock_pb)

        # Mock get_all_for_year to return our test sessions
        repo.get_all_for_year = Mock(return_value=sessions)  # type: ignore[method-assign]

        return repo, mock_pb


class TestResolveSessionName:
    """Tests for resolve_session_name method."""

    def test_all_returns_none_and_no_ag(self):
        """'all' returns (None, False)."""
        repo = self._create_repo_with_sessions([{"cm_id": 1001, "name": "Session 2", "session_type": "main"}])
        cm_id, include_ag = repo.resolve_session_name("all", 2025)

        assert cm_id is None
        assert include_ag is False

    def test_numeric_zero_returns_none(self):
        """'0' returns (None, False) for backward compat."""
        repo = self._create_repo_with_sessions([{"cm_id": 1001, "name": "Session 2", "session_type": "main"}])
        cm_id, include_ag = repo.resolve_session_name("0", 2025)

        assert cm_id is None
        assert include_ag is False

    def test_main_session_includes_ag(self):
        """Main session '2' returns (cm_id, True) to include AG."""
        repo = self._create_repo_with_sessions([{"cm_id": 1001, "name": "Session 2", "session_type": "main"}])
        cm_id, include_ag = repo.resolve_session_name("2", 2025)

        assert cm_id == 1001
        assert include_ag is True

    def test_embedded_session_no_ag(self):
        """Embedded session '2a' returns (cm_id, False) - no AG expansion."""
        repo = self._create_repo_with_sessions([{"cm_id": 1002, "name": "Session 2a", "session_type": "embedded"}])
        cm_id, include_ag = repo.resolve_session_name("2a", 2025)

        assert cm_id == 1002
        assert include_ag is False

    def test_case_insensitive(self):
        """Session names are case-insensitive."""
        repo = self._create_repo_with_sessions([{"cm_id": 1001, "name": "Taste of Camp", "session_type": "main"}])

        # Both uppercase and lowercase should work
        cm_id1, _ = repo.resolve_session_name("TOC", 2025)
        cm_id2, _ = repo.resolve_session_name("toc", 2025)
        cm_id3, _ = repo.resolve_session_name("1", 2025)

        assert cm_id1 == cm_id2 == cm_id3 == 1001

    def test_invalid_session_raises_error(self):
        """Unknown session name raises ValueError with valid options."""
        repo = self._create_repo_with_sessions(
            [
                {"cm_id": 1001, "name": "Session 2", "session_type": "main"},
                {"cm_id": 1002, "name": "Session 3", "session_type": "main"},
            ]
        )

        with pytest.raises(ValueError) as exc_info:
            repo.resolve_session_name("5", 2025)

        error_msg = str(exc_info.value)
        assert "Unknown session '5'" in error_msg
        assert "2025" in error_msg
        assert "2" in error_msg  # Valid option listed
        assert "3" in error_msg  # Valid option listed

    def test_backward_compat_numeric_1_to_4(self):
        """Numeric strings '1', '2', '3', '4' work."""
        repo = self._create_repo_with_sessions(
            [
                {"cm_id": 1001, "name": "Taste of Camp", "session_type": "main"},
                {"cm_id": 1002, "name": "Session 2", "session_type": "main"},
                {"cm_id": 1003, "name": "Session 3", "session_type": "main"},
                {"cm_id": 1004, "name": "Session 4", "session_type": "main"},
            ]
        )

        for session_num in ["1", "2", "3", "4"]:
            cm_id, include_ag = repo.resolve_session_name(session_num, 2025)
            assert cm_id is not None
            assert include_ag is True  # All main sessions include AG

    def test_whitespace_handling(self):
        """Leading/trailing whitespace is stripped."""
        repo = self._create_repo_with_sessions([{"cm_id": 1001, "name": "Session 2", "session_type": "main"}])

        cm_id, _ = repo.resolve_session_name("  2  ", 2025)
        assert cm_id == 1001

    def test_future_session_4a(self):
        """Future embedded sessions like '4a' work when in database."""
        repo = self._create_repo_with_sessions([{"cm_id": 1005, "name": "Session 4a", "session_type": "embedded"}])

        cm_id, include_ag = repo.resolve_session_name("4a", 2025)
        assert cm_id == 1005
        assert include_ag is False  # Embedded sessions don't include AG

    def _create_repo_with_sessions(self, sessions: list[dict[str, Any]]) -> SessionRepository:
        """Create repo with mocked session data."""
        from bunking.sync.bunk_request_processor.data.repositories.session_repository import (
            SessionRepository,
        )

        repo = SessionRepository(pb_client=Mock())
        repo.get_all_for_year = Mock(return_value=sessions)  # type: ignore[method-assign]
        return repo

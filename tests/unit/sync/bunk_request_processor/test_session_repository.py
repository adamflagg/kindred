"""Tests for SessionRepository - Data access for camp sessions.

These tests verify the session repository functionality, particularly
the get_friendly_name method that mirrors monolith's _get_session_friendly_name."""

from __future__ import annotations

from unittest.mock import MagicMock, Mock

from bunking.sync.bunk_request_processor.data.repositories.session_repository import (
    SessionRepository,
)


class TestGetFriendlyName:
    """Tests for SessionRepository.get_friendly_name method"""

    def test_get_friendly_name_returns_db_name_when_found(self):
        """Verify DB lookup takes priority when session exists."""
        # Arrange
        mock_pb = MagicMock()
        mock_session = Mock()
        mock_session.name = "Session 2"

        mock_result = Mock()
        mock_result.items = [mock_session]
        mock_pb.collection.return_value.get_list.return_value = mock_result

        repo = SessionRepository(pb_client=mock_pb)

        # Act
        result = repo.get_friendly_name(1000002)

        # Assert
        assert result == "Session 2"
        mock_pb.collection.assert_called_with("camp_sessions")

    def test_get_friendly_name_falls_back_to_generic_on_db_error(self):
        """Verify fallback to generic format when DB fails.

        This is intentional - we want DB failures to be visible rather than
        silently returning stale hardcoded data.
        """
        # Arrange
        mock_pb = MagicMock()
        mock_pb.collection.return_value.get_list.side_effect = Exception("DB error")

        repo = SessionRepository(pb_client=mock_pb)

        # Act
        result = repo.get_friendly_name(1000002)

        # Assert - generic format makes DB failure visible
        assert result == "Session 1000002"

    def test_get_friendly_name_falls_back_to_generic_when_not_in_db(self):
        """Verify fallback to generic format when session not found in DB.

        This is intentional - if a session ID doesn't exist in the database,
        we should show the raw ID rather than potentially stale hardcoded data.
        """
        # Arrange
        mock_pb = MagicMock()
        mock_result = Mock()
        mock_result.items = []  # Empty result
        mock_pb.collection.return_value.get_list.return_value = mock_result

        repo = SessionRepository(pb_client=mock_pb)

        # Act
        result = repo.get_friendly_name(1000001)

        # Assert - generic format makes missing session visible
        assert result == "Session 1000001"

    def test_get_friendly_name_falls_back_to_generic_format(self):
        """Verify ultimate fallback to generic format for unknown session."""
        # Arrange
        mock_pb = MagicMock()
        mock_result = Mock()
        mock_result.items = []
        mock_pb.collection.return_value.get_list.return_value = mock_result

        repo = SessionRepository(pb_client=mock_pb)

        # Act
        result = repo.get_friendly_name(9999999)  # Unknown session ID

        # Assert
        assert result == "Session 9999999"

    def test_get_friendly_name_without_pb_client(self):
        """Verify generic fallback when no PocketBase client available.

        Without a database connection, all session IDs return the generic format.
        This makes it clear that the system requires a working database.
        """
        # Arrange
        repo = SessionRepository(pb_client=None)

        # Act & Assert - all return generic format without DB
        assert repo.get_friendly_name(1000001) == "Session 1000001"
        assert repo.get_friendly_name(1000002) == "Session 1000002"
        assert repo.get_friendly_name(1000003) == "Session 1000003"
        assert repo.get_friendly_name(9999) == "Session 9999"


class TestGetValidBunkingSessionIds:
    """Tests for SessionRepository.get_valid_bunking_session_ids method.

    This method should return CM IDs of all sessions that are valid for bunking:
    - session_type = "main" (e.g., Session 1, 2, 3, 4)
    - session_type = "embedded" (e.g., Session 2a, 2b, 3a)
    - session_type = "ag" (e.g., All-Gender sessions)

    Excludes family camps and other non-bunking session types.
    """

    def test_returns_main_embedded_ag_sessions(self):
        """Should return all valid bunking session types."""
        # Arrange
        mock_pb = MagicMock()

        # Mock sessions of different types
        sessions = [
            Mock(cm_id=1000001, session_type="main"),  # Taste of Camp
            Mock(cm_id=1000002, session_type="main"),  # Session 2
            Mock(cm_id=1000021, session_type="embedded"),  # Session 2a
            Mock(cm_id=1000022, session_type="embedded"),  # Session 2b
            Mock(cm_id=1000023, session_type="ag"),  # AG Session 2
            Mock(cm_id=9999, session_type="family"),  # Family camp - excluded
        ]
        mock_pb.collection.return_value.get_full_list.return_value = sessions

        repo = SessionRepository(pb_client=mock_pb)

        # Act
        result = repo.get_valid_bunking_session_ids(2025)

        # Assert
        assert result == {1000001, 1000002, 1000021, 1000022, 1000023}
        assert 9999 not in result  # Family camp should be excluded

        # Verify correct filter was used
        mock_pb.collection.assert_called_with("camp_sessions")
        call_args = mock_pb.collection.return_value.get_full_list.call_args
        assert "year = 2025" in call_args.kwargs["query_params"]["filter"]

    def test_returns_empty_set_without_pb_client(self):
        """Should return empty set when no PocketBase client."""
        repo = SessionRepository(pb_client=None)
        result = repo.get_valid_bunking_session_ids(2025)
        assert result == set()

    def test_returns_empty_set_on_db_error(self):
        """Should return empty set on database error."""
        mock_pb = MagicMock()
        mock_pb.collection.return_value.get_full_list.side_effect = Exception("DB error")

        repo = SessionRepository(pb_client=mock_pb)
        result = repo.get_valid_bunking_session_ids(2025)

        assert result == set()


class TestGetRelatedSessionIds:
    """Tests for SessionRepository.get_related_session_ids method.

    Related sessions are:
    - AG sessions that have parent_id pointing to the given session (for main sessions)
    - The main session that an AG session points to via parent_id

    NOTE: Embedded sessions (2a, 2b, 3a) are INDEPENDENT and NOT related.
    They use the same physical bunks but during different time periods.
    """

    def test_main_session_returns_self_and_ag_children(self):
        """Main session should return itself and any AG sessions that reference it."""
        # Arrange
        mock_pb = MagicMock()

        # Main session (Session 2)
        main_session = Mock(cm_id=1000002, session_type="main", parent_id=None, name="Session 2")

        # AG sessions pointing to this main session
        ag_session = Mock(cm_id=1000023, session_type="ag", parent_id=1000002, name="AG 2")

        # Other sessions that should NOT be included (defined for clarity, not returned by mock)
        _ = Mock(cm_id=1000021, session_type="embedded", parent_id=None, name="Session 2a")  # embedded
        _ = Mock(cm_id=1000003, session_type="main", parent_id=None, name="Session 3")  # other_main

        def get_sessions_by_filter(query_params):
            filter_str = query_params.get("filter", "")
            if f"cm_id = {main_session.cm_id}" in filter_str:
                return [main_session]
            elif "parent_id" in filter_str and str(main_session.cm_id) in filter_str:
                return [ag_session]
            return []

        mock_pb.collection.return_value.get_full_list.side_effect = get_sessions_by_filter

        repo = SessionRepository(pb_client=mock_pb)

        # Act
        result = repo.get_related_session_ids(1000002, year=2025)

        # Assert
        assert 1000002 in result  # Self
        assert 1000023 in result  # AG child
        assert 1000021 not in result  # Embedded is independent
        assert 1000003 not in result  # Different main session

    def test_ag_session_returns_self_and_parent_main(self):
        """AG session should return itself and its parent main session."""
        # Arrange
        mock_pb = MagicMock()

        # AG session pointing to parent
        ag_session = Mock(cm_id=1000023, session_type="ag", parent_id=1000002, name="AG 2")

        # Parent main session
        main_session = Mock(cm_id=1000002, session_type="main", parent_id=None, name="Session 2")

        def get_sessions_by_filter(query_params):
            filter_str = query_params.get("filter", "")
            if f"cm_id = {ag_session.cm_id}" in filter_str:
                return [ag_session]
            elif f"cm_id = {main_session.cm_id}" in filter_str:
                return [main_session]
            elif "parent_id" in filter_str:
                return []  # No children of AG session
            return []

        mock_pb.collection.return_value.get_full_list.side_effect = get_sessions_by_filter

        repo = SessionRepository(pb_client=mock_pb)

        # Act
        result = repo.get_related_session_ids(1000023, year=2025)

        # Assert
        assert 1000023 in result  # Self
        assert 1000002 in result  # Parent main session

    def test_embedded_session_returns_only_self(self):
        """Embedded sessions are independent and return only themselves."""
        # Arrange
        mock_pb = MagicMock()

        # Embedded session (no parent relationship)
        embedded_session = Mock(cm_id=1000021, session_type="embedded", parent_id=None, name="Session 2a")

        def get_sessions_by_filter(query_params):
            filter_str = query_params.get("filter", "")
            if f"cm_id = {embedded_session.cm_id}" in filter_str:
                return [embedded_session]
            elif "parent_id" in filter_str:
                return []  # No children
            return []

        mock_pb.collection.return_value.get_full_list.side_effect = get_sessions_by_filter

        repo = SessionRepository(pb_client=mock_pb)

        # Act
        result = repo.get_related_session_ids(1000021, year=2025)

        # Assert
        assert result == [1000021]  # Only self

    def test_returns_only_self_without_pb_client(self):
        """Should return only the input session when no PocketBase client."""
        repo = SessionRepository(pb_client=None)
        result = repo.get_related_session_ids(1000002)
        assert result == [1000002]

    def test_returns_only_self_when_session_not_found(self):
        """Should return only input session if it doesn't exist in DB."""
        mock_pb = MagicMock()
        mock_pb.collection.return_value.get_full_list.return_value = []

        repo = SessionRepository(pb_client=mock_pb)
        result = repo.get_related_session_ids(9999999, year=2025)

        assert result == [9999999]


class TestIsValidBunkingSession:
    """Tests for SessionRepository.is_valid_bunking_session method."""

    def test_returns_true_for_valid_session(self):
        """Should return True for a session that's in valid bunking sessions."""
        mock_pb = MagicMock()
        sessions = [Mock(cm_id=1000002, session_type="main")]
        mock_pb.collection.return_value.get_full_list.return_value = sessions

        repo = SessionRepository(pb_client=mock_pb)
        result = repo.is_valid_bunking_session(1000002, 2025)

        assert result is True

    def test_returns_false_for_invalid_session(self):
        """Should return False for a session not in valid bunking sessions."""
        mock_pb = MagicMock()
        sessions = [Mock(cm_id=1000002, session_type="main")]
        mock_pb.collection.return_value.get_full_list.return_value = sessions

        repo = SessionRepository(pb_client=mock_pb)
        result = repo.is_valid_bunking_session(9999999, 2025)

        assert result is False

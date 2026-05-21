"""
Unit tests for session_utils.get_related_session_ids.

Covers the bug where AG sessions missing cm_id would emit 0 into
downstream filter strings (e.g. session_id = 0).
"""

from unittest.mock import AsyncMock, Mock, patch

import pytest


class TestGetRelatedSessionIds:
    """Tests for get_related_session_ids function."""

    @pytest.fixture
    def mock_pb_client(self):
        """Create a mock PocketBase client."""
        return Mock()

    @pytest.fixture
    def mock_main_session(self):
        """A normal main session with a valid cm_id."""
        session = Mock()
        session.cm_id = 12345
        session.name = "Session 2"
        session.session_type = "main"
        session.year = 2025
        return session

    @pytest.fixture
    def mock_ag_session_with_cm_id(self):
        """An AG session that has a valid cm_id."""
        session = Mock()
        session.cm_id = 67890
        session.name = "Session 2 AG"
        session.session_type = "ag"
        session.parent_id = 12345
        session.year = 2025
        return session

    @pytest.fixture
    def mock_ag_session_missing_cm_id(self):
        """
        An AG session whose cm_id attribute is absent (data-hygiene gap).

        Using spec=[] ensures getattr(session, 'cm_id', 0) returns the
        fallback 0 — exactly the pre-fix behaviour we're guarding against.
        """
        session = Mock(spec=[])  # no attributes at all
        return session

    # ------------------------------------------------------------------
    # RED: AG session without cm_id MUST NOT produce 0 in the result
    # ------------------------------------------------------------------

    @pytest.mark.asyncio
    async def test_ag_session_missing_cm_id_does_not_emit_zero(
        self, mock_pb_client, mock_main_session, mock_ag_session_missing_cm_id
    ):
        """
        Core bug regression: get_related_session_ids must not include 0
        when an AG session record is missing the cm_id field.
        """
        from api.services.session_utils import get_related_session_ids

        def mock_get_full_list(query_params=None):
            filter_str = (query_params or {}).get("filter", "")
            if f"cm_id = {mock_main_session.cm_id} && year = 2025" in filter_str:
                return [mock_main_session]
            if 'session_type = "ag"' in filter_str:
                return [mock_ag_session_missing_cm_id]
            return []

        mock_collection = Mock()
        mock_collection.get_full_list = mock_get_full_list
        mock_pb_client.collection.return_value = mock_collection

        with patch("api.services.session_utils.asyncio.to_thread", new=AsyncMock(side_effect=lambda f, **kw: f(**kw))):
            result = await get_related_session_ids(12345, 2025, mock_pb_client)

        assert 0 not in result, f"cm_id=0 must not appear in related_ids; got {result}"

    @pytest.mark.asyncio
    async def test_ag_session_missing_cm_id_emits_warning(
        self, mock_pb_client, mock_main_session, mock_ag_session_missing_cm_id
    ):
        """
        A logger.warning must fire when an AG session is missing cm_id
        (data-quality alert per acceptance criteria).
        """
        from api.services.session_utils import get_related_session_ids

        def mock_get_full_list(query_params=None):
            filter_str = (query_params or {}).get("filter", "")
            if f"cm_id = {mock_main_session.cm_id} && year = 2025" in filter_str:
                return [mock_main_session]
            if 'session_type = "ag"' in filter_str:
                return [mock_ag_session_missing_cm_id]
            return []

        mock_collection = Mock()
        mock_collection.get_full_list = mock_get_full_list
        mock_pb_client.collection.return_value = mock_collection

        with patch("api.services.session_utils.asyncio.to_thread", new=AsyncMock(side_effect=lambda f, **kw: f(**kw))):
            with patch("api.services.session_utils.logger") as mock_logger:
                await get_related_session_ids(12345, 2025, mock_pb_client)

        assert mock_logger.warning.called, "logger.warning should fire for AG session with missing cm_id"

    # ------------------------------------------------------------------
    # GREEN baseline: normal AG session still appears in result
    # ------------------------------------------------------------------

    @pytest.mark.asyncio
    async def test_ag_session_with_valid_cm_id_is_included(
        self, mock_pb_client, mock_main_session, mock_ag_session_with_cm_id
    ):
        """AG session with a valid positive cm_id is included in result."""
        from api.services.session_utils import get_related_session_ids

        def mock_get_full_list(query_params=None):
            filter_str = (query_params or {}).get("filter", "")
            if f"cm_id = {mock_main_session.cm_id} && year = 2025" in filter_str:
                return [mock_main_session]
            if 'session_type = "ag"' in filter_str:
                return [mock_ag_session_with_cm_id]
            return []

        mock_collection = Mock()
        mock_collection.get_full_list = mock_get_full_list
        mock_pb_client.collection.return_value = mock_collection

        with patch("api.services.session_utils.asyncio.to_thread", new=AsyncMock(side_effect=lambda f, **kw: f(**kw))):
            result = await get_related_session_ids(12345, 2025, mock_pb_client)

        assert 12345 in result
        assert 67890 in result
        assert 0 not in result

    @pytest.mark.asyncio
    async def test_no_ag_sessions_returns_only_main(self, mock_pb_client, mock_main_session):
        """When there are no AG sessions, only the main session id is returned."""
        from api.services.session_utils import get_related_session_ids

        def mock_get_full_list(query_params=None):
            filter_str = (query_params or {}).get("filter", "")
            if f"cm_id = {mock_main_session.cm_id} && year = 2025" in filter_str:
                return [mock_main_session]
            return []

        mock_collection = Mock()
        mock_collection.get_full_list = mock_get_full_list
        mock_pb_client.collection.return_value = mock_collection

        with patch("api.services.session_utils.asyncio.to_thread", new=AsyncMock(side_effect=lambda f, **kw: f(**kw))):
            result = await get_related_session_ids(12345, 2025, mock_pb_client)

        assert result == [12345]

    @pytest.mark.asyncio
    async def test_mixed_ag_sessions_filters_missing_cm_id(
        self, mock_pb_client, mock_main_session, mock_ag_session_with_cm_id, mock_ag_session_missing_cm_id
    ):
        """
        When some AG sessions have cm_id and others don't, only valid ones
        are included; 0 never appears.
        """
        from api.services.session_utils import get_related_session_ids

        def mock_get_full_list(query_params=None):
            filter_str = (query_params or {}).get("filter", "")
            if f"cm_id = {mock_main_session.cm_id} && year = 2025" in filter_str:
                return [mock_main_session]
            if 'session_type = "ag"' in filter_str:
                return [mock_ag_session_with_cm_id, mock_ag_session_missing_cm_id]
            return []

        mock_collection = Mock()
        mock_collection.get_full_list = mock_get_full_list
        mock_pb_client.collection.return_value = mock_collection

        with patch("api.services.session_utils.asyncio.to_thread", new=AsyncMock(side_effect=lambda f, **kw: f(**kw))):
            result = await get_related_session_ids(12345, 2025, mock_pb_client)

        assert 12345 in result
        assert 67890 in result
        assert 0 not in result

"""
Unit tests for SessionContext service.

Tests the centralized session/year validation and filter building logic.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, Mock, patch

import pytest
from fastapi import HTTPException


class TestBuildSessionContext:
    """Tests for build_session_context function."""

    @pytest.fixture
    def mock_pb_client(self):
        """Create a mock PocketBase client."""
        return Mock()

    @pytest.fixture
    def mock_main_session(self):
        """Create a mock main session record."""
        session = Mock()
        session.id = "pb_session_123"
        session.cm_id = 12345
        session.name = "Session 2"
        session.session_type = "main"
        session.year = 2025
        return session

    @pytest.fixture
    def mock_ag_session(self):
        """Create a mock AG session record."""
        session = Mock()
        session.id = "pb_ag_456"
        session.cm_id = 67890
        session.name = "Session 2 AG"
        session.session_type = "ag"
        session.parent_id = 12345
        session.year = 2025
        return session

    @pytest.fixture
    def mock_embedded_session(self):
        """Create a mock embedded session record."""
        session = Mock()
        session.id = "pb_embed_789"
        session.cm_id = 11111
        session.name = "Session 2a"
        session.session_type = "embedded"
        session.year = 2025
        return session

    @pytest.mark.asyncio
    async def test_valid_session_returns_context(self, mock_pb_client, mock_main_session, mock_ag_session):
        """Valid session/year returns a fully populated SessionContext."""
        from api.services.session_context import build_session_context

        # Setup mock for finding the main session
        def mock_get_full_list(query_params=None):
            filter_str = query_params.get("filter", "")
            if "cm_id = 12345 && year = 2025" in filter_str:
                return [mock_main_session]
            elif 'session_type = "ag"' in filter_str:
                return [mock_ag_session]
            elif "cm_id = 12345" in filter_str or "cm_id = 67890" in filter_str:
                return [mock_main_session, mock_ag_session]
            return []

        mock_collection = Mock()
        mock_collection.get_full_list = mock_get_full_list
        mock_pb_client.collection.return_value = mock_collection

        with patch("api.services.session_utils.asyncio.to_thread", new=AsyncMock(side_effect=lambda f, **kw: f(**kw))):
            with patch(
                "api.services.session_context.asyncio.to_thread", new=AsyncMock(side_effect=lambda f, **kw: f(**kw))
            ):
                ctx = await build_session_context(12345, 2025, mock_pb_client)

        assert ctx.session_cm_id == 12345
        assert ctx.year == 2025
        assert ctx.session_pb_id == "pb_session_123"
        assert ctx.session_name == "Session 2"
        assert ctx.session_type == "main"
        assert 12345 in ctx.related_session_ids
        assert 67890 in ctx.related_session_ids
        assert "session.cm_id = 12345" in ctx.session_relation_filter
        assert "session.cm_id = 67890" in ctx.session_relation_filter
        assert "session_id = 12345" in ctx.session_id_filter
        assert "session_id = 67890" in ctx.session_id_filter

    @pytest.mark.asyncio
    async def test_invalid_session_raises_404(self, mock_pb_client):
        """Non-existent session raises HTTPException 404."""
        from api.services.session_context import build_session_context

        mock_collection = Mock()
        mock_collection.get_full_list = Mock(return_value=[])
        mock_pb_client.collection.return_value = mock_collection

        with patch(
            "api.services.session_context.asyncio.to_thread", new=AsyncMock(side_effect=lambda f, **kw: f(**kw))
        ):
            with pytest.raises(HTTPException) as exc_info:
                await build_session_context(99999, 2025, mock_pb_client)

        assert exc_info.value.status_code == 404
        assert "99999" in str(exc_info.value.detail)
        assert "2025" in str(exc_info.value.detail)

    @pytest.mark.asyncio
    async def test_wrong_year_raises_404(self, mock_pb_client, mock_main_session):
        """Session exists in different year raises HTTPException 404."""
        from api.services.session_context import build_session_context

        def mock_get_full_list(query_params=None):
            filter_str = query_params.get("filter", "")
            # Session exists for 2025 but not 2024
            if "year = 2024" in filter_str:
                return []
            if "year = 2025" in filter_str:
                return [mock_main_session]
            return []

        mock_collection = Mock()
        mock_collection.get_full_list = mock_get_full_list
        mock_pb_client.collection.return_value = mock_collection

        with patch(
            "api.services.session_context.asyncio.to_thread", new=AsyncMock(side_effect=lambda f, **kw: f(**kw))
        ):
            with pytest.raises(HTTPException) as exc_info:
                await build_session_context(12345, 2024, mock_pb_client)

        assert exc_info.value.status_code == 404
        assert "2024" in str(exc_info.value.detail)

    @pytest.mark.asyncio
    async def test_embedded_session_no_related_sessions(self, mock_pb_client, mock_embedded_session):
        """Embedded session has no related AG sessions."""
        from api.services.session_context import build_session_context

        def mock_get_full_list(query_params=None):
            filter_str = query_params.get("filter", "")
            if "cm_id = 11111 && year = 2025" in filter_str:
                return [mock_embedded_session]
            elif 'session_type = "ag"' in filter_str:
                # Embedded sessions have no AG children
                return []
            elif "cm_id = 11111" in filter_str:
                return [mock_embedded_session]
            return []

        mock_collection = Mock()
        mock_collection.get_full_list = mock_get_full_list
        mock_pb_client.collection.return_value = mock_collection

        with patch("api.services.session_utils.asyncio.to_thread", new=AsyncMock(side_effect=lambda f, **kw: f(**kw))):
            with patch(
                "api.services.session_context.asyncio.to_thread", new=AsyncMock(side_effect=lambda f, **kw: f(**kw))
            ):
                ctx = await build_session_context(11111, 2025, mock_pb_client)

        assert ctx.session_cm_id == 11111
        assert ctx.session_type == "embedded"
        # Only the session itself, no related AG sessions
        assert len(ctx.related_session_ids) == 1
        assert 11111 in ctx.related_session_ids

    @pytest.mark.asyncio
    async def test_filter_strings_correctly_built(self, mock_pb_client, mock_main_session, mock_ag_session):
        """Filter strings use correct format for PocketBase queries."""
        from api.services.session_context import build_session_context

        def mock_get_full_list(query_params=None):
            filter_str = query_params.get("filter", "")
            if "cm_id = 12345 && year = 2025" in filter_str:
                return [mock_main_session]
            elif 'session_type = "ag"' in filter_str:
                return [mock_ag_session]
            elif "cm_id = 12345" in filter_str or "cm_id = 67890" in filter_str:
                return [mock_main_session, mock_ag_session]
            return []

        mock_collection = Mock()
        mock_collection.get_full_list = mock_get_full_list
        mock_pb_client.collection.return_value = mock_collection

        with patch("api.services.session_utils.asyncio.to_thread", new=AsyncMock(side_effect=lambda f, **kw: f(**kw))):
            with patch(
                "api.services.session_context.asyncio.to_thread", new=AsyncMock(side_effect=lambda f, **kw: f(**kw))
            ):
                ctx = await build_session_context(12345, 2025, mock_pb_client)

        # session_relation_filter uses "session.cm_id = X" format
        assert ctx.session_relation_filter == "session.cm_id = 12345 || session.cm_id = 67890"

        # session_id_filter uses "session_id = X" format
        assert ctx.session_id_filter == "session_id = 12345 || session_id = 67890"

        # session_pb_id_filter uses 'session = "X"' format for PB relation fields
        assert 'session = "pb_session_123"' in ctx.session_pb_id_filter
        assert 'session = "pb_ag_456"' in ctx.session_pb_id_filter


class TestSessionContextDataclass:
    """Tests for the SessionContext dataclass."""

    def test_context_is_frozen(self):
        """SessionContext is immutable (frozen=True)."""
        from api.services.id_cache import IDLookupCache
        from api.services.session_context import SessionContext

        mock_pb = Mock()
        ctx = SessionContext(
            session_cm_id=12345,
            year=2025,
            session_pb_id="abc123",
            session_name="Test Session",
            session_type="main",
            related_session_ids=[12345],
            session_relation_filter="session.cm_id = 12345",
            session_id_filter="session_id = 12345",
            session_pb_id_filter='session = "abc123"',
            id_cache=IDLookupCache(mock_pb, 2025),
        )

        # Attempting to modify should raise FrozenInstanceError
        with pytest.raises(Exception):  # dataclasses.FrozenInstanceError is subclass of Exception
            ctx.year = 2024  # type: ignore[misc]

    def test_context_has_all_required_fields(self):
        """SessionContext contains all fields needed for queries."""
        from api.services.id_cache import IDLookupCache
        from api.services.session_context import SessionContext

        mock_pb = Mock()
        ctx = SessionContext(
            session_cm_id=12345,
            year=2025,
            session_pb_id="abc123",
            session_name="Test Session",
            session_type="main",
            related_session_ids=[12345, 67890],
            session_relation_filter="session.cm_id = 12345 || session.cm_id = 67890",
            session_id_filter="session_id = 12345 || session_id = 67890",
            session_pb_id_filter='session = "abc123" || session = "def456"',
            id_cache=IDLookupCache(mock_pb, 2025),
        )

        # All fields are accessible
        assert ctx.session_cm_id == 12345
        assert ctx.year == 2025
        assert ctx.session_pb_id == "abc123"
        assert ctx.session_name == "Test Session"
        assert ctx.session_type == "main"
        assert len(ctx.related_session_ids) == 2
        assert ctx.session_relation_filter is not None
        assert ctx.session_id_filter is not None
        assert ctx.session_pb_id_filter is not None
        assert ctx.id_cache is not None

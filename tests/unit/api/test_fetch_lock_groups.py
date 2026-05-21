"""Tests for fetch_lock_groups function in data_fetcher."""

from unittest.mock import AsyncMock, Mock, patch

import pytest

from api.services.data_fetcher import fetch_lock_groups


def _mock_locked_group(group_id: str, scenario: str, session: str, year: int) -> Mock:
    """Create a mock locked_groups record."""
    group = Mock()
    group.id = group_id
    group.scenario = scenario
    group.session = session
    group.year = year
    return group


def _mock_locked_group_member(group_id: str, attendee_person_id: int, member_id: str = "mem_x") -> Mock:
    """Create a mock locked_group_members record with expanded attendee."""
    member = Mock()
    member.id = member_id
    member.group = group_id
    member.expand = {"attendee": Mock(person_id=attendee_person_id)}
    return member


def _mock_locked_group_member_orphaned(group_id: str, member_id: str = "mem_orphan") -> Mock:
    """Create a mock locked_group_members record with missing attendee expand."""
    member = Mock()
    member.id = member_id
    member.group = group_id
    member.expand = {}
    return member


@pytest.fixture
def _patch_asyncio_to_thread():
    """Patch asyncio.to_thread to run synchronously (project convention)."""
    with patch(
        "api.services.data_fetcher.asyncio.to_thread",
        new_callable=AsyncMock,
        side_effect=lambda f, *args, **kwargs: f(*args, **kwargs),
    ):
        yield


@pytest.fixture
def _patch_build_session_context():
    """Patch build_session_context to return a mock with session_pb_id_filter."""
    with patch(
        "api.services.data_fetcher.build_session_context",
        new_callable=AsyncMock,
        return_value=Mock(session_pb_id_filter='session = "sess_pb_id"'),
    ) as mock_ctx:
        yield mock_ctx


@pytest.mark.usefixtures("_patch_asyncio_to_thread", "_patch_build_session_context")
class TestFetchLockGroups:
    """Test the fetch_lock_groups function."""

    @pytest.mark.asyncio
    async def test_returns_empty_dict_when_no_groups(self):
        """Should return empty dict when no locked groups exist for scenario."""
        mock_pb = Mock()
        mock_pb.collection.return_value.get_full_list.return_value = []

        result = await fetch_lock_groups(
            scenario="scenario_123",
            session_cm_id=100,
            year=2026,
            pb_client=mock_pb,
        )

        assert result == {}

    @pytest.mark.asyncio
    async def test_returns_group_with_person_cm_ids(self):
        """Should return mapping of group ID to person CM IDs."""
        groups = [_mock_locked_group("grp_1", "scenario_123", "sess_pb_id", 2026)]
        members = [
            _mock_locked_group_member("grp_1", 1001),
            _mock_locked_group_member("grp_1", 1002),
            _mock_locked_group_member("grp_1", 1003),
        ]

        mock_pb = Mock()

        def collection_side_effect(name):
            col = Mock()
            if name == "locked_groups":
                col.get_full_list.return_value = groups
            elif name == "locked_group_members":
                col.get_full_list.return_value = members
            else:
                col.get_full_list.return_value = []
            return col

        mock_pb.collection.side_effect = collection_side_effect

        result = await fetch_lock_groups(
            scenario="scenario_123",
            session_cm_id=100,
            year=2026,
            pb_client=mock_pb,
        )

        assert result == {"grp_1": [1001, 1002, 1003]}

    @pytest.mark.asyncio
    async def test_returns_multiple_groups(self):
        """Should handle multiple lock groups correctly."""
        groups = [
            _mock_locked_group("grp_1", "scenario_123", "sess_pb_id", 2026),
            _mock_locked_group("grp_2", "scenario_123", "sess_pb_id", 2026),
        ]
        members = [
            _mock_locked_group_member("grp_1", 1001),
            _mock_locked_group_member("grp_1", 1002),
            _mock_locked_group_member("grp_2", 1003),
            _mock_locked_group_member("grp_2", 1004),
            _mock_locked_group_member("grp_2", 1005),
        ]

        mock_pb = Mock()

        def collection_side_effect(name):
            col = Mock()
            if name == "locked_groups":
                col.get_full_list.return_value = groups
            elif name == "locked_group_members":
                col.get_full_list.return_value = members
            else:
                col.get_full_list.return_value = []
            return col

        mock_pb.collection.side_effect = collection_side_effect

        result = await fetch_lock_groups(
            scenario="scenario_123",
            session_cm_id=100,
            year=2026,
            pb_client=mock_pb,
        )

        assert "grp_1" in result
        assert "grp_2" in result
        assert result["grp_1"] == [1001, 1002]
        assert result["grp_2"] == [1003, 1004, 1005]

    @pytest.mark.asyncio
    async def test_skips_orphaned_members(self):
        """Should skip members where attendee expand is missing (orphaned records)."""
        groups = [_mock_locked_group("grp_1", "scenario_123", "sess_pb_id", 2026)]
        members = [
            _mock_locked_group_member("grp_1", 1001),
            _mock_locked_group_member_orphaned("grp_1"),  # orphaned
            _mock_locked_group_member("grp_1", 1003),
        ]

        mock_pb = Mock()

        def collection_side_effect(name):
            col = Mock()
            if name == "locked_groups":
                col.get_full_list.return_value = groups
            elif name == "locked_group_members":
                col.get_full_list.return_value = members
            else:
                col.get_full_list.return_value = []
            return col

        mock_pb.collection.side_effect = collection_side_effect

        result = await fetch_lock_groups(
            scenario="scenario_123",
            session_cm_id=100,
            year=2026,
            pb_client=mock_pb,
        )

        # Only non-orphaned members included
        assert result == {"grp_1": [1001, 1003]}

"""Tests for lock_groups_data field on DirectSolverInput."""

import pytest

from bunking.models_v2 import DirectBunk, DirectPerson, DirectSolverInput


@pytest.fixture
def minimal_solver_input():
    """Minimal DirectSolverInput with no lock groups."""
    return DirectSolverInput(
        persons=[
            DirectPerson(
                campminder_person_id=1001,
                first_name="Emma",
                last_name="Johnson",
                grade=6,
                birthdate="2014-03-15",
                gender="F",
                session_cm_id=100,
            ),
        ],
        requests=[],
        bunks=[
            DirectBunk(
                id="bunk_1",
                campminder_id=2001,
                name="B-1",
                capacity=12,
                gender="F",
                session_cm_id=100,
            ),
        ],
    )


class TestLockGroupsDataField:
    """Test the lock_groups_data field on DirectSolverInput."""

    def test_lock_groups_data_defaults_to_empty(self, minimal_solver_input):
        """lock_groups_data should default to an empty dict."""
        assert minimal_solver_input.lock_groups_data == {}

    def test_lock_groups_data_can_be_set(self):
        """lock_groups_data can be populated with group ID -> person CM ID mapping."""
        input_data = DirectSolverInput(
            persons=[],
            requests=[],
            bunks=[],
            lock_groups_data={"group_abc": [1001, 1002, 1003]},
        )
        assert input_data.lock_groups_data == {"group_abc": [1001, 1002, 1003]}


class TestGroupLocksProperty:
    """Test the group_locks property returns lock_groups_data when populated."""

    def test_group_locks_returns_lock_groups_data_when_populated(self):
        """group_locks should return lock_groups_data when it has entries."""
        input_data = DirectSolverInput(
            persons=[],
            requests=[],
            bunks=[],
            lock_groups_data={"group_abc": [1001, 1002, 1003]},
        )
        assert input_data.group_locks == {"group_abc": [1001, 1002, 1003]}

    def test_group_locks_empty_when_no_data(self, minimal_solver_input):
        """group_locks should be empty when no lock data exists."""
        assert minimal_solver_input.group_locks == {}

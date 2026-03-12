"""Tests for lock_groups_data field on DirectSolverInput."""

from __future__ import annotations

import pytest

from bunking.models_v2 import DirectBunk, DirectBunkAssignment, DirectPerson, DirectSolverInput


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

    def test_group_locks_falls_back_to_assignment_derived(self):
        """group_locks should fall back to assignment-derived logic when lock_groups_data is empty."""
        input_data = DirectSolverInput(
            persons=[],
            requests=[],
            bunks=[],
            existing_assignments=[
                DirectBunkAssignment(
                    person_cm_id=1001,
                    session_cm_id=100,
                    bunk_cm_id=2001,
                    year=2026,
                    group_lock_id="group_xyz",
                ),
                DirectBunkAssignment(
                    person_cm_id=1002,
                    session_cm_id=100,
                    bunk_cm_id=2001,
                    year=2026,
                    group_lock_id="group_xyz",
                ),
            ],
        )
        assert input_data.group_locks == {"group_xyz": [1001, 1002]}

    def test_group_locks_prefers_lock_groups_data_over_assignments(self):
        """When both lock_groups_data and assignment group_lock_ids exist, prefer lock_groups_data."""
        input_data = DirectSolverInput(
            persons=[],
            requests=[],
            bunks=[],
            lock_groups_data={"group_abc": [1001, 1002]},
            existing_assignments=[
                DirectBunkAssignment(
                    person_cm_id=1003,
                    session_cm_id=100,
                    bunk_cm_id=2001,
                    year=2026,
                    group_lock_id="group_xyz",
                ),
            ],
        )
        # lock_groups_data takes precedence
        assert input_data.group_locks == {"group_abc": [1001, 1002]}

    def test_group_locks_empty_when_no_data(self, minimal_solver_input):
        """group_locks should be empty when no lock data exists."""
        assert minimal_solver_input.group_locks == {}

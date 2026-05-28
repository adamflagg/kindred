"""Tests for bunking.solver.working_set — reduce_to_working_set().

Each task section is clearly delimited so the test file can grow incrementally.
All person/bunk/request fixtures use fictional names per project conventions.
"""

import pytest

from bunking.models_v2 import (
    DirectBunk,
    DirectBunkRequest,
    DirectPerson,
    DirectSolverInput,
)
from bunking.solver.working_set import WorkingSetReduction, reduce_to_working_set

# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

DEFAULT_SESSION = 1000001
DEFAULT_YEAR = 2026
DEFAULT_BIRTHDATE = "2015-06-15"


def _person(cm_id: int, session: int = DEFAULT_SESSION) -> DirectPerson:
    names = [
        ("Emma", "Johnson"),
        ("Liam", "Garcia"),
        ("Olivia", "Chen"),
        ("Noah", "Williams"),
        ("Ava", "Martinez"),
    ]
    first, last = names[cm_id % len(names)]
    return DirectPerson(
        campminder_person_id=cm_id,
        first_name=first,
        last_name=last,
        grade=6,
        birthdate=DEFAULT_BIRTHDATE,
        gender="F",
        session_cm_id=session,
    )


def _bunk(cm_id: int, session: int = DEFAULT_SESSION) -> DirectBunk:
    return DirectBunk(
        id=f"bunk_{cm_id}",
        campminder_id=cm_id,
        name=f"Bunk{cm_id}",
        capacity=12,
        gender="F",
        session_cm_id=session,
    )


def _request(
    req_id: str,
    requester: int,
    requestee: int | None,
    request_type: str = "bunk_with",
    session: int = DEFAULT_SESSION,
) -> DirectBunkRequest:
    return DirectBunkRequest(
        id=req_id,
        requester_person_cm_id=requester,
        requested_person_cm_id=requestee,
        request_type=request_type,
        session_cm_id=session,
        year=DEFAULT_YEAR,
    )


# ---------------------------------------------------------------------------
# Task 1: identity reduction (no locked_bunks)
# ---------------------------------------------------------------------------


def test_empty_locked_bunks_is_identity():
    """reduce_to_working_set with no locked_bunks returns all persons/bunks unchanged."""
    p1, p2 = _person(1), _person(2)
    b1, b2 = _bunk(3001), _bunk(3002)
    inp = DirectSolverInput(persons=[p1, p2], bunks=[b1, b2], requests=[])
    result = reduce_to_working_set(inp)
    assert isinstance(result, WorkingSetReduction)
    assert result.reduced_input is inp  # no-copy identity guarantee
    assert result.frozen_assignments == []
    assert {p.campminder_person_id for p in result.reduced_input.persons} == {1, 2}
    assert {b.campminder_id for b in result.reduced_input.bunks} == {3001, 3002}


# ---------------------------------------------------------------------------
# Task 2: partition frozen vs working persons/bunks
# ---------------------------------------------------------------------------


def test_partitions_frozen_and_working():
    """Persons/bunks in locked_bunks are removed; only working ones remain."""
    p1, p2, p3 = _person(1), _person(2), _person(3)
    b1, b2 = _bunk(3001), _bunk(3002)
    inp = DirectSolverInput(
        persons=[p1, p2, p3],
        bunks=[b1, b2],
        requests=[],
        locked_bunks={3001: [1, 2]},
    )
    result = reduce_to_working_set(inp)
    # Only bunk 3002 remains in the working set
    assert [b.campminder_id for b in result.reduced_input.bunks] == [3002]
    # Only person 3 remains
    assert [p.campminder_person_id for p in result.reduced_input.persons] == [3]
    # locked_bunks cleared on reduced input
    assert result.reduced_input.locked_bunks == {}
    # frozen_assignments contains persons 1 and 2 mapped to bunk 3001
    frozen_pairs = {(fa.person_cm_id, fa.bunk_cm_id) for fa in result.frozen_assignments}
    assert frozen_pairs == {(1, 3001), (2, 3001)}


# ---------------------------------------------------------------------------
# Task 3: narrow requests — any request involving a frozen person is dropped
# ---------------------------------------------------------------------------


def test_intra_working_requests_kept():
    """A request between two working persons is kept."""
    p1, p2 = _person(1), _person(2)
    b1 = _bunk(3001)
    req = _request("r1", requester=1, requestee=2, request_type="bunk_with")
    inp = DirectSolverInput(
        persons=[p1, p2],
        bunks=[b1],
        requests=[req],
        locked_bunks={},
    )
    result = reduce_to_working_set(inp)
    assert len(result.reduced_input.requests) == 1
    assert result.reduced_input.requests[0].id == "r1"


def test_free_to_locked_bunk_with_dropped():
    """working requester → locked target (bunk_with) → dropped from requests."""
    p1 = _person(1)  # working
    p2 = _person(2)  # locked
    b1, b2 = _bunk(3001), _bunk(3002)
    req = _request("r1", requester=1, requestee=2, request_type="bunk_with")
    inp = DirectSolverInput(
        persons=[p1, p2],
        bunks=[b1, b2],
        requests=[req],
        locked_bunks={3001: [2]},
    )
    result = reduce_to_working_set(inp)
    assert result.reduced_input.requests == []


def test_locked_to_free_bunk_with_dropped():
    """locked requester → working target (bunk_with) → dropped from requests."""
    p1 = _person(1)  # locked
    p2 = _person(2)  # working
    b1, b2 = _bunk(3001), _bunk(3002)
    req = _request("r1", requester=1, requestee=2, request_type="bunk_with")
    inp = DirectSolverInput(
        persons=[p1, p2],
        bunks=[b1, b2],
        requests=[req],
        locked_bunks={3001: [1]},
    )
    result = reduce_to_working_set(inp)
    assert result.reduced_input.requests == []


def test_both_locked_bunk_with_dropped():
    """Both persons frozen → request dropped from working set regardless of same/different cabin."""
    p1, p2 = _person(1), _person(2)
    b1, b2 = _bunk(3001), _bunk(3002)
    req = _request("r1", requester=1, requestee=2, request_type="bunk_with")
    inp = DirectSolverInput(
        persons=[p1, p2],
        bunks=[b1, b2],
        requests=[req],
        locked_bunks={3001: [1], 3002: [2]},
    )
    result = reduce_to_working_set(inp)
    assert result.reduced_input.requests == []


def test_not_bunk_with_to_locked_dropped():
    """working → locked not_bunk_with → dropped from requests."""
    p1 = _person(1)  # working
    p2 = _person(2)  # locked
    b1, b2 = _bunk(3001), _bunk(3002)
    req = _request("r1", requester=1, requestee=2, request_type="not_bunk_with")
    inp = DirectSolverInput(
        persons=[p1, p2],
        bunks=[b1, b2],
        requests=[req],
        locked_bunks={3001: [2]},
    )
    result = reduce_to_working_set(inp)
    assert result.reduced_input.requests == []


def test_locked_bunk_missing_from_inp_raises():
    """locked_bunks referencing a bunk absent from inp.bunks is a contract violation."""
    p1 = _person(1)
    b1 = _bunk(3001)
    inp = DirectSolverInput(
        persons=[p1],
        bunks=[b1],
        requests=[],
        locked_bunks={9999: [1]},  # 9999 is not in inp.bunks
    )
    with pytest.raises(ValueError):
        reduce_to_working_set(inp)

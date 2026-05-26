from api.services.solver_runner import resolve_locked_bunk_occupants


def test_resolves_occupants_for_locked_bunks():
    # assignments: (person_cm_id, bunk_cm_id) pairs from the current board state
    assignments = [(1001, 2001), (1002, 2001), (1003, 2002)]
    assert resolve_locked_bunk_occupants([2001], assignments) == {2001: [1001, 1002]}


def test_empty_locked_list_returns_empty_map():
    assert resolve_locked_bunk_occupants([], [(1001, 2001)]) == {}


def test_locked_bunk_with_no_current_occupants_maps_to_empty_list():
    # A locked-but-empty cabin must still appear in the map (frozen empty -> forbids everyone,
    # and a non-empty locked_bunks is what switches the solver into partial mode).
    assert resolve_locked_bunk_occupants([2003], [(1001, 2001)]) == {2003: []}


def test_multiple_locked_bunks():
    assignments = [(1001, 2001), (1002, 2002), (1003, 2002)]
    assert resolve_locked_bunk_occupants([2001, 2002], assignments) == {2001: [1001], 2002: [1002, 1003]}

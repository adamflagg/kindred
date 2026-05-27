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


# ---------------------------------------------------------------------------
# allow_unassigned derivation: bool(locked_bunks) must drive partial-mode
# ---------------------------------------------------------------------------


def test_allow_unassigned_true_when_locked_bunks_non_empty():
    """Non-empty locked_bunk_cm_ids → resolve_locked_bunk_occupants returns a non-empty
    mapping → bool(result) is True → allow_unassigned must be set True (#1609)."""
    result = resolve_locked_bunk_occupants([2001], [(1001, 2001)])
    assert bool(result) is True, "Partial mode flag derivation: non-empty locked_bunks must be truthy"


def test_allow_unassigned_false_when_no_locked_bunks():
    """Empty locked_bunk_cm_ids → resolve_locked_bunk_occupants returns {} →
    bool(result) is False → allow_unassigned must remain False (full solve)."""
    result = resolve_locked_bunk_occupants([], [(1001, 2001)])
    assert bool(result) is False, "Partial mode flag derivation: empty locked_bunks must be falsy"

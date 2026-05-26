from bunking.models_v2 import DirectSolverInput


def test_locked_bunks_defaults_empty():
    inp = DirectSolverInput(persons=[], requests=[], bunks=[])
    assert inp.locked_bunks == {}
    assert inp.allow_overflow is False


def test_locked_bunks_accepts_bunk_to_occupants_map():
    inp = DirectSolverInput(
        persons=[],
        requests=[],
        bunks=[],
        locked_bunks={2001: [1000001, 1000002]},
        allow_overflow=True,
    )
    assert inp.locked_bunks == {2001: [1000001, 1000002]}
    assert inp.allow_overflow is True

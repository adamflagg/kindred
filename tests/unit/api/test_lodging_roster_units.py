"""Unit summaries carry the parent link and the resolved draw level."""

from api.schemas.lodging import LodgingUnitSummary


def test_parent_code_is_a_code_not_a_record_id() -> None:
    summary = LodgingUnitSummary(unit_id="rec1", code="house-a1", name="Room A1", parent_code="house-a")
    assert summary.parent_code == "house-a"


def test_is_combined_defaults_false() -> None:
    # False is today's behaviour: draw the children. A unit nobody has ruled
    # on must never default to hiding its rooms.
    summary = LodgingUnitSummary(unit_id="rec1", code="house-a", name="House A")
    assert summary.is_combined is False
    assert summary.parent_code == ""


def test_scenario_override_beats_the_registry_default() -> None:
    from api.services.lodging_roster_service import resolve_combined

    # No row: inherit the default, in both directions.
    assert resolve_combined(default=True, override=None) is True
    assert resolve_combined(default=False, override=None) is False
    # A row is explicit, and must be able to say False against a True default.
    # That direction is the whole reason the absent row is a third state.
    assert resolve_combined(default=True, override=False) is False
    assert resolve_combined(default=False, override=True) is True


def test_scenario_override_beats_the_weekend_level_override() -> None:
    """1500000140's middle tier does not get to shadow the top one.

    `override` is THIS scenario's own row; `session_override` is the
    weekend-level one (`scenario == ""`). A scenario that has made its own
    call must win even when the weekend-level row disagrees -- this is the
    case that would break first if the two tiers were ever checked in the
    wrong order.
    """
    from api.services.lodging_roster_service import resolve_combined

    assert resolve_combined(default=False, override=False, session_override=True) is False
    assert resolve_combined(default=True, override=True, session_override=False) is True


def test_the_weekend_level_override_beats_the_registry_default() -> None:
    """With no scenario row, the weekend-level row is what the CampMinder
    mirror sees, and what every scenario inherits until it says otherwise.

    Both directions, for the same reason `override` gets both directions
    above: `session_merge_by_unit.get(id)` returning `None` at this tier must
    inherit `default`, not collapse a real `session_override=False` into the
    same outcome as no row at all.
    """
    from api.services.lodging_roster_service import resolve_combined

    assert resolve_combined(default=True, override=None, session_override=False) is False
    assert resolve_combined(default=False, override=None, session_override=True) is True


def test_no_row_at_either_tier_inherits_the_registry_default() -> None:
    from api.services.lodging_roster_service import resolve_combined

    assert resolve_combined(default=True, override=None, session_override=None) is True
    assert resolve_combined(default=False, override=None, session_override=None) is False


def test_a_blank_code_row_is_never_adopted_as_a_no_parents_ancestor() -> None:
    """`by_code` is keyed on `code`, so a registry row with a blank `code`
    occupies the `""` key -- the SAME key `parent_code == ""` uses to mean
    "no parent". Without a guard, a leaf with no parent at all walks straight
    into the blank-code row and inherits whatever that row resolves to.

    Here the blank-code row is a combined container, which would BLOCK the
    root from drawing if the walk ever resolved into it. It must not: an
    empty `parent_code` is no parent, full stop, and the root must draw.
    """
    from api.services.lodging_roster_service import drawn_units

    blank = LodgingUnitSummary(unit_id="rec_blank", code="", name="Blank Code Row", is_container=True, is_combined=True)
    root = LodgingUnitSummary(unit_id="rec_root", code="room", name="Room", parent_code="")

    drawn = drawn_units([blank, root])

    assert "room" in {u.code for u in drawn}


def test_a_cycle_with_no_root_draws_nothing_the_frontend_would_not_draw() -> None:
    """A unit trapped in a cycle gets no card, so it must get no count either.

    This walk and `drawnUnits` in
    `frontend/src/components/weekend/unitLevel.ts` are documented as mirrors,
    and they reach the answer from opposite directions: this one walks UP from
    every unit, the frontend walks DOWN from the roots. A mutual pair naming
    each other has no path from any root, so the frontend never visits it and
    draws no card -- while an upward walk that merely STOPS at a cycle falls
    through to "not blocked" and draws both.

    That gap is the one `drawn_units` exists to close: the counts describing
    units the board will not draw is exactly the "Housing tab and stats bar
    describe different weekends" drift. So a detected cycle blocks, and the
    party placed there rails to `offBoard` -- which `buildBoard` is total over.

    Only reachable on data that predates `guardUnitParentCycle` (#1899) or a
    hand-edited database; the guard refuses to WRITE a new cycle.
    """
    from api.services.lodging_roster_service import drawn_units

    a = LodgingUnitSummary(unit_id="rec_a", code="a", name="Room A", parent_code="b")
    b = LodgingUnitSummary(unit_id="rec_b", code="b", name="Room B", parent_code="a")

    assert drawn_units([a, b]) == []


def test_a_leaf_below_a_cycle_is_blocked_too() -> None:
    """The leaf is not itself in the cycle, but nothing above it is reachable.

    The frontend seeds from roots, and neither the leaf nor either cycle node
    is one, so it draws nothing here. Stopping the upward walk without
    blocking would draw the leaf and disagree.
    """
    from api.services.lodging_roster_service import drawn_units

    p1 = LodgingUnitSummary(unit_id="rec_p1", code="p1", name="Wing 1", parent_code="p2", is_container=True)
    p2 = LodgingUnitSummary(unit_id="rec_p2", code="p2", name="Wing 2", parent_code="p1", is_container=True)
    leaf = LodgingUnitSummary(unit_id="rec_leaf", code="leaf", name="Room", parent_code="p1")

    assert drawn_units([p1, p2, leaf]) == []

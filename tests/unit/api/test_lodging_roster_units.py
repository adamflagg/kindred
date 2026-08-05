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

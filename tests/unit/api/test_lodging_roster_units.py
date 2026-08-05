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

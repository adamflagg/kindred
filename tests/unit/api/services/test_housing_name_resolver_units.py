"""kindred#2775: naming a live `lodging_assignments` row.

A live row stores UNIT IDS, not a string, so the resolver names it from the
ids -- by the same collapse rule `display_name` applies to a resolved string,
so a live row and the string it was ingested from read the same.

Kept out of `test_lodging_rules.py` on purpose: that file is shared with
concurrent work, and this is one method's contract.
"""

from __future__ import annotations

from api.services.lodging_rules import HousingNameResolver, RegistryUnit


def _unit(unit_id: str, code: str, name: str, parent_id: str = "", year: int = 2026) -> RegistryUnit:
    return RegistryUnit(unit_id=unit_id, code=code, name=name, year=year, parent_id=parent_id)


def _resolver() -> HousingNameResolver:
    return HousingNameResolver.build(
        [
            _unit("p1", "cedar", "Cedar Lodge"),
            _unit("u1", "cedar-1", "Cedar Lodge Room 1", parent_id="p1"),
            _unit("u2", "cedar-2", "Cedar Lodge Room 2", parent_id="p1"),
            _unit("u3", "meadow-1", "Meadow House 1"),
        ],
        [],
    )


def test_one_unit_is_its_name_today() -> None:
    assert _resolver().display_name_for_unit_ids(["u3"]) == "Meadow House 1"


def test_two_rooms_of_one_container_collapse_to_the_container() -> None:
    assert _resolver().display_name_for_unit_ids(["u1", "u2"]) == "Cedar Lodge"


def test_an_id_the_registry_no_longer_holds_names_nothing() -> None:
    # All or nothing, as `resolve_codes` is: a vanished member is not dropped.
    assert _resolver().display_name_for_unit_ids(["u3", "gone"]) == ""


def test_no_ids_names_nothing() -> None:
    assert _resolver().display_name_for_unit_ids([]) == ""
